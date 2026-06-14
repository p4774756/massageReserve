import { el } from "./domUtil";
import { t } from "./i18n";
import type { Booking } from "./bookingTypes";
import { bookingModeLabelSafe, bookingStatusLabel } from "./bookingDisplay";
import { showAdminOptionalReasonModal } from "./modals";

export type AdminSettleBookingSessionsResult = {
  sessions: number;
  note: string;
  /** 已透過後台調整扣過次數，僅更新預約與統計標記 */
  alreadyDeducted?: boolean;
};

export function showAdminSettleBookingSessionsModal(b: Booking): Promise<AdminSettleBookingSessionsResult | null> {
  const defaultSessions = typeof b.units === "number" && b.units > 0 ? Math.floor(b.units) : 1;
  const modeLabel = bookingModeLabelSafe(b.bookingMode);
  const price = typeof b.price === "number" && b.price > 0 ? b.price : undefined;
  const summary = [
    t("admin.settleBooking.intro", "將此筆現金預約改為扣次結帳；會員帳戶將扣除指定次數，統計不再計入現金。"),
    "",
    `${t("booking.summary.name", "姓名")}：${b.displayName ?? ""}`,
    `${t("booking.summary.date", "日期")}：${b.dateKey ?? ""}`,
    `${t("booking.summary.start", "開始時間")}：${b.startSlot ?? ""}`,
    `${t("booking.summary.mode", "付款方式")}：${modeLabel}`,
    ...(price != null
      ? [`${t("admin.settleBooking.originalCash", "原應收")}：${price} ${t("admin.table.priceUnit", "元")}`]
      : []),
    `${t("admin.table.status", "狀態")}：${bookingStatusLabel(b.status)}`,
  ].join("\n");

  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "admin-settle-modal-title");
    const heading = el("h3", { id: "admin-settle-modal-title" }, [
      t("admin.settleBooking.title", "改扣次結帳"),
    ]);
    const body = el("pre", { class: "modal-message" }, [summary]);
    const sessionsInput = el("input", {
      type: "number",
      min: "1",
      max: "50",
      step: "1",
      value: String(defaultSessions),
    });
    sessionsInput.setAttribute("aria-label", t("admin.settleBooking.sessionsLabel", "扣次數"));
    const sessionsField = el("label", { class: "field" }, [
      t("admin.settleBooking.sessionsLabel", "扣次數"),
      sessionsInput,
    ]);
    const noteInput = el("textarea", {
      maxLength: 500,
      rows: 3,
      placeholder: t("admin.settleBooking.notePlaceholder", "例：現場同意改扣 2 次，未收現金"),
    });
    noteInput.setAttribute("aria-label", t("admin.settleBooking.noteLabel", "備註（必填）"));
    const noteField = el("label", { class: "field modal-cancel-reason-field" }, [
      t("admin.settleBooking.noteLabel", "備註（必填）"),
      noteInput,
    ]);
    const alreadyDeductedInput = el("input", { type: "checkbox" });
    const alreadyDeductedField = el("label", { class: "field checkbox-field" }, [
      alreadyDeductedInput,
      t("admin.settleBooking.alreadyDeducted", "已手動扣過次數，僅更新預約紀錄（不再扣帳）"),
    ]);
    const dismissBtn = el("button", { class: "ghost", type: "button" }, [t("modal.close", "關閉")]);
    const confirmBtn = el("button", { class: "primary", type: "button" }, [
      t("admin.settleBooking.confirm", "確認扣次"),
    ]);
    const actions = el("div", { class: "modal-actions" }, [dismissBtn, confirmBtn]);
    dialog.append(heading, body, sessionsField, noteField, alreadyDeductedField, actions);
    overlay.append(dialog);

    const close = (result: AdminSettleBookingSessionsResult | null) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(result);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close(null);
      }
    };

    dismissBtn.addEventListener("click", () => close(null));
    confirmBtn.addEventListener("click", () => {
      const sessions = Math.floor(Number(sessionsInput.value));
      const note = noteInput.value.trim();
      if (!Number.isFinite(sessions) || sessions < 1 || sessions > 50) {
        sessionsInput.focus();
        return;
      }
      if (note.length < 3) {
        noteInput.focus();
        return;
      }
      close({ sessions, note, alreadyDeducted: alreadyDeductedInput.checked });
    });
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) close(null);
    });
    document.addEventListener("keydown", onKeyDown);
    document.body.append(overlay);
    noteInput.focus();
  });
}

export function showAdminCancelBookingModal(summaryLines: string): Promise<string | null> {
  return showAdminOptionalReasonModal({
    title: t("admin.cancelBooking.title", "取消預約"),
    summaryLines,
    reasonLabel: t("admin.cancelBooking.reasonLabel", "取消原因"),
    placeholder: t("admin.cancelBooking.reasonPlaceholder", "取消原因（選填，可不填）"),
    confirmText: t("admin.cancelBooking.confirm", "確認取消"),
  });
}

/** 與後端寄信條件一致：會員預約（非訪客 mode、有 customerId） */
export function memberBookingGetsStatusEmail(b: Pick<Booking, "bookingMode" | "customerId">): boolean {
  const mode = b.bookingMode;
  if (mode === "guest_cash" || mode === "guest_beverage" || mode === "guest_meal") return false;
  const cid = typeof b.customerId === "string" ? b.customerId.trim() : "";
  return cid.length > 0;
}

export function showAdminBookingStatusEmailNoteModal(args: {
  summaryLines: string;
  prevStatusKey: string;
  nextStatusKey: string;
}): Promise<string | null> {
  const prevLabel = bookingStatusLabel(args.prevStatusKey);
  const nextLabel = bookingStatusLabel(args.nextStatusKey);
  const intro = t(
    "admin.statusEmail.intro",
    "將寄發通知信給會員。以下為預約摘要；可選填要一併寫入信件的留言。",
  );
  const statusLine = t("admin.statusEmail.statusLine", "狀態：{{prev}} → {{next}}", {
    prev: prevLabel,
    next: nextLabel,
  });
  const fullSummary = [intro, "", args.summaryLines, "", statusLine].join("\n");
  return showAdminOptionalReasonModal({
    title: t("admin.statusEmail.title", "更新預約狀態並通知會員"),
    summaryLines: fullSummary,
    reasonLabel: t("admin.statusEmail.noteLabel", "信件附言（選填）"),
    placeholder: t("admin.statusEmail.notePlaceholder", "會一併顯示在通知信中給會員（可不填）"),
    confirmText: t("admin.statusEmail.confirm", "確認更新"),
    maxLength: 2000,
    textareaRows: 5,
  });
}
