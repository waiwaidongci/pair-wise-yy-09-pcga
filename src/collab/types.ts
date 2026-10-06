import type { DesignToken, Theme, TokenKind } from "../types/tokens";

/** 可参与三方合并的令牌字段。id 只用于定位，不参与差异计算。 */
export type MergeField = keyof Pick<DesignToken, "name" | "value" | "description">;

/**
 * 离线/本地改动先落为待处理操作，而不是直接覆盖整份主题。
 * baseRevision 记录这次编辑开始时所依据的确认修订，是三方合并的祖先。
 */
export interface PendingOp {
  id: string;
  themeId: string;
  tokenId: string;
  kind: TokenKind;
  clientId: string;
  /** 合并键：同一窗口对同一令牌的连续编辑折叠到一条操作上。 */
  coalesceKey: string;
  at: number;
  baseRevision: number;
  type: "upsert" | "remove";
  /** upsert 时仅携带真正改过的字段；新增令牌携带完整三字段。 */
  after?: Partial<Pick<DesignToken, "name" | "value" | "description">>;
}

export interface ClientInfo {
  id: string;
  label: string;
  lastSeen: number;
  open: boolean;
}

export type ConflictType = "value-value" | "remove-edit" | "add-add";

export interface ConflictProposal {
  clientId: string;
  clientLabel: string;
  opId: string;
  at: number;
  /** remove-edit 中表示该方案是“移除令牌”。 */
  removed?: boolean;
  /** value-value：该方案给出的字段值。 */
  value?: string;
  /** add-add / remove-edit：该方案携带的完整字段集合。 */
  patch?: Partial<Pick<DesignToken, "name" | "value" | "description">>;
}

/** 裁决方式。裁决先暂存在冲突上，提交时才进入新的确认修订。 */
export type ConflictResolution =
  | { type: "proposal"; opId: string }
  | { type: "base" }
  | { type: "custom"; value: string }
  | { type: "remove" }
  | { type: "keep" };

export interface Conflict {
  id: string;
  themeId: string;
  tokenId: string;
  kind: TokenKind;
  /** 冲突发生时令牌在基线中的名字，仅用于展示。 */
  tokenName: string;
  conflictType: ConflictType;
  /** value-value 冲突涉及的字段；改名走 name 字段。 */
  field?: MergeField;
  /** 该字段在确认版本中的当前值（新增冲突时为空串）。 */
  baseValue: string;
  proposals: ConflictProposal[];
  resolution?: ConflictResolution;
  updatedAt: number;
}

export interface MergeEngineInput {
  themes: Theme[];
  /** revisions[themeId][revision] 为该修订下的完整主题，最后一个即当前确认版本。 */
  revisions: Record<string, Theme[]>;
  ops: PendingOp[];
  conflicts: Conflict[];
  clientLabels: Record<string, string>;
  /** 演练用：让本次合并在落库前失败，触发检查点恢复流程。 */
  injectFailure?: boolean;
}

export interface MergeEngineOutput {
  ok: boolean;
  themes: Theme[];
  revisions: Record<string, Theme[]>;
  consumedOpIds: string[];
  /** 仍然开放或新发现的冲突；已裁决提交的冲突不再返回。 */
  conflicts: Conflict[];
  bumpedThemeIds: string[];
  /** 本次提交中被裁决消化掉的冲突 id（用于决定是否生成“裁决提交”快照）。 */
  resolvedConflictIds: string[];
}
