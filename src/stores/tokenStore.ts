import { createEffect, createMemo, createSignal } from "solid-js";
import type {
  Checkpoint,
  DesignToken,
  Snapshot,
  Theme,
  TokenConflict,
  TokenKind,
  TokenOperation,
  WorkspaceState,
} from "../types/tokens";
import { buildWorkingTheme, mergePendingOps, windowColor as windowColorOf, windowDisplayName as windowDisplayNameOf } from "../utils/collab";

const STORAGE_KEY_V1 = "token-forge-workspace-v1";
const STORAGE_KEY_V2 = "token-forge-workspace-v2";
const STATE_VERSION = 2;
const MAX_CHECKPOINTS = 10;
const MAX_CONFLICTS = 50;

const makeTokens = (): Theme["tokens"] => ({
  color: [
    { id: "color-brand", name: "color.brand.primary", value: "#356ae6", description: "品牌主色，用于主操作" },
    { id: "color-surface", name: "color.surface.default", value: "#ffffff", description: "默认卡片与页面表面" },
    { id: "color-text", name: "color.text.primary", value: "#172033", description: "正文主文字" },
    { id: "color-muted", name: "color.text.muted", value: "#68738a", description: "次级说明文字" },
    { id: "color-success", name: "color.status.success", value: "#16845b", description: "成功状态" },
    { id: "color-danger", name: "color.status.danger", value: "#c53b4d", description: "错误与危险状态" },
  ],
  fontSize: [
    { id: "font-xs", name: "font.size.xs", value: "12px", description: "辅助标签" },
    { id: "font-sm", name: "font.size.sm", value: "14px", description: "表格与控件" },
    { id: "font-md", name: "font.size.md", value: "16px", description: "正文" },
    { id: "font-lg", name: "font.size.lg", value: "20px", description: "区块标题" },
    { id: "font-xl", name: "font.size.xl", value: "28px", description: "页面标题" },
  ],
  spacing: [
    { id: "space-1", name: "space.1", value: "4px", description: "最小间距" },
    { id: "space-2", name: "space.2", value: "8px", description: "紧凑间距" },
    { id: "space-3", name: "space.3", value: "12px", description: "控件内间距" },
    { id: "space-4", name: "space.4", value: "16px", description: "常规间距" },
    { id: "space-6", name: "space.6", value: "24px", description: "区块间距" },
    { id: "space-8", name: "space.8", value: "32px", description: "大区块间距" },
  ],
  radius: [
    { id: "radius-sm", name: "radius.sm", value: "4px", description: "小控件" },
    { id: "radius-md", name: "radius.md", value: "8px", description: "卡片与输入框" },
    { id: "radius-full", name: "radius.full", value: "999px", description: "胶囊标签" },
  ],
  shadow: [
    { id: "shadow-sm", name: "shadow.sm", value: "0 1px 2px rgb(22 32 51 / 0.08)", description: "轻微抬升" },
    { id: "shadow-lg", name: "shadow.lg", value: "0 16px 40px rgb(22 32 51 / 0.14)", description: "浮层与弹窗" },
  ],
  motion: [
    { id: "motion-fast", name: "motion.duration.fast", value: "120ms", description: "即时反馈" },
    { id: "motion-base", name: "motion.duration.base", value: "220ms", description: "标准过渡" },
    { id: "motion-slow", name: "motion.duration.slow", value: "420ms", description: "强调过渡" },
  ],
});

function seedThemes(): Theme[] {
  const light = { id: "theme-light", name: "企业浅色", tokens: makeTokens() };
  const dark = structuredClone(light);
  dark.id = "theme-dark";
  dark.name = "夜间模式";
  dark.tokens.color = dark.tokens.color.map((token) => {
    if (token.id === "color-surface") return { ...token, value: "#151b28" };
    if (token.id === "color-text") return { ...token, value: "#f4f7ff" };
    if (token.id === "color-muted") return { ...token, value: "#aab4ca" };
    return token;
  });
  const dense = structuredClone(light);
  dense.id = "theme-dense";
  dense.name = "高密度运营";
  dense.tokens.fontSize = dense.tokens.fontSize.map((token) => ({
    ...token,
    value: `${Math.max(11, Number.parseInt(token.value, 10) - 1)}px`,
  }));
  dense.tokens.spacing = dense.tokens.spacing.map((token) => ({
    ...token,
    value: `${Math.max(2, Number.parseInt(token.value, 10) - 2)}px`,
  }));
  return [light, dark, dense];
}

