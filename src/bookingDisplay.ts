import { el } from "./domUtil";
import { intlLocaleTag, t } from "./i18n";
import type { Booking, BookingMode } from "./bookingTypes";
import { slotStartInstantMsTaipei } from "./taipeiDates";

function beverageOptionLabel(): string {
  return t("booking.beverageOption", "請師傅一杯飲料");
}

export function bookingModeLabel(
  mode: BookingMode,
  opts?: { units?: number; unitPriceNtd?: number; capOverflowSurchargeNtd?: number },
): string {
  const units = opts?.units ?? 1;
  const unitPrice = opts?.unitPriceNtd ?? 0;
  const labels: Record<BookingMode, string> = {
    guest_cash: t("booking.mode.guest_cash", "訪客現金"),
    guest_beverage: beverageOptionLabel(),
    member_cash:
      unitPrice > 0
        ? t("booking.mode.member_cashTotal", "會員現金（{{total}} 元）", { total: unitPrice * units })
        : t("booking.mode.member_cash", "會員現金"),
    member_wallet: t("booking.mode.member_walletUnits", "預約次數扣抵（扣 {{units}} 單位）", { units }),
    member_beverage: beverageOptionLabel(),
    member_qr:
      unitPrice > 0
        ? t("booking.mode.member_qrTotal", "掃描 QR Code 付款（{{total}} 元）", { total: unitPrice * units })
        : t("booking.mode.member_qr", "掃描 QR Code 付款"),
    member_cap_overflow:
      unitPrice > 0 && typeof opts?.capOverflowSurchargeNtd === "number"
        ? t("booking.mode.member_cap_overflowTotal", "加價現金（{{total}} 元，含加價 {{surcharge}} 元）", {
            total: unitPrice * units + opts.capOverflowSurchargeNtd,
            surcharge: opts.capOverflowSurchargeNtd,
          })
        : t("booking.mode.member_cap_overflow", "加價現金（名額已滿）"),
  };
  return labels[mode];
}

/** 後台狀態下拉：不含「已取消」（改由「取消」按鈕呼叫 cancelBooking） */
export function getAdminStatusSelectOptions(): { value: string; label: string }[] {
  return [
    { value: "pending", label: t("status.pending", "待確認") },
    { value: "confirmed", label: t("status.confirmed", "已確認") },
    { value: "done", label: t("status.done", "已完成") },
  ];
}

function formatWhenOpts(): Intl.DateTimeFormatOptions {
  return {
    timeZone: "Asia/Taipei",
    weekday: "short",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  };
}

export function formatWhen(b: Booking): string {
  if (b.startAt?.seconds) {
    const d = new Date(b.startAt.seconds * 1000);
    return d.toLocaleString(intlLocaleTag(), formatWhenOpts());
  }
  const ms = slotStartInstantMsTaipei(b.dateKey, b.startSlot);
  if (Number.isFinite(ms)) {
    return new Date(ms).toLocaleString(intlLocaleTag(), formatWhenOpts());
  }
  return `${b.dateKey} ${b.startSlot}`;
}

/** 後台表格「預約時間」欄：必要時附假日外約標籤 */
export function adminWhenCellParts(b: Booking): (string | Node)[] {
  const parts: (string | Node)[] = [formatWhen(b)];
  if (b.holidayOutcall === true) {
    parts.push(
      el("div", { class: "admin-booking-kind-tag" }, [t("booking.kind.holidayOutcallShort", "假日外約")]),
    );
  }
  return parts;
}

export function bookingStartMs(b: Booking): number {
  if (b.startAt?.seconds) return b.startAt.seconds * 1000;
  const t0 = slotStartInstantMsTaipei(b.dateKey, b.startSlot);
  return Number.isFinite(t0) ? t0 : 0;
}

/** 「尚未開始」分頁：待確認／已確認，且預約開始時刻尚未到 */
export function isMyBookingUpcomingTab(b: Booking): boolean {
  if (b.status !== "pending" && b.status !== "confirmed") return false;
  const start = bookingStartMs(b);
  if (!Number.isFinite(start) || start <= 0) return false;
  return start > Date.now();
}

export function bookingStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: t("status.pending", "待確認"),
    confirmed: t("status.confirmed", "已確認"),
    done: t("status.done", "已完成"),
    cancelled: t("status.cancelled", "已取消"),
    deleted: t("status.deleted", "已刪除"),
  };
  return map[status] ?? status;
}

export function bookingStatusNorm(status: unknown): string {
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

/** 後台列表：已完成則不可改狀態（容錯 status 大小寫／空白；若有 completedAt 亦視為已完成） */
export function bookingIsDoneForAdmin(b: Pick<Booking, "status" | "completedAt">): boolean {
  if (bookingStatusNorm(b.status) === "done") return true;
  const ca = b.completedAt;
  return ca != null && typeof ca === "object" && typeof ca.seconds === "number";
}

export function bookingIsCancelledForAdmin(status: unknown): boolean {
  return bookingStatusNorm(status) === "cancelled";
}

/** 與 getAvailability／名額統計一致：待確認、已確認、已完成 */
export function bookingCountsTowardAvailabilityCap(status: unknown): boolean {
  const n = bookingStatusNorm(status);
  return n === "pending" || n === "confirmed" || n === "done";
}

/** 後台狀態下拉：與 option value（pending／confirmed／done）對齊，避免大小寫／空白導致無匹配 option、畫面卡在「待確認」 */
export function adminSelectableBookingStatus(status: unknown): "pending" | "confirmed" | "done" {
  const n = bookingStatusNorm(status);
  if (n === "confirmed" || n === "done") return n;
  return "pending";
}

export function populateAdminBookingStatusSelect(sel: HTMLSelectElement, status: unknown): void {
  sel.replaceChildren();
  for (const opt of getAdminStatusSelectOptions()) {
    sel.append(el("option", { value: opt.value }, [opt.label]));
  }
  sel.value = adminSelectableBookingStatus(status);
}

export function adminBookingStatusUpdateError(e: unknown): string {
  if (e && typeof e === "object" && "code" in e && "message" in e) {
    const code = (e as { code?: unknown }).code;
    const msg = (e as { message?: unknown }).message;
    if (typeof code === "string" && typeof msg === "string" && msg.length > 0) {
      const base = `${code}: ${msg}`;
      if (code === "permission-denied") {
        return `${base} ${t(
          "admin.status.permissionDeniedRulesHint",
          "（若已填寫信件附言，請確認已部署的 Firestore 規則允許欄位 statusEmailMessage。）",
        )}`;
      }
      return base;
    }
  }
  return e instanceof Error ? e.message : t("admin.status.updateFail", "更新失敗（你是否已加入 admins 集合？）");
}

/** 後台預約表：是否為會員預約（是／否） */
export function bookingMemberYesNo(b: Pick<Booking, "bookingMode" | "customerId">): string {
  const mode = b.bookingMode;
  if (mode === "guest_cash" || mode === "guest_beverage") return t("guest.no", "否");
  if (typeof mode === "string" && mode.startsWith("member_")) return t("guest.yes", "是");
  if (typeof b.customerId === "string" && b.customerId.length > 0) return t("guest.yes", "是");
  return t("guest.dash", "—");
}
