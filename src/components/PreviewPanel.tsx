import { For, Show, createMemo } from "solid-js";
import { Tabs } from "@kobalte/core/tabs";
import { alpha, contrastGrade, contrastRatio } from "../utils/color";
import { useWorkspace } from "../collab";

export default function PreviewPanel() {
  const store = useWorkspace();
  const value = (id: string, fallback: string) => {
    for (const tokens of Object.values(store.activeTheme().tokens)) {
      const found = tokens.find((token) => token.id === id);
      if (found) return found.value;
    }
    return fallback;
  };

  const ratio = createMemo(() => contrastRatio(value("color-text", "#172033"), value("color-surface", "#fff")));
  const cssVars = createMemo(() => ({
    "--preview-brand": value("color-brand", "#356ae6"),
    "--preview-surface": value("color-surface", "#fff"),
    "--preview-text": value("color-text", "#172033"),
    "--preview-muted": value("color-muted", "#68738a"),
    "--preview-success": value("color-success", "#16845b"),
    "--preview-danger": value("color-danger", "#c53b4d"),
    "--preview-radius": value("radius-md", "8px"),
    "--preview-shadow": value("shadow-sm", "0 1px 2px rgb(22 32 51 / 0.08)"),
    "--preview-space": value("space-4", "16px"),
    "--preview-font": value("font-md", "16px"),
    "--preview-motion": value("motion-base", "220ms"),
  }));

  return (
    <section class="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 class="text-sm font-bold text-slate-800">组件预览</h2>
          <p class="text-xs text-slate-400">确认版本 r{store.revisionOfActive()} · {store.activeTheme().name}（未裁决改动不会出现在这里）</p>
        </div>
        <div class={`rounded-full px-2.5 py-1 text-xs font-bold ${ratio() >= 4.5 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          正文对比度 {ratio().toFixed(2)} · {contrastGrade(ratio())}
        </div>
      </div>

      <Tabs defaultValue="dashboard" class="flex min-h-0 flex-1 flex-col">
        <Tabs.List class="flex gap-4 border-b border-slate-100 px-4 pt-3">
          <Tabs.Trigger value="dashboard" class="border-b-2 border-transparent pb-2 text-xs font-semibold text-slate-400 data-[selected]:border-blue-600 data-[selected]:text-blue-700">
            运营面板
          </Tabs.Trigger>
          <Tabs.Trigger value="form" class="border-b-2 border-transparent pb-2 text-xs font-semibold text-slate-400 data-[selected]:border-blue-600 data-[selected]:text-blue-700">
            表单流程
          </Tabs.Trigger>
        </Tabs.List>

        <div class="token-grid scroll-area min-h-0 flex-1 overflow-auto p-5" style={cssVars()}>
          <Tabs.Content value="dashboard">
            <div class="mx-auto max-w-2xl" style={{ color: "var(--preview-text)" }}>
              <div class="mb-4 flex items-center justify-between">
                <div>
                  <p class="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: "var(--preview-muted)" }}>Week 41</p>
                  <h3 class="mt-1 text-2xl font-bold">订单运营概览</h3>
                </div>
                <button
                  class="rounded-lg px-4 py-2 text-sm font-bold text-white transition hover:translate-y-[-1px]"
                  style={{ background: "var(--preview-brand)", "border-radius": "var(--preview-radius)", "transition-duration": "var(--preview-motion)" }}
                >
                  新建批次
                </button>
              </div>
              <div class="grid grid-cols-3 gap-3">
                <For each={[
                  { label: "待处理", value: "1,284", delta: "+12.4%", tone: "var(--preview-brand)" },
                  { label: "已完成", value: "8,920", delta: "+5.8%", tone: "var(--preview-success)" },
                  { label: "异常", value: "27", delta: "-3.1%", tone: "var(--preview-danger)" },
                ]}>
                  {(item) => (
                    <div
                      class="rounded-lg border p-4"
                      style={{
                        background: "var(--preview-surface)",
                        "border-color": alpha(value("color-muted", "#68738a"), 0.2),
                        "border-radius": "var(--preview-radius)",
                        "box-shadow": "var(--preview-shadow)",
                      }}
                    >
                      <p class="text-xs" style={{ color: "var(--preview-muted)" }}>{item.label}</p>
                      <p class="mt-2 text-xl font-bold">{item.value}</p>
                      <p class="mt-1 text-xs font-semibold" style={{ color: item.tone }}>{item.delta}</p>
                    </div>
                  )}
                </For>
              </div>
              <div
                class="mt-4 overflow-hidden rounded-lg border"
                style={{
                  background: "var(--preview-surface)",
                  "border-color": alpha(value("color-muted", "#68738a"), 0.2),
                  "border-radius": "var(--preview-radius)",
                }}
              >
                <For each={["华东仓 · 批量出库", "直播渠道 · 订单归集", "售后池 · 自动分派"]}>
                  {(row, index) => (
                    <div class="flex items-center border-b p-4 last:border-0" style={{ "border-color": alpha(value("color-muted", "#68738a"), 0.12) }}>
                      <span class="mr-3 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: index() === 2 ? "var(--preview-danger)" : "var(--preview-brand)" }}>
                        {index() + 1}
                      </span>
                      <div class="flex-1">
                        <p class="text-sm font-semibold">{row}</p>
                        <p class="mt-1 text-xs" style={{ color: "var(--preview-muted)" }}>最后同步 2 分钟前 · 自动校验完成</p>
                      </div>
                      <span class="rounded-full px-2 py-1 text-xs" style={{ background: alpha(value("color-success", "#16845b"), 0.12), color: "var(--preview-success)" }}>
                        运行中
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="form">
            <div class="mx-auto max-w-lg rounded-xl p-6" style={{ background: "var(--preview-surface)", "border-radius": "var(--preview-radius)", "box-shadow": "var(--preview-shadow)" }}>
              <h3 class="text-xl font-bold">创建交付批次</h3>
              <p class="mt-2 text-sm" style={{ color: "var(--preview-muted)" }}>令牌会统一控制字段状态、反馈和节奏。</p>
              <label class="mt-6 block text-xs font-bold">批次名称</label>
              <input class="mt-2 w-full border px-3 py-2 outline-none" style={{ "border-radius": "var(--preview-radius)", "border-color": "var(--preview-brand)" }} value="国庆活动返场" />
              <div class="mt-4 grid grid-cols-2 gap-3">
                <Show when={true}>
                  <div class="rounded-lg border p-3" style={{ "border-radius": "var(--preview-radius)" }}>
                    <p class="text-xs font-bold">自动质检</p>
                    <p class="mt-1 text-xs" style={{ color: "var(--preview-muted)" }}>通过后进入交付池</p>
                  </div>
                  <div class="rounded-lg border p-3" style={{ "border-radius": "var(--preview-radius)" }}>
                    <p class="text-xs font-bold">人工抽检</p>
                    <p class="mt-1 text-xs" style={{ color: "var(--preview-muted)" }}>抽样比例 10%</p>
                  </div>
                </Show>
              </div>
              <div class="mt-6 flex justify-end gap-2">
                <button class="border px-4 py-2 text-sm font-semibold" style={{ "border-radius": "var(--preview-radius)" }}>取消</button>
                <button class="px-4 py-2 text-sm font-bold text-white" style={{ background: "var(--preview-brand)", "border-radius": "var(--preview-radius)" }}>提交批次</button>
              </div>
            </div>
          </Tabs.Content>
        </div>
      </Tabs>
    </section>
  );
}
