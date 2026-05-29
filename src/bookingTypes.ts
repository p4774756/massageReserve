export type BookingMode =
  | "guest_cash"
  | "guest_beverage"
  | "member_cash"
  | "member_wallet"
  | "member_beverage";

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
};
