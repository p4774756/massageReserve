import type { LittleMarySfxRemoteMap } from "./bookTabLittleMaryAudio";

function envStr(key: string): string | undefined {
  const v = (import.meta.env as Record<string, string | undefined>)[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/**
 * 小瑪莉 HTTP 音效 URL（`fetch` + Web Audio 解碼；需 CORS 或同源）。
 * - 預設不載入任何檔案，跑燈／開轉等皆為程式鋼琴合成。
 * - 若需覆寫，請在 `.env` 設定對應 `VITE_LM_SFX_*`（例如自管 CDN 的真鋼琴取樣）。
 */
export function resolveLittleMaryRemoteSfxUrls(): LittleMarySfxRemoteMap {
  const out: LittleMarySfxRemoteMap = {};
  const spinTick = envStr("VITE_LM_SFX_SPIN_TICK_URL");
  if (spinTick) out.spinTick = spinTick;
  const spinStart = envStr("VITE_LM_SFX_SPIN_START_URL");
  if (spinStart) out.spinStart = spinStart;
  const bet = envStr("VITE_LM_SFX_BET_URL");
  const noCredit = envStr("VITE_LM_SFX_NO_CREDIT_URL");
  const clear = envStr("VITE_LM_SFX_CLEAR_URL");
  const collect = envStr("VITE_LM_SFX_COLLECT_URL");
  const win = envStr("VITE_LM_SFX_WIN_URL");
  const onceMore = envStr("VITE_LM_SFX_ONCE_MORE_URL");
  const miss = envStr("VITE_LM_SFX_MISS_URL");
  const error = envStr("VITE_LM_SFX_ERROR_URL");
  if (bet) out.bet = bet;
  if (noCredit) out.noCredit = noCredit;
  if (clear) out.clear = clear;
  if (collect) out.collect = collect;
  if (win) out.win = win;
  if (onceMore) out.onceMore = onceMore;
  if (miss) out.miss = miss;
  if (error) out.error = error;
  return out;
}
