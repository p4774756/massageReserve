export type BookingMode =
  | "guest_cash"
  | "guest_beverage"
  | "guest_meal"
  | "member_cash"
  | "member_wallet"
  | "member_beverage"
  | "member_meal"
  /** 現場掃描 TWQR／QR Code 轉帳（金額同現金） */
  | "member_qr"
  /** 當日或本工作週名額已滿時：現場現金（按摩費 + 加價） */
  | "member_cap_overflow";

export const BOOKING_MODES: readonly BookingMode[] = [
  "guest_cash",
  "guest_beverage",
  "guest_meal",
  "member_cash",
  "member_wallet",
  "member_beverage",
  "member_meal",
  "member_qr",
  "member_cap_overflow",
] as const;

export function isBookingMode(value: string | undefined | null): value is BookingMode {
  return typeof value === "string" && (BOOKING_MODES as readonly string[]).includes(value);
}

export type Booking = {
  id: string;
  displayName: string;
  note: string;
  dateKey: string;
  startSlot: string;
  status: string;
  startAt?: { seconds: number };
  cancelReason?: string;
  /** 與後端一致：該預約曆日所屬週的週一 dateKey */
  weekStart?: string;
  /** 後台「封存」：自主列表移出（invisible）；僅「已取消／已完成」可封存；不改 status，會員端仍看真實狀態 */
  invisible?: boolean;
  /** 後台標為完成時寫入（與 status done 一併出現） */
  completedAt?: { seconds: number };
  bookingMode?: BookingMode | string;
  customerId?: string | null;
  /** 假日外約（週六日）；計價與平日相同，交通費由客戶負擔為現場約定 */
  holidayOutcall?: boolean;
  /** 預約單位數（1 單位 = unitMinutes 分鐘） */
  units?: number;
  /** 服務總長度（分鐘） */
  durationMinutes?: number;
  /** 建立時每單位分鐘數快照 */
  unitMinutesSnapshot?: number;
  price?: number;
  walletDeducted?: number;
  paidCash?: number;
  /** 改扣次結帳前原現金應收（稽核） */
  paidCashOriginal?: number;
  sessionCreditsDeducted?: number;
  /** 後台將現金預約改為扣次結帳 */
  settledWithSessions?: boolean;
  settlementNote?: string;
  /** 名額已滿時加價預約 */
  capOverflow?: boolean;
  capOverflowSurchargeNtd?: number;
};
