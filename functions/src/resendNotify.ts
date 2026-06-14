import { defineString } from "firebase-functions/params";
import { HttpsError } from "firebase-functions/v2/https";
import { Resend } from "resend";
import { formatDateKeyWithWeekdayZh } from "./bookingLogic";

const emailPublicOrigin = defineString("EMAIL_PUBLIC_ORIGIN", {
  default: "https://my-massage-reserve.web.app",
});

/** 通知信 logo（Firebase Hosting `dist` 內，建置時自 `public/media` 複製） */
export const EMAIL_LOGO_PATH = "/media/email-logo.png";

/** 寄信 HTML 用的 logo 絕對網址（須已 deploy hosting） */
export function getEmailLogoUrl(): string {
  const origin = emailPublicOrigin.value().replace(/\/+$/, "");
  return `${origin}${EMAIL_LOGO_PATH}`;
}

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
  guest_meal: "訪客｜一餐折抵",
  member_cash: "會員｜現場現金",
  member_wallet: "會員｜次數扣 1 次",
  member_beverage: "會員｜飲料折抵",
  member_meal: "會員｜一餐折抵",
  member_qr: "會員｜掃描 QR Code 付款",
  member_cap_overflow: "會員｜加價現金（名額已滿）",
};

const EMAIL_FONT =
  "system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue','Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
const EMAIL_ACCENT_DEEP = "#D94A0E";
const EMAIL_BG = "#ececec";
const EMAIL_SITE_NAME = "辦公室按摩預約";

