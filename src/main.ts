import "./style.css";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  doc,
} from "firebase/firestore";
import {
  cancelBookingCall,
  completeBookingCall,
  createBookingCall,
  createMemberAccountCall,
  getAvailabilityCall,
  getAdminStatusCall,
  getDb,
  getFirebaseAuth,
  getMyWalletCall,
  isFirebaseConfigured,
  searchMemberUsersCall,
  spinWheelCall,
  topupWalletCall,
} from "./firebase";
import { allStartSlots } from "./slots";
import { createLedMarquee, type LedMarqueeHandle } from "./ledMarquee";

type Booking = {
  id: string;
  displayName: string;
  note: string;
  dateKey: string;
  startSlot: string;
  status: string;
  startAt?: { seconds: number };
};

type BookingMode = "guest_cash" | "member_cash" | "member_wallet";

const BOOKING_MODE_LABEL: Record<BookingMode, string> = {
  guest_cash: "訪客現金",
  member_cash: "會員現金",
  member_wallet: "會員儲值",
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "待確認" },
  { value: "confirmed", label: "已確認" },
  { value: "done", label: "已完成" },
  { value: "cancelled", label: "已取消" },
  { value: "deleted", label: "已刪除" },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  for (const [k, v] of Object.entries(props)) {
    if (k === "class" || v === undefined) continue;
      Reflect.set(node, k, v);
  }
  for (const c of children) node.append(typeof c === "string" ? document.createTextNode(c) : c);
  return node;
}

function errorMessage(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  return "發生錯誤";
}

function isDateKeyMonFri(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map((x) => Number(x));
  if (!y || !m || !d) return false;
  const dow = new Date(y, m - 1, d).getDay();
  return dow >= 1 && dow <= 5;
}

function formatWhen(b: Booking): string {
  const base = `${b.dateKey} ${b.startSlot}`;
  if (!b.startAt?.seconds) return base;
  const d = new Date(b.startAt.seconds * 1000);
  return `${base}（${d.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}）`;
}

function buildBookingSummary(
  displayName: string,
  dateKey: string,
  startSlot: string,
  note: string,
  bookingMode: BookingMode,
): string {
  const noteSummary = note || "（未填寫）";
  return [
    "請確認以下預約資訊：",
    `姓名：${displayName}`,
    `日期：${dateKey}`,
    `開始時間：${startSlot}`,
    `付款方式：${BOOKING_MODE_LABEL[bookingMode]}`,
    `備註：${noteSummary}`,
    "",
    "確認無誤後按「確定」送出。",
  ].join("\n");
}

function showConfirmModal(title: string, message: string, confirmText = "確定"): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "confirm-modal-title");
    const heading = el("h3", { id: "confirm-modal-title" }, [title]);
    const body = el("pre", { class: "modal-message" }, [message]);
    const cancelBtn = el("button", { class: "ghost", type: "button" }, ["取消"]);
    const confirmBtn = el("button", { class: "primary", type: "button" }, [confirmText]);
    const actions = el("div", { class: "modal-actions" }, [cancelBtn, confirmBtn]);
    dialog.append(heading, body, actions);
    overlay.append(dialog);

    const close = (ok: boolean) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(ok);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close(false);
      }
    };

    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        close(false);
      }
    });
    document.addEventListener("keydown", onKeyDown);

    document.body.append(overlay);
    confirmBtn.focus();
  });
}