function emptyState(): WorkspaceState {
  const themes = seedThemes();
  const revisions: Record<string, number> = {};
  themes.forEach((theme) => {
    revisions[theme.id] = 1;
  });
  return {
    version: STATE_VERSION,
    themes,
    activeThemeId: "theme-light",
    snapshots: [],
    pendingOps: [],
    conflicts: [],
    checkpoints: [],
    revisions,
    windowCounter: 1,
  };
}

/** 从 v1 升级：保留原主题与快照，补全协作字段。 */
function migrateV1(raw: unknown): WorkspaceState {
  const fallback = emptyState();
  if (!raw || typeof raw !== "object") return fallback;
  const parsed = raw as Partial<WorkspaceState> & { themes?: Theme[]; activeThemeId?: string; snapshots?: Snapshot[] };
  if (!Array.isArray(parsed.themes) || parsed.themes.length === 0) return fallback;
  const themes = parsed.themes;
  const revisions: Record<string, number> = {};
  themes.forEach((theme) => {
    revisions[theme.id] = 1;
  });
  return {
    version: STATE_VERSION,
    themes,
    activeThemeId: parsed.activeThemeId && themes.some((theme) => theme.id === parsed.activeThemeId) ? parsed.activeThemeId : themes[0].id,
    snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    pendingOps: [],
    conflicts: [],
    checkpoints: [],
    revisions,
    windowCounter: 1,
  };
}

function readState(): WorkspaceState {
  const fallback = emptyState();
  try {
    const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as WorkspaceState;
      if (parsed.version === STATE_VERSION && Array.isArray(parsed.themes) && parsed.themes.length > 0) {
        return { ...fallback, ...parsed };
      }
    }
    const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
    if (rawV1) {
      const migrated = migrateV1(JSON.parse(rawV1));
      localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(migrated));
      return migrated;
    }
  } catch {
    // 解析失败时回退到种子数据
  }
  return fallback;
}

/** 每个浏览器标签页（窗口）的稳定身份：会话内保持，重开后重新领取。 */
function initWindowIdentity(): { windowId: string; windowName: string; windowColor: string; windowCounter: number } {
  if (typeof window === "undefined") {
    return { windowId: "window-1", windowName: "窗口 1", windowColor: windowColorOf("window-1"), windowCounter: 1 };
  }
  let windowId = sessionStorage.getItem("token-forge-window-id");
  let windowCounter = 1;
  if (!windowId) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_V2);
      if (raw) {
        const parsed = JSON.parse(raw) as WorkspaceState;
        windowCounter = (parsed.windowCounter ?? 0) + 1;
      }
    } catch {
      // ignore
    }
    windowId = `window-${windowCounter}`;
    sessionStorage.setItem("token-forge-window-id", windowId);
    // 回写窗口计数
    try {
      const raw = localStorage.getItem(STORAGE_KEY_V2);
      if (raw) {
        const parsed = JSON.parse(raw) as WorkspaceState;
        parsed.windowCounter = windowCounter;
        localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(parsed));
      }
    } catch {
      // ignore
    }
  } else {
    const match = windowId.match(/(\d+)/);
    windowCounter = match ? Number.parseInt(match[1], 10) : 1;
  }
  return { windowId, windowName: windowDisplayNameOf(windowId), windowColor: windowColorOf(windowId), windowCounter };
}

const initial = readState();
const identity = initWindowIdentity();

const [themes, setThemes] = createSignal<Theme[]>(initial.themes);
const [activeThemeId, setActiveThemeId] = createSignal(initial.activeThemeId);
const [snapshots, setSnapshots] = createSignal<Snapshot[]>(initial.snapshots);
const [pendingOps, setPendingOps] = createSignal<TokenOperation[]>(initial.pendingOps);
const [conflicts, setConflicts] = createSignal<TokenConflict[]>(initial.conflicts);
const [checkpoints, setCheckpoints] = createSignal<Checkpoint[]>(initial.checkpoints);
const [revisions, setRevisions] = createSignal<Record<string, number>>(initial.revisions);
const [windowCounter, setWindowCounter] = createSignal(identity.windowCounter);
const [online, setOnline] = createSignal(true);
const [windowId] = createSignal(identity.windowId);
const [windowName] = createSignal(identity.windowName);
const [windowColor] = createSignal(identity.windowColor);

