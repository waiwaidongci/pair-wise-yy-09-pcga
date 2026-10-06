import { For, Match, Show, Switch, createMemo, createSignal } from "solid-js";
import { useWorkspace } from "../collab";
import type { Conflict, ConflictResolution } from "../collab/types";

const FIELD_LABELS: Record<string, string> = {
  name: "令牌名",
  value: "值",
  description: "描述",
};

function ConflictCard(props: { conflict: Conflict }) {
  const workspace = useWorkspace();
  const [customValue, setCustomValue] = createSignal("");
  const conflict = () => props.conflict;
  const resolution = () => conflict().resolution;

  const choose = (next: ConflictResolution) => workspace.setResolution(conflict().id, next);
  const clear = () => workspace.setResolution(conflict().id, undefined);

  const chosenOpId = createMemo(() => {
    const current = resolution();
    return current?.type === "proposal" ? current.opId : undefined;
  });

  return (
    <div class="rounded-lg border border-rose-200 bg-rose-50/50 p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-black text-white">
          <Switch>
            <Match when={conflict().conflictType === "value-value"}>同值分歧 · {FIELD_LABELS[conflict().field ?? "value"]}</Match>
            <Match when={conflict().conflictType === "remove-edit"}>移除 ↔ 编辑</Match>
            <Match when={conflict().conflictType === "add-add"}>并行新增不一致</Match>
          </Switch>
        </span>
        <span class="font-mono text-xs font-bold text-slate-800">{conflict().tokenName || conflict().tokenId}</span>
        <Show when={conflict().field && conflict().conflictType === "value-value"}>
          <span class="text-[11px] text-slate-400">确认版当前值：<code class="text-slate-600">{conflict().baseValue || "（空）"}</code></span>
        </Show>
      </div>

      <div class="mt-2 space-y-1.5">
        <For each={conflict().proposals}>
          {(proposal) => (
            <button
              class={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition ${
                chosenOpId() === proposal.opId
                  ? "border-blue-500 bg-blue-50 ring-1 ring-blue-300"
                  : "border-slate-200 bg-white hover:border-blue-300"
              }`}
              onClick={() => choose({ type: "proposal", opId: proposal.opId })}
            >
              <span class="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white">{proposal.clientLabel}</span>
              <Show
                when={!proposal.removed}
                fallback={<span class="font-bold text-rose-600">移除该令牌</span>}
              >
                <span class="min-w-0 flex-1 truncate font-mono text-slate-700">
                  <Show when={conflict().conflictType === "value-value"} fallback={formatPatch(proposal.patch)}>
                    {proposal.value}
                  </Show>
                </span>
              </Show>
              <span class="shrink-0 text-[10px] text-slate-400">{new Date(proposal.at).toLocaleTimeString("zh-CN", { hour12: false })}</span>
            </button>
          )}
        </For>
      </div>

      <div class="mt-2 flex flex-wrap items-center gap-2">
        <Show when={conflict().conflictType === "value-value"}>
          <button
            class="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            classList={{ "!border-slate-500 !bg-slate-100": resolution()?.type === "base" }}
            onClick={() => choose({ type: "base" })}
          >
            维持确认版
          </button>
          <div class="flex items-center gap-1">
            <input
              class="w-32 rounded-md border border-slate-200 px-2 py-1 font-mono text-[11px] outline-none focus:border-blue-400"
              placeholder="自定义值"
              value={customValue()}
              onInput={(event) => setCustomValue(event.currentTarget.value)}
            />
            <button
              class="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
              disabled={!customValue().trim()}
              onClick={() => choose({ type: "custom", value: customValue().trim() })}
            >
              用自定义值
            </button>
          </div>
        </Show>
        <Show when={conflict().conflictType === "remove-edit"}>
          <button
            class="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
            classList={{ "!border-rose-500 !bg-rose-50": resolution()?.type === "remove" }}
            onClick={() => choose({ type: "remove" })}
          >
            裁决：移除
          </button>
          <button
            class="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50"
            classList={{ "!border-emerald-600 !bg-emerald-50": resolution()?.type === "keep" }}
            onClick={() => choose({ type: "keep" })}
          >
            裁决：保留并合并编辑
          </button>
          <button
            class="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
            classList={{ "!border-slate-500 !bg-slate-100": resolution()?.type === "base" }}
            onClick={() => choose({ type: "base" })}
          >
            维持确认版（丢弃两边意图）
          </button>
        </Show>
        <Show when={resolution()}>
          <span class="text-[11px] font-semibold text-blue-700">已暂存裁决，提交后生成新修订与快照</span>
          <button class="text-[11px] font-semibold text-slate-400 underline hover:text-slate-600" onClick={clear}>
            撤回裁决
          </button>
        </Show>
      </div>
    </div>
  );
}

function formatPatch(patch?: Conflict["proposals"][number]["patch"]): string {
  if (!patch) return "（完整令牌）";
  return [patch.name && `名:${patch.name}`, patch.value && `值:${patch.value}`, patch.description && `描述:${patch.description}`].filter(Boolean).join("  ");
}

export default function PendingPanel() {
  const workspace = useWorkspace();
  const localCount = () => workspace.localPendingOps().length;
  const otherCount = () => workspace.allPendingOps().length - localCount();
  const conflicts = () => workspace.themeConflicts();

  return (
    <section class="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 class="text-sm font-bold text-slate-800">待处理改动与冲突</h2>
          <p class="text-xs text-slate-400">未裁决期间主题仍指向上一份确认版本</p>
        </div>
        <div class="flex items-center gap-1.5 text-[11px] font-bold">
          <span class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">本窗 {localCount()}</span>
          <span class="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">他窗 {otherCount()}</span>
          <span class="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">冲突 {conflicts().length}</span>
        </div>
      </div>

      <div class="scroll-area min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        <Show
          when={conflicts().length || localCount() || otherCount()}
          fallback={<div class="flex h-full items-center justify-center text-xs text-slate-400">没有待处理改动，确认版本是最新的。</div>}
        >
          <For each={conflicts()}>{(conflict) => <ConflictCard conflict={conflict} />}</For>
          <Show when={!conflicts().length && (localCount() || otherCount())}>
            <div class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          <Switch>
                <Match when={!workspace.online()}>当前离线：改动安全记录在各窗口，网络恢复后自动逐令牌合并。</Match>
                <Match when={workspace.merging()}>正在合并待处理改动…</Match>
                <Match when={true}>改动已自动并入，无冲突。</Match>
              </Switch>
            </div>
          </Show>
        </Show>
      </div>
    </section>
  );
}
