import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { DateTime } from "luxon";
import { TIMEZONE } from "./bookingLogic";
import {
  addMemberConsumption,
  CONSUMPTION_STATS_MAX_BOOKINGS,
  parseBookingConsumption,
  sortMemberConsumptionEntries,
  type MemberConsumptionTotals,
} from "./consumptionStats";
import { maskDisplayNameForPublic } from "./maskDisplayName";
import { foldWalletBalanceIntoSessions, resolveSessionPriceNtd } from "./pricing";
import { sendMonthlyChampionRewardEmail } from "./resendNotify";

export const MONTHLY_CHAMPION_AWARD_COLLECTION = "monthlyChampionAwards";
export const MONTHLY_CHAMPION_CELEBRATION_DOC_ID = "monthlyChampionCelebration";
export const WALLET_TX_TYPE_MONTHLY_CHAMPION = "monthly_champion_reward";
export const MONTHLY_CHAMPION_SYSTEM_OPERATOR_ID = "system_monthly_champion";
const SYSTEM_OPERATOR_ID = MONTHLY_CHAMPION_SYSTEM_OPERATOR_ID;

function firestoreTimestampToSeconds(v: unknown): number | null {
  if (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: () => number }).toMillis === "function") {
    return Math.floor((v as { toMillis: () => number }).toMillis() / 1000);
  }
  return null;
}

export type MonthlyChampionAwardAdminRow = {
  monthKey: string;
  monthLabel: string;
  customerId: string;
  email: string | null;
  displayNamePublic: string;
  walletTransactionId: string;
  createdAt: number | null;
  cashNtd: number;
  sessions: number;
  bookingCount: number;
};

/** 後台：查詢指定月份冠軍結算（含 Email，供對照消費紀錄） */
export async function getMonthlyChampionAwardAdminRow(
  db: Firestore,
  monthKey: string,
): Promise<MonthlyChampionAwardAdminRow | null> {
  const snap = await db.collection(MONTHLY_CHAMPION_AWARD_COLLECTION).doc(monthKey).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  const customerId = typeof d.customerId === "string" ? d.customerId.trim() : "";
  if (!customerId) return null;
  let email: string | null = null;
  try {
    const user = await getAuth().getUser(customerId);
    email = user.email?.trim() ?? null;
  } catch {
    /* ignore */
  }
  const displayNamePublic = await memberPublicDisplayName(db, customerId);
  return {
    monthKey: snap.id,
    monthLabel: formatMonthKeyLabelZh(snap.id),
    customerId,
    email,
    displayNamePublic,
    walletTransactionId: typeof d.walletTransactionId === "string" ? d.walletTransactionId : "",
    createdAt: firestoreTimestampToSeconds(d.createdAt),
    cashNtd: typeof d.cashNtd === "number" ? d.cashNtd : 0,
    sessions: typeof d.sessions === "number" ? d.sessions : 0,
    bookingCount: typeof d.bookingCount === "number" ? d.bookingCount : 0,
  };
}

export type MonthlyChampionMonthRange = {
  monthKey: string;
  dateFrom: string;
  dateTo: string;
  /** 祝賀橫幅顯示至當月月底（冠軍於下月領取贈送次數） */
  showUntil: string;
};

export function formatMonthKeyLabelZh(monthKey: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return monthKey;
  return `${m[1]}年${Number(m[2])}月`;
}

/** 結算上個月；showUntil 為「頒獎當月」月底 */
export function monthlyChampionMonthRange(
  now = DateTime.now().setZone(TIMEZONE).startOf("day"),
): MonthlyChampionMonthRange {
  const prev = now.minus({ months: 1 });
  return {
    monthKey: prev.toFormat("yyyy-MM"),
    dateFrom: prev.startOf("month").toISODate()!,
    dateTo: prev.endOf("month").toISODate()!,
    showUntil: now.endOf("month").toISODate()!,
  };
}

export function monthlyChampionMonthRangeForKey(
  monthKey: string,
  now = DateTime.now().setZone(TIMEZONE).startOf("day"),
): MonthlyChampionMonthRange | null {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!y || mo < 1 || mo > 12) return null;
  const prev = DateTime.fromObject({ year: y, month: mo, day: 1 }, { zone: TIMEZONE }).startOf("day");
  if (!prev.isValid) return null;
  return {
    monthKey: prev.toFormat("yyyy-MM"),
    dateFrom: prev.startOf("month").toISODate()!,
    dateTo: prev.endOf("month").toISODate()!,
    showUntil: now.endOf("month").toISODate()!,
  };
}

