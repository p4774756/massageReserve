import { t } from "./i18n";

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const fe = e as { code?: unknown; message?: unknown; details?: unknown };
    const code = typeof fe.code === "string" ? fe.code : "";
    const msg = typeof fe.message === "string" ? fe.message.trim() : "";
    if (code === "functions/internal" && (!msg || msg === "INTERNAL")) {
      return t(
        "errors.functionsInternal",
        "伺服器內部錯誤（常見原因：Cloud Function 異常或 Firestore 索引建立中）。請稍後再試。",
      );
    }
    if (msg.length > 0 && msg !== "INTERNAL") return msg;
    const details = typeof fe.details === "string" ? fe.details.trim() : "";
    if (details.length > 0) return details;
  }
  return t("errors.generic", "發生錯誤");
}
