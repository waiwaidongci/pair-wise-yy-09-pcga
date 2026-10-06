import { createMemo, createRoot, createSignal } from "solid-js";
import type { DesignToken, Snapshot, Theme, TokenKind } from "../types/tokens";
import { runMerge } from "./mergeEngine";
import { seedThemes } from "./seed";
import type { ClientInfo, Conflict, ConflictResolution, PendingOp } from "./types";
import {
  CHECKPOINT_KEY,
  HEARTBEAT_MS,
  LOCK_TTL_MS,
  STALE_CLIENT_MS,
  type CheckpointDoc,
  type CollabStateDoc,
  type StorageLike,
  clearCheckpoint,
  collectOutboxKeys,
  isClientOffline,
  outboxKey,
  readAllOutboxes,
  readCheckpoint,
  readClients,
  readOutbox,
  readState,
  setClientOffline,
  writeCheckpoint,
  writeClients,
  writeOutbox,
  writeState,
  initialRevisionsForThemes,
} from "./storage";

const LOCK_KEY = "token-forge-merge-lock-v1";
const SESSION_CLIENT_KEY = "token-forge-client-id";
const MERGE_DEBOUNCE_MS = 180;
const offlineKey = (clientId: string) => `token-forge-offline-v1:${clientId}`;

interface LockDoc {
  ownerClientId: string;
  at: number;
}

export interface WorkspaceEnv {
  storage: StorageLike;
  session: StorageLike;
  /** 跨实例事件总线；浏览器环境用原生 storage 事件，测试环境注入内存总线。 */
  bus?: { emit: (key: string) => void; on: (key: string, cb: (key: string) => void) => void };
  now?: () => number;
  idle?: (ms: number, cb: () => void) => number;
  clearIdle?: (id: number) => void;
  interval?: (ms: number, cb: () => void) => number;
  clearInterval?: (id: number) => void;
  onHide?: (cb: () => void) => void;
  onStorageEvent?: (cb: (key: string) => void) => void;
  clientId?: string;
}

type ResolvedEnv = Required<Pick<WorkspaceEnv, "storage" | "session" | "now" | "idle" | "clearIdle" | "interval" | "clearInterval">> &
  Pick<WorkspaceEnv, "bus" | "onHide" | "onStorageEvent" | "clientId">;

export interface TokenStatus {
  localPending: boolean;
  conflicted: boolean;
}

function emptyTokens(): Theme["tokens"] {
  return { color: [], fontSize: [], spacing: [], radius: [], shadow: [], motion: [] };
}

/** 把一个窗口的待处理操作投影到确认版本之上，得到仅供本窗口编辑/参考的草稿，不影响确认版本。 */
export function applyOps(theme: Theme, ops: PendingOp[]): Theme {
  const draft: Theme = { ...theme, tokens: { ...emptyTokens() } } as Theme;
  for (const kind of Object.keys(theme.tokens) as TokenKind[]) {
    draft.tokens[kind] = theme.tokens[kind].map((token) => ({ ...token }));
  }
  for (const op of [...ops].sort((a, b) => a.at - b.at)) {
    if (op.type === "remove") {
      draft.tokens[op.kind] = draft.tokens[op.kind].filter((token) => token.id !== op.tokenId);
      continue;
    }
    let token = draft.tokens[op.kind].find((item) => item.id === op.tokenId);
    if (!token) {
      token = { id: op.tokenId, name: "", value: "", description: "" };
      draft.tokens[op.kind] = [...draft.tokens[op.kind], token];
    }
    if (op.after) Object.assign(token, structuredClone(op.after));
  }
  return draft;
}

export class CollabWorkspace {
  private env: ResolvedEnv;
  readonly clientId: string;

  private stateDoc!: CollabStateDoc;
  private themesSignal!: ReturnType<typeof createSignal<Theme[]>>[0];
  private setThemes!: ReturnType<typeof createSignal<Theme[]>>[1];
  private activeThemeIdSignal!: ReturnType<typeof createSignal<string>>[0];
  private setActiveThemeIdSignal!: ReturnType<typeof createSignal<string>>[1];
  private snapshotsSignal!: ReturnType<typeof createSignal<Snapshot[]>>[0];
  private setSnapshots!: ReturnType<typeof createSignal<Snapshot[]>>[1];
  private conflictsSignal!: ReturnType<typeof createSignal<Conflict[]>>[0];
  private setConflicts!: ReturnType<typeof createSignal<Conflict[]>>[1];
  private revisionsSignal!: ReturnType<typeof createSignal<Record<string, Theme[]>>>[0];
  private setRevisions!: ReturnType<typeof createSignal<Record<string, Theme[]>>>[1];