export async function aggregateMonthMemberConsumption(
  db: Firestore,
  dateFrom: string,
  dateTo: string,
): Promise<Map<string, MemberConsumptionTotals>> {
  const bookingSnap = await db
    .collection("bookings")
    .where("dateKey", ">=", dateFrom)
    .where("dateKey", "<=", dateTo)
    .limit(CONSUMPTION_STATS_MAX_BOOKINGS)
    .get();

  const byMember = new Map<string, MemberConsumptionTotals>();
  for (const docSnap of bookingSnap.docs) {
    const parsed = parseBookingConsumption(docSnap.data() as Record<string, unknown>);
    if (!parsed) continue;
    addMemberConsumption(byMember, parsed.memberUid, parsed.cashNtd, parsed.sessions);
  }
  return byMember;
}

function hasConsumption(stats: MemberConsumptionTotals): boolean {
  return stats.cashNtd > 0 || stats.sessions > 0 || stats.bookingCount > 0;
}

async function memberEmailDisplayName(db: Firestore, memberUid: string): Promise<string> {
  const snap = await db.collection("customers").doc(memberUid).get();
  const nick = snap.exists && typeof snap.get("nickname") === "string" ? snap.get("nickname").trim() : "";
  if (nick) return nick.slice(0, 80);
  try {
    const user = await getAuth().getUser(memberUid);
    const fromAuth = user.displayName?.trim() ?? "";
    if (fromAuth) return fromAuth.slice(0, 80);
    const email = user.email?.trim() ?? "";
    if (email) return email.split("@")[0] ?? "會員";
  } catch {
    /* ignore */
  }
  return "會員";
}

async function memberPublicDisplayName(db: Firestore, memberUid: string): Promise<string> {
  const snap = await db.collection("customers").doc(memberUid).get();
  const nick = snap.exists && typeof snap.get("nickname") === "string" ? snap.get("nickname").trim() : "";
  const fromNick = maskDisplayNameForPublic(nick);
  if (fromNick) return fromNick;
  try {
    const user = await getAuth().getUser(memberUid);
    const fromAuth = maskDisplayNameForPublic(user.displayName);
    if (fromAuth) return fromAuth;
  } catch {
    /* ignore */
  }
  return "匿名會員";
}

export type MonthlyChampionAwardResult =
  | { ok: true; monthKey: string; customerId: string; displayNamePublic: string }
  | { ok: false; reason: string; monthKey?: string };