export type EmailDetailRow = {
  label: string;
  value: string;
  /** 重點列（例如狀態變更）— HTML 以大號字顯示 */
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

function normalizePlainLines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function emailMultilineHtml(s: string): string {
  return escapeHtmlForEmail(normalizePlainLines(s)).split("\n").join("<br>");
}

function buildEmailLogoImgHtml(logoSrc: string, sizePx: number): string {
  const src = escapeHtmlForEmail(logoSrc);
  const alt = escapeHtmlForEmail(EMAIL_SITE_NAME);
  const s = String(sizePx);
  return `<img src="${src}" width="${s}" height="${s}" alt="${alt}" style="display:block;width:${s}px;height:${s}px;border-radius:6px;border:0;outline:none;text-decoration:none;">`;
}

function buildEmailBrandRowHtml(logoSrc: string, logoSizePx: number): string {
  const logo = buildEmailLogoImgHtml(logoSrc, logoSizePx);
  const siteName = escapeHtmlForEmail(EMAIL_SITE_NAME);
  return `<table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td style="vertical-align:middle;">${logo}</td>
<td style="padding-left:12px;vertical-align:middle;">
<div style="font-family:${EMAIL_FONT};font-size:15px;font-weight:700;color:${EMAIL_ACCENT_DEEP};">${siteName}</div>
</td>
</tr></table>`;
}

function buildDetailRowsHtml(rows: EmailDetailRow[]): string {
  if (rows.length === 0) return "";
  return rows
    .map((row) => {
      const label = escapeHtmlForEmail(row.label);
      const valueHtml = emailMultilineHtml(row.value);
      if (row.emphasize) {
        return `<div style="margin:0 0 22px;">
<p style="margin:0 0 6px;font-family:${EMAIL_FONT};font-size:13px;line-height:1.4;color:#737373;">${label}</p>
<p style="margin:0;font-family:${EMAIL_FONT};font-size:26px;font-weight:800;line-height:1.25;letter-spacing:0.02em;color:#1a1a1a;">${valueHtml}</p>
</div>`;
      }
      return `<div style="margin:0 0 14px;">
<p style="margin:0 0 4px;font-family:${EMAIL_FONT};font-size:13px;line-height:1.4;color:#737373;">${label}</p>
<p style="margin:0;font-family:${EMAIL_FONT};font-size:15px;font-weight:600;line-height:1.5;color:#1a1a1a;">${valueHtml}</p>
</div>`;
    })
    .join("");
}

/** 與 HTML 信內文相同結構的純文字（供預覽或與 text 欄對照） */
export function buildNotifyEmailPlainText(opts: {
  title: string;
  greeting?: string;
  introLines?: string[];
  rows?: EmailDetailRow[];
  outroLines?: string[];
  footer: string;
  testBanner?: boolean;
}): string {
  const lines: string[] = [];
  if (opts.testBanner) {
    lines.push("【測試信】此信不會變更您的預約狀態", "");
  }
  lines.push(opts.title, "");
  if (opts.greeting?.trim()) {
    lines.push(opts.greeting.trim(), "");
  }
  for (const line of opts.introLines ?? []) {
    if (line.trim()) lines.push(line);
  }
  if ((opts.introLines ?? []).some((l) => l.trim())) {
    lines.push("");
  }
  for (const row of opts.rows ?? []) {
    const value = normalizePlainLines(row.value);
    if (value.includes("\n")) {
      lines.push(`${row.label}：`, ...value.split("\n"));
    } else {
      lines.push(`${row.label}：${value}`);
    }
  }
  if ((opts.rows ?? []).length > 0) {
    lines.push("");
  }
  for (const line of opts.outroLines ?? []) {
    if (line.trim()) lines.push(line);
  }
  if ((opts.outroLines ?? []).some((l) => l.trim())) {
    lines.push("");
  }
  lines.push(opts.footer);
  return lines.join("\n");
}

/** 預約／狀態通知共用 HTML（灰底白卡片、品牌色；多數信箱相容） */
export function buildNotifyEmailHtml(opts: {
  title: string;
  greeting?: string;
  introLines?: string[];
  rows?: EmailDetailRow[];
  outroLines?: string[];
  footer: string;
  testBanner?: boolean;
  /** 預覽用相對路徑；未指定則用 Hosting 絕對網址 */
  logoSrc?: string;
}): string {
  const logoSrc = opts.logoSrc?.trim() || getEmailLogoUrl();
  const intro = (opts.introLines ?? [])
    .filter((line) => line.trim())
    .map(
      (line) =>
        `<p style="margin:0 0 12px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.55;color:#333333;">${escapeHtmlForEmail(line)}</p>`,
    )
    .join("");
  const outro = (opts.outroLines ?? [])
    .filter((line) => line.trim())
    .map(
      (line) =>
        `<p style="margin:0 0 10px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.55;color:#333333;">${escapeHtmlForEmail(line)}</p>`,
    )
    .join("");
  const greeting = opts.greeting?.trim()
    ? `<p style="margin:0 0 14px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.55;color:#333333;">${escapeHtmlForEmail(opts.greeting.trim())}</p>`
    : "";
  const testBanner = opts.testBanner
    ? `<p style="margin:0 0 18px;padding:12px 14px;background:#FEF3C7;border-left:4px solid #F59E0B;font-family:${EMAIL_FONT};font-size:14px;line-height:1.45;color:#92400E;font-weight:600;">【測試信】此信不會變更您的預約狀態</p>`
    : "";
  const rowsBlock = buildDetailRowsHtml(opts.rows ?? []);
  const title = escapeHtmlForEmail(opts.title);
  const footer = escapeHtmlForEmail(opts.footer);
  const siteName = escapeHtmlForEmail(EMAIL_SITE_NAME);

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_BG};">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${EMAIL_BG};">
<tr><td align="center" style="padding:32px 16px 40px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;">
<tr><td style="background:#ffffff;padding:32px 28px 28px;border-radius:4px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td style="padding-bottom:22px;">
${buildEmailBrandRowHtml(logoSrc, 48)}
</td></tr>
<tr><td>
<h1 style="margin:0 0 20px;font-family:${EMAIL_FONT};font-size:28px;font-weight:800;line-height:1.3;color:#1a1a1a;">${title}</h1>
${testBanner}${greeting}${intro}${rowsBlock}${outro}
</td></tr>
<tr><td style="padding-top:24px;border-top:1px solid #e5e5e5;">
<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:20px;"><tr>
<td style="vertical-align:middle;">${buildEmailLogoImgHtml(logoSrc, 28)}</td>
<td style="padding-left:10px;vertical-align:middle;font-family:${EMAIL_FONT};font-size:13px;font-weight:600;color:${EMAIL_ACCENT_DEEP};">${siteName}</td>
</tr></table>
<p style="margin:14px 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.55;color:#737373;">${footer}</p>
</td></tr>
</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** 管理員群發：純文字轉為與通知信相同版型 HTML */
export function buildBroadcastEmailHtml(bodyPlain: string, logoSrc?: string): string {
  const safe = bodyPlain.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const introLines = safe ? safe.split("\n") : ["（無內文）"];
  return buildNotifyEmailHtml({
    title: "店家訊息",
    introLines,
    footer: "此信由店家透過預約系統發送；如需回覆請直接聯絡店家。",
    logoSrc,
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
    { label: "姓名", value: payload.displayName, emphasize: true },
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

export type MemberBookingRescheduledEmailPayload = {
  to: string;
  displayName: string;
  previousDateKey: string;
  previousStartSlot: string;
  dateKey: string;
  startSlot: string;
  rescheduleEmailMessage?: string;
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

/** 會員預約改時間通知（訪客不寄） */
export async function sendMemberBookingRescheduledEmail(opts: {
  apiKey: string;
  from: string;
  payload: MemberBookingRescheduledEmailPayload;
}): Promise<void> {
  const { apiKey, from, payload } = opts;
  const prevDateLabel = formatDateKeyWithWeekdayZh(payload.previousDateKey);
  const newDateLabel = formatDateKeyWithWeekdayZh(payload.dateKey);
  const lines: string[] = [
    `${payload.displayName} 您好，`,
    "",
    "您在按摩預約系統中的預約時間已由店家調整。",
    "",
    `原時間：${prevDateLabel} ${payload.previousStartSlot}`,
    `新時間：${newDateLabel} ${payload.startSlot}`,
  ];
  if (payload.rescheduleEmailMessage?.trim()) {
    lines.push("", `店家留言：\n${payload.rescheduleEmailMessage.trim()}`);
  }
  lines.push(
    "",
    "如有疑問請與店家聯繫。",
    "",
    "— 按摩預約系統（自動通知，請勿直接回覆此信）",
  );
  const text = lines.join("\n");
  const rows: EmailDetailRow[] = [
    { label: "原日期", value: prevDateLabel },
    { label: "原開始時間", value: payload.previousStartSlot },
    { label: "新日期", value: newDateLabel, emphasize: true },
    { label: "新開始時間", value: payload.startSlot, emphasize: true },
  ];
  if (payload.rescheduleEmailMessage?.trim()) {
    rows.push({ label: "店家留言", value: payload.rescheduleEmailMessage.trim() });
  }
  const html = buildNotifyEmailHtml({
    title: "預約時間調整",
    greeting: `${payload.displayName} 您好，`,
    introLines: ["您在按摩預約系統中的預約時間已由店家調整。"],
    rows,
    outroLines: ["如有疑問請與店家聯繫。"],
    footer: "— 按摩預約系統（自動通知，請勿直接回覆此信）",
  });
  const resend = new Resend(apiKey);
  const subject = `預約時間調整：${newDateLabel} ${payload.startSlot}`;
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

export type MemberWalletSnapshot = {
  walletBalance: number;
  sessionCredits: number;
  drawChances: number;
  wheelPoints: number;
};

export type MemberWalletChangeKind = "topup" | "admin_session_adjust" | "admin_grant_draw";

const WALLET_CHANGE_KIND_LABEL: Record<MemberWalletChangeKind, string> = {
  topup: "後台儲值",
  admin_session_adjust: "調整可預約次數",
  admin_grant_draw: "贈送輪盤抽獎次數",
};

export type MemberWalletChangedEmailPayload = {
  to: string;
  displayName: string;
  kind: MemberWalletChangeKind;
  before: MemberWalletSnapshot;
  after: MemberWalletSnapshot;
  /** 儲值金額（元），僅 topup */
  topupAmount?: number;
  sessionsDelta?: number;
  drawChancesDelta?: number;
  sessionPriceSnapshot?: number;
  note?: string;
};

function formatWalletFieldDelta(before: number, after: number): string {
  if (before === after) return String(after);
  const diff = after - before;
  const sign = diff > 0 ? "+" : "";
  return `${before} → ${after}（${sign}${diff}）`;
}

/** 後台儲值／調整次數／贈送拉霸次數 — 寄給已驗證 Email 的會員 */
export async function sendMemberWalletChangedEmail(opts: {
  apiKey: string;
  from: string;
  payload: MemberWalletChangedEmailPayload;
}): Promise<void> {
  const { apiKey, from, payload } = opts;
  const kindLabel = WALLET_CHANGE_KIND_LABEL[payload.kind];
  const { before, after } = payload;

  const walletFieldDefs: { key: keyof MemberWalletSnapshot; label: string }[] = [
    { key: "sessionCredits", label: "可預約次數" },
    { key: "walletBalance", label: "未折次數餘額（元）" },
    { key: "drawChances", label: "可拉霸開獎次數" },
    { key: "wheelPoints", label: "輪盤點數" },
  ];

  const rows: EmailDetailRow[] = [{ label: "操作類型", value: kindLabel, emphasize: true }];

  if (typeof payload.topupAmount === "number" && payload.topupAmount > 0) {
    rows.push({ label: "儲值金額（元）", value: String(payload.topupAmount) });
  }
  if (typeof payload.sessionsDelta === "number" && payload.sessionsDelta !== 0) {
    const sign = payload.sessionsDelta > 0 ? "+" : "";
    rows.push({ label: "本次預約次數變更", value: `${sign}${payload.sessionsDelta} 次` });
  }
  if (typeof payload.drawChancesDelta === "number" && payload.drawChancesDelta > 0) {
    rows.push({ label: "本次贈送拉霸次數", value: `+${payload.drawChancesDelta} 次` });
  }
  if (typeof payload.sessionPriceSnapshot === "number" && payload.sessionPriceSnapshot > 0) {
    rows.push({
      label: "折次單價（快照）",
      value: `${payload.sessionPriceSnapshot} 元／次`,
    });
  }
  if (payload.note?.trim()) {
    rows.push({ label: "備註", value: payload.note.trim() });
  }

  for (const { key, label } of walletFieldDefs) {
    if (before[key] !== after[key]) {
      rows.push({
        label,
        value: formatWalletFieldDelta(before[key], after[key]),
        emphasize:
          (payload.kind === "admin_grant_draw" && key === "drawChances") ||
          (payload.kind !== "admin_grant_draw" && key === "sessionCredits") ||
          key === "walletBalance",
      });
    }
  }

  rows.push({
    label: "帳戶目前狀態",
    value: walletFieldDefs.map(({ key, label }) => `${label}：${after[key]}`).join("\n"),
  });

  const emphasizeSubject =
    payload.kind === "admin_grant_draw" && typeof payload.drawChancesDelta === "number"
      ? `+${payload.drawChancesDelta} 次拉霸`
      : typeof payload.sessionsDelta === "number" && payload.sessionsDelta !== 0
        ? `${payload.sessionsDelta > 0 ? "+" : ""}${payload.sessionsDelta} 次預約`
        : kindLabel;

  const text = buildNotifyEmailPlainText({
    title: "會員帳戶異動通知",
    greeting: `${payload.displayName} 您好，`,
    introLines: ["店家已為您的會員帳戶更新餘額，摘要如下。"],
    rows,
    outroLines: ["登入預約站「會員中心」可查看最新餘額。如有疑問請與店家聯繫。"],
    footer: "— 按摩預約系統（自動通知，請勿直接回覆此信）",
  });

  const html = buildNotifyEmailHtml({
    title: "會員帳戶異動通知",
    greeting: `${payload.displayName} 您好，`,
    introLines: ["店家已為您的會員帳戶更新餘額，摘要如下。"],
    rows,
    outroLines: ["登入預約站「會員中心」可查看最新餘額。如有疑問請與店家聯繫。"],
    footer: "— 按摩預約系統（自動通知，請勿直接回覆此信）",
  });

  const resend = new Resend(apiKey);
  const subject = `會員帳戶異動：${kindLabel}｜${emphasizeSubject}`;
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

export type MonthlyChampionRewardEmailPayload = {
  to: string;
  displayName: string;
  monthKey: string;
  monthLabel: string;
  cashNtd: number;
  sessions: number;
  bookingCount: number;
  sessionCreditsAfter: number;
};

/** 月消費冠軍：贈送 1 次按摩 */
export async function sendMonthlyChampionRewardEmail(opts: {
  apiKey: string;
  from: string;
  payload: MonthlyChampionRewardEmailPayload;
}): Promise<void> {
  const { apiKey, from, payload } = opts;
  const rows: EmailDetailRow[] = [
    { label: "獲獎月份", value: payload.monthLabel, emphasize: true },
    { label: "贈送內容", value: "1 次按摩（可預約次數 +1）", emphasize: true },
    { label: "該月現金消費（元）", value: payload.cashNtd > 0 ? String(payload.cashNtd) : "—" },
    { label: "該月扣次", value: payload.sessions > 0 ? String(payload.sessions) : "—" },
    { label: "該月有效預約", value: `${payload.bookingCount} 筆` },
    { label: "目前可預約次數", value: `${payload.sessionCreditsAfter} 次` },
  ];

  const text = buildNotifyEmailPlainText({
    title: "月消費冠軍獎勵",
    greeting: `${payload.displayName} 您好，`,
    introLines: [
      `恭喜您獲得 ${payload.monthLabel} 消費冠軍！`,
      "店家已為您贈送 1 次按摩，請在本月內登入預約站安排時段。",
    ],
    rows,
    outroLines: ["登入「會員中心」可查看可預約次數；如有疑問請與店家聯繫。"],
    footer: "— 按摩預約系統（自動通知，請勿直接回覆此信）",
  });

  const html = buildNotifyEmailHtml({
    title: "月消費冠軍獎勵",
    greeting: `${payload.displayName} 您好，`,
    introLines: [
      `恭喜您獲得 <strong>${escapeHtmlForEmail(payload.monthLabel)}</strong> 消費冠軍！`,
      "店家已為您贈送 <strong>1 次按摩</strong>，請在本月內登入預約站安排時段。",
    ],
    rows,
    outroLines: ["登入「會員中心」可查看可預約次數；如有疑問請與店家聯繫。"],
    footer: "— 按摩預約系統（自動通知，請勿直接回覆此信）",
  });

  const resend = new Resend(apiKey);
  const subject = `恭喜！${payload.monthLabel}消費冠軍 — 已贈送 1 次按摩`;
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
