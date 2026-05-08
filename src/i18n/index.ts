export type AppLocale = "zh-Hant";

const locale: AppLocale = "zh-Hant";

export function getLocale(): AppLocale {
  return locale;
}

/** Merge into callable payloads（後端仍接受 locale 欄位時固定為繁中） */
export function localeApiParam(): { locale: AppLocale } {
  return { locale };
}

export function initI18n(): void {
  document.documentElement.lang = "zh-Hant";
  document.title = t("meta.docTitle", "辦公室按摩預約");
}

function applyVars(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = vars[name];
    return v !== undefined && v !== null ? String(v) : "";
  });
}

export function t(key: string, zh: string, vars?: Record<string, string | number>): string {
  void key;
  return applyVars(zh, vars);
}

/** Number / date formatting helpers */
export function intlLocaleTag(): string {
  return "zh-TW";
}
