/** 與 Cloud Functions `bookingLogic` 保持一致（開始時間間隔與後端相同） */
const SERVICE_DAY_END_MINUTES = 17 * 60;
const SLOT_STEP_MINUTES = 15;
const HOLIDAY_OUTCALL_SLOT_STEP_MINUTES = 30;

function buildGridStartSlots(slotStepMinutes: number): string[] {
  const slots: string[] = [];
  const gridLast = SERVICE_DAY_END_MINUTES - SLOT_STEP_MINUTES;
  for (let m = 8 * 60; m <= gridLast; m += slotStepMinutes) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return slots;
}

/** 平日：每 15 分鐘一格（08:00–16:45） */
export function allStartSlots(): string[] {
  return buildGridStartSlots(SLOT_STEP_MINUTES);
}

/** 假日外約：每 30 分鐘一格 */
export function allHolidayOutcallStartSlots(): string[] {
  return buildGridStartSlots(HOLIDAY_OUTCALL_SLOT_STEP_MINUTES);
}

function minutesFromHHmm(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function hhmmFromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const min = total % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function endSlotFromStartAndDuration(startSlot: string, durationMinutes: number): string {
  const start = minutesFromHHmm(startSlot);
  if (start === null) return startSlot;
  return hhmmFromMinutes(start + durationMinutes);
}
