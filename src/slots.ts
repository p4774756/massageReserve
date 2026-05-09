/** 與 Cloud Functions `bookingLogic` 保持一致（開始時間間隔／時段長度與後端相同） */
const LUNCH_START_MINUTES = 11 * 60 + 45;
const LUNCH_END_MINUTES = 13 * 60 + 15;
const BOOKING_DURATION_MINUTES = 15;
const SERVICE_DAY_END_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;
const HOLIDAY_OUTCALL_SLOT_STEP_MINUTES = 30;

function buildStartSlots(slotStepMinutes: number): string[] {
  const slots: string[] = [];
  const endMinutes = SERVICE_DAY_END_MINUTES - BOOKING_DURATION_MINUTES;
  for (let m = 8 * 60; m <= endMinutes; m += slotStepMinutes) {
    const slotEnd = m + BOOKING_DURATION_MINUTES;
    const overlapsLunch = m < LUNCH_END_MINUTES && slotEnd > LUNCH_START_MINUTES;
    if (overlapsLunch) continue;
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return slots;
}

/** 平日辦公室：每 15 分鐘一格（與 `bookingLogic.allStartSlots` 一致） */
export function allStartSlots(): string[] {
  return buildStartSlots(SLOT_STEP_MINUTES);
}

/** 假日外約：每 30 分鐘一格（與 `bookingLogic.allHolidayOutcallStartSlots` 一致） */
export function allHolidayOutcallStartSlots(): string[] {
  return buildStartSlots(HOLIDAY_OUTCALL_SLOT_STEP_MINUTES);
}
