import {
  addCustomerAdminNoteAdminCall,
  getCustomerAdminProfileAdminCall,
  setCustomerAdminBriefAdminCall,
  updateMemberNicknameAdminCall,
} from "./firebase";
import type { Booking } from "./bookingTypes";
import { el } from "./domUtil";
import { intlLocaleTag, localeApiParam, t } from "./i18n";

const ADMIN_BRIEF_MAX = 300;
const ADMIN_NOTE_MAX = 2000;

export type AdminCustomerNoteRow = {
  id: string;
  text: string;
  category: string;
  createdAt: number | null;
  createdBy: string;
};

export type AdminCustomerProfileLoaded = {
  customerId: string;
  email: string | null;
  nickname: string;
  adminBrief: string;
  notes: AdminCustomerNoteRow[];
};

function noteCategoryLabel(cat: string): string {
  switch (cat) {
    case "health":
      return t("admin.customerProfile.catHealth", "健康／禁忌");
    case "preference":
      return t("admin.customerProfile.catPreference", "偏好");
    case "incident":
      return t("admin.customerProfile.catIncident", "事件");
    default:
      return t("admin.customerProfile.catGeneral", "一般");
  }
}

function formatNoteWhen(seconds: number | null): string {
  if (seconds == null) return "";
  try {
    return new Intl.DateTimeFormat(intlLocaleTag(), {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(seconds * 1000));
  } catch {
    return "";
  }
}

export function collectMemberCustomerIdsFromBookings(bookings: Booking[]): string[] {
  const ids = new Set<string>();
  for (const b of bookings) {
    const cid = typeof b.customerId === "string" ? b.customerId.trim() : "";
    if (cid) ids.add(cid);
  }
  return [...ids];
}

export function createAdminBookingBriefCell(
  customerId: string | null | undefined,
  briefText: string | undefined,
  onEditProfile: (uid: string) => void,
): HTMLElement {
  const cid = typeof customerId === "string" ? customerId.trim() : "";
  const td = el("td", { class: "admin-booking-brief-cell" });
  if (!cid) {
    td.textContent = t("admin.customerProfile.briefGuest", "—");
    td.classList.add("hint");
    return td;
  }
  td.setAttribute("data-admin-brief-for", cid);

  const brief = (briefText ?? "").trim();
  const wrap = el("div", { class: "admin-booking-brief-cell__inner" });
  const textEl = el("span", { class: "admin-booking-brief-cell__text" });
  if (brief) {
    textEl.textContent = brief;
    textEl.title = brief;
  } else {
    textEl.textContent = t("admin.customerProfile.briefEmpty", "（尚無客戶摘要）");
    textEl.classList.add("hint");
  }
  const editBtn = el("button", { type: "button", class: "ghost admin-booking-brief-cell__edit" }, [
    t("admin.customerProfile.briefEdit", "備註"),
  ]);
  editBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onEditProfile(cid);
  });
  wrap.append(textEl, editBtn);
  td.append(wrap);
  return td;
}

export function applyAdminBriefsToBookingTable(
  tableRoot: HTMLElement,
  briefs: Record<string, string>,
): void {
  for (const td of tableRoot.querySelectorAll<HTMLElement>("[data-admin-brief-for]")) {
    const cid = td.getAttribute("data-admin-brief-for") ?? "";
    const brief = (briefs[cid] ?? "").trim();
    const textEl = td.querySelector(".admin-booking-brief-cell__text");
    if (!textEl) continue;
    textEl.classList.remove("hint");
    if (brief) {
      textEl.textContent = brief;
      (textEl as HTMLElement).title = brief;
    } else {
      textEl.textContent = t("admin.customerProfile.briefEmpty", "（尚無客戶摘要）");
      textEl.classList.add("hint");
      (textEl as HTMLElement).removeAttribute("title");
    }
  }
}

export type OpenAdminCustomerProfileOpts = {
  customerId: string;
  email?: string | null;
  onSaved?: () => void;
};

