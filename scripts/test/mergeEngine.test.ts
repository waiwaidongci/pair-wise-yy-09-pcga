import type { DesignToken, Theme, TokenKind } from "../../src/types/tokens";
import { runMerge } from "../../src/collab/mergeEngine";
import type { ConflictResolution, MergeEngineInput, PendingOp } from "../../src/collab/types";
import { seedThemes } from "../../src/collab/seed";

let failures = 0;
let passes = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (condition) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`  ✗ ${message}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

function makeInput(theme: Theme, overrides: Partial<MergeEngineInput> = {}): MergeEngineInput {
  return {
    themes: [structuredClone(theme)],
    revisions: { [theme.id]: [structuredClone(theme)] },
    ops: [],
    conflicts: [],
    clientLabels: { c1: "窗口 A", c2: "窗口 B" },
    ...overrides,
  };
}

function op(
  clientId: string,
  themeId: string,
  tokenId: string,
  kind: TokenKind,
  type: PendingOp["type"],
  at: number,
  baseRevision = 0,
  after?: PendingOp["after"],
): PendingOp {
  return {
    id: `${clientId}-${tokenId}-${type}-${at}`,
    themeId,
    tokenId,
    kind,
    clientId,
    coalesceKey: `${kind}:${tokenId}`,
    at,
    baseRevision,
    type,
    after,
  };
}

function themeToken(theme: Theme, tokenId: string): DesignToken | undefined {
  for (const tokens of Object.values(theme.tokens)) {
    const found = tokens.find((token) => token.id === tokenId);
    if (found) return found;
  }
  return undefined;
}

function seedTheme(): Theme {
  return seedThemes()[0];
}

// 1. 互不相关的编辑自动并入，且修订号前进。
section("干净合并：不同令牌 / 不同字段");
{
  const theme = seedTheme();
  const input = makeInput(theme, {
    ops: [
      op("c1", theme.id, "color-brand", "color", "upsert", 1, 0, { value: "#111111" }),
      op("c2", theme.id, "color-brand", "color", "upsert", 2, 0, { description: "品牌色（B 改描述）" }),
      op("c1", theme.id, "color-danger", "color", "upsert", 3, 0, { value: "#ff0000" }),
    ],
  });
  const result = runMerge(input);
  assert(result.ok, "合并成功");
  const merged = result.themes[0];
  assert(themeToken(merged, "color-brand")?.value === "#111111", "A 的值改动进入确认版本");
  assert(themeToken(merged, "color-brand")?.description === "品牌色（B 改描述）", "B 的描述改动同时进入，字段级合并互不覆盖");
  assert(themeToken(merged, "color-danger")?.value === "#ff0000", "另一令牌改动也进入");
  assert(result.conflicts.length === 0, "没有冲突");
  assert(result.consumedOpIds.length === 3, "全部操作被消化");
  assert(result.bumpedThemeIds[0] === theme.id, "主题修订号前进");
  assert(result.revisions[theme.id].length === 2, "修订链追加一版，旧修订保留");
}

// 2. 同字段改成不同值 → 并排冲突；其他干净字段照常提交；确认版本该字段保持基线。
section("值-值冲突：并排保留，主题仍指向确认版本");
{
  const theme = seedTheme();
  const base = themeToken(theme, "color-brand")!;
  const input = makeInput(theme, {
    ops: [
      op("c1", theme.id, "color-brand", "color", "upsert", 1, 0, { value: "#aaaaaa", description: "A 的描述" }),
      op("c2", theme.id, "color-brand", "color", "upsert", 2, 0, { value: "#bbbbbb" }),
    ],
  });
  const result = runMerge(input);
  const merged = result.themes[0];
  assert(themeToken(merged, "color-brand")?.value === base.value, "分歧字段保持基线，未被任一方盖掉");
  assert(themeToken(merged, "color-brand")?.description === "A 的描述", "同令牌上无冲突的描述字段照常提交");
  assert(result.conflicts.length === 1, "产生 1 个待裁决冲突");
  const conflict = result.conflicts[0];
  assert(conflict.conflictType === "value-value", "类型为值-值冲突");
  assert(conflict.field === "value", "定位到 value 字段");
  assert(conflict.proposals.length === 2, "两个方案并排保留");
  assert(conflict.proposals.map((p) => p.clientLabel).join("|") === "窗口 A|窗口 B", "方案带来源窗口标签");
  const pending = result.consumedOpIds;
  assert(!pending.includes("c1-color-brand-upsert-1"), "A 操作未消化（仍被冲突引用）");
  assert(!pending.includes("c2-color-brand-upsert-2"), "B 操作未消化");
}

// 3. 改名冲突同样走字段冲突，不悄悄盖掉。
section("改名冲突：name 字段并排");
{
  const theme = seedTheme();
  const input = makeInput(theme, {
    ops: [
      op("c1", theme.id, "color-brand", "color", "upsert", 1, 0, { name: "color.brand.strong" }),
      op("c2", theme.id, "color-brand", "color", "upsert", 2, 0, { name: "color.brand.accent" }),
    ],
  });
  const result = runMerge(input);
  assert(result.conflicts.length === 1 && result.conflicts[0].field === "name", "改名产生 name 字段冲突");
  assert(themeToken(result.themes[0], "color-brand")?.name === "color.brand.primary", "名字保持基线等待裁决");
}

// 4. 移除 vs 编辑 → remove-edit 冲突，令牌仍在确认版本。
section("移除-编辑冲突：不删也不盖");
{
  const theme = seedTheme();
  const input = makeInput(theme, {
    ops: [
      op("c1", theme.id, "color-muted", "color", "remove", 1, 0),
      op("c2", theme.id, "color-muted", "color", "upsert", 2, 0, { value: "#999999" }),
    ],
  });
  const result = runMerge(input);
  assert(Boolean(themeToken(result.themes[0], "color-muted")), "令牌仍在确认版本中");
  assert(result.conflicts.length === 1, "产生 remove-edit 冲突");
  assert(result.conflicts[0].conflictType === "remove-edit", "类型为移除-编辑");
  assert(result.conflicts[0].proposals.some((p) => p.removed), "方案包含移除方");
  assert(result.conflicts[0].proposals.some((p) => p.patch?.value === "#999999"), "方案包含编辑方");
  assert(result.consumedOpIds.length === 0, "两个操作都保留在待处理区");
}

// 5. 两边都删 → 直接移除。
section("双方一致移除");
{
  const theme = seedTheme();
  const input = makeInput(theme, {
    ops: [
      op("c1", theme.id, "color-muted", "color", "remove", 1, 0),
      op("c2", theme.id, "color-muted", "color", "remove", 2, 0),
    ],
  });
  const result = runMerge(input);
  assert(!themeToken(result.themes[0], "color-muted"), "令牌已从确认版本移除");
  assert(result.conflicts.length === 0, "无冲突");
}

// 6. 并行新增相同令牌且内容不同 → add-add 冲突；内容一致 → 直接进入。
section("并行新增：一致自动并入，不一致挂冲突");
{
  const theme = seedTheme();
  const tokenId = "color-new-badge";
  const inputSame = makeInput(theme, {
    ops: [
      op("c1", theme.id, tokenId, "color", "upsert", 1, 0, { name: "color.badge", value: "#f00", description: "徽标" }),
      op("c2", theme.id, tokenId, "color", "upsert", 2, 0, { name: "color.badge", value: "#f00", description: "徽标" }),
    ],
  });
  const sameResult = runMerge(inputSame);
  assert(themeToken(sameResult.themes[0], tokenId)?.value === "#f00", "两边新增内容一致，令牌进入确认版本");
  assert(sameResult.conflicts.length === 0, "无冲突");

  const theme2 = seedTheme();
  const inputDiff = makeInput(theme2, {
    ops: [
      op("c1", theme2.id, tokenId, "color", "upsert", 1, 0, { name: "color.badge", value: "#f00", description: "A" }),
      op("c2", theme2.id, tokenId, "color", "upsert", 2, 0, { name: "color.badge", value: "#0f0", description: "B" }),
    ],
  });
  const diffResult = runMerge(inputDiff);
  assert(!themeToken(diffResult.themes[0], tokenId), "不一致的并行新增不进入确认版本");
  assert(diffResult.conflicts.length === 1 && diffResult.conflicts[0].conflictType === "add-add", "挂出 add-add 冲突");
}

// 7. 裁决后提交：选择某方方案 → 新修订；冲突消失，操作消化。
section("裁决提交");
{
  const theme = seedTheme();
  const first = makeInput(theme, {
    ops: [
      op("c1", theme.id, "color-brand", "color", "upsert", 1, 0, { value: "#aaaaaa" }),
      op("c2", theme.id, "color-brand", "color", "upsert", 2, 0, { value: "#bbbbbb" }),
    ],
  });
  const pendingResult = runMerge(first);
  const resolution: ConflictResolution = { type: "proposal", opId: "c2-color-brand-upsert-2" };
  const second: MergeEngineInput = {
    themes: pendingResult.themes,
    revisions: pendingResult.revisions,
    ops: first.ops,
    conflicts: pendingResult.conflicts.map((conflict) => ({ ...conflict, resolution })),
    clientLabels: first.clientLabels,
  };
  const resolved = runMerge(second);
  assert(themeToken(resolved.themes[0], "color-brand")?.value === "#bbbbbb", "采用窗口 B 的值");
  assert(resolved.conflicts.length === 0, "冲突已裁决并消失");
  assert(resolved.consumedOpIds.length === 2, "两边操作都被消化");
  assert(resolved.resolvedConflictIds.length === 1, "记录已裁决冲突 id（用于生成裁决快照）");
  assert(resolved.revisions[theme.id].length === 2, "生成新修订，旧修订仍在链上");
}

// 8. 裁决 remove-edit 为保留并选编辑方案 → 令牌复活为该方案；裁决为移除 → 令牌消失。
section("remove-edit 两种裁决");
{
  const theme = seedTheme();
  const first = makeInput(theme, {
    ops: [
      op("c1", theme.id, "color-muted", "color", "remove", 1, 0),
      op("c2", theme.id, "color-muted", "color", "upsert", 2, 0, { value: "#999999" }),
    ],
  });
  const pendingResult = runMerge(first);

  const keep: MergeEngineInput = {
    themes: pendingResult.themes,
    revisions: pendingResult.revisions,
    ops: first.ops,
    conflicts: pendingResult.conflicts.map((conflict) => ({ ...conflict, resolution: { type: "keep" } })),
    clientLabels: first.clientLabels,
  };
  const kept = runMerge(keep);
  assert(themeToken(kept.themes[0], "color-muted")?.value === "#999999", "裁决保留：令牌按编辑方案留下，移除不生效");

  const remove: MergeEngineInput = {
    themes: pendingResult.themes,
    revisions: pendingResult.revisions,
    ops: first.ops,
    conflicts: pendingResult.conflicts.map((conflict) => ({ ...conflict, resolution: { type: "remove" } })),
    clientLabels: first.clientLabels,
  };
  const removed = runMerge(remove);
  assert(!themeToken(removed.themes[0], "color-muted"), "裁决移除：令牌删除，编辑不复活它");
}

// 9. 基线不同的续作：A 先把值改为 #a 并确认（rev1），B 离线基于 rev0 改为 #b，再回来。
section("跨基线续作合并（stale 编辑不覆盖已确认改动）");
{
  const theme = seedTheme();
  const rev0 = structuredClone(theme);
  const afterA = structuredClone(theme);
  themeToken(afterA, "color-brand")!.value = "#aaaaaa";
  const revisions = { [theme.id]: [rev0, afterA] };
  const current = structuredClone(afterA);
  // B 基于 rev0 改了一个与 A 不同字段的描述，应自动并入 rev1。
  const input: MergeEngineInput = {
    themes: [current],
    revisions,
    ops: [op("c2", theme.id, "color-brand", "color", "upsert", 5, 0, { description: "离线改描述" })],
    conflicts: [],
    clientLabels: { c2: "窗口 B" },
  };
  const result = runMerge(input);
  assert(themeToken(result.themes[0], "color-brand")?.value === "#aaaaaa", "已确认的 A 值保留，未被 B 的旧基线覆盖");
  assert(themeToken(result.themes[0], "color-brand")?.description === "离线改描述", "B 基于旧基线的字段改动仍干净并入");
  assert(result.conflicts.length === 0, "跨基线不同字段不冲突");
}

// 10. 操作幂等：把已经在确认版本中的操作再喂一遍，不产生变化也不产生冲突。
section("幂等：已并入操作重放");
{
  const theme = seedTheme();
  const input = makeInput(theme, {
    ops: [op("c1", theme.id, "color-brand", "color", "upsert", 1, 0, { value: themeToken(theme, "color-brand")!.value })],
  });
  const result = runMerge(input);
  assert(result.bumpedThemeIds.length === 0, "无实际变化时不生成新修订");
  assert(result.consumedOpIds.length === 1, "无意义操作被消化");
}

// 11. injectFailure 抛出异常（由工作区捕获并走检查点恢复）。
section("失败注入");
{
  const theme = seedTheme();
  const input = { ...makeInput(theme, { ops: [op("c1", theme.id, "color-brand", "color", "upsert", 1, 0, { value: "#123" })] }), injectFailure: true };
  let threw = false;
  try {
    runMerge(input);
  } catch {
    threw = true;
  }
  assert(threw, "injectFailure 时抛出，调用方据此回滚检查点");
}

// 12. remove-edit 未裁决时多轮合并：编辑操作不能被悄悄消化掉。
section("remove-edit 未裁决：多轮合并后编辑意图仍在");
{
  const theme = seedTheme();
  const baseValue = themeToken(theme, "color-muted")!.value;
  const ops = [
    op("c1", theme.id, "color-muted", "color", "remove", 1, 0),
    op("c2", theme.id, "color-muted", "color", "upsert", 2, 0, { value: "#999999" }),
  ];
  let state = makeInput(theme, { ops });
  const round1 = runMerge(state);
  assert(round1.consumedOpIds.length === 0, "第一轮没有操作被消化");
  assert(themeToken(round1.themes[0], "color-muted")?.value === baseValue, "确认版本保持基线");

  // 第二轮把第一轮输出（无新修订）连同原操作再喂一次，模拟他窗又触发合并。
  state = {
    themes: round1.themes,
    revisions: round1.revisions,
    ops,
    conflicts: round1.conflicts,
    clientLabels: state.clientLabels,
  };
  const round2 = runMerge(state);
  assert(round2.consumedOpIds.length === 0, "第二轮编辑操作依然保留，没有被悄悄删除意图盖掉");
  assert(round2.conflicts.length === 1, "冲突仍在待处理区");
  assert(round2.conflicts[0].proposals.length === 2, "两边方案仍并排保留");
}

// 13. 三方合并：一个字段 A=C 一致，另一个字段 B 独有，只有真正分歧的字段挂冲突。
section("三窗口：部分一致自动并入，仅分歧字段挂冲突");
{
  const theme = seedTheme();
  const input = makeInput(theme, {
    ops: [
      op("c1", theme.id, "color-brand", "color", "upsert", 1, 0, { value: "#abcdef", description: "共同描述" }),
      op("c2", theme.id, "color-brand", "color", "upsert", 2, 0, { value: "#abcdef" }),
      op("c3", theme.id, "color-brand", "color", "upsert", 3, 0, { value: "#000000" }),
    ],
    clientLabels: { c1: "窗口 A", c2: "窗口 B", c3: "窗口 C" },
  });
  const result = runMerge(input);
  assert(result.conflicts.length === 1 && result.conflicts[0].field === "value", "仅 value 字段挂冲突");
  assert(themeToken(result.themes[0], "color-brand")?.description === "共同描述", "描述字段干净并入");
  assert(result.conflicts[0].proposals.length === 3, "三个窗口方案并排保留来源");
  assert(new Set(result.conflicts[0].proposals.map((p) => p.value)).size === 2, "取值只有两种：#abcdef 与 #000000");
}

console.log(`\n${passes} 通过, ${failures} 失败`);
setTimeout(() => process.exit(failures > 0 ? 1 : 0), 50);
