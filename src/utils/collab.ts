import type {
  ConflictReason,
  ConflictVersion,
  DesignToken,
  Theme,
  TokenConflict,
  TokenKind,
  TokenOperation,
} from "../types/tokens";

/** 窗口配色盘：按窗口序号取色，便于在待处理区区分。 */
const WINDOW_COLORS = ["#356ae6", "#c53b4d", "#16845b", "#b25ed6", "#d97706", "#0891b2"];

export function windowColor(windowId: string): string {
  const match = windowId.match(/(\d+)/);
  const index = match ? Number.parseInt(match[1], 10) : 0;
  return WINDOW_COLORS[(index - 1 + WINDOW_COLORS.length) % WINDOW_COLORS.length];
}

export function windowDisplayName(windowId: string): string {
  const match = windowId.match(/(\d+)/);
  return match ? `窗口 ${match[1]}` : windowId;
}

/** 把同一令牌上的一连串操作应用到基线令牌，返回结果（null 表示删除）。 */
export function applyOpsToToken(base: DesignToken | null, ops: TokenOperation[]): DesignToken | null {
  let current: DesignToken | null = base ? { ...base } : null;
  for (const op of ops) {
    if (op.type === "remove") {
      current = null;
    } else if (op.type === "add") {
      current = op.token ? { ...op.token } : current;
    } else if (op.type === "edit") {
      if (current && op.patch) {
        current = { ...current, ...op.patch };
      }
    }
  }
  return current;
}

export function findToken(theme: Theme, kind: TokenKind, tokenId: string): DesignToken | null {
  return theme.tokens[kind]?.find((token) => token.id === tokenId) ?? null;
}

/** 把结果写回主题：null 表示删除，否则新增或更新。 */
export function setToken(theme: Theme, kind: TokenKind, tokenId: string, token: DesignToken | null): Theme {
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

export function tokensEqual(a: DesignToken | null, b: DesignToken | null): boolean {
  if (a === null || b === null) return a === b;
  return a.id === b.id && a.name === b.name && a.value === b.value && a.description === b.description;
}

function groupOpsByToken(ops: TokenOperation[]): Map<string, TokenOperation[]> {
  const map = new Map<string, TokenOperation[]>();
  for (const op of ops) {
    const key = `${op.themeId}|${op.kind}|${op.tokenId}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(op);
  }
  return map;
}

function reasonFromVersions(versions: ConflictVersion[], base: DesignToken | null): ConflictReason {
  const removed = versions.some((version) => version.token === null);
  const edited = versions.some((version) => version.token !== null);
  if (removed && edited) return "edit-removed";
  if (base === null) return "add-add";
  return "both-edited";
}

export interface MergeOutcome {
  theme: Theme;
  revision: number;
  appliedOps: TokenOperation[];
  newConflicts: TokenConflict[];
}

/**
 * 逐令牌合并待处理操作。
 * - 仅一个窗口碰过：直接应用。
 * - 多个窗口碰过但结果一致：应用（视为同一改动）。
 * - 多个窗口结果不一致：记入冲突，主题保持基线不动。
 */
export function mergePendingOps(
  theme: Theme,
  revision: number,
  allOps: TokenOperation[],
): MergeOutcome {
  const opsForTheme = allOps.filter((op) => op.themeId === theme.id);
  const groups = groupOpsByToken(opsForTheme);
  let newTheme = structuredClone(theme);
  let appliedOps: TokenOperation[] = [];
  const newConflicts: TokenConflict[] = [];
  let newRevision = revision;

  for (const [key, ops] of groups) {
    const [, kind, tokenId] = key.split("|") as [string, TokenKind, string];
    const baseToken = findToken(theme, kind, tokenId);

    const byWindow = new Map<string, TokenOperation[]>();
    for (const op of ops) {
      if (!byWindow.has(op.windowId)) byWindow.set(op.windowId, []);
      byWindow.get(op.windowId)!.push(op);
    }
    const windowIds = Array.from(byWindow.keys());

    const versions: ConflictVersion[] = windowIds.map((windowId) => {
      const winOps = byWindow.get(windowId)!;
      const result = applyOpsToToken(baseToken, winOps);
      return {
        windowId,
        windowName: windowDisplayName(windowId),
        windowColor: windowColor(windowId),
        token: result,
        ops: winOps,
      };
    });

    if (windowIds.length === 1) {
      newTheme = setToken(newTheme, kind, tokenId, versions[0].token);
      appliedOps = appliedOps.concat(ops);
      newRevision += 1;
      continue;
    }

    const allEqual = versions.every((version) => tokensEqual(version.token, versions[0].token));
    if (allEqual) {
      newTheme = setToken(newTheme, kind, tokenId, versions[0].token);
      appliedOps = appliedOps.concat(ops);
      newRevision += 1;
      continue;
    }

    newConflicts.push({
      id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      themeId: theme.id,
      kind,
      tokenId,
      tokenName: baseToken?.name ?? versions.find((version) => version.token)?.token?.name ?? tokenId,
      baseRevision: revision,
      reason: reasonFromVersions(versions, baseToken),
      baseToken,
      versions,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
    // 冲突未裁决：该令牌保持基线，不进入确认主题。
  }

  return { theme: newTheme, revision: newRevision, appliedOps, newConflicts };
}

/** 把指定窗口的待处理操作应用到基线主题，得到工作草稿（编辑器读取）。 */
export function buildWorkingTheme(theme: Theme, windowId: string, ops: TokenOperation[]): Theme {
  const ownOps = ops.filter((op) => op.windowId === windowId && op.themeId === theme.id);
  if (ownOps.length === 0) return theme;
  let working = structuredClone(theme);
  const groups = groupOpsByToken(ownOps);
  for (const [key, opsForToken] of groups) {
    const [, kind, tokenId] = key.split("|") as [string, TokenKind, string];
    const baseToken = findToken(working, kind, tokenId);
    const result = applyOpsToToken(baseToken, opsForToken);
    working = setToken(working, kind, tokenId, result);
  }
  return working;
}