function render() {
  const root = document.querySelector<HTMLDivElement>("#app")!;
  root.innerHTML = "";

  if (!isFirebaseConfigured()) {
    root.append(
      el("div", { class: "banner" }, [
        "尚未設定 Firebase：請複製 `.env.example` 為 `.env`，填入專案設定後執行 `npm run dev`。",
      ]),
    );
    return;
  }

  const auth = getFirebaseAuth();
  const db = getDb();

  let tab: "book" | "admin" = "book";

  const titleHeading = el("h1", {}, ["辦公室按摩預約"]);
  const titleDesc = el("p", {}, ["週一至週五 · 以 30 分鐘估算 · 午休 11:45–13:15 不開放 · 最晚 17:30 開始、18:00 前結束"]);
  const titleBlock = el("div", {}, [titleHeading, titleDesc]);

  const memberEntryBtn = el("button", { class: "ghost member-entry", type: "button" }, ["會員登入"]);
  const headActions = el("div", { class: "head-actions" }, [memberEntryBtn]);

  const panelBook = el("main", { class: "panel" });
  const panelAdmin = el("main", { class: "panel", hidden: true });

  const shell = el("div", { class: "shell" }, [
    el("header", { class: "page-head" }, [titleBlock, headActions]),
    panelBook,
    panelAdmin,
  ]);

  root.append(shell);

  const announcementBox = el("div", { class: "marquee marquee-led", hidden: true });
  const ledHost = el("div", { class: "marquee-led-host" });
  announcementBox.append(ledHost);
  let ledMarquee: LedMarqueeHandle | null = null;

  function disposeLedMarquee() {
    ledMarquee?.destroy();
    ledMarquee = null;
  }

  onSnapshot(
    doc(db, "siteSettings", "announcement"),
    (snap) => {
      if (tab !== "book") {
        announcementBox.hidden = true;
        return;
      }
      const data = snap.data() as { text?: unknown; enabled?: unknown } | undefined;
      const text = typeof data?.text === "string" ? data.text.trim() : "";
      const enabled = typeof data?.enabled === "boolean" ? data.enabled : false;
      if (!enabled || !text) {
        announcementBox.hidden = true;
        disposeLedMarquee();
        return;
      }
      announcementBox.hidden = false;
      if (!ledMarquee) {
        ledMarquee = createLedMarquee(ledHost);
      }
      ledMarquee.setText(`${text}     ·     ${text}`);
    },
    () => {
      announcementBox.hidden = true;
      disposeLedMarquee();
    },
  );
  shell.prepend(announcementBox);

  /** --- 預約表單 --- */
  const nameInput = el("input", { type: "text", autocomplete: "name", maxLength: 80 });
  const dateInput = el("input", { type: "date" });
  const slotSelect = el("select", {}, []);
  const noteInput = el("textarea", { maxLength: 500 });
  const bookingModeSelect = el("select", {}, []);
  const bookingModeHint = el("span", { class: "hint" }, [
    "訪客預約以現金 50 元結帳；儲值與抽獎請使用右上角登入。",
  ]);
  const submitBtn = el("button", { class: "primary", type: "button" }, ["送出預約"]);
  const bookStatus = el("div", { class: "status-line" });
  const meta = el("div", { class: "meta-pills" });
  const walletStatus = el("div", { class: "status-line" });
  const wheelStatus = el("div", { class: "status-line" });
  const wheelResult = el("div", { class: "pill", hidden: true });
  const spinBtn = el("button", { class: "ghost", type: "button" }, ["抽輪盤"]);
  /** 僅登入後顯示：餘額／抽輪盤（訪客預約不需此區） */
  const memberExtrasWrap = el("div", { class: "book-member-extras", hidden: true });
  let walletBalance = 0;
  let drawChances = 0;

  function updateMemberEntryLabel() {
    const user = auth.currentUser;
    memberEntryBtn.textContent = user ? "會員中心" : "會員登入";
  }

  function openMemberAuthModal() {
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card member-modal" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const user = auth.currentUser;

    const status = el("div", { class: "status-line" });
    if (!user) {
      const email = el("input", { type: "email", autocomplete: "username", placeholder: "會員 Email" });
      const password = el("input", {
        type: "password",
        autocomplete: "current-password",
        placeholder: "會員密碼",
      });
      const loginBtn = el("button", { class: "primary", type: "button" }, ["登入"]);
      const cancelBtn = el("button", { class: "ghost", type: "button" }, ["關閉"]);
      loginBtn.addEventListener("click", async () => {
        status.textContent = "";
        status.className = "status-line";
        loginBtn.setAttribute("disabled", "true");
        try {
          await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
          overlay.remove();
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : "登入失敗";
          status.classList.add("error");
        } finally {
          loginBtn.removeAttribute("disabled");
        }
      });
      cancelBtn.addEventListener("click", () => overlay.remove());
      dialog.append(
        el("h3", {}, ["會員登入"]),
        el("label", { class: "field" }, ["Email", email]),
        el("label", { class: "field" }, ["密碼", password]),
        status,
        el("div", { class: "modal-actions" }, [cancelBtn, loginBtn]),
      );
    } else {
      const closeBtn = el("button", { class: "ghost", type: "button" }, ["關閉"]);
      const logoutBtn = el("button", { class: "primary", type: "button" }, ["登出"]);
      closeBtn.addEventListener("click", () => overlay.remove());
      logoutBtn.addEventListener("click", async () => {
        await signOut(auth);
        overlay.remove();
      });
      dialog.append(
        el("h3", {}, ["會員中心"]),
        el("div", { class: "hint" }, [`目前登入：${user.email ?? user.uid}`]),
        walletStatus.cloneNode(true),
        el("div", { class: "modal-actions" }, [closeBtn, logoutBtn]),
      );
    }

    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) overlay.remove();
    });
    overlay.append(dialog);
    document.body.append(overlay);
  }

  memberEntryBtn.addEventListener("click", openMemberAuthModal);
  function refillBookingModes(isMember: boolean) {
    const current = bookingModeSelect.value as BookingMode;
    bookingModeSelect.innerHTML = "";
    const modes: { value: BookingMode; label: string; disabled?: boolean }[] = isMember
      ? [
          { value: "member_wallet", label: "會員儲值（扣 50 元）" },
          { value: "member_cash", label: "會員現金（50 元）" },
        ]
      : [{ value: "guest_cash", label: "訪客現金（50 元）" }];
    for (const mode of modes) {
      const opt = el("option", { value: mode.value, disabled: mode.disabled }, [mode.label]);
      bookingModeSelect.append(opt);
    }
    const values = modes.map((m) => m.value);
    bookingModeSelect.value = values.includes(current) ? current : modes[0].value;
    bookingModeHint.textContent = isMember
      ? "可選儲值扣款或會員現金（均為 50 元）。"
      : "訪客預約以現金 50 元結帳；儲值與抽獎請使用右上角登入。";
  }

  async function refreshWalletStatus() {
    const user = auth.currentUser;
    refillBookingModes(Boolean(user));
    updateMemberEntryLabel();
    if (!user) {
      walletBalance = 0;
      drawChances = 0;
      memberExtrasWrap.hidden = true;
      walletStatus.textContent = "";
      walletStatus.className = "status-line";
      spinBtn.setAttribute("disabled", "true");
      wheelStatus.textContent = "";
      wheelStatus.className = "status-line";
      wheelResult.hidden = true;
      return;
    }
    memberExtrasWrap.hidden = false;
    walletStatus.textContent = "讀取會員餘額中…";
    walletStatus.className = "status-line";
    try {
      const fn = getMyWalletCall();
      const res = await fn();
      const data = res.data as { walletBalance: number; drawChances: number };
      walletBalance = typeof data.walletBalance === "number" ? data.walletBalance : 0;
      drawChances = typeof data.drawChances === "number" ? data.drawChances : 0;
      walletStatus.textContent = `會員已登入：儲值餘額 ${walletBalance} 元，可抽次數 ${drawChances}。`;
      walletStatus.className = "status-line ok";
      wheelStatus.textContent = drawChances > 0 ? "可抽輪盤，祝你好運！" : "目前無可抽次數。";
      wheelStatus.className = "status-line";
      if (drawChances > 0) spinBtn.removeAttribute("disabled");
      else spinBtn.setAttribute("disabled", "true");
    } catch (e) {
      walletBalance = 0;
      drawChances = 0;
      memberExtrasWrap.hidden = false;
      walletStatus.textContent = errorMessage(e);
      walletStatus.className = "status-line error";
      spinBtn.setAttribute("disabled", "true");
      wheelStatus.textContent = "無法讀取抽獎狀態。";
      wheelStatus.className = "status-line error";
    }
  }

  spinBtn.addEventListener("click", async () => {
    wheelStatus.textContent = "";
    wheelStatus.className = "status-line";
    if (!auth.currentUser) {
      wheelStatus.textContent = "請先登入會員。";
      wheelStatus.classList.add("error");
      return;
    }
    if (drawChances < 1) {
      wheelStatus.textContent = "目前沒有可抽次數。";
      wheelStatus.classList.add("error");
      return;
    }
    spinBtn.setAttribute("disabled", "true");
    wheelStatus.textContent = "抽獎中…";
    try {
      const fn = spinWheelCall();
      const res = await fn();
      const data = res.data as {
        prize: { name: string; type: string; value: number };
        drawChances: number;
        walletBalance: number;
      };
      wheelResult.textContent = `抽中：${data.prize.name}`;
      wheelResult.hidden = false;
      wheelStatus.textContent = "抽獎完成！";
      wheelStatus.classList.add("ok");
      await refreshWalletStatus();
    } catch (e) {
      wheelStatus.textContent = errorMessage(e);
      wheelStatus.classList.add("error");
      if (drawChances > 0) spinBtn.removeAttribute("disabled");
    }
  });

  function refillSlots(taken: Set<string>, disabled: boolean) {
    slotSelect.innerHTML = "";
    slotSelect.disabled = disabled;
    const opt0 = el("option", { value: "" }, ["請選擇開始時間"]);
    slotSelect.append(opt0);
    for (const s of allStartSlots()) {
      const takenHere = taken.has(s);
      const o = el("option", { value: s, disabled: takenHere }, [
        `${s}${takenHere ? "（已佔用）" : ""}`,
      ]);
      slotSelect.append(o);
    }
  }

  refillSlots(new Set(), true);

  async function refreshAvailability() {
    bookStatus.textContent = "";
    bookStatus.className = "status-line";
    meta.innerHTML = "";
    const dk = dateInput.value;
    if (!dk) {
      refillSlots(new Set(), true);
      meta.append(
        el("span", { class: "pill" }, ["先選擇日期後，會顯示可選時段與名額"]),
      );
      return;
    }

    if (!isDateKeyMonFri(dk)) {
      refillSlots(new Set(), true);
      bookStatus.textContent = "僅能預約週一到週五。";
      bookStatus.classList.add("error");
      return;
    }

    try {
      const fn = getAvailabilityCall();
      const res = await fn({ dateKey: dk });
      const data = res.data as {
        taken: string[];
        dayCount: number;
        weekCount: number;
        dayCap: number;
        weekCap: number;
      };
      const taken = new Set(data.taken);
      const dayFull = data.dayCount >= data.dayCap;
      const weekFull = data.weekCount >= data.weekCap;
      const blocked = dayFull || weekFull;

      refillSlots(taken, blocked);
      meta.append(
        el("span", { class: "pill" }, [
          "當日已預約 ",
          el("strong", {}, [String(data.dayCount)]),
          ` / ${data.dayCap}`,
        ]),
        el("span", { class: "pill" }, [
          "本工作週已預約 ",
          el("strong", {}, [String(data.weekCount)]),
          ` / ${data.weekCap}`,
        ]),
      );
      if (dayFull) {
        bookStatus.textContent = "這一天已額滿。";
        bookStatus.classList.add("error");
      } else if (weekFull) {
        bookStatus.textContent = "本工作週已達上限。";
        bookStatus.classList.add("error");
      }
    } catch (e) {
      console.error(e);
      refillSlots(new Set(), true);
      bookStatus.textContent = "無法載入空檔，請稍後再試。";
      bookStatus.classList.add("error");
    }
  }

  dateInput.addEventListener("change", refreshAvailability);

  submitBtn.addEventListener("click", async () => {
    bookStatus.textContent = "";
    bookStatus.className = "status-line";
    const displayName = nameInput.value.trim();
    const dateKey = dateInput.value;
    const startSlot = slotSelect.value;
    const note = noteInput.value.trim();
    const bookingMode = bookingModeSelect.value as BookingMode;
    if (!displayName) {
      bookStatus.textContent = "請填寫姓名。";
      bookStatus.classList.add("error");
      return;
    }
    if (!dateKey || !startSlot) {
      bookStatus.textContent = "請選擇日期與開始時間。";
      bookStatus.classList.add("error");
      return;
    }
    if (bookingMode !== "guest_cash" && !auth.currentUser) {
      bookStatus.textContent = "會員付款模式需先登入。";
      bookStatus.classList.add("error");
      return;
    }
    if (bookingMode === "member_wallet" && walletBalance < 50) {
      bookStatus.textContent = "儲值餘額不足，請改用現金或先儲值。";
      bookStatus.classList.add("error");
      return;
    }
    const confirmed = await showConfirmModal(
      "確認送出預約",
      buildBookingSummary(displayName, dateKey, startSlot, note, bookingMode),
      "確認送出",
    );
    if (!confirmed) {
      bookStatus.textContent = "已取消送出。";
      return;
    }
    submitBtn.setAttribute("disabled", "true");
    try {
      const fn = createBookingCall();
      await fn({ displayName, note, dateKey, startSlot, bookingMode });
      bookStatus.textContent = "已送出！狀態為「待確認」，實際時間會依現場情況微調。";
      bookStatus.classList.add("ok");
      nameInput.value = "";
      noteInput.value = "";
      await refreshAvailability();
      await refreshWalletStatus();
    } catch (e) {
      bookStatus.textContent = errorMessage(e);
      bookStatus.classList.add("error");
    } finally {
      submitBtn.removeAttribute("disabled");
    }
  });

  memberExtrasWrap.append(
    walletStatus,
    el("div", { class: "row-actions" }, [spinBtn, wheelResult]),
    wheelStatus,
  );

  panelBook.append(
    el("div", { class: "grid grid-2" }, [
      el("label", { class: "field" }, [
        "姓名",
        nameInput,
        el("span", { class: "hint" }, ["可不登入，打個暱稱即可"]),
      ]),
      el("label", { class: "field" }, [
        "日期（週一至週五）",
        dateInput,
        el("span", { class: "hint" }, ["請選擇你有空的上班日"]),
      ]),
    ]),
    el("div", { class: "grid" }, [
      el("label", { class: "field" }, [
        "開始時間（30 分鐘一格）",
        slotSelect,
        el("span", { class: "hint" }, ["系統以約 30 分鐘估算；實際長度依情況調整"]),
      ]),
    ]),
    el("div", { class: "grid" }, [
      el("label", { class: "field" }, [
        "付款方式",
        bookingModeSelect,
        bookingModeHint,
      ]),
    ]),
    memberExtrasWrap,
    meta,
    el("div", { class: "grid" }, [
      el("label", { class: "field" }, [
        "備註（選填）",
        noteInput,
        el("span", { class: "hint" }, ["可填寫需求，例如：頭痛、背部痠痛、腿部需要按壓等"]),
      ]),
    ]),
    el("div", { class: "row-actions" }, [submitBtn]),
    bookStatus,
    el("div", { class: "footer-note" }, [
      "規則：同一天最多兩位、同一工作週最多四筆；已取消的不計入名額。",
    ]),
  );

  /** --- 管理後台 --- */
  const adminWrap = el("div", {}, []);
  panelAdmin.append(adminWrap);

  let adminUnsub: (() => void) | null = null;
  let adminAnnouncementUnsub: (() => void) | null = null;

  function stopAdminListener() {
    if (adminUnsub) {
      adminUnsub();
      adminUnsub = null;
    }
    if (adminAnnouncementUnsub) {
      adminAnnouncementUnsub();
      adminAnnouncementUnsub = null;
    }
  }

  function renderAdminLoggedOut() {
    stopAdminListener();
    adminWrap.innerHTML = "";
    const box = el("div", { class: "admin-login" }, []);
    const email = el("input", { type: "email", autocomplete: "username" });
    const password = el("input", { type: "password", autocomplete: "current-password" });
    const loginBtn = el("button", { class: "primary", type: "button" }, ["登入"]);
    const adminStatus = el("div", { class: "status-line" });
    loginBtn.addEventListener("click", async () => {
      adminStatus.textContent = "";
      adminStatus.className = "status-line";
      loginBtn.setAttribute("disabled", "true");
      try {
        await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
      } catch (e) {
        adminStatus.textContent = e instanceof Error ? e.message : "登入失敗";
        adminStatus.classList.add("error");
      } finally {
        loginBtn.removeAttribute("disabled");
      }
    });
    box.append(
      el("p", { class: "hint" }, [
        "僅限管理員。請先在 Firebase Console 建立 Email/Password 帳號，並在 Firestore 新增文件 ",
        el("code", {}, ["admins/<你的 UID>"]),
        "（可用空物件 `{}`）。",
      ]),
      el("label", { class: "field" }, ["Email", email]),
      el("label", { class: "field" }, ["密碼", password]),
      loginBtn,
      adminStatus,
    );
    adminWrap.append(box);
  }

  function renderAdminForbidden() {
    stopAdminListener();
    adminWrap.innerHTML = "";
    adminWrap.append(
      el("div", { class: "admin-login" }, [
        el("p", { class: "status-line error" }, ["無權限：此帳號不是管理員。"]),
      ]),
    );
  }

  function renderAdminTable(userId: string) {
    stopAdminListener();
    adminWrap.innerHTML = "";
    const top = el("div", { class: "row-actions" }, []);
    const who = el("span", { class: "hint" }, [`已登入：${userId}`]);
    const outBtn = el("button", { class: "ghost", type: "button" }, ["登出"]);
    outBtn.addEventListener("click", () => signOut(auth));
    top.append(who, outBtn);

    const adminStatus = el("div", { class: "status-line" });
    const walletTopupSection = el("div", { class: "admin-announce" }, []);
    const accountCreateSection = el("div", { class: "admin-announce" }, []);
    const topupCustomerId = el("input", {
      type: "text",
      placeholder: "會員 Email（建議）或 UID",
      autocomplete: "off",
    });
    const topupSuggestions = el("ul", {
      class: "member-typeahead-list",
      hidden: true,
      role: "listbox",
    });
    const topupTypeaheadWrap = el("div", { class: "member-typeahead-wrap" });
    topupTypeaheadWrap.append(topupCustomerId, topupSuggestions);

    let topupSearchTimer: ReturnType<typeof setTimeout> | null = null;
    async function runTopupMemberSearch() {
      const q = topupCustomerId.value.trim();
      if (q.length < 2) {
        topupSuggestions.hidden = true;
        topupSuggestions.innerHTML = "";
        return;
      }
      try {
        const fn = searchMemberUsersCall();
        const res = await fn({ prefix: q });
        const users = (res.data as { users?: { uid: string; email: string }[] }).users ?? [];
        topupSuggestions.innerHTML = "";
        if (users.length === 0) {
          topupSuggestions.hidden = true;
          return;
        }
        for (const u of users) {
          const li = el("li", { class: "member-typeahead-item", role: "option" }, [u.email]);
          li.addEventListener("mousedown", (ev) => {
            ev.preventDefault();
            topupCustomerId.value = u.email;
            topupSuggestions.hidden = true;
            topupSuggestions.innerHTML = "";
          });
          topupSuggestions.append(li);
        }
        topupSuggestions.hidden = false;
      } catch {
        topupSuggestions.hidden = true;
      }
    }

    topupCustomerId.addEventListener("input", () => {
      const raw = topupCustomerId.value.trim();
      if (raw.length < 2) {
        topupSuggestions.hidden = true;
        topupSuggestions.innerHTML = "";
        return;
      }
      if (topupSearchTimer) clearTimeout(topupSearchTimer);
      topupSearchTimer = setTimeout(() => void runTopupMemberSearch(), 280);
    });
    topupCustomerId.addEventListener("focus", () => {
      void runTopupMemberSearch();
    });
    topupCustomerId.addEventListener("blur", () => {
      setTimeout(() => {
        topupSuggestions.hidden = true;
      }, 200);
    });
    const topupAmount = el("input", { type: "number", value: "100", min: "1", step: "1" });
    const topupNote = el("input", { type: "text", placeholder: "備註（選填）" });
    const topupBtn = el("button", { class: "ghost", type: "button" }, ["儲值"]);
    const topupStatus = el("div", { class: "status-line" });
    topupBtn.addEventListener("click", async () => {
      topupStatus.textContent = "";
      topupStatus.className = "status-line";
      const customerId = topupCustomerId.value.trim();
      const amount = Number(topupAmount.value);
      const note = topupNote.value.trim();
      if (!customerId) {
        topupStatus.textContent = "請輸入會員 Email 或 UID。";
        topupStatus.classList.add("error");
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
        topupStatus.textContent = "儲值金額需為正整數。";
        topupStatus.classList.add("error");
        return;
      }
      topupBtn.setAttribute("disabled", "true");
      topupStatus.textContent = "儲值中…";
      try {
        const fn = topupWalletCall();
        await fn({ customerId, amount, note });
        topupStatus.textContent = "儲值成功";
        topupStatus.classList.add("ok");
      } catch (e) {
        topupStatus.textContent = errorMessage(e);
        topupStatus.classList.add("error");
      } finally {
        topupBtn.removeAttribute("disabled");
      }
    });
    const announcementSection = el("div", { class: "admin-announce" }, []);
    const announcementEnabled = el("input", { type: "checkbox" });
    const announcementText = el("textarea", {
      maxLength: 240,
      placeholder: "輸入公告內容，例如：本週三 15:00-16:00 暫停服務",
    });
    const saveAnnouncementBtn = el("button", { class: "ghost", type: "button" }, ["儲存公告"]);
    const announcementStatus = el("div", { class: "status-line" });

    const announcementDocRef = doc(db, "siteSettings", "announcement");
    adminAnnouncementUnsub = onSnapshot(
      announcementDocRef,
      (snap) => {
        const data = snap.data() as { text?: unknown; enabled?: unknown } | undefined;
        announcementText.value = typeof data?.text === "string" ? data.text : "";
        announcementEnabled.checked = typeof data?.enabled === "boolean" ? data.enabled : false;
      },
      () => {
        announcementStatus.textContent = "無法讀取公告設定。";
        announcementStatus.className = "status-line error";
      },
    );
    saveAnnouncementBtn.addEventListener("click", async () => {
      announcementStatus.textContent = "儲存中…";
      announcementStatus.className = "status-line";
      saveAnnouncementBtn.setAttribute("disabled", "true");
      try {
        await setDoc(
          announcementDocRef,
          {
            text: announcementText.value.trim(),
            enabled: announcementEnabled.checked,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        announcementStatus.textContent = "公告已更新";
        announcementStatus.classList.add("ok");
      } catch (e) {
        announcementStatus.textContent = e instanceof Error ? e.message : "公告更新失敗";
        announcementStatus.classList.add("error");
      } finally {
        saveAnnouncementBtn.removeAttribute("disabled");
      }
    });

    announcementSection.append(
      el("h3", {}, ["跑馬燈公告"]),
      el("label", { class: "field" }, ["公告內容", announcementText]),
      el("label", { class: "field checkbox-field" }, [
        announcementEnabled,
        el("span", {}, ["啟用公告"]),
      ]),
      el("div", { class: "row-actions" }, [saveAnnouncementBtn]),
      announcementStatus,
    );
    walletTopupSection.append(
      el("h3", {}, ["會員儲值"]),
      el("label", { class: "field" }, ["會員（Email 或 UID）", topupTypeaheadWrap]),
      el("div", { class: "hint" }, [
        "輸入至少 2 個字元會顯示符合的 Email；亦可直接貼上 UID。",
      ]),
      el("label", { class: "field" }, ["儲值金額", topupAmount]),
      el("label", { class: "field" }, ["備註（選填）", topupNote]),
      el("div", { class: "row-actions" }, [topupBtn]),
      topupStatus,
    );
    const createMemberEmail = el("input", { type: "email", placeholder: "會員 Email" });
    const createMemberPassword = el("input", {
      type: "password",
      placeholder: "初始密碼（至少 6 碼）",
      autocomplete: "new-password",
    });
    const createMemberBtn = el("button", { class: "ghost", type: "button" }, ["建立會員帳號"]);
    const createMemberStatus = el("div", { class: "status-line" });
    createMemberBtn.addEventListener("click", async () => {
      createMemberStatus.textContent = "";
      createMemberStatus.className = "status-line";
      const email = createMemberEmail.value.trim();
      const password = createMemberPassword.value;
      if (!email || !password) {
        createMemberStatus.textContent = "請輸入 Email 與密碼。";
        createMemberStatus.classList.add("error");
        return;
      }
      createMemberBtn.setAttribute("disabled", "true");
      try {
        const fn = createMemberAccountCall();
        const res = await fn({ email, password });
        const data = res.data as { uid: string };
        createMemberStatus.textContent = `建立成功，UID：${data.uid}（儲值欄已帶入 Email）`;
        createMemberStatus.classList.add("ok");
        createMemberPassword.value = "";
        topupCustomerId.value = email;
      } catch (e) {
        createMemberStatus.textContent = errorMessage(e);
        createMemberStatus.classList.add("error");
      } finally {
        createMemberBtn.removeAttribute("disabled");
      }
    });
    accountCreateSection.append(
      el("h3", {}, ["建立會員帳號"]),
      el("label", { class: "field" }, ["會員 Email", createMemberEmail]),
      el("label", { class: "field" }, ["初始密碼", createMemberPassword]),
      el("div", { class: "hint" }, ["註冊入口已關閉，僅管理後台可建立新會員帳號。"]),
      el("div", { class: "row-actions" }, [createMemberBtn]),
      createMemberStatus,
    );
    const tableHolder = el("div", { class: "table-wrap" });
    const table = el("table", {}, []);
    table.append(
      el("tr", {}, [
        el("th", {}, ["時間"]),
        el("th", {}, ["姓名"]),
        el("th", {}, ["備註"]),
        el("th", {}, ["狀態"]),
        el("th", {}, ["操作"]),
      ]),
    );
    tableHolder.append(table);

    adminWrap.append(top, accountCreateSection, announcementSection, walletTopupSection, adminStatus, tableHolder);

    const q = query(collection(db, "bookings"), orderBy("startAt", "desc"));
    adminUnsub = onSnapshot(
      q,
      (snap) => {
        adminStatus.textContent = "";
        adminStatus.className = "status-line";
        // 保留表頭
        table.innerHTML = "";
        table.append(
          el("tr", {}, [
            el("th", {}, ["時間"]),
            el("th", {}, ["姓名"]),
            el("th", {}, ["備註"]),
            el("th", {}, ["狀態"]),
            el("th", {}, ["操作"]),
          ]),
        );
        for (const d of snap.docs) {
          const b = { id: d.id, ...d.data() } as Booking;
          const sel = el("select", {}, []);
          if (b.status === "deleted") {
            continue;
          }
          const deleteBtn = el("button", { class: "ghost", type: "button" }, ["刪除（軟）"]);
          for (const opt of STATUS_OPTIONS) {
            const o = el("option", { value: opt.value }, [opt.label]);
            if (opt.value === b.status) o.setAttribute("selected", "selected");
            sel.append(o);
          }
          sel.addEventListener("change", async () => {
            const nextStatus = sel.value;
            const prevStatus = b.status;
            adminStatus.textContent = "更新中…";
            try {
              if (nextStatus === "done") {
                const fn = completeBookingCall();
                await fn({ bookingId: b.id });
              } else if (nextStatus === "cancelled") {
                const fn = cancelBookingCall();
                await fn({ bookingId: b.id });
              } else {
                await updateDoc(doc(db, "bookings", b.id), {
                  status: nextStatus,
                  updatedAt: serverTimestamp(),
                });
              }
              adminStatus.textContent = "已更新";
              adminStatus.classList.add("ok");
              if (nextStatus === "done" || nextStatus === "cancelled") {
                await refreshWalletStatus();
              }
            } catch (e) {
              sel.value = prevStatus;
              adminStatus.textContent =
                e instanceof Error ? e.message : "更新失敗（你是否已加入 admins 集合？）";
              adminStatus.classList.add("error");
            }
          });
          deleteBtn.addEventListener("click", async () => {
            const confirmed = await showConfirmModal(
              "確認刪除（軟刪除）",
              `確定刪除這筆預約嗎？\n\n（此操作為軟刪除，資料會保留於系統中）\n\n姓名：${b.displayName ?? ""}\n日期：${b.dateKey ?? ""}\n開始時間：${b.startSlot ?? ""}`,
              "刪除",
            );
            if (!confirmed) return;
            adminStatus.textContent = "刪除中…";
            adminStatus.className = "status-line";
            deleteBtn.setAttribute("disabled", "true");
            try {
              await updateDoc(doc(db, "bookings", b.id), {
                status: "deleted",
                deletedBy: userId,
                deletedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
              });
              adminStatus.textContent = "已刪除（軟刪除）";
              adminStatus.classList.add("ok");
            } catch (e) {
              adminStatus.textContent =
                e instanceof Error ? e.message : "刪除失敗（你是否已加入 admins 集合？）";
              adminStatus.classList.add("error");
              deleteBtn.removeAttribute("disabled");
            }
          });
          table.append(
            el("tr", {}, [
              el("td", { class: "mono" }, [formatWhen(b)]),
              el("td", {}, [b.displayName ?? ""]),
              el("td", {}, [b.note ?? ""]),
              el("td", {}, [sel]),
              el("td", {}, [deleteBtn]),
            ]),
          );
        }
      },
      (err) => {
        console.error(err);
        adminStatus.textContent =
          "無法讀取預約（常見原因：Firestore Rules 拒絕，或尚未建立索引／admins 文件）。";
        adminStatus.classList.add("error");
      },
    );
  }

  async function canCurrentUserAccessAdmin(): Promise<boolean> {
    const user = auth.currentUser;
    if (!user) return false;
    try {
      const fn = getAdminStatusCall();
      const res = await fn();
      const data = res.data as { isAdmin?: boolean };
      return data.isAdmin === true;
    } catch {
      return false;
    }
  }

  async function syncAdminView() {
    if (tab !== "admin") return;
    const user = auth.currentUser;
    if (!user) {
      renderAdminLoggedOut();
      return;
    }
    const allowed = await canCurrentUserAccessAdmin();
    if (!allowed) {
      renderAdminForbidden();
      return;
    }
    renderAdminTable(user.uid);
  }

  onAuthStateChanged(auth, () => {
    void refreshWalletStatus();
    if (tab !== "admin") return;
    void syncAdminView();
  });

  function tabFromPath(): "book" | "admin" {
    const path = (window.location.pathname.replace(/\/+$/, "") || "/").toLowerCase();
    return path === "/admin" ? "admin" : "book";
  }

  function setTab(next: "book" | "admin") {
    tab = next;
    const isBook = next === "book";
    shell.classList.toggle("admin-mode", !isBook);
    memberEntryBtn.hidden = !isBook;
    titleHeading.textContent = isBook ? "辦公室按摩預約" : "管理後台";
    titleDesc.textContent = isBook
      ? "週一至週五 · 以 30 分鐘估算 · 午休 11:45–13:15 不開放 · 最晚 17:30 開始、18:00 前結束"
      : "管理預約狀態、會員儲值、公告與資料維護";
    panelBook.hidden = !isBook;
    panelAdmin.hidden = isBook;
    announcementBox.hidden = !isBook;
    if (isBook) {
      stopAdminListener();
    } else {
      void syncAdminView();
    }
  }

  window.addEventListener("popstate", () => setTab(tabFromPath()));

  void refreshWalletStatus();
  setTab(tabFromPath());
}

render();
