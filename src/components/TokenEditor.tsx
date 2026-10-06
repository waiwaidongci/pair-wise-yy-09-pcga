import { For, Show, createMemo } from "solid-js";
import { Tabs } from "@kobalte/core/tabs";
import type { DesignToken, TokenKind } from "../types/tokens";
import { TOKEN_LABELS } from "../utils/exporters";
import { contrastGrade, contrastRatio } from "../utils/color";
import { useWorkspace } from "../collab";

const kinds: TokenKind[] = ["color", "fontSize", "spacing", "radius", "shadow", "motion"];

function TokenRow(props: { token: DesignToken; kind: TokenKind }) {
  const workspace = useWorkspace();
  const isColor = () => props.kind === "color";
  // 对比度读“确认版本”的底色，避免离线草稿影响裁决前的对外预览判断。
  const ratio = createMemo(() => {
    if (!isColor()) return 0;
    const background = workspace.activeTheme().tokens.color.find((token) => token.id === "color-surface")?.value ?? "#fff";
    return contrastRatio(props.token.value, background);
  });
  const status = () => workspace.tokenStatus(props.kind, props.token.id);

  return (
    <div class="grid grid-cols-[minmax(150px,1.2fr)_minmax(110px,0.8fr)_32px] gap-3 border-b border-slate-100 px-3 py-3 last:border-0">
      <div>
        <div class="flex items-center gap-2">
          <input
            class="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 font-mono text-xs font-semibold text-slate-800 outline-none transition focus:border-blue-300 focus:bg-white"
            value={props.token.name}
            onInput={(event) => workspace.updateToken(props.kind, props.token.id, { name: event.currentTarget.value })}
          />
          <Show when={status().localPending}>
            <span title="本窗口待处理改动，网络恢复后逐令牌合并" class="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
              待处理
            </span>
          </Show>
          <Show when={status().conflicted}>
            <span title="该令牌存在未裁决冲突，确认版本保持上一版" class="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">
              冲突
            </span>
          </Show>
        </div>
        <p class="mt-1 line-clamp-1 px-2 text-[11px] text-slate-400">{props.token.description}</p>
      </div>
      <div class="flex items-center gap-2">
        <Show when={isColor()}>
          <input
            type="color"
            class="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-slate-200 bg-white p-0.5"
            value={props.token.value.match(/^#[0-9a-f]{6}$/i) ? props.token.value : "#000000"}
            onInput={(event) => workspace.updateToken(props.kind, props.token.id, { value: event.currentTarget.value })}
          />
        </Show>
        <input
          class="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs outline-none focus:border-blue-400"
          value={props.token.value}
          onInput={(event) => workspace.updateToken(props.kind, props.token.id, { value: event.currentTarget.value })}
        />
      </div>
      <button
        class="rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
        title="删除令牌（记录移除意图，不会悄悄盖掉他窗的编辑）"
        onClick={() => workspace.removeToken(props.kind, props.token.id)}
      >
        ×
      </button>
      <Show when={isColor()}>
        <div class="col-span-2 col-start-2 flex items-center justify-between rounded-md bg-slate-50 px-2 py-1">
          <span class="text-[11px] text-slate-500">对比度 {ratio().toFixed(2)}:1</span>
          <span
            class={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              ratio() >= 4.5 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {contrastGrade(ratio())}
          </span>
        </div>
      </Show>
    </div>
  );
}

export default function TokenEditor() {
  const workspace = useWorkspace();
  // 编辑器读写本窗口“草稿”（确认版本 + 本窗口待处理改动）；确认版本不受离线改动污染。
  const draft = () => workspace.draftTheme();

  return (
    <section class="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 class="text-sm font-bold text-slate-800">令牌编辑器</h2>
          <p class="text-xs text-slate-400">
            改动先记入 {workspace.clientLabel()} 的待处理队列 · 基线修订 r{workspace.revisionOfActive()}
          </p>
        </div>
        <button
          class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          onClick={() => {
            const label = window.prompt("快照名称", `${workspace.activeTheme().name} r${workspace.revisionOfActive()} ${new Date().toLocaleTimeString("zh-CN")}`);
            if (label !== null) workspace.saveSnapshot(label);
          }}
        >
          保存快照
        </button>
      </div>

      <Tabs defaultValue="color" class="flex min-h-0 flex-1 flex-col">
        <Tabs.List class="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50/70 px-3 py-2">
          <For each={kinds}>
            {(kind) => (
              <Tabs.Trigger
                value={kind}
                class="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-500 outline-none transition data-[selected]:bg-white data-[selected]:text-blue-700 data-[selected]:shadow-sm"
              >
                {TOKEN_LABELS[kind]}
              </Tabs.Trigger>
            )}
          </For>
        </Tabs.List>
        <For each={kinds}>
          {(kind) => (
            <Tabs.Content value={kind} class="scroll-area min-h-0 flex-1 overflow-y-auto">
              <div class="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {draft().tokens[kind].length} 个令牌
                </span>
                <button class="text-xs font-semibold text-blue-600 hover:text-blue-800" onClick={() => workspace.addToken(kind)}>
                  + 添加令牌
                </button>
              </div>
              <For each={draft().tokens[kind]}>{(token) => <TokenRow token={token} kind={kind} />}</For>
            </Tabs.Content>
          )}
        </For>
      </Tabs>
    </section>
  );
}
