import { For, Show, createMemo } from "solid-js";
import { Tabs } from "@kobalte/core/tabs";
import type { DesignToken, TokenKind } from "../types/tokens";
import { TOKEN_LABELS } from "../utils/exporters";
import { contrastGrade, contrastRatio } from "../utils/color";
import { useTokenStore } from "../stores/tokenStore";

const kinds: TokenKind[] = ["color", "fontSize", "spacing", "radius", "shadow", "motion"];

/** 计算当前主题下每个令牌的待处理状态，用于在编辑器里打标记。 */
function usePendingMarkers() {
  const store = useTokenStore();
  return createMemo(() => {
    const themeId = store.activeThemeId();
    const markers = new Map<string, { own: boolean; other: boolean; conflict: boolean }>();
    for (const op of store.pendingOps()) {
      if (op.themeId !== themeId) continue;
      const current = markers.get(op.tokenId) ?? { own: false, other: false, conflict: false };
      if (op.windowId === store.windowId()) current.own = true;
      else current.other = true;
      markers.set(op.tokenId, current);
    }
    for (const conflict of store.pendingConflicts()) {
      if (conflict.themeId !== themeId) continue;
      const current = markers.get(conflict.tokenId) ?? { own: false, other: false, conflict: false };
      current.conflict = true;
      markers.set(conflict.tokenId, current);
    }
    return markers;
  });
}

function PendingDot(props: { status: { own: boolean; other: boolean; conflict: boolean } | undefined }) {
  const store = useTokenStore();
  return (
    <Show when={props.status}>
      {(status) => {
        const color = () => (status().conflict ? "#d97706" : status().own ? store.windowColor() : "#94a3b8");
        const title = () => (status().conflict ? "存在未裁决冲突" : status().own ? "本窗口未合并改动" : "其他窗口未合并改动");
        return <span class="h-2 w-2 shrink-0 rounded-full" style={{ background: color() }} title={title()} />;
      }}
    </Show>
  );
}

function TokenRow(props: { token: DesignToken; kind: TokenKind }) {
  const store = useTokenStore();
  const markers = usePendingMarkers();
  const isColor = () => props.kind === "color";
  const ratio = createMemo(() => {
    if (!isColor()) return 0;
    const background = store.workingTheme().tokens.color.find((token) => token.id === "color-surface")?.value ?? "#fff";
    return contrastRatio(props.token.value, background);
  });

  return (
    <div class="grid grid-cols-[minmax(150px,1.2fr)_minmax(110px,0.8fr)_32px] gap-3 border-b border-slate-100 px-3 py-3 last:border-0">
      <div>
        <div class="flex items-center gap-2">
          <PendingDot status={markers().get(props.token.id)} />
          <input
            class="w-full rounded-md border border-transparent bg-transparent px-2 py-1 font-mono text-xs font-semibold text-slate-800 outline-none transition focus:border-blue-300 focus:bg-white"
            value={props.token.name}
            onInput={(event) => store.updateToken(props.kind, props.token.id, { name: event.currentTarget.value })}
          />
        </div>
        <p class="mt-1 line-clamp-1 px-2 text-[11px] text-slate-400">{props.token.description}</p>
      </div>
      <div class="flex items-center gap-2">
        <Show when={isColor()}>
          <input
            type="color"
            class="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-slate-200 bg-white p-0.5"
            value={props.token.value.match(/^#[0-9a-f]{6}$/i) ? props.token.value : "#000000"}
            onInput={(event) => store.updateToken(props.kind, props.token.id, { value: event.currentTarget.value })}
          />
        </Show>
        <input
          class="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs outline-none focus:border-blue-400"
          value={props.token.value}
          onInput={(event) => store.updateToken(props.kind, props.token.id, { value: event.currentTarget.value })}
        />
      </div>
      <button
        class="rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
        title="删除令牌"
        onClick={() => store.removeToken(props.kind, props.token.id)}
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
  const store = useTokenStore();
  const markers = usePendingMarkers();
  const pendingCount = createMemo(() => {
    const themeId = store.activeThemeId();
    let count = 0;
    for (const op of store.pendingOps()) if (op.themeId === themeId) count += 1;
    return count;
  });

  return (
    <section class="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 class="text-sm font-bold text-slate-800">令牌编辑器</h2>
          <p class="text-xs text-slate-400">
            {store.online() ? "在线 · 改动即时合并到确认版本" : "离线 · 改动暂存，恢复网络后合并"}
            {pendingCount() > 0 && <span class="ml-1 font-semibold text-amber-600">· {pendingCount()} 项待合并</span>}
          </p>
        </div>
        <button
          class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          onClick={() => {
            const label = window.prompt("快照名称", `${store.activeTheme().name} ${new Date().toLocaleTimeString("zh-CN")}`);
            if (label !== null) store.saveSnapshot(label);
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
                  {store.workingTheme().tokens[kind].length} 个令牌
                </span>
                <button class="text-xs font-semibold text-blue-600 hover:text-blue-800" onClick={() => store.addToken(kind)}>
                  + 添加令牌
                </button>
              </div>
              <For each={store.workingTheme().tokens[kind]}>
                {(token) => <TokenRow token={token} kind={kind} />}
              </For>
            </Tabs.Content>
          )}
        </For>
      </Tabs>
    </section>
  );
}
