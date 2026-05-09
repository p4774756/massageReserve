import { t } from "./i18n";
import type { Booking } from "./bookingTypes";
import { bookingStatusLabel } from "./bookingDisplay";
import { showAdminOptionalReasonModal } from "./modals";

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
  if (mode === "guest_cash" || mode === "guest_beverage") return false;
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
