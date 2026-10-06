import type { Snapshot, Theme } from "../types/tokens";
import type { ClientInfo, Conflict, PendingOp } from "./types";

export const STATE_KEY = "token-forge-collab-v2";
export const CLIENTS_KEY = "token-forge-clients-v1";
export const CHECKPOINT_KEY = "token-forge-checkpoint-v1";
const OUTBOX_PREFIX = "token-forge-outbox-v1:";
const OFFLINE_PREFIX = "token-forge-offline-v1:";
const LEGACY_STATE_KEY = "token-forge-workspace-v1";

export const LOCK_TTL_MS = 6_000;
export const HEARTBEAT_MS = 1_500;
export const STALE_CLIENT_MS = 8_000;
export const MAX_REVISIONS = 200;

export interface CollabStateDoc {
  /** 已确认版本：预览、版本差异、导出都读这些主题。 */
  themes: Theme[];
  activeThemeId: string;
  snapshots: Snapshot[];
  /** revisions[themeId] 是该主题的确认修订链，索引即修订号。 */
  revisions: Record<string, Theme[]>;
  conflicts: Conflict[];
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear" | "key" | "length">;

export interface CheckpointDoc {
  savedAt: number;
  reason: string;
  state: CollabStateDoc;
  /** 检查点之前已写入的 outbox（按 clientId 分键），恢复时一并还原。 */
  outboxes: Record<string, PendingOp[]>;
  /** 合并时持锁的窗口，恢复仅它自己可执行。 */
  ownerClientId: string;
}

interface LegacyState {
  themes?: Theme[];
  activeThemeId?: string;
  snapshots?: Snapshot[];
}

function initialRevisions(themes: Theme[]): Record<string, Theme[]> {
  return Object.fromEntries(themes.map((theme) => [theme.id, [structuredClone(theme)]]));
}

/**
 * 升级旧版工作台数据：原主题、原快照继续可用；
 * 每个旧主题的当前内容登记为第 0 号确认修订，升级后一切编辑都以它为基线。
 */
export function migrateLegacy(storage: StorageLike): CollabStateDoc | undefined {
  const raw = storage.getItem(LEGACY_STATE_KEY);
  if (!raw) return undefined;
  try {
    const legacy = JSON.parse(raw) as LegacyState;
    if (!legacy.themes?.length) return undefined;
    const snapshots = (legacy.snapshots ?? []).map((snapshot) => ({ ...snapshot, revision: snapshot.revision ?? 0 }));
    return {
      themes: structuredClone(legacy.themes),
      activeThemeId: legacy.activeThemeId ?? legacy.themes[0].id,
      snapshots,
      revisions: initialRevisions(legacy.themes),
      conflicts: [],
    };
  } catch {
    return undefined;
  }
}

export function readState(storage: StorageLike, seed: () => CollabStateDoc): CollabStateDoc {
  const raw = storage.getItem(STATE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as CollabStateDoc;
      if (parsed.themes?.length) {
        if (!parsed.revisions) parsed.revisions = initialRevisions(parsed.themes);
        parsed.conflicts ??= [];
        return parsed;
      }
    } catch {
      // 落到迁移/种子逻辑
    }
  }
  const migrated = migrateLegacy(storage);
  const doc = migrated ?? seed();
  writeState(storage, doc);
  return doc;
}

export function writeState(storage: StorageLike, doc: CollabStateDoc): void {
  storage.setItem(STATE_KEY, JSON.stringify(doc));
}

export function outboxKey(clientId: string): string {
  return `${OUTBOX_PREFIX}${clientId}`;
}

export function readOutbox(storage: StorageLike, clientId: string): PendingOp[] {
  try {
    const raw = storage.getItem(outboxKey(clientId));
    return raw ? (JSON.parse(raw) as PendingOp[]) : [];
  } catch {
    return [];
  }
}

export function writeOutbox(storage: StorageLike, clientId: string, ops: PendingOp[]): void {
  storage.setItem(outboxKey(clientId), JSON.stringify(ops));
}

/** 收集本浏览器内所有窗口（含暂时离线的）留下的待处理操作。 */
export function readAllOutboxes(storage: StorageLike): { clientId: string; ops: PendingOp[] }[] {
  const result: { clientId: string; ops: PendingOp[] }[] = [];
  const keys = collectOutboxKeys(storage);
  for (const key of keys) {
    const clientId = key.slice(OUTBOX_PREFIX.length);
    try {
      const raw = storage.getItem(key);
      if (raw) result.push({ clientId, ops: JSON.parse(raw) as PendingOp[] });
    } catch {
      // 损坏的单个 outbox 不影响其他窗口
    }
  }
  return result;
}

export function collectOutboxKeys(storage: StorageLike): string[] {
  try {
    const length = storage.length ?? 0;
    const keys: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = storage.key?.(index);
      if (key?.startsWith(OUTBOX_PREFIX)) keys.push(key);
    }
    return keys;
  } catch {
    return [];
  }
}

export function readClients(storage: StorageLike): ClientInfo[] {
  try {
    const raw = storage.getItem(CLIENTS_KEY);
    return raw ? (JSON.parse(raw) as ClientInfo[]) : [];
  } catch {
    return [];
  }
}

export function writeClients(storage: StorageLike, clients: ClientInfo[]): void {
  storage.setItem(CLIENTS_KEY, JSON.stringify(clients));
}

/** 网络状态按窗口独立：可能只断了其中一台机器，回来时它单独触发合并。 */
export function isClientOffline(storage: StorageLike, clientId: string): boolean {
  return storage.getItem(`${OFFLINE_PREFIX}${clientId}`) === "offline";
}

export function setClientOffline(storage: StorageLike, clientId: string, offline: boolean): void {
  const key = `${OFFLINE_PREFIX}${clientId}`;
  if (offline) storage.setItem(key, "offline");
  else storage.removeItem(key);
}

export function readCheckpoint(storage: StorageLike): CheckpointDoc | undefined {
  try {
    const raw = storage.getItem(CHECKPOINT_KEY);
    return raw ? (JSON.parse(raw) as CheckpointDoc) : undefined;
  } catch {
    return undefined;
  }
}

export function writeCheckpoint(storage: StorageLike, checkpoint: CheckpointDoc): void {
  storage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoint));
}

export function clearCheckpoint(storage: StorageLike): void {
  storage.removeItem(CHECKPOINT_KEY);
}

export function initialRevisionsForThemes(themes: Theme[]): Record<string, Theme[]> {
  return initialRevisions(themes);
}