export async function runMonthlyChampionAward(opts: {
  db: Firestore;
  resendApiKey: string;
  resendFrom: string;
  monthKey?: string;
}): Promise<MonthlyChampionAwardResult> {
  const range = opts.monthKey
    ? monthlyChampionMonthRangeForKey(opts.monthKey)
    : monthlyChampionMonthRange();
  if (!range) {
    return { ok: false, reason: "invalid_month_key" };
  }

  const awardRef = opts.db.collection(MONTHLY_CHAMPION_AWARD_COLLECTION).doc(range.monthKey);
  const existing = await awardRef.get();
  if (existing.exists) {
    return { ok: false, reason: "already_awarded", monthKey: range.monthKey };
  }

  let byMember: Map<string, MemberConsumptionTotals>;
  try {
    byMember = await aggregateMonthMemberConsumption(opts.db, range.dateFrom, range.dateTo);
  } catch (e) {
    console.error("runMonthlyChampionAward aggregate failed", range.monthKey, e);
    return { ok: false, reason: "aggregate_failed", monthKey: range.monthKey };
  }

  const sorted = sortMemberConsumptionEntries(byMember, 1);
  const top = sorted[0];
  if (!top || !hasConsumption(top[1])) {
    return { ok: false, reason: "no_eligible_winner", monthKey: range.monthKey };
  }

  const [customerId, stats] = top;
  const pricingRef = opts.db.collection("siteSettings").doc("pricing");
  const customerRef = opts.db.collection("customers").doc(customerId);
  const walletTxRef = opts.db.collection("walletTransactions").doc();
  const celebrationRef = opts.db.collection("siteSettings").doc(MONTHLY_CHAMPION_CELEBRATION_DOC_ID);

  const monthLabel = formatMonthKeyLabelZh(range.monthKey);
  const note = `${monthLabel}消費冠軍獎勵：贈送 1 次按摩`;

  let sessionCreditsAfter = 0;

  try {
    await opts.db.runTransaction(async (tx) => {
    const awardSnap = await tx.get(awardRef);
    if (awardSnap.exists) {
      throw new Error("already_awarded");
    }

    const [pricingSnap, customerSnap] = await Promise.all([tx.get(pricingRef), tx.get(customerRef)]);
    const sessionPriceNtd = resolveSessionPriceNtd(pricingSnap.data());

    const walletBalanceRaw = customerSnap.exists ? customerSnap.get("walletBalance") : 0;
    const sessionCreditsRaw = customerSnap.exists ? customerSnap.get("sessionCredits") : 0;
    const drawChancesRaw = customerSnap.exists ? customerSnap.get("drawChances") : 0;
    const wheelPointsRaw = customerSnap.exists ? customerSnap.get("wheelPoints") : 0;

    let walletBalance = typeof walletBalanceRaw === "number" ? walletBalanceRaw : 0;
    let sessionCredits = typeof sessionCreditsRaw === "number" ? sessionCreditsRaw : 0;
    const drawChances = typeof drawChancesRaw === "number" ? drawChancesRaw : 0;
    const wheelPoints = typeof wheelPointsRaw === "number" ? wheelPointsRaw : 0;

    const folded = foldWalletBalanceIntoSessions(walletBalance, sessionCredits, sessionPriceNtd);
    walletBalance = folded.walletBalance;
    sessionCredits = folded.sessionCredits + 1;
    sessionCreditsAfter = sessionCredits;

    tx.set(
      customerRef,
      {
        walletBalance,
        sessionCredits,
        drawChances,
        wheelPoints,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(walletTxRef, {
      customerId,
      type: WALLET_TX_TYPE_MONTHLY_CHAMPION,
      amount: 0,
      sessionsDelta: 1,
      sessionPriceSnapshot: sessionPriceNtd,
      note,
      operatorId: SYSTEM_OPERATOR_ID,
      championMonthKey: range.monthKey,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(awardRef, {
      customerId,
      monthKey: range.monthKey,
      cashNtd: stats.cashNtd,
      sessions: stats.sessions,
      bookingCount: stats.bookingCount,
      walletTransactionId: walletTxRef.id,
      createdAt: FieldValue.serverTimestamp(),
    });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "already_awarded") {
      return { ok: false, reason: "already_awarded", monthKey: range.monthKey };
    }
    console.error("runMonthlyChampionAward transaction failed", range.monthKey, e);
    return { ok: false, reason: "aggregate_failed", monthKey: range.monthKey };
  }

  const displayNamePublic = await memberPublicDisplayName(opts.db, customerId);

  await celebrationRef.set({
    monthKey: range.monthKey,
    displayName: displayNamePublic,
    cashNtd: stats.cashNtd,
    sessions: stats.sessions,
    bookingCount: stats.bookingCount,
    showUntil: range.showUntil,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const apiKey = opts.resendApiKey.trim();
  if (apiKey) {
    try {
      const user = await getAuth().getUser(customerId);
      if (user.emailVerified === true) {
        const to = (user.email ?? "").trim();
        if (to) {
          const displayName = await memberEmailDisplayName(opts.db, customerId);
          await sendMonthlyChampionRewardEmail({
            apiKey,
            from: opts.resendFrom.trim() || "Massage預約 <onboarding@resend.dev>",
            payload: {
              to,
              displayName,
              monthKey: range.monthKey,
              monthLabel,
              cashNtd: stats.cashNtd,
              sessions: stats.sessions,
              bookingCount: stats.bookingCount,
              sessionCreditsAfter,
            },
          });
          await awardRef.set({ emailSentAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      } else {
        console.warn("runMonthlyChampionAward: email not verified", customerId);
      }
    } catch (e) {
      console.error("runMonthlyChampionAward email failed", customerId, e);
    }
  } else {
    console.warn("runMonthlyChampionAward: RESEND_API_KEY empty");
  }

  return { ok: true, monthKey: range.monthKey, customerId, displayNamePublic };
}

/** 供前台讀取：是否在祝賀期間內 */
export function parseMonthlyChampionCelebration(
  data: Record<string, unknown> | undefined,
  todayKey: string,
): {
  monthKey: string;
  monthLabel: string;
  displayName: string;
  cashNtd: number;
  sessions: number;
  bookingCount: number;
} | null {
  if (!data) return null;
  const monthKey = typeof data.monthKey === "string" ? data.monthKey.trim() : "";
  const displayName = typeof data.displayName === "string" ? data.displayName.trim() : "";
  const showUntil = typeof data.showUntil === "string" ? data.showUntil.trim() : "";
  if (!monthKey || !displayName || !showUntil || todayKey > showUntil) return null;
  return {
    monthKey,
    monthLabel: formatMonthKeyLabelZh(monthKey),
    displayName,
    cashNtd: typeof data.cashNtd === "number" ? data.cashNtd : 0,
    sessions: typeof data.sessions === "number" ? data.sessions : 0,
    bookingCount: typeof data.bookingCount === "number" ? data.bookingCount : 0,
  };
}
