import { A, useLocation } from "@solidjs/router";
import type { JSX } from "solid-js";
import { createSignal, Show } from "solid-js";
import ThemeToolbar from "./ThemeToolbar";
import CollabPanel from "./CollabPanel";
import { useTokenStore } from "../stores/tokenStore";

export default function AppShell(props: { children: JSX.Element }) {
  const location = useLocation();
  const store = useTokenStore();
  const [collabOpen, setCollabOpen] = createSignal(false);

  return (
    <div class="min-h-screen bg-[#eef1f6] text-slate-900">
      <header class="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div class="mx-auto flex max-w-[1600px] items-center gap-5 px-5 py-3">
          <div class="flex items-center gap-3">
            <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-black text-white">TF</div>
            <div>
              <h1 class="text-sm font-black tracking-tight">Token Forge</h1>
              <p class="text-[11px] text-slate-400">设计令牌工作台</p>
            </div>
          </div>
          <nav class="flex items-center rounded-lg bg-slate-100 p-1">
            <A
              href="/"
              class={`rounded-md px-3 py-1.5 text-xs font-bold ${location.pathname === "/" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            >
              工作区
            </A>
            <A
              href="/compare"
              class={`rounded-md px-3 py-1.5 text-xs font-bold ${location.pathname === "/compare" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}
            >
              版本差异
            </A>
          </nav>
          <div class="ml-auto flex items-center gap-3">
            <div class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5">
              <span class="h-2 w-2 rounded-full" style={{ background: store.windowColor() }} />
              <span class="text-xs font-semibold text-slate-600">{store.windowName()}</span>
            </div>
            <button
              class={`relative rounded-lg border px-3 py-1.5 text-xs font-bold ${
                store.online() ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50" : "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
              }`}
              onClick={() => store.setOnlineStatus(!store.online())}
              title={store.online() ? "点击切换为离线，模拟断网编辑" : "点击恢复在线，自动合并"}
            >
              {store.online() ? "在线" : "离线"}
            </button>
            <button
              class="relative rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
              onClick={() => setCollabOpen(true)}
            >
              待处理
              <Show when={store.pendingChangeCount() > 0}>
                <span class="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">
                  {store.pendingChangeCount()}
                </span>
              </Show>
            </button>
            <ThemeToolbar />
          </div>
        </div>
      </header>
      <main class="mx-auto h-[calc(100vh-65px)] max-w-[1600px] p-4">{props.children}</main>
      <CollabPanel open={collabOpen()} onClose={() => setCollabOpen(false)} />
    </div>
  );
}
