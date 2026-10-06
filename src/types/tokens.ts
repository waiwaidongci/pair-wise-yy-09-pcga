export type TokenKind = "color" | "fontSize" | "spacing" | "radius" | "shadow" | "motion";

export interface DesignToken {
  id: string;
  name: string;
  value: string;
  description: string;
}

export interface Theme {
  id: string;
  name: string;
  tokens: Record<TokenKind, DesignToken[]>;
}

export interface Snapshot {
  id: string;
  label: string;
  createdAt: string;
  theme: Theme;
}

export interface TokenDifference {
  path: string;
  before: string;
  after: string;
  kind: "changed" | "added" | "removed";
}

// === 协作修订（Collaborative Revision）===

export type OperationType = "edit" | "add" | "remove";

export interface WindowInfo {
  id: string;
  name: string;
  color: string;
}

/** 一次未合并的令牌改动：记录窗口、令牌编号与基线修订。 */
export interface TokenOperation {
  id: string;
  windowId: string;
  themeId: string;
  kind: TokenKind;
  tokenId: string;
  type: OperationType;
  /** 改动所基于的确认修订号。 */
  baseRevision: number;
  createdAt: string;
  /** edit 时的字段补丁。 */
  patch?: Partial<DesignToken>;
  /** add 时的新令牌。 */
  token?: DesignToken;
}

export type ConflictReason =
  | "both-edited" // 两边都改了同一个令牌
  | "edit-removed" // 一边改了，一边删了
  | "add-add"; // 两边新增了同 id 令牌

export interface ConflictVersion {
  windowId: string;
  windowName: string;
  windowColor: string;
  /** 该窗口操作后得到的令牌；null 表示删除。 */
  token: DesignToken | null;
  ops: TokenOperation[];
}

export interface TokenConflict {
  id: string;
  themeId: string;
  kind: TokenKind;
  tokenId: string;
  tokenName: string;
  baseRevision: number;
  reason: ConflictReason;
  /** 共同祖先（基线）处的令牌，供对照。 */
  baseToken: DesignToken | null;
  versions: ConflictVersion[];
  status: "pending" | "resolved";
  resolution?: "pick" | "keep-both";
  pickedWindowId?: string;
  resolvedAt?: string;
  createdAt: string;
}

/** 合并前检查点：失败后从此恢复。 */
export interface Checkpoint {
  id: string;
  themeId: string;
  revision: number;
  theme: Theme;
  pendingOps: TokenOperation[];
  conflicts: TokenConflict[];
  createdAt: string;
  label: string;
}

export interface WorkspaceState {
  version: number;
  themes: Theme[];
  activeThemeId: string;
  snapshots: Snapshot[];
  pendingOps: TokenOperation[];
  conflicts: TokenConflict[];
  checkpoints: Checkpoint[];
  /** 每个主题的确认修订号。 */
  revisions: Record<string, number>;
  windowCounter: number;
}
