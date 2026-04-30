/**
 * 輪盤扇區色票：與全站玫瑰粉／香檳金調和，供 SVG、WebGL、CSS conic-gradient 同步使用。
 * 變更時請一併更新 `style.css` 內 `.wheel-spectacle-wheel-disk` 的 conic-gradient。
 */
export const WHEEL_SLICE_FILLS = [
  "#c4356a",
  "#dd4d7f",
  "#e8785c",
  "#e8b84a",
  "#c9a227",
  "#6aab7a",
  "#4a9eaa",
  "#5a7fd4",
  "#7a6ad0",
  "#a868c4",
  "#e090b0",
  "#8eb0e8",
] as const;

/** 依底色亮度選擇標籤填色，維持可讀性 */
export function wheelSliceLabelInk(sliceFill: string): string {
  const raw = sliceFill.trim().replace("#", "");
  if (raw.length !== 6 || !/^[0-9a-fA-F]+$/.test(raw)) return "#1f0f24";
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return l < 0.42 ? "#fffdf8" : "#1a0f22";
}