  private localOpsSignal!: ReturnType<typeof createSignal<PendingOp[]>>[0];
  private setLocalOps!: ReturnType<typeof createSignal<PendingOp[]>>[1];
  private allOpsSignal!: ReturnType<typeof createSignal<PendingOp[]>>[0];
  private setAllOps!: ReturnType<typeof createSignal<PendingOp[]>>[1];
  private clientsSignal!: ReturnType<typeof createSignal<ClientInfo[]>>[0];
  private setClientsList!: ReturnType<typeof createSignal<ClientInfo[]>>[1];
  private onlineSignal!: ReturnType<typeof createSignal<boolean>>[0];
  private setOnlineSignal!: ReturnType<typeof createSignal<boolean>>[1];
  private mergeErrorSignal!: ReturnType<typeof createSignal<string | undefined>>[0];
  private setMergeError!: ReturnType<typeof createSignal<string | undefined>>[1];
  private mergingSignal!: ReturnType<typeof createSignal<boolean>>[0];
  private setMerging!: ReturnType<typeof createSignal<boolean>>[1];
  private checkpointSignal!: ReturnType<typeof createSignal<CheckpointDoc | undefined>>[0];
  private setCheckpoint!: ReturnType<typeof createSignal<CheckpointDoc | undefined>>[1];

  private mergeTimer: number | undefined;
  private injectNextFailure = false;

  constructor(env: WorkspaceEnv) {
    this.env = {
      storage: env.storage,
      session: env.session,
      bus: env.bus,
      now: env.now ?? (() => Date.now()),
      idle: env.idle ?? ((ms, cb) => setTimeout(cb, ms) as unknown as number),
      clearIdle: env.clearIdle ?? ((id) => clearTimeout(id)),
      interval: env.interval ?? ((ms, cb) => setInterval(cb, ms) as unknown as number),
      clearInterval: env.clearInterval ?? ((id) => clearInterval(id)),
      onHide: env.onHide,
      onStorageEvent: env.onStorageEvent,
      clientId: env.clientId,
    };

    this.clientId = this.acquireClientIdentity();
    // 工作台脱离组件树存在（跨页面共享单例/测试环境同样使用），显式创建响应式根，
    // 否则 createMemo 在无 owner 时只会计算一次，草稿/冲突视图不会随后续改动更新。
    this.disposeRoot = createRoot((dispose) => {
      this.bootstrapSignals();
      this.wireEvents();
      this.startHeartbeat();
      // 启动时若有待处理改动且在线，立即尝试续作合并。
      this.scheduleMerge(0);
      return dispose;
    });
  }

  private disposeRoot!: () => void;

  /** 释放响应式根与资源（主要供测试/热重载使用）。 */
  dispose(): void {
    this.disposeRoot?.();
  }

  // ---- 初始化与持久化 ----

  private seedDoc(): CollabStateDoc {
    const themes = seedThemes();
    return {
      themes,
      activeThemeId: themes[0].id,
      snapshots: [],
      revisions: initialRevisionsForThemes(themes),
      conflicts: [],
    };
  }

