import type { Auth } from "firebase/auth";
import { getAdminStatusCall } from "./firebase";
import { localeApiParam } from "./i18n";

export async function canCurrentUserAccessAdmin(auth: Auth): Promise<boolean> {
  const user = auth.currentUser;
  if (!user) return false;
  try {
    const fn = getAdminStatusCall();
    const res = await fn({ ...localeApiParam() });
    const data = res.data as { isAdmin?: boolean };
    return data.isAdmin === true;
  } catch {
    return false;
  }
}
