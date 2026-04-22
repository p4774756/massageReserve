/** 與 Cloud Functions `bookingLogic.allStartSlots` 保持一致 */
export function allStartSlots(): string[] {
  const slots: string[] = [];
  const endMinutes = 17 * 60 + 30;
  const lunchStartMinutes = 11 * 60 + 45;
  const lunchEndMinutes = 13 * 60 + 15;
  const slotStepMinutes = 15;
  const bookingDurationMinutes = 30;
  for (let m = 8 * 60; m <= endMinutes; m += slotStepMinutes) {
    const slotEnd = m + bookingDurationMinutes;
    const overlapsLunch = m < lunchEndMinutes && slotEnd > lunchStartMinutes;
    if (overlapsLunch) continue;
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return slots;
}
