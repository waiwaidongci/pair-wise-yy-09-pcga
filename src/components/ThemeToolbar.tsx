import { createSignal } from "solid-js";
import { Select } from "@kobalte/core/select";
import { useWorkspace } from "../collab";
import { downloadText, parseImportedTheme, toCssVariables, toSassVariables, toStyleDictionaryJson } from "../utils/exporters";
import type { Theme } from "../types/tokens";

export default function ThemeToolbar() {
  const store = useWorkspace();
  const [format, setFormat] = createSignal("json");
  const [importOpen, setImportOpen] = createSignal(false);
  const [importText, setImportText] = createSignal("");

  const exportCurrent = () => {
    const theme = store.activeTheme();
    if (format() === "css") {
      downloadText(`${theme.id}.css`, toCssVariables(theme), "text/css");
    } else if (format() === "scss") {
      downloadText(`${theme.id}.scss`, toSassVariables(theme), "text/x-scss");
    } else {
      downloadText(`${theme.id}.tokens.json`, toStyleDictionaryJson(theme), "application/json");
    }
  };

  const importTheme = () => {
    try {
      const theme = parseImportedTheme(importText(), store.activeTheme());
      store.replaceTheme(theme);
      setImportOpen(false);
      setImportText("");
    } catch {
      window.alert("JSON 解析失败，请检查内容。");
    }
  };

  const uploadJson = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  return (
    <div class="flex flex-wrap items-center gap-2">
      <div class="min-w-[180px]">
        <Select<Theme>
          options={store.themes()}
          value={store.activeTheme()}
          optionValue="id"
          optionTextValue="name"
          onChange={(theme) => theme && store.setActiveThemeId(theme.id)}
          itemComponent={(props) => (
            <Select.Item item={props.item} class="cursor-pointer rounded-md px-3 py-2 text-sm text-slate-700 outline-none data-[highlighted]:bg-blue-50 data-[selected]:font-bold data-[selected]:text-blue-700">
              <Select.ItemLabel>{props.item.rawValue.name}</Select.ItemLabel>
            </Select.Item>
          )}
        >
          <Select.Trigger class="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm outline-none">
            <Select.Value<Theme> class="truncate">{(state) => state.selectedOption().name}</Select.Value>
            <Select.Icon class="ml-2 text-slate-400">⌄</Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content class="z-50 min-w-[180px] rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
              <Select.Listbox />
            </Select.Content>
          </Select.Portal>
        </Select>
      </div>
      <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => {
        const name = window.prompt("新主题名称", `品牌主题 ${store.themes().length + 1}`);
        if (name) store.createTheme(name);
      }}>
        复制主题
      </button>
      <div class="flex overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <select class="border-r border-slate-200 bg-white px-2 py-2 text-xs font-semibold outline-none" value={format()} onChange={(event) => setFormat(event.currentTarget.value)}>
          <option value="json">Style Dictionary JSON</option>
          <option value="css">CSS Variables</option>
          <option value="scss">Sass Variables</option>
        </select>
        <button class="px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50" onClick={exportCurrent}>导出</button>
      </div>
      <button class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => setImportOpen(true)}>
        导入 JSON
      </button>

      {importOpen() && (
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onClick={() => setImportOpen(false)}>
          <div class="w-full max-w-2xl rounded-xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div class="flex items-center justify-between">
              <div>
                <h3 class="font-bold text-slate-900">导入令牌</h3>
                <p class="mt-1 text-xs text-slate-500">支持工作台主题 JSON 与扁平键值 JSON</p>
              </div>
              <input type="file" accept=".json,application/json" class="text-xs" onChange={(event) => uploadJson(event.currentTarget.files?.[0])} />
            </div>
            <textarea
              class="mt-4 h-72 w-full rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs outline-none focus:border-blue-400"
              placeholder='{"color.brand.primary":"#356ae6"}'
              value={importText()}
              onInput={(event) => setImportText(event.currentTarget.value)}
            />
            <div class="mt-4 flex justify-end gap-2">
              <button class="rounded-lg border px-4 py-2 text-sm" onClick={() => setImportOpen(false)}>取消</button>
              <button class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" disabled={!importText().trim()} onClick={importTheme}>导入为新主题</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