export function openAdminCustomerProfileModal(opts: OpenAdminCustomerProfileOpts): void {
  const overlay = el("div", { class: "modal-overlay" });
  const dialog = el("div", { class: "modal-card admin-customer-profile-modal" });
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  const titleId = "admin-customer-profile-title";
  dialog.setAttribute("aria-labelledby", titleId);

  const heading = el("h3", { id: titleId }, [t("admin.customerProfile.title", "會員客戶檔案")]);
  const whoLine = el("p", { class: "hint admin-customer-profile-who" }, [opts.customerId]);
  const statusLine = el("div", { class: "status-line" });

  const nickInput = el("input", {
    type: "text",
    maxLength: 80,
    class: "admin-member-nick-input",
    autocomplete: "off",
  });
  const briefInput = el("textarea", {
    class: "admin-customer-profile-brief",
    rows: 4,
    maxLength: ADMIN_BRIEF_MAX,
  });
  briefInput.setAttribute(
    "placeholder",
    t(
      "admin.customerProfile.briefPlaceholder",
      "長期注意事項（過敏、禁忌、固定偏好等），預約列表會顯示此摘要。",
    ),
  );

  const noteCategorySelect = el("select", { class: "admin-customer-profile-note-cat" });
  for (const [val, label] of [
    ["general", noteCategoryLabel("general")],
    ["health", noteCategoryLabel("health")],
    ["preference", noteCategoryLabel("preference")],
    ["incident", noteCategoryLabel("incident")],
  ] as const) {
    noteCategorySelect.append(el("option", { value: val }, [label]));
  }
  const noteInput = el("textarea", {
    class: "admin-customer-profile-note-input",
    rows: 3,
    maxLength: ADMIN_NOTE_MAX,
  });
  noteInput.setAttribute("placeholder", t("admin.customerProfile.notePlaceholder", "新增一筆情況紀錄…"));
  const addNoteBtn = el("button", { type: "button", class: "ghost" }, [
    t("admin.customerProfile.addNote", "新增筆記"),
  ]);
  const notesList = el("div", { class: "admin-customer-profile-notes" });

  const cancelBtn = el("button", { class: "ghost", type: "button" }, [t("modal.cancel", "取消")]);
  const saveBtn = el("button", { class: "primary", type: "button" }, [
    t("admin.customerProfile.save", "儲存摘要與稱呼"),
  ]);
  const actions = el("div", { class: "modal-actions" }, [cancelBtn, saveBtn]);

  const dismiss = () => {
    document.removeEventListener("keydown", onKeyDown);
    overlay.remove();
  };
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      dismiss();
    }
  };

  cancelBtn.addEventListener("click", () => dismiss());
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) dismiss();
  });
  document.addEventListener("keydown", onKeyDown);

  function paintNotes(notes: AdminCustomerNoteRow[]) {
    notesList.replaceChildren();
    if (notes.length === 0) {
      notesList.append(
        el("p", { class: "hint" }, [t("admin.customerProfile.notesEmpty", "尚無筆記。")]),
      );
      return;
    }
    for (const n of notes) {
      const meta = el("div", { class: "admin-customer-profile-note-meta" }, [
        `${noteCategoryLabel(n.category)} · ${formatNoteWhen(n.createdAt)}`,
      ]);
      const body = el("p", { class: "admin-customer-profile-note-text" }, [n.text]);
      notesList.append(el("article", { class: "admin-customer-profile-note" }, [meta, body]));
    }
  }

  async function loadProfile() {
    statusLine.textContent = t("admin.customerProfile.loading", "載入中…");
    statusLine.className = "status-line";
    try {
      const fn = getCustomerAdminProfileAdminCall();
      const res = await fn({ customerId: opts.customerId, ...localeApiParam() });
      const data = res.data as AdminCustomerProfileLoaded;
      const email = data.email ?? opts.email ?? null;
      whoLine.textContent = email ? `${email} · ${data.customerId}` : data.customerId;
      nickInput.value = data.nickname ?? "";
      briefInput.value = data.adminBrief ?? "";
      paintNotes(Array.isArray(data.notes) ? data.notes : []);
      statusLine.textContent = "";
    } catch (e) {
      statusLine.textContent = e instanceof Error ? e.message : t("admin.customerProfile.loadFail", "載入失敗");
      statusLine.classList.add("error");
    }
  }

  addNoteBtn.addEventListener("click", async () => {
    const text = noteInput.value.trim();
    if (!text) {
      statusLine.textContent = t("admin.customerProfile.noteEmpty", "請輸入筆記內容。");
      statusLine.classList.add("error");
      return;
    }
    statusLine.textContent = "";
    statusLine.className = "status-line";
    addNoteBtn.setAttribute("disabled", "true");
    try {
      const fn = addCustomerAdminNoteAdminCall();
      await fn({
        customerId: opts.customerId,
        text,
        category: noteCategorySelect.value,
        ...localeApiParam(),
      });
      noteInput.value = "";
      await loadProfile();
      opts.onSaved?.();
    } catch (e) {
      statusLine.textContent = e instanceof Error ? e.message : t("admin.customerProfile.noteFail", "新增筆記失敗");
      statusLine.classList.add("error");
    } finally {
      addNoteBtn.removeAttribute("disabled");
    }
  });

  saveBtn.addEventListener("click", async () => {
    statusLine.textContent = "";
    statusLine.className = "status-line";
    saveBtn.setAttribute("disabled", "true");
    cancelBtn.setAttribute("disabled", "true");
    try {
      const nickFn = updateMemberNicknameAdminCall();
      await nickFn({
        customerId: opts.customerId,
        nickname: nickInput.value,
        ...localeApiParam(),
      });
      const briefFn = setCustomerAdminBriefAdminCall();
      await briefFn({
        customerId: opts.customerId,
        adminBrief: briefInput.value,
        ...localeApiParam(),
      });
      statusLine.textContent = t("admin.customerProfile.saved", "已儲存。");
      statusLine.classList.add("ok");
      opts.onSaved?.();
      dismiss();
    } catch (e) {
      statusLine.textContent = e instanceof Error ? e.message : t("admin.customerProfile.saveFail", "儲存失敗");
      statusLine.classList.add("error");
    } finally {
      saveBtn.removeAttribute("disabled");
      cancelBtn.removeAttribute("disabled");
    }
  });

  dialog.append(
    heading,
    whoLine,
    el("label", { class: "field" }, [t("admin.memberList.nickFieldLabel", "稱呼"), nickInput]),
    el("label", { class: "field" }, [t("admin.customerProfile.briefLabel", "客戶摘要（內部）"), briefInput]),
    el("p", { class: "hint admin-customer-profile-brief-hint" }, [
      t("admin.customerProfile.briefHint", "最多 {{max}} 字；會顯示在後台預約列表，會員看不到。", {
        max: ADMIN_BRIEF_MAX,
      }),
    ]),
    el("h4", { class: "admin-customer-profile-notes-heading" }, [
      t("admin.customerProfile.notesHeading", "情況筆記"),
    ]),
    notesList,
    el("div", { class: "admin-customer-profile-add-note" }, [
      el("label", { class: "field" }, [t("admin.customerProfile.noteCatLabel", "類別"), noteCategorySelect]),
      el("label", { class: "field" }, [t("admin.customerProfile.noteFieldLabel", "內容"), noteInput]),
      addNoteBtn,
    ]),
    statusLine,
    actions,
  );
  overlay.append(dialog);
  document.body.append(overlay);
  void loadProfile();
  nickInput.focus();
}
