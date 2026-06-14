import { getAuth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { DateTime } from "luxon";
import { ACTIVE_STATUSES, TIMEZONE, mondayOfWeek } from "./bookingLogic";
import { maskDisplayNameForPublic } from "./maskDisplayName";
import { st, type ServerLocale } from "./serverI18n";

export const STATS_CASH_BOOKING_MODES = new Set(["member_cash", "member_qr", "member_cap_overflow"]);
export const STATS_PAYMENT_MODES = [
  "member_cash",
  "member_qr",
  "member_cap_overflow",
  "member_wallet",
  "member_beverage",
  "member_meal",
] as const;

export const STATS_WALLET_TOPUP = "topup";
export const STATS_WALLET_ADJUST = "admin_session_adjust";
export const CONSUMPTION_STATS_MAX_BOOKINGS = 2500;
export const CONSUMPTION_STATS_MAX_WALLET_TX = 2500;
export const CONSUMPTION_STATS_MAX_RANGE_DAYS = 366;
export const CONSUMPTION_RANK_PUBLIC_MAX = 10;

export type MemberConsumptionTotals = {
  bookingCount: number;
  cashNtd: number;
  sessions: number;
};

export type ConsumptionStatsByModeRow = {
  mode: string;
  bookingCount: number;
  cashNtd: number;
  sessions: number;
};

export type BookingConsumptionParsed = {
  bookingMode: string;
  memberUid: string;
  cashNtd: number;
  sessions: number;
};

export function bookingSessionCreditsDeducted(d: Record<string, unknown>): number {
  const raw = d.sessionCreditsDeducted;
  return typeof raw === "number" ? Math.max(0, Math.floor(raw)) : 0;
}

/** 單筆有效預約 → 現金／扣次；不符合統計條件則回傳 null */
export function parseBookingConsumption(
  d: Record<string, unknown>,
  opts?: { dateFrom?: string; dateTo?: string; customerId?: string | null },
): BookingConsumptionParsed | null {
  const dateKey = typeof d.dateKey === "string" ? d.dateKey : "";
  if (opts?.customerId && opts.dateFrom && opts.dateTo) {
    if (dateKey < opts.dateFrom || dateKey > opts.dateTo) return null;
  }

  const status = typeof d.status === "string" ? d.status : "pending";
  if (status === "cancelled" || status === "deleted") return null;
  if (!(ACTIVE_STATUSES as readonly string[]).includes(status)) return null;

  const bookingMode = typeof d.bookingMode === "string" ? d.bookingMode : "";
  if (!STATS_PAYMENT_MODES.includes(bookingMode as (typeof STATS_PAYMENT_MODES)[number])) return null;

  const paidCash = typeof d.paidCash === "number" ? d.paidCash : 0;
  const price = typeof d.price === "number" ? d.price : 0;
  const sessionCreditsDeducted = bookingSessionCreditsDeducted(d);
  const cashNtd =
    STATS_CASH_BOOKING_MODES.has(bookingMode) && sessionCreditsDeducted < 1
      ? paidCash > 0
        ? paidCash
        : price
      : 0;
  const units = typeof d.units === "number" && d.units > 0 ? Math.floor(d.units) : 1;
  const sessions =
    bookingMode === "member_wallet" || sessionCreditsDeducted >= 1
      ? sessionCreditsDeducted >= 1
        ? sessionCreditsDeducted
        : units
      : 0;

  const memberUid = typeof d.customerId === "string" ? d.customerId.trim() : "";
  return { bookingMode, memberUid, cashNtd, sessions };
}

export function addMemberConsumption(
  map: Map<string, MemberConsumptionTotals>,
  memberUid: string,
  cashNtd: number,
  sessions: number,
) {
  if (!memberUid) return;
  const prev = map.get(memberUid) ?? { bookingCount: 0, cashNtd: 0, sessions: 0 };
  prev.bookingCount += 1;
  prev.cashNtd += cashNtd;
  prev.sessions += sessions;
  map.set(memberUid, prev);
}

export function consumptionRankPublicPeriodRange(period: "week" | "month"): { dateFrom: string; dateTo: string } {
  const today = DateTime.now().setZone(TIMEZONE).startOf("day");
  if (period === "week") {
    const mon = mondayOfWeek(today);
    return { dateFrom: mon.toISODate()!, dateTo: mon.plus({ days: 6 }).toISODate()! };
  }
  return {
    dateFrom: today.startOf("month").toISODate()!,
    dateTo: today.endOf("month").toISODate()!,
  };
}

export async function publicRankDisplayName(
  db: Firestore,
  memberUid: string,
  locale: ServerLocale,
): Promise<string> {
  const snap = await db.collection("customers").doc(memberUid).get();
  const d = snap.exists ? (snap.data() as Record<string, unknown>) : {};
  const nick = typeof d.nickname === "string" ? d.nickname.trim() : "";
  const fromNick = maskDisplayNameForPublic(nick);
  if (fromNick) return fromNick;
  try {
    const user = await getAuth().getUser(memberUid);
    const fromAuth = maskDisplayNameForPublic(user.displayName);
    if (fromAuth) return fromAuth;
  } catch {
    /* ignore */
  }
  return st(locale, "consumptionRank.anonymous", "匿名會員");
}

export function sortMemberConsumptionEntries(
  byMember: Map<string, MemberConsumptionTotals>,
  limit: number,
): [string, MemberConsumptionTotals][] {
  return [...byMember.entries()]
    .sort(
      (a, b) =>
        b[1].cashNtd - a[1].cashNtd ||
        b[1].sessions - a[1].sessions ||
        b[1].bookingCount - a[1].bookingCount,
    )
    .slice(0, limit);
}
