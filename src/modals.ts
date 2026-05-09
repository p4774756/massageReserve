import { el } from "./domUtil";
import { t } from "./i18n";

export function showConfirmModal(
  title: string,
  message: string,
  confirmText = t("modal.confirmDefault", "確定"),
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "confirm-modal-title");
    const heading = el("h3", { id: "confirm-modal-title" }, [title]);
    const body = el("pre", { class: "modal-message" }, [message]);
    const cancelBtn = el("button", { class: "ghost", type: "button" }, [t("modal.cancel", "取消")]);
    const confirmBtn = el("button", { class: "primary", type: "button" }, [confirmText]);
    const actions = el("div", { class: "modal-actions" }, [cancelBtn, confirmBtn]);
    dialog.append(heading, body, actions);
    overlay.append(dialog);

    const close = (ok: boolean) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(ok);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close(false);
      }
    };

    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        close(false);
      }
    });
    document.addEventListener("keydown", onKeyDown);

    document.body.append(overlay);
    confirmBtn.focus();
  });
}

/** 單鍵提醒（無取消鈕）；Esc／點遮罩／按鈕皆可關閉 */
export function showAlertModal(title: string, message: string, okText = t("modal.ok", "我知道了")): Promise<void> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "alert-modal-title");
    const heading = el("h3", { id: "alert-modal-title" }, [title]);
    const body = el("pre", { class: "modal-message" }, [message]);
    const okBtn = el("button", { class: "primary", type: "button" }, [okText]);
    const actions = el("div", { class: "modal-actions" }, [okBtn]);
    dialog.append(heading, body, actions);
    overlay.append(dialog);

    const close = () => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve();
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close();
      }
    };

    okBtn.addEventListener("click", () => close());
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        close();
      }
    });
    document.addEventListener("keydown", onKeyDown);

    document.body.append(overlay);
    okBtn.focus();
  });
}

/** 後台表單：可填說明（可留空）；null 表示關閉視窗未確認 */
export function showAdminOptionalReasonModal(args: {
  title: string;
  summaryLines: string;
  reasonLabel: string;
  placeholder: string;
  confirmText: string;
  maxLength?: number;
  textareaRows?: number;
}): Promise<string | null> {
  const { title, summaryLines, reasonLabel, placeholder, confirmText } = args;
  const maxLength = args.maxLength ?? 500;
  const textareaRows = args.textareaRows ?? 4;
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "admin-reason-modal-title");
    const heading = el("h3", { id: "admin-reason-modal-title" }, [title]);
    const body = el("pre", { class: "modal-message" }, [summaryLines]);
    const reasonInput = el("textarea", {
      maxLength,
      rows: textareaRows,
      placeholder,
    });
    reasonInput.setAttribute("aria-label", reasonLabel);
    const reasonField = el("label", { class: "field modal-cancel-reason-field" }, [reasonLabel, reasonInput]);
    const dismissBtn = el("button", { class: "ghost", type: "button" }, [t("modal.close", "關閉")]);
    const confirmBtn = el("button", { class: "primary", type: "button" }, [confirmText]);
    const actions = el("div", { class: "modal-actions" }, [dismissBtn, confirmBtn]);
    dialog.append(heading, body, reasonField, actions);
    overlay.append(dialog);
    dialog.addEventListener("click", (ev) => {
      ev.stopPropagation();
    });

    const finish = (reason: string | null) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(reason);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(null);
      }
    };

    dismissBtn.addEventListener("click", () => finish(null));
    confirmBtn.addEventListener("click", () => finish(reasonInput.value.trim()));
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        finish(null);
      }
    });
    document.addEventListener("keydown", onKeyDown);

    document.body.append(overlay);
    reasonInput.focus();
  });
}
