import type { Auth } from "firebase/auth";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { el } from "./domUtil";
import { t } from "./i18n";
import { wrapPasswordField } from "./passwordField";

export type AdminLoginShell = {
  adminWrap: HTMLElement;
  auth: Auth;
  stopAdminListener: () => void;
  syncAdminHeadSignedInHint: (userId?: string) => void;
};

export function renderAdminLoggedOut(shell: AdminLoginShell): void {
  const { adminWrap, auth, stopAdminListener, syncAdminHeadSignedInHint } = shell;
  stopAdminListener();
  adminWrap.innerHTML = "";
  adminWrap.className = "";
  const box = el("div", { class: "admin-login" }, []);
  const email = el("input", { type: "email", autocomplete: "username" });
  const password = el("input", { type: "password", autocomplete: "current-password" });
  const loginBtn = el("button", { class: "primary", type: "button" }, [t("admin.login", "登入")]);
  const resetBtn = el("button", { class: "ghost", type: "button" }, [t("admin.resetSend", "寄送重設密碼信")]);
  const adminStatus = el("div", { class: "status-line" });
  loginBtn.addEventListener("click", async () => {
    adminStatus.textContent = "";
    adminStatus.className = "status-line";
    loginBtn.setAttribute("disabled", "true");
    try {
      await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    } catch (e) {
      adminStatus.textContent = e instanceof Error ? e.message : t("auth.loginFail", "登入失敗");
      adminStatus.classList.add("error");
    } finally {
      loginBtn.removeAttribute("disabled");
    }
  });
  resetBtn.addEventListener("click", async () => {
    adminStatus.textContent = "";
    adminStatus.className = "status-line";
    const em = email.value.trim();
    if (!em) {
      adminStatus.textContent = t("admin.needEmailFirst", "請先輸入 Email。");
      adminStatus.classList.add("error");
      return;
    }
    resetBtn.setAttribute("disabled", "true");
    try {
      await sendPasswordResetEmail(auth, em);
      adminStatus.textContent = t(
        "admin.resetSentLong",
        "若此 Email 已註冊，您將很快收到重設密碼信（請一併查看垃圾郵件）。點信內連結即可設定新密碼。",
      );
      adminStatus.classList.add("ok");
    } catch (e) {
      adminStatus.textContent = e instanceof Error ? e.message : t("auth.resetSendFail", "寄送失敗");
      adminStatus.classList.add("error");
    } finally {
      resetBtn.removeAttribute("disabled");
    }
  });
  box.append(
    el("label", { class: "field" }, ["Email", email]),
    el("label", { class: "field" }, [t("auth.label.password", "密碼"), wrapPasswordField(password)]),
    el("div", { class: "row-actions" }, [loginBtn, resetBtn]),
    adminStatus,
  );
  adminWrap.append(box);
  syncAdminHeadSignedInHint();
}

export function renderAdminForbidden(shell: AdminLoginShell): void {
  const { adminWrap, stopAdminListener, syncAdminHeadSignedInHint } = shell;
  stopAdminListener();
  adminWrap.innerHTML = "";
  adminWrap.className = "";
  adminWrap.append(
    el("div", { class: "admin-login" }, [
      el("p", { class: "status-line error" }, [t("admin.forbidden", "無權限：此帳號不是管理員。")]),
    ]),
  );
  syncAdminHeadSignedInHint();
}
