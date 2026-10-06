const HEX_PATTERN = /^#?([a-f\d]{3}|[a-f\d]{6})$/i;

export function normalizeHex(value: string): string {
  const match = value.trim().match(HEX_PATTERN);
  if (!match) return "#000000";
  const raw = match[1];
  const full = raw.length === 3 ? raw.split("").map((part) => part + part).join("") : raw;
  return `#${full.toLowerCase()}`;
}

function channelToLinear(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const normalized = normalizeHex(hex).slice(1);
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

export function contrastGrade(ratio: number): "AAA" | "AA" | "AA Large" | "不通过" {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "AA Large";
  return "不通过";
}

export function alpha(hex: string, opacity: number): string {
  const normalized = normalizeHex(hex).slice(1);
  const value = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${normalized}${value}`;
}
