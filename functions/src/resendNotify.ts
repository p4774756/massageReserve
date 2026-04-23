import { Resend } from "resend";

const BOOKING_MODE_LABEL: Record<string, string> = {
  guest_cash: "訪客｜現場現金",
  guest_beverage: "訪客｜飲料折抵",
  member_cash: "會員｜現場現金",
  member_wallet: "會員｜儲值扣款",
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

export async function sendNewBookingEmailToOwner(opts: {
  apiKey: string;
  from: string;
  to: string;
  payload: NewBookingEmailPayload;
}): Promise<void> {
  const { apiKey, from, to, payload } = opts;
  const modeLabel = BOOKING_MODE_LABEL[payload.bookingMode] ?? payload.bookingMode;
  const lines = [
    "有新的按摩預約。",
    "",
    `預約編號：${payload.id}`,
    `姓名：${payload.displayName}`,
    `日期：${payload.dateKey}`,
    `開始時間：${payload.startSlot}`,
    `付款方式：${modeLabel}`,
  ];
  if (payload.memberUid) {
    lines.push(`會員 UID：${payload.memberUid}`);
  }
  if (payload.note) {
    lines.push(`備註：${payload.note}`);
  }
  const text = lines.join("\n");
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject: `新預約：${payload.displayName}｜${payload.dateKey} ${payload.startSlot}`,
    text,
  });
  if (error) {
    throw error;
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

/** 會員預約狀態變更通知（訪客不寄） */
export async function sendMemberBookingStatusChangedEmail(opts: {
  apiKey: string;
  from: string;
  payload: MemberBookingStatusEmailPayload;
}): Promise<void> {
  const { apiKey, from, payload } = opts;
  const prev = STATUS_LABEL_ZH[payload.previousStatus] ?? payload.previousStatus;
  const next = STATUS_LABEL_ZH[payload.newStatus] ?? payload.newStatus;
  const lines = [
    `${payload.displayName} 您好，`,
    "",
    "您在按摩預約系統中的預約狀態已更新。",
    "",
    `日期：${payload.dateKey}`,
    `開始時間：${payload.startSlot}`,
    `狀態：${prev} → ${next}`,
  ];
  if (payload.newStatus === "cancelled" && payload.cancelReason) {
    lines.push("", `取消說明：${payload.cancelReason}`);
  }
  lines.push("", "如有疑問請與店家聯繫。", "", "— 按摩預約系統（自動通知，請勿直接回覆此信）");
  const text = lines.join("\n");
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: [payload.to],
    subject: `預約狀態更新：${next}｜${payload.dateKey} ${payload.startSlot}`,
    text,
  });
  if (error) {
    throw error;
  }
}
