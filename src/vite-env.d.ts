/// <reference types="vite/client" />

/** 由 `vite.config.ts` 在建置時注入（`npm run dev` 亦會帶入當次啟動日期） */
declare const __APP_VERSION__: string;
declare const __APP_BUILD_DATE__: string;

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  /** 小瑪莉：可選 HTTP 音效 URL（需 CORS）；見 `bookTabLittleMarySfxUrls.ts` */
  readonly VITE_LM_SFX_SPIN_TICK_URL?: string;
  readonly VITE_LM_SFX_SPIN_START_URL?: string;
  readonly VITE_LM_SFX_BET_URL?: string;
  readonly VITE_LM_SFX_NO_CREDIT_URL?: string;
  readonly VITE_LM_SFX_CLEAR_URL?: string;
  readonly VITE_LM_SFX_COLLECT_URL?: string;
  readonly VITE_LM_SFX_WIN_URL?: string;
  readonly VITE_LM_SFX_ONCE_MORE_URL?: string;
  readonly VITE_LM_SFX_MISS_URL?: string;
  readonly VITE_LM_SFX_ERROR_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** 獎勵廣告：若由站方注入，則「看廣告領全部」等流程會改呼叫此函式（回傳是否成功觀看完畢） */
interface Window {
  __MR_rewardedShow?: () => Promise<boolean>;
}
