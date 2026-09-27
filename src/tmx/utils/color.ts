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
