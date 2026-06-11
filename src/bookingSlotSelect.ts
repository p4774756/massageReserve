import { allHolidayOutcallStartSlots, allStartSlots, slotBlockedByLunch } from "./slots";
import { isStartSlotInPastForTaipeiToday } from "./taipeiDates";
import { el } from "./domUtil";
import { t } from "./i18n";

export function blockNoteForSlot(blockReason: string | undefined, blockedHere: boolean): string {
  if (!blockedHere || blockReason === undefined) return "";
  return blockReason.trim()
    ? t("slot.blockedReason", "（{{reason}}）", { reason: blockReason.trim() })
    : t("slot.blocked", "（不開放預約）");
}

export function lunchNoteForSlot(lunchHere: boolean): string {
  return lunchHere ? t("slot.lunch", "（午休）") : "";
}

export function takenNoteForSlot(takenHere: boolean): string {
  return takenHere ? t("slot.taken", "（已佔用）") : "";
}

function unavailableSuffixForSlot(opts: {
  takenHere: boolean;
  pastHere: boolean;
  blockedHere: boolean;
  lunchHere: boolean;
  blockReason: string | undefined;
}): string {
  const { takenHere, pastHere, blockedHere, lunchHere, blockReason } = opts;
  if (blockedHere) return blockNoteForSlot(blockReason, true);
  if (takenHere && lunchHere) return lunchNoteForSlot(true);
  if (takenHere) return takenNoteForSlot(true);
  if (pastHere) return t("slot.past", "（已過）");
  return "";
}

export type RefillSlotsContext = {
  slotSelect: HTMLSelectElement;
};

export function refillSlots(
  ctx: RefillSlotsContext,
  taken: Set<string>,
  disabled: boolean,
  selectedDateKey: string,
  blockedReasonBySlot: Map<string, string> = new Map(),
  holidayOutcall = false,
  durationMinutes = 15,
): void {
  const { slotSelect } = ctx;
  const prev = slotSelect.value;
  slotSelect.innerHTML = "";
  slotSelect.disabled = disabled;
  const opt0 = el("option", { value: "" }, [t("slot.optionPick", "請選擇開始時間")]);
  slotSelect.append(opt0);
  const slots = holidayOutcall ? allHolidayOutcallStartSlots() : allStartSlots();
  for (let i = 0; i < slots.length; ) {
    const s = slots[i]!;
    const takenHere = taken.has(s);
    const pastHere = isStartSlotInPastForTaipeiToday(selectedDateKey, s);
    const blockReason = blockedReasonBySlot.get(s);
    const blockedHere = blockReason !== undefined;
    const lunchHere = !blockedHere && !holidayOutcall && slotBlockedByLunch(s, durationMinutes);

    /** 連續「已過」且未被佔用的格子合併成一列，避免下拉清單過長（與不開放區間合併同理） */
    const mergeablePast = pastHere && !takenHere && !blockedHere;
    if (mergeablePast) {
      let j = i;
      while (j + 1 < slots.length) {
        const s2 = slots[j + 1]!;
        if (taken.has(s2) || blockedReasonBySlot.has(s2)) break;
        if (!isStartSlotInPastForTaipeiToday(selectedDateKey, s2)) break;
        j++;
      }
      if (j > i) {
        const rangeTimes = t("slot.pastRangeTimes", "{{from}}–{{to}}", { from: s, to: slots[j]! });
        const pastNote = t("slot.past", "（已過）");
        slotSelect.append(el("option", { value: "", disabled: true }, [`${rangeTimes}${pastNote}`]));
        i = j + 1;
        continue;
      }
    }

    /** 不開放時段（含後台事由）優先於「已佔用」顯示 */
    const mergeableBlocked = blockedHere && !pastHere;
    if (mergeableBlocked) {
      const reason0 = blockReason as string;
      let j = i;
      while (j + 1 < slots.length) {
        const s2 = slots[j + 1]!;
        if (isStartSlotInPastForTaipeiToday(selectedDateKey, s2)) break;
        const r2 = blockedReasonBySlot.get(s2);
        if (r2 === undefined || r2 !== reason0) break;
        j++;
      }
      if (j > i) {
        const blockNote = blockNoteForSlot(reason0, true);
        const timePart = t("slot.blockedRangeTimes", "{{from}}–{{to}}", { from: s, to: slots[j]! });
        slotSelect.append(
          el("option", { value: "", disabled: true }, [`${timePart}${blockNote}`]),
        );
        i = j + 1;
        continue;
      }
    }

    /** 午休區間（後端標為 unavailable，前端改顯示「午休」） */
    const mergeableLunch = lunchHere && takenHere && !pastHere;
    if (mergeableLunch) {
      let j = i;
      while (j + 1 < slots.length) {
        const s2 = slots[j + 1]!;
        if (!taken.has(s2)) break;
        if (blockedReasonBySlot.has(s2)) break;
        if (isStartSlotInPastForTaipeiToday(selectedDateKey, s2)) break;
        if (!slotBlockedByLunch(s2, durationMinutes)) break;
        j++;
      }
      if (j > i) {
        const timePart = t("slot.lunchRangeTimes", "{{from}}–{{to}}", { from: s, to: slots[j]! });
        const lunchNote = lunchNoteForSlot(true);
        slotSelect.append(el("option", { value: "", disabled: true }, [`${timePart}${lunchNote}`]));
        i = j + 1;
        continue;
      }
    }

    /** 連續「已佔用」（預約衝突）合併成一列 */
    const mergeableTaken = takenHere && !blockedHere && !lunchHere && !pastHere;
    if (mergeableTaken) {
      let j = i;
      while (j + 1 < slots.length) {
        const s2 = slots[j + 1]!;
        if (!taken.has(s2)) break;
        if (blockedReasonBySlot.has(s2)) break;
        if (slotBlockedByLunch(s2, durationMinutes)) break;
        j++;
      }
      if (j > i) {
        const timePart = t("slot.takenRangeTimes", "{{from}}–{{to}}", { from: s, to: slots[j]! });
        const takenNote = takenNoteForSlot(true);
        slotSelect.append(el("option", { value: "", disabled: true }, [`${timePart}${takenNote}`]));
        i = j + 1;
        continue;
      }
    }

    const suffix = unavailableSuffixForSlot({
      takenHere,
      pastHere,
      blockedHere,
      lunchHere,
      blockReason,
    });
    const o = el("option", { value: s, disabled: takenHere || pastHere || blockedHere }, [
      `${s}${suffix}`,
    ]);
    slotSelect.append(o);
    i++;
  }
  if (disabled) {
    /** 全日／全週額滿等會整個停用選單；勿沿用他日選過的時段，否則付款區仍會顯示 */
    slotSelect.value = "";
  } else if (prev) {
    const keep = [...slotSelect.options].some((o) => o.value === prev && !o.disabled);
    if (!keep) slotSelect.value = "";
    else slotSelect.value = prev;
  }
}
