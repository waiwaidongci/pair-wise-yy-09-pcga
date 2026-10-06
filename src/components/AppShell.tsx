import { A, useLocation } from "@solidjs/router";
import type { JSX } from "solid-js";
import ThemeToolbar from "./ThemeToolbar";

export default function AppShell(props: { children: JSX.Element }) {
  const location = useLocation();
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
          <div class="ml-auto">
            <ThemeToolbar />
          </div>
        </div>
      </header>
      <main class="mx-auto h-[calc(100vh-65px)] max-w-[1600px] p-4">{props.children}</main>
    </div>
  );
}
