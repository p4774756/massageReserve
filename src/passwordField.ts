import { el } from "./domUtil";
import { t } from "./i18n";

/** 密碼輸入框右側「顯示／隱藏」切換（不改變 input 的 value） */
export function wrapPasswordField(input: HTMLInputElement): HTMLElement {
  const row = el("div", { class: "field-password-row" });
  const btn = el("button", { type: "button", class: "ghost password-reveal-btn" }, [t("pwd.show", "顯示")]);
  btn.setAttribute("aria-label", t("pwd.ariaShow", "顯示密碼"));
  btn.setAttribute("aria-pressed", "false");
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? t("pwd.hide", "隱藏") : t("pwd.show", "顯示");
    btn.setAttribute("aria-label", show ? t("pwd.ariaHide", "隱藏密碼") : t("pwd.ariaShow", "顯示密碼"));
    btn.setAttribute("aria-pressed", String(show));
  });
  row.append(input, btn);
  return row;
}
