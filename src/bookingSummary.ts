import { el } from "./domUtil";
import { BOOKING_UNIT_MINUTES_FIXED } from "./sitePricingResolve";
import { t } from "./i18n";
import type { Booking, BookingMode } from "./bookingTypes";
import { bookingModeLabel } from "./bookingDisplay";
import { endSlotFromStartAndDuration } from "./slots";

export function buildBookingSummary(
  displayName: string,
  dateKey: string,
  startSlot: string,
  note: string,
  bookingMode: BookingMode,
  holidayOutcall: boolean,
  opts?: {
    units?: number;
    unitMinutes?: number;
    unitPriceNtd?: number;
    capOverflowSurchargeNtd?: number;
  },
): string {
  const noteSummary = note || t("booking.summary.noteEmpty", "（未填寫）");
  const units = opts?.units ?? 1;
  const unitMinutes = opts?.unitMinutes ?? BOOKING_UNIT_MINUTES_FIXED;
  const durationMinutes = units * unitMinutes;
  const endSlot = endSlotFromStartAndDuration(startSlot, durationMinutes);
  const unitPrice = opts?.unitPriceNtd ?? 0;
  const massageTotal = unitPrice > 0 ? unitPrice * units : 0;
  const surcharge =
    typeof opts?.capOverflowSurchargeNtd === "number" && opts.capOverflowSurchargeNtd > 0
      ? opts.capOverflowSurchargeNtd
      : 0;
  const totalPrice = massageTotal + (bookingMode === "member_cap_overflow" ? surcharge : 0);
  const lines = [
    t("booking.summary.intro", "請確認以下預約資訊："),
    `${t("booking.summary.name", "姓名")}：${displayName}`,
    `${t("booking.summary.date", "日期")}：${dateKey}`,
    `${t("booking.summary.start", "開始時間")}：${startSlot}`,
    t("booking.summary.durationLine", "時長：約 {{minutes}} 分鐘（{{start}}–{{end}}）", {
      minutes: durationMinutes,
      start: startSlot,
      end: endSlot,
    }),
    ...(massageTotal > 0 &&
    (bookingMode === "member_cash" || bookingMode === "member_qr" || bookingMode === "member_cap_overflow")
      ? [
          t("booking.summary.cashTotal", "現金參考：{{total}} 元", {
            total: bookingMode === "member_cap_overflow" ? massageTotal : totalPrice,
          }),
        ]
      : []),
    ...(bookingMode === "member_cap_overflow" && surcharge > 0
      ? [
          t("booking.summary.capOverflowSurcharge", "名額加價：{{surcharge}} 元／張（當日或本週預約張數已滿）", {
            surcharge,
          }),
          t("booking.summary.capOverflowPayTotal", "現場合計：{{total}} 元", { total: totalPrice }),
        ]
      : []),
    `${t("booking.summary.mode", "付款方式")}：${bookingModeLabel(bookingMode, {
      units,
      unitPriceNtd: unitPrice,
      capOverflowSurchargeNtd: surcharge > 0 ? surcharge : undefined,
    })}`,
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
