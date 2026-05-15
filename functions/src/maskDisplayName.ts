/**
 * 公開名單用：保留首個 Unicode 字元，其餘以「x」取代；單字名再補兩個 x 以避免過度可辨識。
 * 例：John → Jxxx、Rex → Rxx、「王」→ 王xx。
 */
export function maskDisplayNameForPublic(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  const chars = Array.from(s);
  if (chars.length === 0) return "";
  const first = chars[0]!;
  if (chars.length === 1) return `${first}xx`;
  return first + "x".repeat(chars.length - 1);
}
