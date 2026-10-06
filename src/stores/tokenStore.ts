import { createEffect, createMemo, createSignal } from "solid-js";
import type { DesignToken, Snapshot, Theme, TokenKind } from "../types/tokens";

const STORAGE_KEY = "token-forge-workspace-v1";

const makeTokens = (): Theme["tokens"] => ({
  color: [
    { id: "color-brand", name: "color.brand.primary", value: "#356ae6", description: "品牌主色，用于主操作" },
    { id: "color-surface", name: "color.surface.default", value: "#ffffff", description: "默认卡片与页面表面" },
    { id: "color-text", name: "color.text.primary", value: "#172033", description: "正文主文字" },
    { id: "color-muted", name: "color.text.muted", value: "#68738a", description: "次级说明文字" },
    { id: "color-success", name: "color.status.success", value: "#16845b", description: "成功状态" },
    { id: "color-danger", name: "color.status.danger", value: "#c53b4d", description: "错误与危险状态" },
  ],
  fontSize: [
    { id: "font-xs", name: "font.size.xs", value: "12px", description: "辅助标签" },
    { id: "font-sm", name: "font.size.sm", value: "14px", description: "表格与控件" },
    { id: "font-md", name: "font.size.md", value: "16px", description: "正文" },
    { id: "font-lg", name: "font.size.lg", value: "20px", description: "区块标题" },
    { id: "font-xl", name: "font.size.xl", value: "28px", description: "页面标题" },
  ],
  spacing: [
    { id: "space-1", name: "space.1", value: "4px", description: "最小间距" },
    { id: "space-2", name: "space.2", value: "8px", description: "紧凑间距" },
    { id: "space-3", name: "space.3", value: "12px", description: "控件内间距" },
    { id: "space-4", name: "space.4", value: "16px", description: "常规间距" },
    { id: "space-6", name: "space.6", value: "24px", description: "区块间距" },
    { id: "space-8", name: "space.8", value: "32px", description: "大区块间距" },
  ],
  radius: [
    { id: "radius-sm", name: "radius.sm", value: "4px", description: "小控件" },
    { id: "radius-md", name: "radius.md", value: "8px", description: "卡片与输入框" },
    { id: "radius-full", name: "radius.full", value: "999px", description: "胶囊标签" },
  ],
  shadow: [
    { id: "shadow-sm", name: "shadow.sm", value: "0 1px 2px rgb(22 32 51 / 0.08)", description: "轻微抬升" },
    { id: "shadow-lg", name: "shadow.lg", value: "0 16px 40px rgb(22 32 51 / 0.14)", description: "浮层与弹窗" },
  ],
  motion: [
    { id: "motion-fast", name: "motion.duration.fast", value: "120ms", description: "即时反馈" },
    { id: "motion-base", name: "motion.duration.base", value: "220ms", description: "标准过渡" },
    { id: "motion-slow", name: "motion.duration.slow", value: "420ms", description: "强调过渡" },
  ],
});

function seedThemes(): Theme[] {
  const light = { id: "theme-light", name: "企业浅色", tokens: makeTokens() };
  const dark = structuredClone(light);
  dark.id = "theme-dark";
  dark.name = "夜间模式";
  dark.tokens.color = dark.tokens.color.map((token) => {
    if (token.id === "color-surface") return { ...token, value: "#151b28" };
    if (token.id === "color-text") return { ...token, value: "#f4f7ff" };
    if (token.id === "color-muted") return { ...token, value: "#aab4ca" };
    return token;
  });
  const dense = structuredClone(light);
  dense.id = "theme-dense";
  dense.name = "高密度运营";
  dense.tokens.fontSize = dense.tokens.fontSize.map((token) => ({
    ...token,
    value: `${Math.max(11, Number.parseInt(token.value, 10) - 1)}px`,
  }));
  dense.tokens.spacing = dense.tokens.spacing.map((token) => ({
    ...token,
    value: `${Math.max(2, Number.parseInt(token.value, 10) - 2)}px`,
  }));
  return [light, dark, dense];
}

interface PersistedState {
  themes: Theme[];
  activeThemeId: string;
  snapshots: Snapshot[];
}

function readPersisted(): PersistedState {
  const fallback: PersistedState = { themes: seedThemes(), activeThemeId: "theme-light", snapshots: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as PersistedState;
    return parsed.themes?.length ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const initial = readPersisted();
const [themes, setThemes] = createSignal<Theme[]>(initial.themes);
const [activeThemeId, setActiveThemeId] = createSignal(initial.activeThemeId);
const [snapshots, setSnapshots] = createSignal<Snapshot[]>(initial.snapshots);

const activeTheme = createMemo(() => themes().find((theme) => theme.id === activeThemeId()) ?? themes()[0]);

createEffect(() => {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ themes: themes(), activeThemeId: activeThemeId(), snapshots: snapshots() }),
  );
});

function updateTheme(themeId: string, updater: (theme: Theme) => Theme): void {
  setThemes((current) => current.map((theme) => (theme.id === themeId ? updater(theme) : theme)));
}

export function useTokenStore() {
  const updateToken = (kind: TokenKind, id: string, patch: Partial<DesignToken>): void => {
    updateTheme(activeThemeId(), (theme) => ({
      ...theme,
      tokens: {
        ...theme.tokens,
        [kind]: theme.tokens[kind].map((token) => (token.id === id ? { ...token, ...patch } : token)),
      },
    }));
  };

  const addToken = (kind: TokenKind): void => {
    updateTheme(activeThemeId(), (theme) => ({
      ...theme,
      tokens: {
        ...theme.tokens,
        [kind]: [
          ...theme.tokens[kind],
          {
            id: `${kind}-${Date.now()}`,
            name: `${kind}.custom.${theme.tokens[kind].length + 1}`,
            value: kind === "color" ? "#4f46e5" : kind === "shadow" ? "0 8px 24px rgb(0 0 0 / 0.12)" : "8px",
            description: "自定义令牌",
          },
        ],
      },
    }));
  };

  const removeToken = (kind: TokenKind, id: string): void => {
    updateTheme(activeThemeId(), (theme) => ({
      ...theme,
      tokens: { ...theme.tokens, [kind]: theme.tokens[kind].filter((token) => token.id !== id) },
    }));
  };

  const createTheme = (name: string, sourceId = activeThemeId()): string => {
    const source = themes().find((theme) => theme.id === sourceId) ?? themes()[0];
    const id = `theme-${Date.now()}`;
    setThemes((current) => [...current, { ...structuredClone(source), id, name }]);
    setActiveThemeId(id);
    return id;
  };

  const saveSnapshot = (label: string): void => {
    const snapshot: Snapshot = {
      id: `snapshot-${Date.now()}`,
      label: label.trim() || `快照 ${snapshots().length + 1}`,
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
      theme: structuredClone(activeTheme()),
    };
    setSnapshots((current) => [snapshot, ...current].slice(0, 20));
  };

  const replaceTheme = (theme: Theme): void => {
    setThemes((current) => [...current, theme]);
    setActiveThemeId(theme.id);
  };

  return {
    themes,
    activeTheme,
    activeThemeId,
    setActiveThemeId,
    snapshots,
    updateToken,
    addToken,
    removeToken,
    createTheme,
    saveSnapshot,
    replaceTheme,
    reset: () => {
      const fresh = seedThemes();
      setThemes(fresh);
      setActiveThemeId(fresh[0].id);
      setSnapshots([]);
    },
  };
}
