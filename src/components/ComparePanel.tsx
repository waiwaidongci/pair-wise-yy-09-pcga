import { For, Show, createMemo, createSignal } from "solid-js";
import { diffThemes } from "../utils/exporters";
import { useWorkspace } from "../collab";

export default function ComparePanel() {
  const store = useWorkspace();
  const [beforeId, setBeforeId] = createSignal(store.snapshots()[0]?.id ?? "");
  const [afterId, setAfterId] = createSignal("current");
  const before = createMemo(() => store.snapshots().find((item) => item.id === beforeId())?.theme);
  const after = createMemo(() => afterId() === "current" ? store.activeTheme() : store.snapshots().find((item) => item.id === afterId())?.theme);
  const differences = createMemo(() => before() && after() ? diffThemes(before()!, after()!) : []);

  return (
    <div class="flex h-full min-h-0 flex-col gap-4">
      <section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div class="flex flex-wrap items-end gap-4">
          <div>
            <p class="text-xs font-bold uppercase tracking-wider text-slate-400">基准快照</p>
            <select class="mt-2 min-w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={beforeId()} onChange={(event) => setBeforeId(event.currentTarget.value)}>
              <option value="">请选择快照</option>
              <For each={store.snapshots()}>{(snapshot) => <option value={snapshot.id}>{snapshot.label} · r{snapshot.revision ?? 0} · {snapshot.createdAt}</option>}</For>
            </select>
          </div>
          <div class="pb-3 text-xl text-slate-300">→</div>
          <div>
            <p class="text-xs font-bold uppercase tracking-wider text-slate-400">对比目标</p>
            <select class="mt-2 min-w-64 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={afterId()} onChange={(event) => setAfterId(event.currentTarget.value)}>
              <option value="current">当前确认版本 r{store.revisionOfActive()} · {store.activeTheme().name}</option>
              <For each={store.snapshots()}>{(snapshot) => <option value={snapshot.id}>{snapshot.label} · r{snapshot.revision ?? 0} · {snapshot.createdAt}</option>}</For>
            </select>
          </div>
          <div class="ml-auto rounded-lg bg-slate-50 px-4 py-3">
            <p class="text-xs text-slate-500">检测到变化</p>
            <p class="text-2xl font-black text-slate-900">{differences().length}</p>
          </div>
        </div>
      </section>

      <section class="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 class="text-sm font-bold">令牌差异</h2>
          <p class="text-xs text-slate-400">仅展示新增、删除和值变化</p>
        </div>
        <Show
          when={differences().length}
          fallback={<div class="flex flex-1 items-center justify-center text-sm text-slate-400">选择两个不同快照后查看差异，或先保存多个快照。</div>}
        >
          <div class="scroll-area min-h-0 flex-1 overflow-auto">
            <div class="grid grid-cols-[1.2fr_1fr_1fr_88px] border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <span>令牌</span><span>修改前</span><span>修改后</span><span>类型</span>
            </div>
            <For each={differences()}>
              {(difference) => (
                <div class="grid grid-cols-[1.2fr_1fr_1fr_88px] items-center border-b border-slate-100 px-4 py-3 text-xs">
                  <span class="font-mono font-semibold text-slate-800">{difference.path}</span>
                  <div class="flex items-center gap-2">
                    <Show when={difference.before.startsWith("#")}><span class="h-4 w-4 rounded" style={{ background: difference.before }} /></Show>
                    <code class="truncate text-rose-600">{difference.before}</code>
                  </div>
                  <div class="flex items-center gap-2">
                    <Show when={difference.after.startsWith("#")}><span class="h-4 w-4 rounded" style={{ background: difference.after }} /></Show>
                    <code class="truncate text-emerald-700">{difference.after}</code>
                  </div>
                  <span class="w-fit rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-600">
                    {difference.kind === "changed" ? "值变化" : difference.kind === "added" ? "新增" : "移除"}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>
    </div>
  );
}
