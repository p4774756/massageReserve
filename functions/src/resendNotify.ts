import { HttpsError } from "firebase-functions/v2/https";
import { Resend } from "resend";
import { formatDateKeyWithWeekdayZh } from "./bookingLogic";

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

const EMAIL_FONT =
  "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue','Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
const EMAIL_ACCENT = "#FC5B14";
const EMAIL_ACCENT_DEEP = "#D94A0E";
const EMAIL_SITE_NAME = "辦公室按摩預約";

export type EmailDetailRow = {
  label: string;
  value: string;
  /** 重點列（例如狀態變更） */
  emphasize?: boolean;
};

function escapeHtmlForEmail(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function emailMultilineHtml(s: string): string {
  return escapeHtmlForEmail(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").join("<br>");
}

function buildDetailRowsTableHtml(rows: EmailDetailRow[]): string {
  if (rows.length === 0) return "";
  const cells = rows
    .map((row, i) => {
      const bg = i % 2 === 0 ? "#f3f4f6" : "#ffffff";
      const valueStyle = row.emphasize
        ? `color:${EMAIL_ACCENT_DEEP};font-weight:700;`
        : "color:#1a1a1a;font-weight:600;";
      return `<tr>
<td style="width:34%;padding:12px 14px;background:${bg};border-bottom:1px solid #e5e7eb;font-family:${EMAIL_FONT};font-size:14px;line-height:1.45;color:#6b7280;vertical-align:top;">${escapeHtmlForEmail(row.label)}</td>
<td style="padding:12px 14px;background:${bg};border-bottom:1px solid #e5e7eb;font-family:${EMAIL_FONT};font-size:14px;line-height:1.5;${valueStyle}vertical-align:top;">${emailMultilineHtml(row.value)}</td>
</tr>`;
    })
    .join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:0 0 20px;">${cells}</table>`;
}

/** 預約／狀態通知共用 HTML 版型（表格列、品牌色；多數信箱相容） */
export function buildNotifyEmailHtml(opts: {
  title: string;
  greeting?: string;
  introLines?: string[];
  rows?: EmailDetailRow[];
  outroLines?: string[];
  footer: string;
  testBanner?: boolean;
}): string {
  const intro = (opts.introLines ?? [])
    .map(
      (line) =>
        `<p style="margin:0 0 10px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.6;color:#374151;">${escapeHtmlForEmail(line)}</p>`,
    )
    .join("");
  const outro = (opts.outroLines ?? [])
    .map(
      (line) =>
        `<p style="margin:0 0 8px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.6;color:#374151;">${escapeHtmlForEmail(line)}</p>`,
    )
    .join("");
  const greeting = opts.greeting
    ? `<p style="margin:0 0 12px;font-family:${EMAIL_FONT};font-size:16px;line-height:1.5;color:#1a1a1a;font-weight:600;">${escapeHtmlForEmail(opts.greeting)}</p>`
    : "";
  const testBanner = opts.testBanner
    ? `<p style="margin:0 0 14px;padding:10px 12px;background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;font-family:${EMAIL_FONT};font-size:13px;line-height:1.45;color:#92400E;font-weight:600;">【測試信】此信不會變更您的預約狀態</p>`
    : "";
  const rowsTable = buildDetailRowsTableHtml(opts.rows ?? []);
  const title = escapeHtmlForEmail(opts.title);
  const footer = escapeHtmlForEmail(opts.footer);

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border-collapse:separate;">
<tr><td style="height:6px;background:${EMAIL_ACCENT};border-radius:12px 12px 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background:#FFF4ED;padding:18px 22px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
<div style="font-family:${EMAIL_FONT};font-size:18px;font-weight:800;color:${EMAIL_ACCENT_DEEP};letter-spacing:0.02em;">${EMAIL_SITE_NAME}</div>
<div style="margin-top:4px;font-family:${EMAIL_FONT};font-size:12px;color:#6b7280;">Massage Reserve</div>
</td></tr>
<tr><td style="background:#ffffff;padding:26px 22px 22px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
<h1 style="margin:0 0 18px;font-family:${EMAIL_FONT};font-size:20px;font-weight:800;line-height:1.35;color:#1a1a1a;text-align:center;">— ${title} —</h1>
${testBanner}${greeting}${intro}${rowsTable}${outro}
<p style="margin:18px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;font-family:${EMAIL_FONT};font-size:12px;line-height:1.5;color:#9ca3af;">${footer}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** 管理員群發：純文字轉為與通知信相同外框的 HTML */
export function buildBroadcastEmailHtml(bodyPlain: string): string {
  const safe = bodyPlain.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const introLines = safe ? safe.split("\n") : ["（無內文）"];
  return buildNotifyEmailHtml({
    title: "店家訊息",
    introLines,
    footer: "此信由店家透過預約系統發送；如需回覆請直接聯絡店家。",
  });
}

export type NewBookingEmailPayload = {
  id: string;
  displayName: string;
  dateKey: string;
  startSlot: string;
  note: string;
  bookingMode: string;
  memberUid: string | null;
  /** 假日外約（交通費由客戶負擔為現場約定，信內註記） */
  holidayOutcall?: boolean;
};

export async function sendNewBookingEmailToOwner(opts: {
  apiKey: string;
  from: string;
  to: string;
  payload: NewBookingEmailPayload;
}): Promise<void> {
  const { apiKey, from, to, payload } = opts;
  const modeLabel = BOOKING_MODE_LABEL[payload.bookingMode] ?? payload.bookingMode;
  const dateLabel = formatDateKeyWithWeekdayZh(payload.dateKey);
  const lines: string[] = [
    "有新的按摩預約。",
    "",
    `預約編號：${payload.id}`,
    `姓名：${payload.displayName}`,
    `日期：${dateLabel}`,
    `開始時間：${payload.startSlot}`,
    `付款方式：${modeLabel}`,
  ];
  if (payload.holidayOutcall) {
    lines.push("服務類型：假日外約（單次計價與平日相同；交通費由客戶負擔）");
  }
  if (payload.memberUid) {
    lines.push(`會員 UID：${payload.memberUid}`);
  }
  if (payload.note) {
    lines.push(`備註：${payload.note}`);
  }
  const text = lines.join("\n");
  const rows: EmailDetailRow[] = [
    { label: "預約編號", value: payload.id },
    { label: "姓名", value: payload.displayName },
    { label: "日期", value: dateLabel },
    { label: "開始時間", value: payload.startSlot },
    { label: "付款方式", value: modeLabel },
  ];
  if (payload.holidayOutcall) {
    rows.push({
      label: "服務類型",
      value: "假日外約（單次計價與平日相同；交通費由客戶負擔）",
    });
  }
  if (payload.memberUid) {
    rows.push({ label: "會員 UID", value: payload.memberUid });
  }
  if (payload.note.trim()) {
    rows.push({ label: "備註", value: payload.note.trim() });
  }
  const html = buildNotifyEmailHtml({
    title: "新預約通知",
    introLines: ["有新的按摩預約，請至管理後台查看。"],
    rows,
    footer: "— 按摩預約系統（自動通知，請勿直接回覆此信）",
  });
  const resend = new Resend(apiKey);
  const subject = payload.holidayOutcall
    ? `新預約（假日外約）：${payload.displayName}｜${dateLabel} ${payload.startSlot}`
    : `新預約：${payload.displayName}｜${dateLabel} ${payload.startSlot}`;
  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject,
    text,
    html,
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
  /** 後台選填，寄出後由 trigger 自文件移除 */
  statusEmailMessage?: string;
  cancelReason?: string;
};

/** 會員預約狀態變更通知（訪客不寄） */
export async function sendMemberBookingStatusChangedEmail(opts: {
  apiKey: string;
  from: string;
  /** 後台一鍵測試：主旨與內文標示為測試，不應宣稱已變更預約 */
  testMode?: boolean;
  payload: MemberBookingStatusEmailPayload;
}): Promise<void> {
  const { apiKey, from, payload } = opts;
  const testMode = opts.testMode === true;
  const prev = STATUS_LABEL_ZH[payload.previousStatus] ?? payload.previousStatus;
  const next = STATUS_LABEL_ZH[payload.newStatus] ?? payload.newStatus;
  const dateLabel = formatDateKeyWithWeekdayZh(payload.dateKey);
  const lines: string[] = testMode
    ? [
        `${payload.displayName} 您好，`,
        "",
        "【測試】此信由管理員在後台按下「測試通知信」寄出，您的預約狀態不會因此改變。",
        "以下「狀態」為範例文案（待確認→已確認），用於確認會員信箱能否收到、版面是否正常。",
        "",
        `此筆預約日期：${dateLabel}`,
        `開始時間：${payload.startSlot}`,
        `狀態（僅示範）：${prev} → ${next}`,
      ]
    : [
        `${payload.displayName} 您好，`,
        "",
        "您在按摩預約系統中的預約狀態已更新。",
        "",
        `日期：${dateLabel}`,
        `開始時間：${payload.startSlot}`,
        `狀態：${prev} → ${next}`,
      ];
  if (!testMode && payload.statusEmailMessage && payload.statusEmailMessage.trim()) {
    const shopMsg = payload.statusEmailMessage.trim();
    lines.push("", `店家留言：\n${shopMsg}`);
  }
  if (!testMode && payload.newStatus === "cancelled" && payload.cancelReason) {
    lines.push("", `取消說明：${payload.cancelReason}`);
  }
  lines.push(
    "",
    "如有疑問請與店家聯繫。",
    "",
    "— 按摩預約系統（自動通知，請勿直接回覆此信）",
  );
  const text = lines.join("\n");
  const rows: EmailDetailRow[] = [
    { label: "日期", value: dateLabel },
    { label: "開始時間", value: payload.startSlot },
    {
      label: testMode ? "狀態（僅示範）" : "狀態",
      value: `${prev} → ${next}`,
      emphasize: true,
    },
  ];
  if (!testMode && payload.statusEmailMessage?.trim()) {
    rows.push({ label: "店家留言", value: payload.statusEmailMessage.trim() });
  }
  if (!testMode && payload.newStatus === "cancelled" && payload.cancelReason?.trim()) {
    rows.push({ label: "取消說明", value: payload.cancelReason.trim() });
  }
  const html = buildNotifyEmailHtml({
    title: testMode ? "預約狀態通知（測試）" : "預約狀態更新",
    testBanner: testMode,
    greeting: `${payload.displayName} 您好，`,
    introLines: testMode
      ? [
          "此信由管理員在後台寄出，您的預約狀態不會因此改變。",
          "以下為範例文案，用於確認信箱能否收到、版面是否正常。",
        ]
      : ["您在按摩預約系統中的預約狀態已更新。"],
    rows,
    outroLines: ["如有疑問請與店家聯繫。"],
    footer: "— 按摩預約系統（自動通知，請勿直接回覆此信）",
  });
  const resend = new Resend(apiKey);
  const subject = testMode
    ? `[測試] 預約狀態通知信測試｜${dateLabel} ${payload.startSlot}`
    : `預約狀態更新：${next}｜${dateLabel} ${payload.startSlot}`;
  const { error } = await resend.emails.send({
    from,
    to: [payload.to],
    subject,
    text,
    html,
  });
  if (error) {
    throwResendEmailError(error);
  }
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
