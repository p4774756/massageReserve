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
