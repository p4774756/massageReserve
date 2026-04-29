import { HttpsError } from "firebase-functions/v2/https";
import { Resend } from "resend";

/** Resend `emails.send` 的 `error` 為純物件，不可直接拋給 Callable（會變成 INTERNAL）。 */
function throwResendEmailError(error: unknown): never {
  let msg = "Resend error";
  if (error && typeof error === "object" && "message" in error) {
    const m = (error as { message: unknown }).message;
    const n = (error as { name?: unknown }).name;
    const parts: string[] = [];
    if (typeof n === "string" && n.length > 0) parts.push(n);
    if (typeof m === "string" && m.length > 0) parts.push(m);
    if (parts.length > 0) msg = parts.join(": ");
  } else if (error instanceof Error && error.message) {
    msg = error.message;
  }
  throw new HttpsError("failed-precondition", msg.slice(0, 500));
}

/** Resend 入門預設寄件者；此模式下 API 常仍回成功，但「收件人」若非 Resend 允許的測試對象則實際不進對方信箱。 */
export function isResendOnboardingFromAddress(from: string): boolean {
  return /onboarding@resend\.dev/i.test(from);
}

const BOOKING_MODE_LABEL: Record<string, string> = {
  guest_cash: "訪客｜現場現金",
  guest_beverage: "訪客｜飲料折抵",
  member_cash: "會員｜現場現金",
  member_wallet: "會員｜次數扣 1 次",
  member_beverage: "會員｜飲料折抵",
};

export type NewBookingEmailPayload = {
  id: string;
  displayName: string;
  dateKey: string;
  startSlot: string;
  note: string;
  bookingMode: string;
  memberUid: string | null;
};

export type EmailLocale = "zh-Hant" | "en";

const BOOKING_MODE_LABEL_EN: Record<string, string> = {
  guest_cash: "Guest · cash on site",
  guest_beverage: "Guest · drink credit",
  member_cash: "Member · cash on site",
  member_wallet: "Member · session credit",
  member_beverage: "Member · drink credit",
};

export async function sendNewBookingEmailToOwner(opts: {
  apiKey: string;
  from: string;
  to: string;
  locale?: EmailLocale;
  payload: NewBookingEmailPayload;
}): Promise<void> {
  const { apiKey, from, to, payload } = opts;
  const loc = opts.locale === "en" ? "en" : "zh-Hant";
  const modeLabel =
    loc === "en"
      ? (BOOKING_MODE_LABEL_EN[payload.bookingMode] ?? payload.bookingMode)
      : (BOOKING_MODE_LABEL[payload.bookingMode] ?? payload.bookingMode);
  const lines =
    loc === "en"
      ? [
          "There is a new massage booking.",
          "",
          `Booking ID: ${payload.id}`,
          `Name: ${payload.displayName}`,
          `Date: ${payload.dateKey}`,
          `Start: ${payload.startSlot}`,
          `Payment: ${modeLabel}`,
        ]
      : [
          "有新的按摩預約。",
          "",
          `預約編號：${payload.id}`,
          `姓名：${payload.displayName}`,
          `日期：${payload.dateKey}`,
          `開始時間：${payload.startSlot}`,
          `付款方式：${modeLabel}`,
        ];
  if (payload.memberUid) {
    lines.push(loc === "en" ? `Member UID: ${payload.memberUid}` : `會員 UID：${payload.memberUid}`);
  }
  if (payload.note) {
    lines.push(loc === "en" ? `Notes: ${payload.note}` : `備註：${payload.note}`);
  }
  const text = lines.join("\n");
  const resend = new Resend(apiKey);
  const subject =
    loc === "en"
      ? `New booking: ${payload.displayName} | ${payload.dateKey} ${payload.startSlot}`
      : `新預約：${payload.displayName}｜${payload.dateKey} ${payload.startSlot}`;
  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    text,
  });
  if (error) {
    throwResendEmailError(error);
  }
}

const STATUS_LABEL_ZH: Record<string, string> = {
  pending: "待確認",
  confirmed: "已確認",
  done: "已完成",
  cancelled: "已取消",
  deleted: "已刪除",
};

export type MemberBookingStatusEmailPayload = {
  to: string;
  displayName: string;
  dateKey: string;
  startSlot: string;
  previousStatus: string;
  newStatus: string;
  cancelReason?: string;
};

const STATUS_LABEL_EN: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  done: "Completed",
  cancelled: "Cancelled",
  deleted: "Deleted",
};

