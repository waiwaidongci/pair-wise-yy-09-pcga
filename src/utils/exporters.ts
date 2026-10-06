import type { DesignToken, Theme, TokenDifference, TokenKind } from "../types/tokens";

export const TOKEN_LABELS: Record<TokenKind, string> = {
  color: "颜色",
  fontSize: "字号",
  spacing: "间距",
  radius: "圆角",
  shadow: "阴影",
  motion: "动效时长",
};

export function flattenTheme(theme: Theme): Record<string, string> {
  const result: Record<string, string> = {};
  (Object.keys(theme.tokens) as TokenKind[]).forEach((kind) => {
    theme.tokens[kind].forEach((token) => {
      result[token.name] = token.value;
    });
  });
  return result;
}

export function toCssVariables(theme: Theme): string {
  const lines = Object.entries(flattenTheme(theme)).map(([name, value]) => {
    const variable = name.replace(/\./g, "-").replace(/[^a-zA-Z0-9-_]/g, "-");
    return `  --${variable}: ${value};`;
  });
  return `:root {\n${lines.join("\n")}\n}\n`;
}

export function toSassVariables(theme: Theme): string {
  const lines = Object.entries(flattenTheme(theme)).map(([name, value]) => {
    const variable = name.replace(/\./g, "-").replace(/[^a-zA-Z0-9-_]/g, "-");
    return `$${variable}: ${value};`;
  });
  return `${lines.join("\n")}\n`;
}

export function toStyleDictionaryJson(theme: Theme): string {
  const tree: Record<string, unknown> = {};
  (Object.keys(theme.tokens) as TokenKind[]).forEach((kind) => {
    theme.tokens[kind].forEach((token) => {
      const path = token.name.split(".");
      let branch = tree;
      path.forEach((segment, index) => {
        if (index === path.length - 1) {
          branch[segment] = {
            value: token.value,
            type: kind === "motion" ? "time" : kind === "fontSize" ? "dimension" : kind,
            comment: token.description,
          };
          return;
        }
        branch[segment] = branch[segment] ?? {};
        branch = branch[segment] as Record<string, unknown>;
      });
    });
  });
  return `${JSON.stringify(tree, null, 2)}\n`;
}

export function downloadText(filename: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function parseImportedTheme(raw: string, fallback: Theme): Theme {
  const parsed = JSON.parse(raw) as Partial<Theme> | Record<string, string>;
  if ("tokens" in parsed && parsed.tokens) {
    return {
      id: `imported-${Date.now()}`,
      name: parsed.name ?? "导入主题",
      tokens: parsed.tokens as Theme["tokens"],
    };
  }

  const imported = parsed as Record<string, string>;
  const next: Theme = structuredClone(fallback);
  next.id = `imported-${Date.now()}`;
  next.name = "导入的令牌集";
  (Object.keys(next.tokens) as TokenKind[]).forEach((kind) => {
    next.tokens[kind] = next.tokens[kind].map((token) => ({
      ...token,
      value: token.name in imported ? imported[token.name] : token.value,
    }));
  });
  return next;
}

export function diffThemes(before: Theme, after: Theme): TokenDifference[] {
  const left = flattenTheme(before);
  const right = flattenTheme(after);
  const names = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();
  return names.reduce<TokenDifference[]>((differences, path) => {
    if (!(path in left)) {
      differences.push({ path, before: "未定义", after: right[path], kind: "added" });
      return differences;
    }
    if (!(path in right)) {
      differences.push({ path, before: left[path], after: "已移除", kind: "removed" });
      return differences;
    }
    if (left[path] !== right[path]) {
      differences.push({ path, before: left[path], after: right[path], kind: "changed" });
    }
    return differences;
  }, []);
}

export function tokenToCss(token: DesignToken): string {
  if (token.name.includes("font")) return `font-size:${token.value}`;
  if (token.name.includes("radius")) return `border-radius:${token.value}`;
  if (token.name.includes("shadow")) return `box-shadow:${token.value}`;
  return token.value;
}
