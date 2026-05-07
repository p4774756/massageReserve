/**
 * 小瑪莉外圈停格：非均等機率（權重與該格倍率成反比），高倍率較罕見。
 * 八條線均押相同金額時，長期期望值低於總押（莊家優勢）；押注分配仍會改變實際感受。
 */

export function lmCellWeightsFromSymbols(
  loop24: readonly string[],
  multBySym: Readonly<Record<string, number>>,
): number[] {
  return loop24.map((sym) => {
    const m = multBySym[sym];
    const mult = typeof m === "number" && Number.isFinite(m) && m > 0 ? m : 1;
    return Math.max(1, Math.round(1000 / mult));
  });
}

export function lmPickStopIndexFromWeights(
  weights: readonly number[],
  randomUnder: (maxExclusive: number) => number,
): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || weights.length === 0) return 0;
  let r = randomUnder(total);
  if (r < 0) r = 0;
  if (r >= total) r = total - 1;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}
