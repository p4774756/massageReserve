import { el } from "./domUtil";
import { t } from "./i18n";
import type { Booking, BookingMode } from "./bookingTypes";
import { bookingModeLabel } from "./bookingDisplay";

export function buildBookingSummary(
  displayName: string,
  dateKey: string,
  startSlot: string,
  note: string,
  bookingMode: BookingMode,
  holidayOutcall: boolean,
): string {
  const noteSummary = note || t("booking.summary.noteEmpty", "（未填寫）");
  const lines = [
    t("booking.summary.intro", "請確認以下預約資訊："),
    `${t("booking.summary.name", "姓名")}：${displayName}`,
    `${t("booking.summary.date", "日期")}：${dateKey}`,
    `${t("booking.summary.start", "開始時間")}：${startSlot}`,
    `${t("booking.summary.mode", "付款方式")}：${bookingModeLabel(bookingMode)}`,
    `${t("booking.summary.note", "備註")}：${noteSummary}`,
  ];
  if (holidayOutcall) {
    lines.push(
      "",
      t(
        "booking.summary.holidayOutcallTransport",
        "假日外約：按摩單價與平日相同；前往外約地點之交通費由您（客戶）負擔，請於現場與師傅確認。",
      ),
    );
  }
  lines.push("", t("booking.summary.footer", "確認無誤後按「確定」送出。"));
  return lines.join("\n");
}

/** 會員「我的預約」：後台取消有填原因時顯示 */
export function myBookingReasonBlock(b: Booking): HTMLElement | null {
  if (b.status !== "cancelled") return null;
  const cr = typeof b.cancelReason === "string" ? b.cancelReason.trim() : "";
  if (!cr) return null;
  return el("div", { class: "my-booking-reason" }, [
    el("span", { class: "my-booking-reason-label" }, [t("myBooking.cancelReasonLabel", "取消說明：")]),
    el("span", { class: "my-booking-reason-body" }, [cr]),
  ]);
}
