/**
 * 輪盤扇區色票：卡通糖果色（飽和、對比高）；供 SVG、WebGL、CSS conic-gradient 同步。
 * 變更時請一併更新 `style.css` 內 `.wheel-spectacle-wheel-disk` 的 conic-gradient（前 11 色與此陣列一致）。
 */
export const WHEEL_SLICE_FILLS = [
  "#ff4d8d",
  "#ff9f1a",
  "#ffee58",
  "#7bed9f",
  "#54d6e8",
  "#7c7cff",
  "#c56cf0",
  "#ff6b9d",
  "#48dbfb",
  "#ffa502",
  "#a55eea",
  "#26de81",
] as const;

/** 依底色亮度選擇標籤填色，維持可讀性 */
export function wheelSliceLabelInk(sliceFill: string): string {
  const raw = sliceFill.trim().replace("#", "");
  if (raw.length !== 6 || !/^[0-9a-fA-F]+$/.test(raw)) return "#1f0f24";
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  /* 深色扇區用亮字；淺色扇區用深字（描邊於 WebGL canvas 再反差） */
  return l < 0.45 ? "#fffdf8" : "#1a0f22";
}
