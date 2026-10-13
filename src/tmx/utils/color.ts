/** Shade a #rrggbb hex color by a signed fraction (negative darkens, positive lightens). */
export function shadeHex(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const factor = 1 + amount;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 0xff) * factor);
  const g = clamp(((n >> 8) & 0xff) * factor);
  const b = clamp((n & 0xff) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Composite a CSS color string (rgb/rgba, e.g. a theme's accentSoft glow) over
 * a #rrggbb base and return the flattened hex. `strength` scales the overlay's
 * own alpha, so a faded glow corner can be reproduced without a gradient.
 * Unparseable overlays return the base unchanged.
 */
export function flattenOverlay(base: string, overlay: string, strength = 1): string {
  const baseM = /^#([0-9a-f]{6})$/i.exec(base.trim());
  const overM = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(overlay.trim());
  if (!baseM || !overM) return base;
  const bn = parseInt(baseM[1], 16);
  const baseRgb = [(bn >> 16) & 0xff, (bn >> 8) & 0xff, bn & 0xff];
  const overRgb = [Number(overM[1]), Number(overM[2]), Number(overM[3])];
  const a = Math.max(0, Math.min(1, (overM[4] === undefined ? 1 : Number(overM[4])) * strength));
  const mix = (i: number) =>
    Math.max(0, Math.min(255, Math.round(baseRgb[i] * (1 - a) + overRgb[i] * a)));
  const r = mix(0);
  const g = mix(1);
  const b = mix(2);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
