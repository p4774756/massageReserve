export type ServerLocale = "zh-Hant" | "en";

export function parseLocale(data: unknown): ServerLocale {
  if (data && typeof data === "object" && "locale" in data) {
    const v = (data as { locale?: unknown }).locale;
    if (v === "en") return "en";
  }
  return "zh-Hant";
}

const EN: Record<string, string> = {
  "admin.only": "Admins only",
  "member.verifyEmailFirst": "Verify your email in the inbox before using member features.",
  "topup.needId": "Enter member email or UID.",
  "topup.emailNotFound": "No member account found for this email.",
  "avail.badDateKey": "dateKey must be YYYY-MM-DD",
  "avail.invalidDate": "Invalid date",
  "avail.beyondWindow": "Availability is only through the Sunday of next calendar week",
  "avail.weekdaysOnly": "Only Monday–Friday can be queried",
  "booking.pickPayment": "Select a payment method",
  "booking.memberNeedLogin": "Member payment requires sign-in",
  "booking.nameRequired": "Enter your name (max 80 characters)",
  "booking.noteTooLong": "Notes are too long",
  "booking.badDateFormat": "Invalid date format",
  "slot.invalid_dateKey": "Invalid date",
  "slot.past_date": "Cannot book dates in the past",
  "slot.past_slot": "That start time has passed — pick a later slot",
  "slot.beyond_booking_window": "Bookings only through the Sunday of next week.",
  "slot.not_weekday": "Only Monday–Friday",
  "slot.invalid_slot": "Start time is outside bookable hours",
  "slot.ends_after_1800": "This start would end after the 18:00 limit",
  "slot.generic": "Cannot complete booking",
  "booking.blockedPrefix": "This slot is closed: ",
  "booking.blockedGeneric": "This slot is closed for booking",
  "booking.dayFull": "This day is full (max {{max}} bookings)",
  "booking.weekFull": "This work week is full (max {{max}} bookings)",
  "booking.slotTaken": "This slot is already booked",
  "booking.walletShort": "Insufficient wallet — switch to cash or top up first",
  "booking.sessionShort": "Not enough prepaid sessions — use cash, drink option, or top up sessions first",
  "topup.sessionsPositive": "Top-up session count must be a positive integer",
  "redeem.pointsShort": "Not enough points to redeem yet",
  "booking.createFailed": "Booking failed — try again later",
  "auth.needLogin": "Please sign in",
  "topup.amountPositive": "Top-up amount must be a positive integer",
  "member.emailRequired": "Email is required",
  "member.passwordMin": "Password must be at least 6 characters",
  "member.createExists": "Could not create member — email may already exist",
  "admin.customerIdRequired": "customerId is required (member UID or email)",
  "booking.idRequired": "bookingId is required",
  "booking.notFound": "Booking not found",
  "booking.alreadyDone": "This booking is already completed",
  "booking.badStateComplete": "Current status cannot be completed",
  "cancel.notYours": "You can only cancel your own booking, or you must be an admin",
  "cancel.alreadyCancelled": "This booking is already cancelled",
  "cancel.deleted": "This booking is deleted",
  "cancel.doneNoDirect": "Completed bookings cannot be cancelled this way",
  "wheel.noPrizes": "No wheel prizes are available",
  "wheel.noChances": "Not enough spin chances",
  "support.needLoginOrGuest": "Sign in or start guest chat to message support",
  "support.noThread": "No conversation history yet",
  "support.needMessage": "Enter a message",
  "support.messageTooLong": "Message is too long (max {{max}} characters)",
  "support.threadClosed": "This chat is closed — tap “Resume chat” first",
  "support.needCustomerId": "customerId is missing",
  "support.needReply": "Enter a reply",
  "support.threadMissing": "Conversation not found",
  "testStatusEmail.guest": "Guest bookings do not receive member status emails.",
  "testStatusEmail.noCustomer": "This booking has no linked member (customerId).",
  "testStatusEmail.noMemberEmail": "The member account has no email in Firebase Auth.",
  "testStatusEmail.noResendKey": "RESEND_API_KEY is not configured for this project.",
};

function applyVars(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s;
  return s.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const v = vars[name];
    return v !== undefined && v !== null ? String(v) : "";
  });
}

export function st(
  locale: ServerLocale,
  key: string,
  zh: string,
  vars?: Record<string, string | number>,
): string {
  const raw = locale === "en" ? (EN[key] ?? zh) : zh;
  return applyVars(raw, vars);
}
