import { EN } from "./catalog-en";

export type AppLocale = "zh-Hant" | "en";

const STORAGE_KEY = "massageReserve.locale";

function readLocale(): AppLocale {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(STORAGE_KEY) === "en") {
      return "en";
    }
  } catch {
    /* ignore */
  }
  return "zh-Hant";
}

let locale: AppLocale = readLocale();

export function getLocale(): AppLocale {
  return locale;
}

/** Merge into callable payloads so Cloud Functions can localize errors and emails. */
export function localeApiParam(): { locale: AppLocale } {
  return { locale };
}

export function initI18n(): void {
  locale = readLocale();
  document.documentElement.lang = locale === "en" ? "en" : "zh-Hant";
  document.title = t("meta.docTitle", "辦公室按摩預約");
}

export function setLocale(next: AppLocale): void {
  if (next !== "en" && next !== "zh-Hant") return;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  if (next === locale) return;
  locale = next;
  window.location.reload();
}

function applyVars(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = vars[name];
    return v !== undefined && v !== null ? String(v) : "";
  });
}

/**
 * @param key Stable id; English comes from `catalog-en.ts`, zh is the Traditional Chinese fallback shown when locale is zh-Hant or a key is missing in EN.
 */
export function t(key: string, zh: string, vars?: Record<string, string | number>): string {
  const raw = locale === "en" ? (EN[key] ?? zh) : zh;
  return applyVars(raw, vars);
}

/** Number / date formatting helpers */
export function intlLocaleTag(): string {
  return locale === "en" ? "en-US" : "zh-TW";
}
