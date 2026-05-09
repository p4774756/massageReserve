import type { User } from "firebase/auth";
import { t } from "./i18n";

export function shortUidForDisplay(uid: string, headChars = 8): string {
  if (!uid) return "";
  if (uid.length <= headChars) return uid;
  return `${uid.slice(0, headChars)}…`;
}

export function adminSessionCallName(user: User): string {
  const fromDisplay = user.displayName?.trim();
  if (fromDisplay) return fromDisplay;
  const email = user.email?.trim();
  if (email) {
    const at = email.indexOf("@");
    const local = at > 0 ? email.slice(0, at).trim() : email;
    if (local) return local;
  }
  return t("adminSession.fallbackName", "管理員");
}