  private acquireClientIdentity(): string {
    const { storage, session } = this.env;
    const existingId = session.getItem(SESSION_CLIENT_KEY);
    let clients = readClients(storage);
    const now = this.env.now();

    if (existingId && clients.some((client) => client.id === existingId)) {
      clients = clients.map((client) => (client.id === existingId ? { ...client, open: true, lastSeen: now } : client));
      writeClients(storage, clients);
      return existingId;
    }

    // 重开窗口：优先认领一个明确已关闭的身份（它的待处理改动随之回来）；
    // 没有关闭身份时，再回收心跳超时的失活身份。绝不抢占仍在线的窗口。
    const closed = clients.filter((client) => !client.open).sort((a, b) => a.lastSeen - b.lastSeen)[0];
    const stale =
      closed ??
      clients.filter((client) => now - client.lastSeen > STALE_CLIENT_MS).sort((a, b) => a.lastSeen - b.lastSeen)[0];
    if (stale) {
      clients = clients.map((client) => (client.id === stale.id ? { ...client, open: true, lastSeen: now } : client));
      writeClients(storage, clients);
      session.setItem(SESSION_CLIENT_KEY, stale.id);
      return stale.id;
    }

    const id = this.env.clientId ?? `client-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const usedLabels = new Set(clients.map((client) => client.label));
    const label = ["窗口 A", "窗口 B", "窗口 C", "窗口 D"].find((item) => !usedLabels.has(item)) ?? `窗口 ${clients.length + 1}`;
    clients = [...clients, { id, label, lastSeen: now, open: true }];
    writeClients(storage, clients);
    session.setItem(SESSION_CLIENT_KEY, id);
    return id;
  }

  private bootstrapSignals(): void {
    this.stateDoc = readState(this.env.storage, () => this.seedDoc());
    // 所有信号先声明并立刻挂到实例字段上，再创建备忘录；
    // 否则备忘录首次求值时 this.xxxSignal 还是 undefined，响应式追踪会失效。
    const [themes, setThemes] = createSignal<Theme[]>(this.stateDoc.themes);
    const [activeThemeId, setActiveThemeId] = createSignal<string>(this.stateDoc.activeThemeId);
    const [snapshots, setSnapshots] = createSignal<Snapshot[]>(this.stateDoc.snapshots);
    const [conflicts, setConflicts] = createSignal<Conflict[]>(this.stateDoc.conflicts);
    const [revisions, setRevisions] = createSignal<Record<string, Theme[]>>(this.stateDoc.revisions);
    this.themesSignal = themes;
    this.setThemes = setThemes;
    this.activeThemeIdSignal = activeThemeId;
    this.setActiveThemeIdSignal = setActiveThemeId;
    this.snapshotsSignal = snapshots;
    this.setSnapshots = setSnapshots;
    this.conflictsSignal = conflicts;
    this.setConflicts = setConflicts;
    this.revisionsSignal = revisions;
    this.setRevisions = setRevisions;

    const [localOpsSignal, setLocalOps] = createSignal<PendingOp[]>(readOutbox(this.env.storage, this.clientId));
    const [allOpsSignal, setAllOps] = createSignal<PendingOp[]>(this.collectAllOps());
    this.localOpsSignal = localOpsSignal;
    this.setLocalOps = setLocalOps;
    this.allOpsSignal = allOpsSignal;
    this.setAllOps = setAllOps;

    const [clientsSignal, setClientsList] = createSignal<ClientInfo[]>(readClients(this.env.storage));
    const [onlineSignal, setOnline] = createSignal<boolean>(!isClientOffline(this.env.storage, this.clientId));
    const [mergeErrorSignal, setMergeError] = createSignal<string | undefined>(undefined);
    const [mergingSignal, setMerging] = createSignal<boolean>(false);
    const checkpoint = readCheckpoint(this.env.storage);
    const [checkpointSignal, setCheckpoint] = createSignal<CheckpointDoc | undefined>(
      checkpoint?.ownerClientId === this.clientId ? checkpoint : undefined,
    );
    this.clientsSignal = clientsSignal;
    this.setClientsList = setClientsList;
    this.onlineSignal = onlineSignal;
    this.setOnlineSignal = setOnline;
    this.mergeErrorSignal = mergeErrorSignal;
    this.setMergeError = setMergeError;
    this.mergingSignal = mergingSignal;
    this.setMerging = setMerging;
    this.checkpointSignal = checkpointSignal;
    this.setCheckpoint = setCheckpoint;

    this.activeTheme = createMemo<Theme>(() => {
      const id = this.activeThemeIdSignal();
      return this.themesSignal().find((theme) => theme.id === id) ?? this.themesSignal()[0];
    });
    this.revisionOfActive = createMemo<number>(() => Math.max(0, (this.revisionsSignal()[this.activeThemeIdSignal()]?.length ?? 1) - 1));
    this.draftTheme = createMemo<Theme>(() =>
      applyOps(this.activeTheme(), this.localOpsSignal().filter((op) => op.themeId === this.activeThemeIdSignal())),
    );
    this.clientLabel = createMemo<string>(() => this.clientsSignal().find((client) => client.id === this.clientId)?.label ?? this.clientId);
    this.themeConflicts = createMemo<Conflict[]>(() => this.conflictsSignal().filter((conflict) => conflict.themeId === this.activeThemeIdSignal()));
    this.hasPendingResolution = createMemo<boolean>(() => this.conflictsSignal().some((conflict) => Boolean(conflict.resolution)));
  }

  private wireEvents(): void {
    const handle = (key: string) => {
      if (key.startsWith("token-forge-outbox") || key === "token-forge-clients-v1") {
        this.setAllOps(this.collectAllOps());
        this.setClientsList(readClients(this.env.storage));
        if (key.startsWith("token-forge-outbox")) this.scheduleMerge();
      } else if (key === offlineKey(this.clientId)) {
        const online = !isClientOffline(this.env.storage, this.clientId);
        this.setOnlineSignal(online);
        if (online) this.scheduleMerge(0);
      } else if (key === "token-forge-collab-v2") {
        this.reloadFromState();
      } else if (key === CHECKPOINT_KEY) {
        const checkpoint = readCheckpoint(this.env.storage);
        this.setCheckpoint(checkpoint?.ownerClientId === this.clientId ? checkpoint : undefined);
      }
    };
    this.env.onStorageEvent?.(handle);
    this.env.bus?.on("*", handle);
  }

  private emit(key: string): void {
    this.env.bus?.emit(key);
  }

  private startHeartbeat(): void {
    const beat = () => {
      const clients = readClients(this.env.storage).map((client) =>
        client.id === this.clientId ? { ...client, lastSeen: this.env.now(), open: true } : client,
      );
      writeClients(this.env.storage, clients);
      this.setClientsList(clients);
    };
    this.env.interval(HEARTBEAT_MS, beat);
    this.env.onHide?.(() => {
      const clients = readClients(this.env.storage).map((client) =>
        client.id === this.clientId ? { ...client, open: false } : client,
      );
      writeClients(this.env.storage, clients);
      this.setClientsList(clients);
    });
  }

  private reloadFromState(): void {
    const doc = readState(this.env.storage, () => this.seedDoc());
    this.stateDoc = doc;
    this.setThemes(doc.themes);
    this.setActiveThemeIdSignal(doc.activeThemeId);
    this.setSnapshots(doc.snapshots);
    this.setConflicts(doc.conflicts);
    this.setRevisions(doc.revisions);
    this.setAllOps(this.collectAllOps());
    const localOps = readOutbox(this.env.storage, this.clientId);
    this.setLocalOps(localOps);
  }

  private collectAllOps(): PendingOp[] {
    return readAllOutboxes(this.env.storage)
      .flatMap((entry) => entry.ops)
      .sort((a, b) => a.at - b.at);
  }

  private persistStateDoc(): void {
    this.stateDoc.themes = this.themesSignal();
    this.stateDoc.activeThemeId = this.activeThemeIdSignal();
    this.stateDoc.snapshots = this.snapshotsSignal();
    this.stateDoc.conflicts = this.conflictsSignal();
    writeState(this.env.storage, this.stateDoc);
    this.emit("token-forge-collab-v2");
  }

  // ---- 只读视图（确认版本 + 草稿） ----

  get themes() {
    return this.themesSignal;
  }
  get snapshots() {
    return this.snapshotsSignal;
  }
  get conflicts() {
    return this.conflictsSignal;
  }
  get clients() {
    return this.clientsSignal;
  }
  get online() {
    return this.onlineSignal;
  }
  get mergeError() {
    return this.mergeErrorSignal;
  }
  get merging() {
    return this.mergingSignal;
  }
  get checkpoint() {
    return this.checkpointSignal;
  }
  get allPendingOps() {
    return this.allOpsSignal;
  }
  get localPendingOps() {
    return this.localOpsSignal;
  }
  get revisions() {
    return this.revisionsSignal;
  }

  get activeThemeId() {
    return this.activeThemeIdSignal;
  }

  setActiveThemeId = (id: string): void => {
    this.setActiveThemeIdSignal(id);
    this.persistStateDoc();
  };

  /** 确认版本中的当前主题；预览、版本差异、导出均读它，未裁决改动不会污染。 */
  activeTheme!: ReturnType<typeof createMemo<Theme>>;
  /** 当前主题在确认修订链上的修订号。 */
  revisionOfActive!: ReturnType<typeof createMemo<number>>;
  /** 本窗口待处理改动投影在确认版本之上的草稿，仅供编辑器使用。 */
  draftTheme!: ReturnType<typeof createMemo<Theme>>;
  clientLabel!: ReturnType<typeof createMemo<string>>;
  themeConflicts!: ReturnType<typeof createMemo<Conflict[]>>;
  hasPendingResolution!: ReturnType<typeof createMemo<boolean>>;

  tokenStatus(kind: TokenKind, tokenId: string): TokenStatus {
    const themeId = this.activeThemeIdSignal();
    return {
      localPending: this.localOpsSignal().some((op) => op.themeId === themeId && op.kind === kind && op.tokenId === tokenId),
      conflicted: this.conflictsSignal().some((conflict) => conflict.themeId === themeId && conflict.tokenId === tokenId),
    };
  }

  // ---- 编辑：改动先记窗口、令牌与基线修订 ----

  private baseRevision(themeId: string): number {
    const history = this.stateDoc.revisions[themeId];
    return Math.max(0, (history?.length ?? 1) - 1);
  }

  private appendLocalOps(ops: PendingOp[]): void {
    const current = readOutbox(this.env.storage, this.clientId);
    const next = [...current, ...ops];
    writeOutbox(this.env.storage, this.clientId, next);
    this.setLocalOps(next);
    this.setAllOps(this.collectAllOps());
    this.emit(outboxKey(this.clientId));
    this.scheduleMerge();
  }

  private replaceLocalOps(ops: PendingOp[]): void {
    writeOutbox(this.env.storage, this.clientId, ops);
    this.setLocalOps(ops);
    this.setAllOps(this.collectAllOps());
    this.emit(outboxKey(this.clientId));
    this.scheduleMerge();
  }

  updateToken = (kind: TokenKind, id: string, patch: Partial<Pick<DesignToken, "name" | "value" | "description">>): void => {
    const themeId = this.activeThemeIdSignal();
    const now = this.env.now();
    const baseRevision = this.baseRevision(themeId);
    const coalesceKey = `${kind}:${id}`;
    const stored = readOutbox(this.env.storage, this.clientId);
    const existing = [...stored]
      .reverse()
      .find((op) => op.themeId === themeId && op.coalesceKey === coalesceKey && op.type === "upsert" && op.baseRevision === baseRevision);

    if (existing) {
      existing.at = now;
      existing.after = { ...(existing.after ?? {}), ...structuredClone(patch) };
      this.replaceLocalOps(stored);
      return;
    }

    this.appendLocalOps([
      {
        id: `op-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        themeId,
        tokenId: id,
        kind,
        clientId: this.clientId,
        coalesceKey,
        at: now,
        baseRevision,
        type: "upsert",
        after: structuredClone(patch),
      },
    ]);
  };

  addToken = (kind: TokenKind): DesignToken => {
    const themeId = this.activeThemeIdSignal();
    const now = this.env.now();
    const token: DesignToken = {
      id: `${kind}-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${kind}.custom.${this.draftTheme().tokens[kind].length + 1}`,
      value: kind === "color" ? "#4f46e5" : kind === "shadow" ? "0 8px 24px rgb(0 0 0 / 0.12)" : "8px",
      description: "自定义令牌",
    };
    this.appendLocalOps([
      {
        id: `op-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        themeId,
        tokenId: token.id,
        kind,
        clientId: this.clientId,
        coalesceKey: `${kind}:${token.id}`,
        at: now,
        baseRevision: this.baseRevision(themeId),
        type: "upsert",
        after: { name: token.name, value: token.value, description: token.description },
      },
    ]);
    return token;
  };

  removeToken = (kind: TokenKind, id: string): void => {
    const themeId = this.activeThemeIdSignal();
    const committed = this.activeTheme().tokens[kind].some((token) => token.id === id);
    const stored = readOutbox(this.env.storage, this.clientId);
    // 取消一个尚未确认的新增：直接撤回本窗口相关操作，避免“删了又复活”。
    if (!committed) {
      this.replaceLocalOps(stored.filter((op) => !(op.themeId === themeId && op.tokenId === id)));
      return;
    }
    // 记录移除意图，并丢掉本窗口对该令牌尚未提交的编辑（以最终移除为准；与他窗编辑仍会撞出冲突）。
    const kept = stored.filter((op) => !(op.themeId === themeId && op.tokenId === id));
    const now = this.env.now();
    kept.push({
      id: `op-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      themeId,
      tokenId: id,
      kind,
      clientId: this.clientId,
      coalesceKey: `${kind}:${id}:remove`,
      at: now,
      baseRevision: this.baseRevision(themeId),
      type: "remove",
    });
    this.replaceLocalOps(kept);
  };

  // ---- 网络与合并 ----

  setOnline(online: boolean): void {
    setClientOffline(this.env.storage, this.clientId, !online);
    this.setOnlineSignal(online);
    this.emit(offlineKey(this.clientId));
    if (online) this.scheduleMerge(0);
  }

  armNextMergeFailure(): void {
    this.injectNextFailure = true;
  }

  private scheduleMerge(delay = MERGE_DEBOUNCE_MS): void {
    if (isClientOffline(this.env.storage, this.clientId)) return;
    if (this.mergeTimer !== undefined) this.env.clearIdle(this.mergeTimer);
    this.mergeTimer = this.env.idle(delay, () => {
      this.mergeTimer = undefined;
      void this.mergeNow();
    });
  }

  private acquireLock(): boolean {
    const { storage } = this.env;
    const now = this.env.now();
    try {
      const raw = storage.getItem(LOCK_KEY);
      if (raw) {
        const lock = JSON.parse(raw) as LockDoc;
        if (lock.ownerClientId !== this.clientId && now - lock.at < LOCK_TTL_MS) return false;
      }
      storage.setItem(LOCK_KEY, JSON.stringify({ ownerClientId: this.clientId, at: now } satisfies LockDoc));
      return true;
    } catch {
      return false;
    }
  }

  private releaseLock(): void {
    try {
      const raw = this.env.storage.getItem(LOCK_KEY);
      if (raw) {
        const lock = JSON.parse(raw) as LockDoc;
        if (lock.ownerClientId === this.clientId) this.env.storage.removeItem(LOCK_KEY);
      }
    } catch {
      // 锁损坏时忽略，TTL 会兜底
    }
  }

  /**
   * 网络恢复后的逐令牌合并。全程加锁串行化；合并前写检查点，失败不触碰确认版本，
   * 可从检查点恢复到合并前的状态与各窗口待处理操作。
   */
  async mergeNow(): Promise<void> {
    if (isClientOffline(this.env.storage, this.clientId)) return;
    // 存在未清除的检查点说明上一轮合并在写入新修订前中断：状态存疑，
    // 任何窗口都不得越过它继续合并。持有者恢复、其他窗口等待，不做重试风暴。
    const pendingCheckpoint = readCheckpoint(this.env.storage);
    if (pendingCheckpoint) {
      if (pendingCheckpoint.ownerClientId === this.clientId) {
        this.setMergeError("上一轮合并在写入前失败，已从检查点暂停；请恢复后续作");
        this.setCheckpoint(pendingCheckpoint);
      }
      return;
    }
    if (!this.acquireLock()) {
      this.scheduleMerge(240);
      return;
    }
    this.setMerging(true);
    try {
      const fresh = readState(this.env.storage, () => this.seedDoc());
      const outboxes = readAllOutboxes(this.env.storage);
      const allOps = outboxes.flatMap((entry) => entry.ops);
      if (!allOps.length) {
        this.setMergeError(undefined);
        return;
      }

      // 只有已恢复网络的窗口才把待处理操作交给本轮合并；仍离线窗口的操作原样保留。
      const onlineClientIds = new Set(
        outboxes
          .map((entry) => entry.clientId)
          .filter((clientId) => !isClientOffline(this.env.storage, clientId)),
      );
      // 还需包含没有任何待处理操作、但在线并可能拥有已存冲突的窗口（标签映射需要）。
      for (const client of readClients(this.env.storage)) {
        if (!isClientOffline(this.env.storage, client.id)) onlineClientIds.add(client.id);
      }
      const mergeableOps = allOps.filter((op) => onlineClientIds.has(op.clientId));
      if (!mergeableOps.length) {
        // 有待处理操作但全部来自仍离线的窗口：本窗口无事可做。
        this.setMerging(false);
        this.releaseLock();
        return;
      }

      // 检查点：合并前的确认状态 + 所有窗口待处理操作（含离线窗口，恢复时原样还原）。
      const checkpoint: CheckpointDoc = {
        savedAt: this.env.now(),
        reason: "merge",
        state: structuredClone(fresh),
        outboxes: Object.fromEntries(outboxes.map((entry) => [entry.clientId, structuredClone(entry.ops)])),
        ownerClientId: this.clientId,
      };
      writeCheckpoint(this.env.storage, checkpoint);
      this.emit(CHECKPOINT_KEY);

      const shouldFail = this.injectNextFailure;
      this.injectNextFailure = false;
      const output = runMerge({
        themes: fresh.themes,
        revisions: fresh.revisions,
        ops: mergeableOps,
        conflicts: fresh.conflicts,
        clientLabels: Object.fromEntries(readClients(this.env.storage).map((client) => [client.id, client.label])),
        injectFailure: shouldFail,
      });

      // 已裁决冲突本轮已从 output.conflicts 移除，其主题信息从合并前的冲突列表里取。
      const freshConflictTheme = new Map(fresh.conflicts.map((conflict) => [conflict.id, conflict.themeId]));
      const resolvedThemeIds = new Set(
        output.resolvedConflictIds.map((id) => freshConflictTheme.get(id)).filter((id): id is string => Boolean(id)),
      );
      const snapshots = [...fresh.snapshots];
      for (const themeId of resolvedThemeIds) {
        if (!output.bumpedThemeIds.includes(themeId)) continue;
        const theme = output.themes.find((item) => item.id === themeId);
        if (!theme) continue;
        const revision = (output.revisions[themeId]?.length ?? 1) - 1;
        const snapshot: Snapshot = {
          id: `snapshot-${this.env.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          label: `协作裁决提交 · r${revision}`,
          createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
          revision,
          theme: structuredClone(theme),
        };
        snapshots.unshift(snapshot);
      }

      const nextDoc: CollabStateDoc = {
        ...fresh,
        themes: output.themes,
        revisions: output.revisions,
        conflicts: output.conflicts,
        snapshots,
      };
      writeState(this.env.storage, nextDoc);

      // 已消化的操作从各窗口 outbox 移除；未裁决冲突引用的操作原样保留。
      const consumed = new Set(output.consumedOpIds);
      for (const entry of outboxes) {
        const remaining = entry.ops.filter((op) => !consumed.has(op.id));
        writeOutbox(this.env.storage, entry.clientId, remaining);
      }
      clearCheckpoint(this.env.storage);
      this.setCheckpoint(undefined);
      this.setMergeError(undefined);
      this.emit(CHECKPOINT_KEY);
      this.emit("token-forge-collab-v2");
      for (const key of collectOutboxKeys(this.env.storage)) this.emit(key);
      this.reloadFromState();
    } catch (error) {
      // 合并失败：新修订未写入，确认版本与 outbox 保持检查点内容，等待人工恢复。
      this.setMergeError(error instanceof Error ? error.message : "合并失败");
    } finally {
      this.releaseLock();
      this.setMerging(false);
    }
  }

  /** 从检查点恢复：仅由持检查点的窗口执行，还原状态与所有待处理改动后重新可合并。 */
  recoverFromCheckpoint(): void {
    const checkpoint = readCheckpoint(this.env.storage);
    if (!checkpoint || checkpoint.ownerClientId !== this.clientId) return;
    writeState(this.env.storage, checkpoint.state);
    for (const [clientId, ops] of Object.entries(checkpoint.outboxes)) {
      writeOutbox(this.env.storage, clientId, ops);
    }
    clearCheckpoint(this.env.storage);
    this.setCheckpoint(undefined);
    this.setMergeError(undefined);
    this.emit(CHECKPOINT_KEY);
    this.emit("token-forge-collab-v2");
    for (const key of collectOutboxKeys(this.env.storage)) this.emit(key);
    this.reloadFromState();
    // 恢复完成，重新安排合并（检查点已清除，可以安全续作）。
    this.scheduleMerge(0);
  }

  // ---- 冲突裁决：暂存选择，提交时才产生新确认修订与快照 ----

  setResolution(conflictId: string, resolution: ConflictResolution | undefined): void {
    const doc = readState(this.env.storage, () => this.seedDoc());
    doc.conflicts = doc.conflicts.map((conflict) =>
      conflict.id === conflictId ? { ...conflict, resolution, updatedAt: this.env.now() } : conflict,
    );
    writeState(this.env.storage, doc);
    this.emit("token-forge-collab-v2");
    this.reloadFromState();
    this.scheduleMerge(0);
  }

  resolveAllWith(proposalOpId: string): void {
    const doc = readState(this.env.storage, () => this.seedDoc());
    doc.conflicts = doc.conflicts.map((conflict) =>
      conflict.proposals.some((proposal) => proposal.opId === proposalOpId)
        ? { ...conflict, resolution: { type: "proposal", opId: proposalOpId }, updatedAt: this.env.now() }
        : conflict,
    );
    writeState(this.env.storage, doc);
    this.emit("token-forge-collab-v2");
    this.reloadFromState();
    this.scheduleMerge(0);
  }

  // ---- 主题管理、快照与导入 ----

  createTheme = (name: string, sourceId?: string): string => {
    const source = this.stateDoc.themes.find((theme) => theme.id === (sourceId ?? this.activeThemeIdSignal())) ?? this.stateDoc.themes[0];
    const id = `theme-${this.env.now().toString(36)}`;
    const theme: Theme = { ...structuredClone(source), id, name };
    const doc = readState(this.env.storage, () => this.seedDoc());
    doc.themes = [...doc.themes, theme];
    doc.revisions[theme.id] = [structuredClone(theme)];
    doc.activeThemeId = id;
    writeState(this.env.storage, doc);
    this.emit("token-forge-collab-v2");
    this.reloadFromState();
    return id;
  };

  saveSnapshot = (label: string): void => {
    const theme = this.activeTheme();
    const revision = this.baseRevision(theme.id);
    const snapshot: Snapshot = {
      id: `snapshot-${this.env.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      label: label.trim() || `快照 ${this.snapshotsSignal().length + 1}`,
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      revision,
      theme: structuredClone(theme),
    };
    const doc = readState(this.env.storage, () => this.seedDoc());
    doc.snapshots = [snapshot, ...doc.snapshots];
    writeState(this.env.storage, doc);
    this.emit("token-forge-collab-v2");
    this.reloadFromState();
  };

  replaceTheme = (theme: Theme): void => {
    const doc = readState(this.env.storage, () => this.seedDoc());
    doc.themes = [...doc.themes.filter((item) => item.id !== theme.id), theme];
    doc.revisions[theme.id] = [structuredClone(theme)];
    doc.activeThemeId = theme.id;
    writeState(this.env.storage, doc);
    this.emit("token-forge-collab-v2");
    this.reloadFromState();
  };

  switchClient(clientId: string): void {
    if (clientId === this.clientId) return;
    const now = this.env.now();
    const clients = readClients(this.env.storage).map((client) => {
      if (client.id === this.clientId) return { ...client, open: false };
      if (client.id === clientId) return { ...client, open: true, lastSeen: now };
      return client;
    });
    writeClients(this.env.storage, clients);
    this.env.session.setItem(SESSION_CLIENT_KEY, clientId);
    // 演示用：直接重新加载页面以完成身份切换。
    if (typeof location !== "undefined") location.reload();
  }

  reset = (): void => {
    const storage = this.env.storage;
    collectOutboxKeys(storage).forEach((key) => storage.removeItem(key));
    clearCheckpoint(storage);
    storage.removeItem(LOCK_KEY);
    const seeded = this.seedDoc();
    writeState(storage, seeded);
    this.emit("token-forge-collab-v2");
    this.reloadFromState();
  };
}
