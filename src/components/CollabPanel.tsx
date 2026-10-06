import { For, Show, createMemo } from "solid-js";
import { useTokenStore } from "../stores/tokenStore";
import { TOKEN_LABELS } from "../utils/exporters";
import type { TokenConflict, TokenOperation } from "../types/tokens";

const REASON_LABELS: Record<TokenConflict["reason"], string> = {
  "both-edited": "两边都改了",
  "edit-removed": "一边修改一边删除",
  "add-add": "新增了同名令牌",
};

function opDescription(op: TokenOperation): string {
  if (op.type === "add") return `新增令牌 ${op.token?.name ?? op.tokenId}`;
  if (op.type === "remove") return `删除令牌 ${op.tokenId}`;
  const fields = Object.keys(op.patch ?? {});
  if (fields.length === 0) return `修改令牌 ${op.tokenId}`;
  const labels: Record<string, string> = { name: "名称", value: "值", description: "描述" };
  return `修改 ${fields.map((field) => labels[field] ?? field).join("、")}`;
}

function PendingOpsList() {
  const store = useTokenStore();
  const grouped = createMemo(() => {
    const map = new Map<string, TokenOperation[]>();
    for (const op of store.pendingOps()) {
      if (op.themeId !== store.activeThemeId()) continue;
      if (!map.has(op.windowId)) map.set(op.windowId, []);
      map.get(op.windowId)!.push(op);
    }
    return Array.from(map.entries());
  });

  return (
    <div class="space-y-2">
      <For each={grouped()}>
        {([windowId, ops]) => (
          <div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div class="flex items-center gap-2">
              <span class="h-2.5 w-2.5 rounded-full" style={{ background: store.windowId() === windowId ? store.windowColor() : "#94a3b8" }} />
              <span class="text-xs font-bold text-slate-700">
                {store.windowId() === windowId ? `${store.windowName()}（本窗口）` : `窗口 ${windowId.replace("window-", "")}`}
              </span>
              <span class="text-[10px] text-slate-400">基线修订 {ops[0]?.baseRevision ?? 1}</span>
            </div>
            <ul class="mt-2 space-y-1">
              <For each={ops}>{(op) => <li class="font-mono text-[11px] text-slate-600">· {opDescription(op)}</li>}</For>
            </ul>
          </div>
        )}
      </For>
    </div>
  );
}

function ConflictCard(props: { conflict: TokenConflict }) {
  const store = useTokenStore();
  const isColor = () => props.conflict.kind === "color";

  return (
    <div class="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div class="flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">{REASON_LABELS[props.conflict.reason]}</span>
            <span class="font-mono text-xs font-bold text-slate-800">{props.conflict.tokenName}</span>
          </div>
          <p class="mt-1 text-[11px] text-slate-500">
            {TOKEN_LABELS[props.conflict.kind]} · 基线修订 {props.conflict.baseRevision} · 裁决前主题保持上一份确认版本
          </p>
        </div>
      </div>

      <div class="mt-3 grid gap-3 md:grid-cols-2">
        <For each={props.conflict.versions}>
          {(version) => (
            <div class="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="h-2.5 w-2.5 rounded-full" style={{ background: version.windowColor }} />
                  <span class="text-xs font-bold text-slate-700">{version.windowName}</span>
                </div>
                <span class="text-[10px] text-slate-400">{version.ops.length} 项改动</span>
              </div>
              <Show
                when={version.token}
                fallback={
                  <div class="mt-2 rounded-md bg-rose-50 px-2 py-3 text-center text-xs font-bold text-rose-600">已删除</div>
                }
              >
                {(token) => (
                  <div class="mt-2 flex items-center gap-2">
                    <Show when={isColor()}>
                      <span class="h-6 w-6 shrink-0 rounded border border-slate-200" style={{ background: token().value }} />
                    </Show>
                    <code class="truncate font-mono text-xs text-slate-800">{token().value}</code>
                  </div>
                )}
              </Show>
              <div class="mt-2 flex flex-wrap gap-1">
                <button
                  class="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-700"
                  onClick={() => store.adjudicateConflict(props.conflict.id, "pick", version.windowId)}
                >
                  采用此版本
                </button>
                <button
                  class="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  onClick={() => store.adjudicateConflict(props.conflict.id, "keep-both", version.windowId)}
                >
                  两边都保留
                </button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

export default function CollabPanel(props: { open: boolean; onClose: () => void }) {
  const store = useTokenStore();
  const pendingOpsForTheme = createMemo(() => store.pendingOps().filter((op) => op.themeId === store.activeThemeId()).length);

  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-50 flex justify-end bg-slate-950/40" onClick={props.onClose}>
        <div class="h-full w-full max-w-xl overflow-y-auto bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
            <div>
              <h3 class="text-sm font-black text-slate-900">协作待处理区</h3>
              <p class="mt-0.5 text-[11px] text-slate-500">
                {store.windowName()} · {store.online() ? "在线" : "离线"} · 主题保持上一份确认版本，裁决后生成新快照
              </p>
            </div>
            <button class="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100" onClick={props.onClose}>✕</button>
          </div>

          <div class="space-y-5 px-5 py-4">
            <section class="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div class="flex items-center gap-2">
                <span class={`h-2.5 w-2.5 rounded-full ${store.online() ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span class="text-xs font-bold text-slate-700">{store.online() ? "在线 · 改动即时合并" : "离线 · 改动暂存待合并"}</span>
              </div>
              <button
                class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
                disabled={pendingOpsForTheme() === 0 && store.pendingConflicts().length === 0}
                onClick={() => store.mergePending()}
              >
                立即合并
              </button>
            </section>

            <Show when={store.pendingConflicts().length > 0}>
              <section>
                <h4 class="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">冲突 · {store.pendingConflicts().length}</h4>
                <div class="space-y-3">
                  <For each={store.pendingConflicts()}>{(conflict) => <ConflictCard conflict={conflict} />}</For>
                </div>
              </section>
            </Show>

            <Show when={pendingOpsForTheme() > 0}>
              <section>
                <h4 class="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">待合并改动 · {pendingOpsForTheme()}</h4>
                <PendingOpsList />
              </section>
            </Show>

            <Show when={store.pendingChangeCount() === 0}>
              <div class="rounded-lg border border-dashed border-slate-200 py-10 text-center text-xs text-slate-400">
                没有待处理改动。两个窗口离线编辑同一主题后，回到这里合并。
              </div>
            </Show>

            <Show when={store.checkpoints().length > 0}>
              <section>
                <h4 class="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">检查点</h4>
                <div class="space-y-1.5">
                  <For each={store.checkpoints().slice(0, 5)}>
                    {(checkpoint) => (
                      <div class="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                        <div>
                          <p class="text-xs font-semibold text-slate-700">{checkpoint.label}</p>
                          <p class="text-[10px] text-slate-400">修订 {checkpoint.revision} · {checkpoint.createdAt}</p>
                        </div>
                        <button
                          class="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                          onClick={() => store.recoverCheckpoint(checkpoint.id)}
                        >
                          恢复
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </section>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
