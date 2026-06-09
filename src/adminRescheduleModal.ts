import type { Booking } from "./bookingTypes";
import { formatWhen } from "./bookingDisplay";
import { refillSlots } from "./bookingSlotSelect";
import { el } from "./domUtil";
import { getAvailabilityCall } from "./firebase";
import { errorMessage } from "./errorUtil";
import { localeApiParam, t } from "./i18n";
import { taipeiLatestBookableDateKey, taipeiTodayDateKey } from "./taipeiDates";

export type AdminRescheduleResult = {
  dateKey: string;
  startSlot: string;
  emailNote: string;
};

export function showAdminRescheduleBookingModal(b: Booking): Promise<AdminRescheduleResult | null> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card admin-reschedule-modal" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "admin-reschedule-modal-title");

    const heading = el("h3", { id: "admin-reschedule-modal-title" }, [
      t("admin.reschedule.title", "改預約時間"),
    ]);
    const intro = t(
      "admin.reschedule.intro",
      "選擇新的日期與開始時間。會員預約完成後將寄出時間調整通知信（可選填附言）。",
    );
    const summaryLines = [
      intro,
      "",
      `${t("booking.summary.name", "姓名")}：${b.displayName ?? ""}`,
      `${t("admin.reschedule.currentWhen", "目前時間")}：${formatWhen(b)}`,
      `${t("booking.summary.note", "備註")}：${(b.note ?? "").trim() || t("admin.hidden.cancelSummaryNone", "（無）")}`,
    ].join("\n");
    const body = el("pre", { class: "modal-message" }, [summaryLines]);

    const dateInput = el("input", {
      type: "date",
      value: b.dateKey ?? "",
      min: taipeiTodayDateKey(),
      max: taipeiLatestBookableDateKey(),
    });
    dateInput.setAttribute("aria-label", t("admin.reschedule.dateLabel", "新日期"));
    const dateField = el("label", { class: "field" }, [
      t("admin.reschedule.dateLabel", "新日期"),
      dateInput,
    ]);

    const slotSelect = el("select", {});
    slotSelect.setAttribute("aria-label", t("admin.reschedule.slotLabel", "新開始時間"));
    const slotField = el("label", { class: "field" }, [
      t("admin.reschedule.slotLabel", "新開始時間"),
      slotSelect,
    ]);

    const slotStatus = el("p", { class: "hint admin-reschedule-slot-status" }, [
      t("booking.slotsLoading", "正在載入可預約時段…"),
    ]);

    const emailInput = el("textarea", {
      maxLength: 2000,
      rows: 4,
      placeholder: t(
        "admin.reschedule.emailPlaceholder",
        "會一併顯示在通知信中給會員（可不填）",
      ),
    });
    emailInput.setAttribute("aria-label", t("admin.reschedule.emailLabel", "信件附言（選填）"));
    const emailField = el("label", { class: "field modal-cancel-reason-field" }, [
      t("admin.reschedule.emailLabel", "信件附言（選填）"),
      emailInput,
    ]);

    const dismissBtn = el("button", { class: "ghost", type: "button" }, [t("modal.close", "關閉")]);
    const confirmBtn = el("button", { class: "primary", type: "button" }, [
      t("admin.reschedule.confirm", "確認改時間"),
    ]);
    confirmBtn.disabled = true;
    const actions = el("div", { class: "modal-actions" }, [dismissBtn, confirmBtn]);
    dialog.append(heading, body, dateField, slotField, slotStatus, emailField, actions);
    overlay.append(dialog);
    dialog.addEventListener("click", (ev) => {
      ev.stopPropagation();
    });

    let loadGen = 0;

    const syncConfirmEnabled = () => {
      confirmBtn.disabled = !dateInput.value || !slotSelect.value;
    };

    const loadSlots = async () => {
      const dk = dateInput.value.trim();
      const gen = ++loadGen;
      slotSelect.disabled = true;
      confirmBtn.disabled = true;
      slotStatus.textContent = t("booking.slotsLoading", "正在載入可預約時段…");
      slotStatus.className = "hint admin-reschedule-slot-status";
      if (!dk) {
        slotSelect.replaceChildren(el("option", { value: "" }, [t("slot.optionPick", "請選擇開始時間")]));
        slotStatus.textContent = t("admin.reschedule.pickDateFirst", "請先選擇日期");
        return;
      }
      try {
        const fn = getAvailabilityCall();
        const units = typeof b.units === "number" && b.units > 0 ? Math.trunc(b.units) : 1;
        const res = await fn({
          dateKey: dk,
          units,
          holidayOutcall: b.holidayOutcall === true,
          excludeBookingId: b.id,
          ...localeApiParam(),
        });
        if (gen !== loadGen) return;
        const data = res.data as {
          taken?: string[];
          blockedSlots?: { startSlot: string; reason?: string }[];
        };
        const taken = new Set(Array.isArray(data.taken) ? data.taken : []);
        const blockedMap = new Map<string, string>();
        for (const row of data.blockedSlots ?? []) {
          if (row && typeof row.startSlot === "string") {
            blockedMap.set(row.startSlot, typeof row.reason === "string" ? row.reason : "");
          }
        }
        refillSlots({ slotSelect }, taken, false, dk, blockedMap, b.holidayOutcall === true);
        slotSelect.disabled = false;
        if (dk === b.dateKey && b.startSlot) {
          const keep = [...slotSelect.options].some((o) => o.value === b.startSlot && !o.disabled);
          if (keep) slotSelect.value = b.startSlot;
        }
        const hasPick = [...slotSelect.options].some((o) => o.value && !o.disabled);
        slotStatus.textContent = hasPick
          ? t("admin.reschedule.slotsReady", "請選擇新的開始時間")
          : t("admin.reschedule.noSlots", "此日無可選時段，請改選其他日期");
        slotStatus.classList.toggle("error", !hasPick);
        syncConfirmEnabled();
      } catch (e) {
        if (gen !== loadGen) return;
        slotSelect.replaceChildren(el("option", { value: "" }, [t("slot.optionPick", "請選擇開始時間")]));
        slotSelect.disabled = true;
        slotStatus.textContent =
          e instanceof Error ? e.message : t("admin.reschedule.slotsLoadFail", "無法載入時段");
        slotStatus.classList.add("error");
        syncConfirmEnabled();
      }
    };

    dateInput.addEventListener("change", () => {
      void loadSlots();
    });
    slotSelect.addEventListener("change", syncConfirmEnabled);

    const finish = (result: AdminRescheduleResult | null) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(result);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(null);
      }
    };

    dismissBtn.addEventListener("click", () => finish(null));
    confirmBtn.addEventListener("click", () => {
      const dateKey = dateInput.value.trim();
      const startSlot = slotSelect.value.trim();
      if (!dateKey || !startSlot) return;
      if (dateKey === b.dateKey && startSlot === b.startSlot) {
        slotStatus.textContent = t("admin.reschedule.unchanged", "新時間與目前相同");
        slotStatus.classList.add("error");
        return;
      }
      finish({
        dateKey,
        startSlot,
        emailNote: emailInput.value.trim(),
      });
    });
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        finish(null);
      }
    });
    document.addEventListener("keydown", onKeyDown);

    document.body.append(overlay);
    void loadSlots();
    dateInput.focus();
  });
}

/** 後台改時間失敗訊息（Callable 錯誤） */
export function adminRescheduleErrorMessage(e: unknown): string {
  return errorMessage(e);
}
