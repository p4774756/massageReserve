/** 與 Cloud Functions `bookingLogic.allStartSlots` 保持一致 */
export function allStartSlots(): string[] {
  const slots: string[] = [];
  const endMinutes = 17 * 60 + 30;
  for (let m = 8 * 60; m <= endMinutes; m += 30) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  return slots;
}
