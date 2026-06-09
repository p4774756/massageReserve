import { t } from "./i18n";

export function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const fe = e as { code?: unknown; message?: unknown; details?: unknown };
    const code = typeof fe.code === "string" ? fe.code : "";
    const msg = typeof fe.message === "string" ? fe.message.trim() : "";
    const msgLower = msg.toLowerCase();
    if (code === "functions/not-found") {
      return t(
        "errors.functionNotFound",
        "伺服器功能尚未更新（Cloud Function 可能尚未部署）。請稍後再試或聯絡管理員。",
      );
    }
    if (code === "functions/internal" && (!msg || msgLower === "internal")) {
      return t(
        "errors.functionsInternal",
        "伺服器內部錯誤（常見原因：Cloud Function 異常或 Firestore 索引建立中）。請稍後再試。",
      );
    }
    if (msg.length > 0 && msgLower !== "internal") return msg;
    const details = typeof fe.details === "string" ? fe.details.trim() : "";
    if (details.length > 0) return details;
  }
  return t("errors.generic", "發生錯誤");
}
