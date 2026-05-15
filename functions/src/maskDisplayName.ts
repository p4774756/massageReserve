/**
 * 公開名單用：多保留幾個字，其餘以最多 2 個「x」收尾。
 * 例：John → Joxx、Rex → Rxx、testname → tesxx、「王」→ 王xx、「王明」→ 王明x。
 */
export function maskDisplayNameForPublic(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "";
  const chars = Array.from(s);
  const n = chars.length;
  if (n === 0) return "";
  if (n === 1) return `${chars[0]}xx`;
  if (n === 2) return `${chars[0]}${chars[1]}x`;
  if (n === 3) return `${chars[0]}${chars[1]}x`;
  const visible = Math.min(3, n - 2);
  return chars.slice(0, visible).join("") + "xx";
}