/** 會員預約狀態變更通知（訪客不寄） */
export async function sendMemberBookingStatusChangedEmail(opts: {
  apiKey: string;
  from: string;
  locale?: EmailLocale;
  /** 後台一鍵測試：主旨與內文標示為測試，不應宣稱已變更預約 */
  testMode?: boolean;
  payload: MemberBookingStatusEmailPayload;
}): Promise<void> {
  const { apiKey, from, payload } = opts;
  const loc = opts.locale === "en" ? "en" : "zh-Hant";
  const testMode = opts.testMode === true;
  const prev =
    loc === "en"
      ? (STATUS_LABEL_EN[payload.previousStatus] ?? payload.previousStatus)
      : (STATUS_LABEL_ZH[payload.previousStatus] ?? payload.previousStatus);
  const next =
    loc === "en"
      ? (STATUS_LABEL_EN[payload.newStatus] ?? payload.newStatus)
      : (STATUS_LABEL_ZH[payload.newStatus] ?? payload.newStatus);
  const lines: string[] = testMode
    ? loc === "en"
      ? [
          `Hello ${payload.displayName},`,
          "",
          "[TEST] Sent from the admin panel (“Test status email”). Your booking was not changed.",
          "The status line below is sample text (Pending → Confirmed) to verify inbox delivery.",
          "",
          `This booking’s date: ${payload.dateKey}`,
          `Start time: ${payload.startSlot}`,
          `Status (sample only): ${prev} → ${next}`,
        ]
      : [
          `${payload.displayName} 您好，`,
          "",
          "【測試】此信由管理員在後台按下「測試通知信」寄出，您的預約狀態不會因此改變。",
          "以下「狀態」為範例文案（待確認→已確認），用於確認會員信箱能否收到、版面是否正常。",
          "",
          `此筆預約日期：${payload.dateKey}`,
          `開始時間：${payload.startSlot}`,
          `狀態（僅示範）：${prev} → ${next}`,
        ]
    : loc === "en"
      ? [
          `Hello ${payload.displayName},`,
          "",
          "Your massage booking status has been updated.",
          "",
          `Date: ${payload.dateKey}`,
          `Start: ${payload.startSlot}`,
          `Status: ${prev} → ${next}`,
        ]
      : [
          `${payload.displayName} 您好，`,
          "",
          "您在按摩預約系統中的預約狀態已更新。",
          "",
          `日期：${payload.dateKey}`,
          `開始時間：${payload.startSlot}`,
          `狀態：${prev} → ${next}`,
        ];
  if (!testMode && payload.newStatus === "cancelled" && payload.cancelReason) {
    lines.push("", loc === "en" ? `Cancellation note: ${payload.cancelReason}` : `取消說明：${payload.cancelReason}`);
  }
  lines.push(
    "",
    loc === "en" ? "If you have questions, contact the shop." : "如有疑問請與店家聯繫。",
    "",
    loc === "en"
      ? "— Massage booking system (automated, do not reply)"
      : "— 按摩預約系統（自動通知，請勿直接回覆此信）",
  );
  const text = lines.join("\n");
  const resend = new Resend(apiKey);
  const subject = testMode
    ? loc === "en"
      ? `[Test] Booking status email test | ${payload.dateKey} ${payload.startSlot}`
      : `[測試] 預約狀態通知信測試｜${payload.dateKey} ${payload.startSlot}`
    : loc === "en"
      ? `Booking update: ${next} | ${payload.dateKey} ${payload.startSlot}`
      : `預約狀態更新：${next}｜${payload.dateKey} ${payload.startSlot}`;
  const { error } = await resend.emails.send({
    from,
    to: [payload.to],
    subject,
    text,
  });
  if (error) {
    throwResendEmailError(error);
  }
}

function escapeHtmlForEmail(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 管理員群發：純文字轉為簡單 HTML（換行轉 &lt;br&gt;，其餘跳脫） */
export function buildBroadcastEmailHtml(bodyPlain: string, locale: EmailLocale): string {
  const safe = escapeHtmlForEmail(bodyPlain).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const br = safe.split("\n").join("<br>\n");
  const footer =
    locale === "en"
      ? "This message was sent by the shop using the booking system. Please contact the shop directly if you need a reply."
      : "此信由店家透過預約系統發送；如需回覆請直接聯絡店家。";
  const lang = locale === "en" ? "en" : "zh-Hant";
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f6f6;"><div style="max-width:560px;margin:0 auto;padding:24px 20px;background:#fff;font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans TC',sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;"><div style="margin:0 0 12px;">${br}</div><hr style="border:none;border-top:1px solid #e8e8e8;margin:28px 0 16px;"><p style="margin:0;font-size:12px;color:#6b6b6b;">${footer}</p></div></body></html>`;
}

export async function sendBroadcastHtmlEmail(opts: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const resend = new Resend(opts.apiKey);
  const { error } = await resend.emails.send({
    from: opts.from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
  });
  if (error) {
    throwResendEmailError(error);
  }
}