const activeTheme = createMemo(() => themes().find((theme) => theme.id === activeThemeId()) ?? themes()[0]);
const pendingConflicts = createMemo(() => conflicts().filter((conflict) => conflict.status === "pending"));
const pendingChangeCount = createMemo(() => pendingOps().length + pendingConflicts().length);

/** 工作草稿：确认主题叠加本窗口未合并的改动，供编辑器实时读取。 */
const workingTheme = createMemo(() => buildWorkingTheme(activeTheme(), windowId(), pendingOps()));

function persist(state: WorkspaceState): void {
  try {
    localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(state));
  } catch {
    // 存储失败时忽略
  }
}

function currentState(): WorkspaceState {
  return {
    version: STATE_VERSION,
    themes: themes(),
    activeThemeId: activeThemeId(),
    snapshots: snapshots(),
    pendingOps: pendingOps(),
    conflicts: conflicts(),
    checkpoints: checkpoints(),
    revisions: revisions(),
    windowCounter: windowCounter(),
  };
}

createEffect(() => {
  persist(currentState());
});

/** 其他窗口写入后同步内存状态，保持多标签一致。 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY_V2 || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as WorkspaceState;
      if (parsed.version !== STATE_VERSION || !Array.isArray(parsed.themes)) return;
      setThemes(parsed.themes);
      if (parsed.activeThemeId && parsed.themes.some((theme) => theme.id === parsed.activeThemeId)) {
        setActiveThemeId(parsed.activeThemeId);
      }
      setSnapshots(parsed.snapshots ?? []);
      setPendingOps(parsed.pendingOps ?? []);
      setConflicts(parsed.conflicts ?? []);
      setCheckpoints(parsed.checkpoints ?? []);
      setRevisions(parsed.revisions ?? {});
    } catch {
      // ignore malformed payload
    }
  });
}

function updateTheme(themeId: string, updater: (theme: Theme) => Theme): void {
  setThemes((current) => current.map((theme) => (theme.id === themeId ? updater(theme) : theme)));
}

function revisionOf(themeId: string): number {
  return revisions()[themeId] ?? 1;
}

function nextRevision(themeId: string): number {
  return revisionOf(themeId) + 1;
}

/** 记录一次改动（窗口、令牌、基线修订）。在线时立即尝试合并。 */
function recordOp(themeId: string, kind: TokenKind, tokenId: string, type: TokenOperation["type"], extra: Partial<TokenOperation>): void {
  const op: TokenOperation = {
    id: `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    windowId: windowId(),
    themeId,
    kind,
    tokenId,
    type,
    baseRevision: revisionOf(themeId),
    createdAt: new Date().toISOString(),
    ...extra,
  };
  setPendingOps((current) => [...current, op]);
  if (online()) {
    // 在线：立即合并，确认主题前进，预览实时刷新。
    queueMicrotask(() => mergeThemeOps(themeId));
  }
}

function saveCheckpoint(themeId: string, label: string): void {
  const theme = themes().find((item) => item.id === themeId);
  if (!theme) return;
  const checkpoint: Checkpoint = {
    id: `checkpoint-${Date.now()}`,
    themeId,
    revision: revisionOf(themeId),
    theme: structuredClone(theme),
    pendingOps: structuredClone(pendingOps()),
    conflicts: structuredClone(conflicts()),
    createdAt: new Date().toISOString(),
    label,
  };
  setCheckpoints((current) => [checkpoint, ...current].slice(0, MAX_CHECKPOINTS));
}

/** 合并某主题的待处理操作；失败则从检查点恢复。 */
function mergeThemeOps(themeId: string): void {
  const theme = themes().find((item) => item.id === themeId);
  if (!theme) return;
  saveCheckpoint(themeId, `合并前 · ${theme.name}`);
  try {
    const outcome = mergePendingOps(theme, revisionOf(themeId), pendingOps());
    if (outcome.appliedOps.length === 0 && outcome.newConflicts.length === 0) return;
    updateTheme(themeId, () => outcome.theme);
    setRevisions((current) => ({ ...current, [themeId]: outcome.revision }));
    const appliedIds = new Set(outcome.appliedOps.map((op) => op.id));
    setPendingOps((current) => current.filter((op) => !appliedIds.has(op.id)));
    if (outcome.newConflicts.length > 0) {
      setConflicts((current) => [...outcome.newConflicts, ...current].slice(0, MAX_CONFLICTS));
    }
  } catch (error) {
    // 合并失败：从最近检查点恢复。
    const checkpoint = checkpoints().find((item) => item.themeId === themeId);
    if (checkpoint) {
      updateTheme(themeId, () => structuredClone(checkpoint.theme));
      setRevisions((current) => ({ ...current, [themeId]: checkpoint.revision }));
      setPendingOps(checkpoint.pendingOps);
      setConflicts(checkpoint.conflicts);
    }
    throw error;
  }
}

function saveSnapshotForTheme(theme: Theme, label: string): void {
  const snapshot: Snapshot = {
    id: `snapshot-${Date.now()}`,
    label: label.trim() || `快照 ${snapshots().length + 1}`,
    createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    theme: structuredClone(theme),
  };
  setSnapshots((current) => [snapshot, ...current].slice(0, 20));
}

export function useTokenStore() {
  const updateToken = (kind: TokenKind, id: string, patch: Partial<DesignToken>): void => {
    recordOp(activeThemeId(), kind, id, "edit", { patch });
  };

  const addToken = (kind: TokenKind): void => {
    const theme = activeTheme();
    const token: DesignToken = {
      id: `${kind}-${Date.now()}`,
      name: `${kind}.custom.${theme.tokens[kind].length + 1}`,
      value: kind === "color" ? "#4f46e5" : kind === "shadow" ? "0 8px 24px rgb(0 0 0 / 0.12)" : "8px",
      description: "自定义令牌",
    };
    recordOp(activeThemeId(), kind, token.id, "add", { token });
  };

  const removeToken = (kind: TokenKind, id: string): void => {
    recordOp(activeThemeId(), kind, id, "remove", {});
  };

  const createTheme = (name: string, sourceId = activeThemeId()): string => {
    const source = themes().find((theme) => theme.id === sourceId) ?? themes()[0];
    const id = `theme-${Date.now()}`;
    setThemes((current) => [...current, { ...structuredClone(source), id, name }]);
    setRevisions((current) => ({ ...current, [id]: 1 }));
    setActiveThemeId(id);
    return id;
  };

  const saveSnapshot = (label: string): void => {
    saveSnapshotForTheme(activeTheme(), label);
  };

  const replaceTheme = (theme: Theme): void => {
    setThemes((current) => [...current, theme]);
    setRevisions((current) => ({ ...current, [theme.id]: 1 }));
    setActiveThemeId(theme.id);
  };

  /** 手动合并当前主题的全部待处理操作。 */
  const mergePending = (): void => {
    mergeThemeOps(activeThemeId());
  };

  /** 裁决冲突：选择某一版本，或两边都保留。裁决后生成新快照，旧快照保留。 */
  const adjudicateConflict = (conflictId: string, choice: "pick" | "keep-both", pickedWindowId?: string): void => {
    const conflict = conflicts().find((item) => item.id === conflictId);
    if (!conflict || conflict.status !== "pending") return;
    const theme = themes().find((item) => item.id === conflict.themeId);
    if (!theme) return;

    saveCheckpoint(conflict.themeId, `裁决前 · ${theme.name}`);
    try {
      let nextTheme = structuredClone(theme);
      const picked = conflict.versions.find((version) => version.windowId === pickedWindowId) ?? conflict.versions[0];

      if (choice === "pick") {
        nextTheme = setTokenOnTheme(nextTheme, conflict.kind, conflict.tokenId, picked.token);
      } else {
        // keep-both：保留选中版本（原 id），其余版本另存为新令牌。
        nextTheme = setTokenOnTheme(nextTheme, conflict.kind, conflict.tokenId, picked.token);
        for (const version of conflict.versions) {
          if (version.windowId === picked.windowId || version.token === null) continue;
          const suffix = version.windowId.replace(/[^a-z0-9]/gi, "");
          const altId = `${conflict.tokenId}__${suffix}`;
          const altToken: DesignToken = {
            ...version.token,
            id: altId,
            name: version.token.name.includes(conflict.tokenId)
              ? version.token.name
              : `${version.token.name}.${suffix}`,
          };
          nextTheme = setTokenOnTheme(nextTheme, conflict.kind, altId, altToken);
        }
      }

      const newRevision = nextRevision(conflict.themeId);
      updateTheme(conflict.themeId, () => nextTheme);
      setRevisions((current) => ({ ...current, [conflict.themeId]: newRevision }));

      // 移除该冲突相关的待处理操作
      const relatedOpIds = new Set(conflict.versions.flatMap((version) => version.ops.map((op) => op.id)));
      setPendingOps((current) => current.filter((op) => !relatedOpIds.has(op.id)));

      // 标记冲突已裁决（保留记录，不删除）
      setConflicts((current) =>
        current.map((item) =>
          item.id === conflictId
            ? {
                ...item,
                status: "resolved",
                resolution: choice,
                pickedWindowId: picked.windowId,
                resolvedAt: new Date().toISOString(),
              }
            : item,
        ),
      );

      // 裁决后生成新快照依据，旧快照保留。
      saveSnapshotForTheme(nextTheme, `冲突裁决 · ${conflict.tokenName}`);
    } catch (error) {
      const checkpoint = checkpoints().find((item) => item.themeId === conflict.themeId);
      if (checkpoint) {
        updateTheme(conflict.themeId, () => structuredClone(checkpoint.theme));
        setRevisions((current) => ({ ...current, [conflict.themeId]: checkpoint.revision }));
        setPendingOps(checkpoint.pendingOps);
        setConflicts(checkpoint.conflicts);
      }
      throw error;
    }
  };

  /** 从检查点恢复。 */
  const recoverCheckpoint = (checkpointId: string): void => {
    const checkpoint = checkpoints().find((item) => item.id === checkpointId);
    if (!checkpoint) return;
    updateTheme(checkpoint.themeId, () => structuredClone(checkpoint.theme));
    setRevisions((current) => ({ ...current, [checkpoint.themeId]: checkpoint.revision }));
    setPendingOps(structuredClone(checkpoint.pendingOps));
    setConflicts(structuredClone(checkpoint.conflicts));
  };

  const setOnlineStatus = (value: boolean): void => {
    setOnline(value);
    if (value) {
      // 恢复在线：自动合并待处理改动。
      queueMicrotask(() => mergeThemeOps(activeThemeId()));
    }
  };

  return {
    themes,
    activeTheme,
    activeThemeId,
    setActiveThemeId,
    snapshots,
    pendingOps,
    pendingConflicts,
    pendingChangeCount,
    allConflicts: conflicts,
    checkpoints,
    revisions,
    online,
    windowId,
    windowName,
    windowColor,
    workingTheme,
    updateToken,
    addToken,
    removeToken,
    createTheme,
    saveSnapshot,
    replaceTheme,
    mergePending,
    adjudicateConflict,
    recoverCheckpoint,
    setOnlineStatus,
    reset: () => {
      const fresh = emptyState();
      setThemes(fresh.themes);
      setActiveThemeId(fresh.activeThemeId);
      setSnapshots([]);
      setPendingOps([]);
      setConflicts([]);
      setCheckpoints([]);
      setRevisions(fresh.revisions);
    },
  };
}

// 本地辅助：把结果写回主题（null 表示删除）。
function setTokenOnTheme(theme: Theme, kind: TokenKind, tokenId: string, token: DesignToken | null): Theme {
  const list = theme.tokens[kind] ? [...theme.tokens[kind]] : [];
  const index = list.findIndex((item) => item.id === tokenId);
  if (token === null) {
    if (index >= 0) list.splice(index, 1);
  } else if (index >= 0) {
    list[index] = token;
  } else {
    list.push(token);
  }
  return { ...theme, tokens: { ...theme.tokens, [kind]: list } };
}
