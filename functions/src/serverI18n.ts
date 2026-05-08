export type ServerLocale = "zh-Hant";

export function parseLocale(_data?: unknown): ServerLocale {
  return "zh-Hant";
}

function applyVars(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = vars[name];
    return v !== undefined && v !== null ? String(v) : "";
  });
}

export function st(
  _locale: ServerLocale,
  _key: string,
  zh: string,
  vars?: Record<string, string | number>,
): string {
  void _locale;
  void _key;
  return applyVars(zh, vars);
}
