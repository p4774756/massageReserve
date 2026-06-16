import { addDaysTaipeiDateKey, taipeiTodayDateKey } from "./taipeiDates";

export type TsmcDailyBar = { dateKey: string; close: number };

export type TsmcQuoteCloses = {
  anchorCloseNtd: number;
  lastQuoteCloseNtd: number;
  quoteDateKey: string;
};

type YahooChartResult = {
  timestamp?: number[];
  indicators?: { quote?: Array<{ close?: Array<number | null> }> };
};

/** 解析 Yahoo 日 K 收盤價（依台北日期去重，保留同日最後一筆） */
export function parseYahooDailyBars(result: YahooChartResult): TsmcDailyBar[] {
  const stamps = result.timestamp ?? [];
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const byDate = new Map<string, number>();
  for (let i = 0; i < stamps.length; i++) {
    const ts = stamps[i];
    const close = closes[i];
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    if (typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    const dateKey = new Date(ts * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
    if (!dateKey) continue;
    byDate.set(dateKey, close);
  }
  return [...byDate.entries()]
    .map(([dateKey, close]) => ({ dateKey, close }))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

export function resolveTsmcQuoteClosesFromBars(
  bars: TsmcDailyBar[],
  anchorDateKey: string,
): TsmcQuoteCloses | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDateKey) || bars.length === 0) return null;
  const anchorIdx = bars.findIndex((b) => b.dateKey >= anchorDateKey);
  if (anchorIdx < 0) return null;
  const anchorBar = bars[anchorIdx]!;
  const lastBar = bars[bars.length - 1]!;
  return {
    anchorCloseNtd: anchorBar.close,
    lastQuoteCloseNtd: lastBar.close,
    quoteDateKey: lastBar.dateKey,
  };
}

function chartPeriodSeconds(anchorDateKey: string): { period1: number; period2: number } {
  const period1 = Math.floor(new Date(`${anchorDateKey}T00:00:00+08:00`).getTime() / 1000);
  const endKey = addDaysTaipeiDateKey(taipeiTodayDateKey(), 1);
  const period2 = Math.floor(new Date(`${endKey}T00:00:00+08:00`).getTime() / 1000);
  return { period1, period2 };
}

/** 經 Hosting／Vite 代理讀取 2330 日 K 收盤價（僅後台顯示用） */
export async function fetchTsmcQuoteClosesSince(anchorDateKey: string): Promise<TsmcQuoteCloses | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDateKey)) return null;
  const { period1, period2 } = chartPeriodSeconds(anchorDateKey);
  const url = `/api/yahoo-chart/2330.TW?interval=1d&period1=${period1}&period2=${period2}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const body = (await res.json()) as { chart?: { result?: YahooChartResult[] } };
  const result = body.chart?.result?.[0];
  if (!result || typeof result !== "object") return null;
  const bars = parseYahooDailyBars(result);
  return resolveTsmcQuoteClosesFromBars(bars, anchorDateKey);
}
