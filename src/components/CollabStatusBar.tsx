import { For, Show, createSignal } from "solid-js";
import { useWorkspace } from "../collab";

/**
 * 协作状态与网络模拟：
 * - 在线/断网切换决定改动是直接续作合并还是先留在各窗口；
 * - 展示当前窗口身份与同浏览器内其他窗口；
 * - 合并失败后的检查点恢复入口、以及用于演练的失败注入。
 */
export default function CollabStatusBar() {
  const workspace = useWorkspace();
  const [confirmFail, setConfirmFail] = createSignal(false);

  return (
    <div class="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
      <div class="flex items-center gap-2">
        <span class={`h-2.5 w-2.5 rounded-full ${workspace.online() ? "bg-emerald-500" : "bg-slate-300"}`} />
        <span class="text-xs font-bold text-slate-700">{workspace.online() ? "网络正常" : "已断网"}</span>
        <button
          class={`rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
            workspace.online()
              ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
          onClick={() => workspace.setOnline(!workspace.online())}
        >
          {workspace.online() ? "模拟断网" : "恢复网络并合并"}
        </button>
      </div>

      <div class="h-4 w-px bg-slate-200" />

      <div class="flex items-center gap-2 text-[11px]">
        <span class="font-bold text-slate-500">窗口：</span>
        <For each={workspace.clients()}>
          {(client) => (
            <span
              class={`rounded-full px-2 py-0.5 font-bold ${
                client.id === workspace.clientId
                  ? "bg-slate-900 text-white"
                  : client.open
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-400"
              }`}
            >
              {client.label}
              {client.id === workspace.clientId ? "（本窗）" : client.open ? " · 在线" : " · 已关闭"}
            </span>
          )}
        </For>
      </div>

      <Show when={workspace.merging()}>
        <span class="text-[11px] font-bold text-blue-600">合并中…</span>
      </Show>

      <div class="ml-auto flex items-center gap-2">
        <Show when={workspace.mergeError()}>
          <span class="rounded-md bg-rose-50 px-2 py-1 text-[11px] font-bold text-rose-600">{workspace.mergeError()}</span>
        </Show>
        <Show when={workspace.checkpoint()}>
          <button
            class="rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-amber-600"
            onClick={() => workspace.recoverFromCheckpoint()}
          >
            从检查点恢复
          </button>
        </Show>
        <Show
          when={!confirmFail()}
          fallback={
            <span class="flex items-center gap-1 text-[11px]">
              <span class="font-bold text-slate-500">下次合并将失败：</span>
              <button
                class="rounded bg-rose-600 px-2 py-0.5 font-bold text-white"
                onClick={() => {
                  workspace.armNextMergeFailure();
                  setConfirmFail(false);
                }}
              >
                确认注入
              </button>
              <button class="text-slate-400 underline" onClick={() => setConfirmFail(false)}>
                取消
              </button>
            </span>
          }
        >
          <button
            class="rounded-md border border-dashed border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600"
            title="演练：让下一轮合并在写入新修订前失败，触发检查点恢复流程"
            onClick={() => setConfirmFail(true)}
          >
            演练合并失败
          </button>
        </Show>
      </div>
    </div>
  );
}
