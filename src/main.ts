import "./style.css";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
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
  listMembersAdminCall,
  updateMemberNicknameAdminCall,
  sendImmediatePushCall,
  spinWheelCall,
  listActiveWheelPrizesCall,
  topupWalletCall,
} from "./firebase";
import { getWebPushVapidKey, registerWebPushForCurrentUser, unregisterWebPushForCurrentUser } from "./webPush";
import { allStartSlots } from "./slots";
import { runWheelSpectacle } from "./wheelSpectacle";
import {
  clampLedSpeed,
  createLedMarquee,
  LED_SPEED_MAX,
  LED_SPEED_MIN,
  type LedMarqueeHandle,
} from "./ledMarquee";

type Booking = {
  id: string;
  displayName: string;
  note: string;
  dateKey: string;
  startSlot: string;
  status: string;
  startAt?: { seconds: number };
  cancelReason?: string;
  /** 後台「自列表隱藏」；不改 status，會員端仍看真實狀態 */
  invisible?: boolean;
  bookingMode?: BookingMode | string;
  customerId?: string | null;
};

type BookingMode =
  | "guest_cash"
  | "guest_beverage"
  | "member_cash"
  | "member_wallet"
  | "member_beverage";

const BEVERAGE_OPTION_LABEL = "請師傅一杯飲料";

const BOOKING_MODE_LABEL: Record<BookingMode, string> = {
  guest_cash: "訪客現金",
  guest_beverage: BEVERAGE_OPTION_LABEL,
  member_cash: "會員現金",
  member_wallet: "會員儲值",
  member_beverage: BEVERAGE_OPTION_LABEL,
};

/** 後台狀態下拉：不含「已取消」（改由「取消」按鈕呼叫 cancelBooking） */
const ADMIN_STATUS_SELECT_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "待確認" },
  { value: "confirmed", label: "已確認" },
  { value: "done", label: "已完成" },
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

/** 密碼輸入框右側「顯示／隱藏」切換（不改變 input 的 value） */
function wrapPasswordField(input: HTMLInputElement): HTMLElement {
  const row = el("div", { class: "field-password-row" });
  const btn = el("button", { type: "button", class: "ghost password-reveal-btn" }, ["顯示"]);
  btn.setAttribute("aria-label", "顯示密碼");
  btn.setAttribute("aria-pressed", "false");
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? "隱藏" : "顯示";
    btn.setAttribute("aria-label", show ? "隱藏密碼" : "顯示密碼");
    btn.setAttribute("aria-pressed", String(show));
  });
  row.append(input, btn);
  return row;
}

function truncateOneLine(s: string, maxChars: number): string {
  const t = s.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

function isDateKeyMonFri(dateKey: string): boolean {
  const [y, m, d] = dateKey.split("-").map((x) => Number(x));
  if (!y || !m || !d) return false;
  const dow = new Date(y, m - 1, d).getDay();
  return dow >= 1 && dow <= 5;
}

/** 今日日曆日（台北），YYYY-MM-DD；與 date input 的 min、後端 dateKey 一致 */
function taipeiTodayDateKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

/** 該 dateKey + startSlot 在台北時區的開始瞬間（ms）；無效則 NaN */
function slotStartInstantMsTaipei(dateKey: string, startSlot: string): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!dm) return Number.NaN;
  const [, y, mo, d] = dm;
  const sm = /^(\d{1,2}):(\d{2})$/.exec(startSlot.trim());
  if (!sm) return Number.NaN;
  const hh = String(Number(sm[1])).padStart(2, "0");
  const mm = String(Number(sm[2])).padStart(2, "0");
  return new Date(`${y}-${mo}-${d}T${hh}:${mm}:00+08:00`).getTime();
}

/** 選「今天」且該格開始時間已早於現在（台北當日） */
function isStartSlotInPastForTaipeiToday(dateKey: string, startSlot: string): boolean {
  if (dateKey !== taipeiTodayDateKey()) return false;
  const t = slotStartInstantMsTaipei(dateKey, startSlot);
  return Number.isFinite(t) && t < Date.now();
}

function formatWhen(b: Booking): string {
  const base = `${b.dateKey} ${b.startSlot}`;
  if (!b.startAt?.seconds) return base;
  const d = new Date(b.startAt.seconds * 1000);
  return `${base}（${d.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}）`;
}

function bookingStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: "待確認",
    confirmed: "已確認",
    done: "已完成",
    cancelled: "已取消",
    deleted: "已刪除",
  };
  return map[status] ?? status;
}

/** 後台預約表：是否為訪客預約（是／否） */
function bookingGuestYesNo(b: Pick<Booking, "bookingMode" | "customerId">): string {
  const mode = b.bookingMode;
  if (mode === "guest_cash" || mode === "guest_beverage") return "是";
  if (typeof mode === "string" && mode.startsWith("member_")) return "否";
  if (typeof b.customerId === "string" && b.customerId.length > 0) return "否";
  return "—";
}

/** 會員「我的預約」：後台取消有填原因時顯示 */
function myBookingReasonBlock(b: Booking): HTMLElement | null {
  if (b.status !== "cancelled") return null;
  const cr = typeof b.cancelReason === "string" ? b.cancelReason.trim() : "";
  if (!cr) return null;
  return el("div", { class: "my-booking-reason" }, [
    el("span", { class: "my-booking-reason-label" }, ["取消說明："]),
    el("span", { class: "my-booking-reason-body" }, [cr]),
  ]);
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

function shortUidForDisplay(uid: string, headChars = 8): string {
  if (!uid) return "";
  if (uid.length <= headChars) return uid;
  return `${uid.slice(0, headChars)}…`;
}

function adminSessionCallName(user: User): string {
  const fromDisplay = user.displayName?.trim();
  if (fromDisplay) return fromDisplay;
  const email = user.email?.trim();
  if (email) {
    const at = email.indexOf("@");
    const local = at > 0 ? email.slice(0, at).trim() : email;
    if (local) return local;
  }
  return "管理員";
}

/** 後台表單：可填說明（可留空）；null 表示關閉視窗未確認 */
function showAdminOptionalReasonModal(args: {
  title: string;
  summaryLines: string;
  reasonLabel: string;
  placeholder: string;
  confirmText: string;
}): Promise<string | null> {
  const { title, summaryLines, reasonLabel, placeholder, confirmText } = args;
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "admin-reason-modal-title");
    const heading = el("h3", { id: "admin-reason-modal-title" }, [title]);
    const body = el("pre", { class: "modal-message" }, [summaryLines]);
    const reasonInput = el("textarea", {
      maxLength: 500,
      rows: 4,
      placeholder,
    });
    reasonInput.setAttribute("aria-label", reasonLabel);
    const reasonField = el("label", { class: "field modal-cancel-reason-field" }, [reasonLabel, reasonInput]);
    const dismissBtn = el("button", { class: "ghost", type: "button" }, ["關閉"]);
    const confirmBtn = el("button", { class: "primary", type: "button" }, [confirmText]);
    const actions = el("div", { class: "modal-actions" }, [dismissBtn, confirmBtn]);
    dialog.append(heading, body, reasonField, actions);
    overlay.append(dialog);

    const finish = (reason: string | null) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      resolve(reason);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        finish(null);
      }
    };

    dismissBtn.addEventListener("click", () => finish(null));
    confirmBtn.addEventListener("click", () => finish(reasonInput.value.trim()));
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        finish(null);
      }
    });
    document.addEventListener("keydown", onKeyDown);

    document.body.append(overlay);
    reasonInput.focus();
  });
}

function showAdminCancelBookingModal(summaryLines: string): Promise<string | null> {
  return showAdminOptionalReasonModal({
    title: "取消預約",
    summaryLines,
    reasonLabel: "取消原因",
    placeholder: "取消原因（選填，可不填）",
    confirmText: "確認取消",
  });
}

function render() {
  const root = document.querySelector<HTMLDivElement>("#app")!;
  root.innerHTML = "";
  root.className = "";

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
  const titleDesc = el("p", {}, ["週一至週五 · 開始時間 15 分鐘一格 · 單次服務約15~50分鐘, 看情況. · 午休 11:45–13:15 不開放 · 最晚 17:30 開始、18:00 前結束"]);
  const titleGuestHint = el("p", { class: "page-head-guest-hint" }, [
    "免事先註冊也可預約，選「訪客」付款方式即可；註冊會員則可儲值與抽獎。",
  ]);
  const titleBlock = el("div", { class: "page-head-main" }, [titleHeading, titleDesc, titleGuestHint]);

  const memberEntryBtn = el("button", { class: "ghost member-entry", type: "button" }, ["會員登入"]);
  const headSessionStatus = el("span", {
    class: "page-head-session",
    role: "status",
    ariaLive: "polite",
  });
  const headActions = el("div", { class: "head-actions" }, [headSessionStatus, memberEntryBtn]);

  const hostPortrait = el("figure", { class: "host-atelier" }, [
    el("div", { class: "host-atelier__frame" }, [
      el("img", {
        class: "host-atelier__img",
        src: "/host-portrait.png",
        alt: "主理人肖像：由凝視、伏案書寫與窗邊沉思三幅畫面組成的直式影像。",
        loading: "lazy",
        decoding: "async",
      }),
    ]),
    el("figcaption", { class: "host-atelier__cap" }, [
      "片刻的暗影與光，也是留給身體的空白。",
    ]),
  ]);

  const panelBook = el("main", { class: "panel" });
  const panelAdmin = el("main", { class: "panel", hidden: true });

  const shell = el("div", { class: "shell" }, [
    el("header", { class: "page-head" }, [titleBlock, headActions]),
    hostPortrait,
    panelBook,
    panelAdmin,
  ]);

  root.append(shell);

  /** 頂部：一般文字跑馬燈（與底部 LED 同一則公告） */
  const announcementTextStrip = el("div", {
    class: "marquee marquee-text-announce",
    hidden: true,
    role: "status",
    ariaLive: "polite",
  });
  shell.prepend(announcementTextStrip);

  const announcementBox = el("div", { class: "marquee marquee-led", hidden: true });
  const ledHost = el("div", { class: "marquee-led-host" });
  announcementBox.append(ledHost);
  let ledMarquee: LedMarqueeHandle | null = null;

  function disposeLedMarquee() {
    ledMarquee?.destroy();
    ledMarquee = null;
  }

  let topMarqueeOn = false;
  let bottomMarqueeOn = false;

  function parseMarqueeSettings(data: unknown): { text: string; enabled: boolean } {
    const o = data as { text?: unknown; enabled?: unknown } | undefined;
    const text = typeof o?.text === "string" ? o.text.trim() : "";
    const enabled = typeof o?.enabled === "boolean" ? o.enabled : false;
    return { text, enabled };
  }

  function syncMarqueeVisibilityForTab() {
    if (tab !== "book") {
      announcementTextStrip.hidden = true;
      announcementBox.hidden = true;
      return;
    }
    announcementTextStrip.hidden = !topMarqueeOn;
    announcementBox.hidden = !bottomMarqueeOn;
  }

  onSnapshot(
    doc(db, "siteSettings", "marqueeText"),
    (snap) => {
      if (tab !== "book") {
        announcementTextStrip.hidden = true;
        return;
      }
      const { text, enabled } = parseMarqueeSettings(snap.data());
      if (!enabled || !text) {
        topMarqueeOn = false;
        announcementTextStrip.replaceChildren();
      } else {
        topMarqueeOn = true;
        announcementTextStrip.replaceChildren(
          el("div", { class: "marquee-track" }, [text, "  •  ", text]),
        );
      }
      syncMarqueeVisibilityForTab();
    },
    () => {
      topMarqueeOn = false;
      announcementTextStrip.replaceChildren();
      announcementTextStrip.hidden = true;
      syncMarqueeVisibilityForTab();
    },
  );

  onSnapshot(
    doc(db, "siteSettings", "marqueeLed"),
    (snap) => {
      if (tab !== "book") {
        announcementBox.hidden = true;
        return;
      }
      const raw = snap.data() as
        | { text?: unknown; enabled?: unknown; speed?: unknown }
        | undefined;
      const { text, enabled } = parseMarqueeSettings(raw);
      const speed = clampLedSpeed(raw?.speed);
      if (!enabled || !text) {
        bottomMarqueeOn = false;
        disposeLedMarquee();
        syncMarqueeVisibilityForTab();
        return;
      }
      bottomMarqueeOn = true;
      if (!ledMarquee) {
        ledMarquee = createLedMarquee(ledHost, { speed });
      } else {
        ledMarquee.setSpeed(speed);
      }
      ledMarquee.setText(`${text}     ·     ${text}`);
      syncMarqueeVisibilityForTab();
    },
    () => {
      bottomMarqueeOn = false;
      disposeLedMarquee();
      announcementBox.hidden = true;
      syncMarqueeVisibilityForTab();
    },
  );
  shell.append(announcementBox);

  /** --- 預約表單 --- */
  const nameInput = el("input", { type: "text", autocomplete: "name", maxLength: 80 });
  const dateInput = el("input", { type: "date" });
  dateInput.min = taipeiTodayDateKey();
  const slotSelect = el("select", {}, []);
  const noteInput = el("textarea", { maxLength: 500 });
  const bookingModeSelect = el("select", {}, []);
  const bookingModeHint = el("span", { class: "hint" }, [
    "訪客預約以現金 50 元結帳；儲值與抽獎請使用右上角登入。",
  ]);
  const submitBtn = el("button", { class: "primary", type: "button" }, ["送出預約"]);
  const bookStatus = el("div", { class: "status-line" });
  const meta = el("div", { class: "meta-pills" });
  const bookFooterNote = el("div", { class: "footer-note" });
  bookFooterNote.textContent = "規則：同一天最多 2 筆、同一工作週最多 4 筆；已取消的不計入名額。";
  function setBookFooterFromCaps(dayCap: number, weekCap: number) {
    bookFooterNote.textContent = `規則：同一天最多 ${dayCap} 筆、同一工作週最多 ${weekCap} 筆；已取消的不計入名額。`;
  }
  const walletStatus = el("div", { class: "status-line" });
  const wheelStatus = el("div", { class: "status-line" });
  const wheelResult = el("div", { class: "pill", hidden: true });
  const spinBtn = el("button", { class: "ghost", type: "button" }, ["抽輪盤"]);
  /** 僅登入後顯示：餘額／抽輪盤（訪客預約不需此區） */
  const memberExtrasWrap = el("div", { class: "book-member-extras", hidden: true });
  const emailVerifyBanner = el("div", { class: "email-verify-banner", hidden: true });
  const emailVerifyText = el("p", { class: "hint" }, []);
  const resendVerifyBtn = el("button", { class: "ghost", type: "button" }, ["重新寄送驗證信"]);
  const reloadVerifyBtn = el("button", { class: "ghost", type: "button" }, ["我已驗證，重新整理狀態"]);
  emailVerifyBanner.append(emailVerifyText, el("div", { class: "row-actions" }, [resendVerifyBtn, reloadVerifyBtn]));
  let walletBalance = 0;
  let drawChances = 0;

  let myBookingsUnsub: (() => void) | null = null;
  let myBookingsListenerUid: string | null = null;
  const myBookingsSection = el("div", { class: "my-bookings" }, []);
  const myBookingsHint = el("div", { class: "status-line" });
  const myBookingsList = el("div", { class: "my-bookings-list" }, []);
  myBookingsSection.append(
    el("h3", { class: "my-bookings-heading" }, ["我的預約"]),
    el("p", { class: "hint my-bookings-intro" }, [
      "以下為綁定你帳號的預約（須使用會員付款方式送出）。訪客預約不會出現在此。",
    ]),
    myBookingsHint,
    myBookingsList,
  );

  function stopMyBookingsListener() {
    if (myBookingsUnsub) {
      myBookingsUnsub();
      myBookingsUnsub = null;
    }
    myBookingsListenerUid = null;
    myBookingsList.innerHTML = "";
    myBookingsHint.textContent = "";
    myBookingsHint.className = "status-line";
  }

  function ensureMyBookingsListener(customerUid: string) {
    if (myBookingsListenerUid === customerUid && myBookingsUnsub) return;
    stopMyBookingsListener();
    myBookingsListenerUid = customerUid;
    const db = getDb();
    const q = query(
      collection(db, "bookings"),
      where("customerId", "==", customerUid),
      orderBy("startAt", "desc"),
    );
    myBookingsUnsub = onSnapshot(
      q,
      (snap) => {
        myBookingsList.innerHTML = "";
        myBookingsHint.textContent = "";
        myBookingsHint.className = "status-line";
        if (snap.empty) {
          myBookingsList.append(
            el("p", { class: "hint my-bookings-empty" }, [
              "尚無紀錄。請用會員儲值／現金／飲料折抵送出預約後，會顯示於此。",
            ]),
          );
          return;
        }
        for (const d of snap.docs) {
          const b = { id: d.id, ...d.data() } as Booking;
          const canCancel = b.status === "pending" || b.status === "confirmed";
          const row = el("div", { class: "my-booking-row" }, []);
          const mainCol = el("div", { class: "my-booking-main" }, []);
          mainCol.append(
            el("div", { class: "mono my-booking-when" }, [formatWhen(b)]),
            el("div", { class: "my-booking-status" }, [bookingStatusLabel(b.status)]),
          );
          const actions = el("div", { class: "my-booking-actions" }, []);
          if (canCancel) {
            const btn = el("button", { class: "ghost", type: "button" }, ["取消預約"]);
            btn.addEventListener("click", async () => {
              const ok = await showConfirmModal(
                "取消預約",
                `確定取消這筆預約？\n\n${formatWhen(b)}`,
                "取消預約",
              );
              if (!ok) return;
              btn.setAttribute("disabled", "true");
              try {
                const fn = cancelBookingCall();
                await fn({ bookingId: b.id });
                await refreshWalletStatus();
              } catch (e) {
                myBookingsHint.textContent = e instanceof Error ? e.message : "取消失敗";
                myBookingsHint.classList.add("error");
                btn.removeAttribute("disabled");
              }
            });
            actions.append(btn);
          }
          row.append(mainCol, actions);
          const reasonEl = myBookingReasonBlock(b);
          if (reasonEl) row.append(reasonEl);
          myBookingsList.append(row);
        }
      },
      (err) => {
        console.error(err);
        myBookingsHint.textContent =
          "無法載入我的預約。若專案剛新增索引，請執行 firebase deploy 並等待索引建立完成。";
        myBookingsHint.classList.add("error");
      },
    );
  }

  function updateMemberEntryLabel() {
    const user = auth.currentUser;
    memberEntryBtn.textContent = user ? "會員中心" : "會員登入";
  }

  /** 預約頁右上角：訪客／登入與驗證狀態／稱呼（長字省略，信箱完整字串放 title 提示） */
  function syncPageHeadSession(profileLabel?: string) {
    if (tab !== "book") {
      headSessionStatus.hidden = true;
      return;
    }
    headSessionStatus.hidden = false;
    const u = auth.currentUser;
    if (!u) {
      headSessionStatus.textContent = "訪客";
      headSessionStatus.removeAttribute("title");
      headSessionStatus.className = "page-head-session";
      return;
    }
    if (!u.emailVerified) {
      headSessionStatus.textContent = "已登入 · 待驗證信箱";
      headSessionStatus.title = u.email ?? "尚未驗證信箱";
      headSessionStatus.className = "page-head-session page-head-session--pending";
      return;
    }
    const fromArg = profileLabel?.trim();
    const fromAuthName = u.displayName?.trim();
    const fromEmail = u.email?.trim();
    const raw =
      fromArg && fromArg.length > 0
        ? fromArg
        : fromAuthName && fromAuthName.length > 0
          ? fromAuthName
          : fromEmail && fromEmail.length > 0
            ? fromEmail
            : "會員";
    const shown = truncateOneLine(raw, 18);
    headSessionStatus.textContent = `已登入 · ${shown}`;
    headSessionStatus.title = shown !== raw ? raw : "";
    headSessionStatus.className = "page-head-session";
  }

  function isVerifiedMember(): boolean {
    const u = auth.currentUser;
    return Boolean(u?.emailVerified);
  }

  resendVerifyBtn.addEventListener("click", async () => {
    const u = auth.currentUser;
    if (!u || u.emailVerified) return;
    resendVerifyBtn.setAttribute("disabled", "true");
    try {
      await sendEmailVerification(u);
      emailVerifyText.textContent = "已再次寄出驗證信，請檢查信箱（含垃圾郵件）。";
    } catch (e) {
      emailVerifyText.textContent = errorMessage(e);
    } finally {
      resendVerifyBtn.removeAttribute("disabled");
    }
  });

  reloadVerifyBtn.addEventListener("click", async () => {
    const u = auth.currentUser;
    if (!u) return;
    reloadVerifyBtn.setAttribute("disabled", "true");
    try {
      await reload(u);
      const fresh = auth.currentUser;
      await refreshWalletStatus();
      emailVerifyText.textContent = fresh?.emailVerified
        ? "驗證完成，已可使用會員功能。"
        : "尚未偵測到驗證完成，請確認已點擊信內連結後再試。";
    } catch (e) {
      emailVerifyText.textContent = errorMessage(e);
    } finally {
      reloadVerifyBtn.removeAttribute("disabled");
    }
  });

  function openMemberAuthModal() {
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card member-modal" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const user = auth.currentUser;

    const status = el("div", { class: "status-line" });
    if (!user) {
      const modalTitle = el("h3", {}, ["會員登入／註冊"]);
      const loginStack = el("div", { class: "member-auth-stack" });
      const registerStack = el("div", { class: "member-auth-stack", hidden: true });
      const resetStack = el("div", { class: "member-auth-stack", hidden: true });

      const loginEmail = el("input", { type: "email", autocomplete: "username", placeholder: "會員 Email" });
      const loginPassword = el("input", {
        type: "password",
        autocomplete: "current-password",
        placeholder: "會員密碼",
      });
      const loginBtn = el("button", { class: "primary", type: "button" }, ["登入"]);
      const registerEmail = el("input", { type: "email", autocomplete: "username", placeholder: "會員 Email" });
      const registerPassword = el("input", {
        type: "password",
        autocomplete: "new-password",
        placeholder: "密碼（至少 6 碼）",
      });
      const registerPassword2 = el("input", {
        type: "password",
        autocomplete: "new-password",
        placeholder: "再次輸入密碼",
      });
      const registerBtn = el("button", { class: "primary", type: "button" }, ["註冊並寄驗證信"]);
      const resetSendBtn = el("button", { class: "primary", type: "button" }, ["寄送重設密碼信"]);
      const cancelBtn = el("button", { class: "ghost", type: "button" }, ["關閉"]);
      const switchToRegister = el("button", { class: "ghost", type: "button" }, ["還沒有帳號？註冊"]);
      const switchToLogin = el("button", { class: "ghost", type: "button" }, ["返回登入"]);
      const switchToForgot = el("button", { class: "ghost", type: "button" }, ["忘記密碼？"]);
      const switchToForgotFromRegister = el("button", { class: "ghost", type: "button" }, ["忘記密碼？"]);
      const switchToLoginFromReset = el("button", { class: "ghost", type: "button" }, ["返回登入"]);
      const resetEmail = el("input", { type: "email", autocomplete: "username", placeholder: "註冊時使用的 Email" });

      function syncAuthModalPrimaryButtons() {
        loginBtn.hidden = loginStack.hidden;
        registerBtn.hidden = registerStack.hidden;
        resetSendBtn.hidden = resetStack.hidden;
      }
      function showLoginStack() {
        loginStack.hidden = false;
        registerStack.hidden = true;
        resetStack.hidden = true;
        modalTitle.textContent = "會員登入／註冊";
        status.textContent = "";
        status.className = "status-line";
        syncAuthModalPrimaryButtons();
      }
      function showRegisterStack() {
        loginStack.hidden = true;
        registerStack.hidden = false;
        resetStack.hidden = true;
        modalTitle.textContent = "會員登入／註冊";
        status.textContent = "";
        status.className = "status-line";
        syncAuthModalPrimaryButtons();
      }
      function showResetStack() {
        loginStack.hidden = true;
        registerStack.hidden = true;
        resetStack.hidden = false;
        modalTitle.textContent = "重設密碼";
        status.textContent = "";
        status.className = "status-line";
        syncAuthModalPrimaryButtons();
      }

      switchToRegister.addEventListener("click", () => {
        registerEmail.value = loginEmail.value.trim();
        showRegisterStack();
      });
      switchToLogin.addEventListener("click", () => {
        loginEmail.value = registerEmail.value.trim();
        showLoginStack();
      });
      switchToForgot.addEventListener("click", () => {
        resetEmail.value = loginEmail.value.trim();
        showResetStack();
      });
      switchToForgotFromRegister.addEventListener("click", () => {
        resetEmail.value = registerEmail.value.trim();
        showResetStack();
      });
      switchToLoginFromReset.addEventListener("click", () => {
        loginEmail.value = resetEmail.value.trim();
        showLoginStack();
      });

      loginBtn.addEventListener("click", async () => {
        status.textContent = "";
        status.className = "status-line";
        loginBtn.setAttribute("disabled", "true");
        try {
          await signInWithEmailAndPassword(auth, loginEmail.value.trim(), loginPassword.value);
          overlay.remove();
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : "登入失敗";
          status.classList.add("error");
        } finally {
          loginBtn.removeAttribute("disabled");
        }
      });

      registerBtn.addEventListener("click", async () => {
        status.textContent = "";
        status.className = "status-line";
        const em = registerEmail.value.trim();
        const pw = registerPassword.value;
        const pw2 = registerPassword2.value;
        if (!em || !pw) {
          status.textContent = "請輸入 Email 與密碼。";
          status.classList.add("error");
          return;
        }
        if (pw.length < 6) {
          status.textContent = "密碼至少 6 碼。";
          status.classList.add("error");
          return;
        }
        if (pw !== pw2) {
          status.textContent = "兩次輸入的密碼不一致。";
          status.classList.add("error");
          return;
        }
        registerBtn.setAttribute("disabled", "true");
        try {
          const cred = await createUserWithEmailAndPassword(auth, em, pw);
          await sendEmailVerification(cred.user);
          status.textContent =
            "註冊成功，已寄出驗證信。請至信箱點擊連結後，再按主畫面的「我已驗證，重新整理狀態」或重新登入。";
          status.classList.add("ok");
          overlay.remove();
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : "註冊失敗";
          status.classList.add("error");
        } finally {
          registerBtn.removeAttribute("disabled");
        }
      });

      cancelBtn.addEventListener("click", () => overlay.remove());

      resetSendBtn.addEventListener("click", async () => {
        status.textContent = "";
        status.className = "status-line";
        const em = resetEmail.value.trim();
        if (!em) {
          status.textContent = "請輸入 Email。";
          status.classList.add("error");
          return;
        }
        resetSendBtn.setAttribute("disabled", "true");
        try {
          await sendPasswordResetEmail(auth, em);
          status.textContent =
            "若此 Email 已註冊，您將很快收到重設密碼信（請一併查看垃圾郵件）。收到信後點連結即可設定新密碼。";
          status.classList.add("ok");
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : "寄送失敗";
          status.classList.add("error");
        } finally {
          resetSendBtn.removeAttribute("disabled");
        }
      });

      loginStack.append(
        el("label", { class: "field" }, ["Email", loginEmail]),
        el("label", { class: "field" }, ["密碼", wrapPasswordField(loginPassword)]),
        el("div", { class: "hint member-auth-links" }, [switchToRegister, switchToForgot]),
      );
      registerStack.append(
        el("label", { class: "field" }, ["Email", registerEmail]),
        el("label", { class: "field" }, ["密碼", wrapPasswordField(registerPassword)]),
        el("label", { class: "field" }, ["確認密碼", wrapPasswordField(registerPassword2)]),
        el("div", { class: "hint member-auth-links" }, [switchToLogin, switchToForgotFromRegister]),
      );
      resetStack.append(
        el("p", { class: "hint" }, [
          "輸入註冊時使用的 Email，我們將寄出重設密碼連結。若未收到信，請確認信箱正確並檢查垃圾郵件匣。",
        ]),
        el("label", { class: "field" }, ["Email", resetEmail]),
        el("div", { class: "hint" }, [switchToLoginFromReset]),
      );

      dialog.append(
        modalTitle,
        loginStack,
        registerStack,
        resetStack,
        status,
        el("div", { class: "modal-actions" }, [cancelBtn, loginBtn, registerBtn, resetSendBtn]),
      );
      syncAuthModalPrimaryButtons();
    } else {
      const closeBtn = el("button", { class: "ghost", type: "button" }, ["關閉"]);
      const logoutBtn = el("button", { class: "primary", type: "button" }, ["登出"]);
      closeBtn.addEventListener("click", () => overlay.remove());
      logoutBtn.addEventListener("click", async () => {
        await unregisterWebPushForCurrentUser();
        await signOut(auth);
        overlay.remove();
      });
      const modalBody: HTMLElement[] = [
        el("h3", {}, ["會員中心"]),
        el("div", { class: "hint" }, [
          `目前登入：${user.email ?? "（無 Email）"}（UID：${shortUidForDisplay(user.uid)}）`,
        ]),
      ];
      if (!user.emailVerified) {
        const verifyHint = el("div", { class: "status-line" }, [
          "請至信箱點擊驗證連結後，才能使用儲值、會員預約與抽獎。",
        ]);
        const modalVerifyStatus = el("div", { class: "status-line" });
        const modalResendBtn = el("button", { class: "ghost", type: "button" }, ["重新寄送驗證信"]);
        const modalReloadBtn = el("button", { class: "ghost", type: "button" }, ["我已驗證，重新整理"]);
        modalResendBtn.addEventListener("click", async () => {
          const u = auth.currentUser;
          if (!u || u.emailVerified) return;
          modalVerifyStatus.textContent = "";
          modalVerifyStatus.className = "status-line";
          modalResendBtn.setAttribute("disabled", "true");
          try {
            await sendEmailVerification(u);
            modalVerifyStatus.textContent = "已寄出驗證信。";
            modalVerifyStatus.classList.add("ok");
          } catch (e) {
            modalVerifyStatus.textContent = errorMessage(e);
            modalVerifyStatus.classList.add("error");
          } finally {
            modalResendBtn.removeAttribute("disabled");
          }
        });
        modalReloadBtn.addEventListener("click", async () => {
          const u = auth.currentUser;
          if (!u) return;
          modalReloadBtn.setAttribute("disabled", "true");
          modalVerifyStatus.textContent = "";
          modalVerifyStatus.className = "status-line";
          try {
            await reload(u);
            await refreshWalletStatus();
            const fresh = auth.currentUser;
            modalVerifyStatus.textContent = fresh?.emailVerified
              ? "驗證完成。"
              : "尚未偵測到驗證完成，請確認已點擊信內連結。";
            modalVerifyStatus.classList.add(fresh?.emailVerified ? "ok" : "error");
          } catch (e) {
            modalVerifyStatus.textContent = errorMessage(e);
            modalVerifyStatus.classList.add("error");
          } finally {
            modalReloadBtn.removeAttribute("disabled");
          }
        });
        modalBody.push(
          verifyHint,
          modalVerifyStatus,
          el("div", { class: "modal-actions" }, [modalResendBtn, modalReloadBtn]),
        );
      }
      const pushSubscribeBtn = el("button", { class: "ghost", type: "button" }, ["訂閱推播通知"]);
      const pushSubscribeStatus = el("div", { class: "status-line" });
      if (!getWebPushVapidKey()) {
        pushSubscribeBtn.setAttribute("disabled", "true");
        pushSubscribeStatus.textContent =
          "尚未設定 VAPID 金鑰，無法訂閱（請於 .env 設定 VITE_FIREBASE_VAPID_KEY 後重新建置）。";
        pushSubscribeStatus.className = "status-line error";
      }
      pushSubscribeBtn.addEventListener("click", async () => {
        pushSubscribeStatus.textContent = "";
        pushSubscribeStatus.className = "status-line";
        pushSubscribeBtn.setAttribute("disabled", "true");
        try {
          const r = await registerWebPushForCurrentUser();
          if (r.ok) {
            pushSubscribeStatus.textContent = "已訂閱此裝置，可請管理員從後台發送立即推播。";
            pushSubscribeStatus.classList.add("ok");
          } else {
            pushSubscribeStatus.textContent = r.message;
            pushSubscribeStatus.classList.add("error");
          }
        } catch (e) {
          pushSubscribeStatus.textContent = errorMessage(e);
          pushSubscribeStatus.classList.add("error");
        } finally {
          pushSubscribeBtn.removeAttribute("disabled");
        }
      });
      modalBody.push(
        el("h4", { class: "admin-subhead" }, ["推播通知"]),
        el("p", { class: "hint" }, [
          "訂閱後可接收後台「立即推播」（瀏覽器須允許通知；背景時仍可能收到系統通知）。",
        ]),
        pushSubscribeStatus,
        el("div", { class: "row-actions" }, [pushSubscribeBtn]),
      );
      modalBody.push(walletStatus.cloneNode(true) as HTMLElement);
      modalBody.push(el("div", { class: "modal-actions" }, [closeBtn, logoutBtn]));
      dialog.append(...modalBody);
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
          { value: "member_beverage", label: BEVERAGE_OPTION_LABEL },
        ]
      : [
          { value: "guest_cash", label: "訪客現金（50 元）" },
          { value: "guest_beverage", label: BEVERAGE_OPTION_LABEL },
        ];
    for (const mode of modes) {
      const opt = el("option", { value: mode.value, disabled: mode.disabled }, [mode.label]);
      bookingModeSelect.append(opt);
    }
    const values = modes.map((m) => m.value);
    bookingModeSelect.value = values.includes(current) ? current : modes[0].value;
    const loggedInUnverified = Boolean(auth.currentUser && !auth.currentUser.emailVerified);
    bookingModeHint.textContent = isMember
      ? "可選儲值扣款、會員現金（50 元），或「請師傅一杯飲料」（依現場約定）。"
      : loggedInUnverified
        ? "已登入但尚未驗證信箱，暫以訪客方式預約；完成驗證後可選會員付款、儲值與抽獎。"
        : "訪客可選現金 50 元或「請師傅一杯飲料」；儲值與抽獎請使用右上角登入。";
  }

  async function refreshWalletStatus() {
    const user = auth.currentUser;
    refillBookingModes(isVerifiedMember());
    updateMemberEntryLabel();
    if (!user) {
      stopMyBookingsListener();
      walletBalance = 0;
      drawChances = 0;
      memberExtrasWrap.hidden = true;
      emailVerifyBanner.hidden = true;
      walletStatus.textContent = "";
      walletStatus.className = "status-line";
      spinBtn.setAttribute("disabled", "true");
      wheelStatus.textContent = "";
      wheelStatus.className = "status-line";
      wheelResult.hidden = true;
      syncPageHeadSession();
      return;
    }
    memberExtrasWrap.hidden = false;
    if (!user.emailVerified) {
      stopMyBookingsListener();
      walletBalance = 0;
      drawChances = 0;
      emailVerifyBanner.hidden = false;
      emailVerifyText.textContent =
        "已登入，但尚未完成 Email 驗證。請至信箱點擊驗證連結；完成後請按「我已驗證，重新整理狀態」。";
      walletStatus.textContent = "";
      walletStatus.className = "status-line";
      spinBtn.setAttribute("disabled", "true");
      wheelStatus.textContent = "完成信箱驗證後才可抽輪盤。";
      wheelStatus.className = "status-line";
      wheelResult.hidden = true;
      syncPageHeadSession();
      return;
    }
    emailVerifyBanner.hidden = true;
    ensureMyBookingsListener(user.uid);
    walletStatus.textContent = "讀取會員餘額中…";
    walletStatus.className = "status-line";
    syncPageHeadSession(user.displayName?.trim() || user.email?.trim());
    try {
      const fn = getMyWalletCall();
      const res = await fn();
      const data = res.data as { walletBalance: number; drawChances: number; nickname?: string };
      walletBalance = typeof data.walletBalance === "number" ? data.walletBalance : 0;
      drawChances = typeof data.drawChances === "number" ? data.drawChances : 0;
      const nickFromDb =
        typeof data.nickname === "string" && data.nickname.trim() ? data.nickname.trim() : "";
      const nickFromAuth = user.displayName?.trim() ?? "";
      const profileNick = nickFromDb || nickFromAuth;
      if (profileNick && !nameInput.value.trim()) {
        nameInput.value = profileNick.slice(0, 80);
      }
      walletStatus.textContent = `會員已登入：儲值餘額 ${walletBalance} 元，可抽次數 ${drawChances}。`;
      walletStatus.className = "status-line ok";
      wheelStatus.textContent = drawChances > 0 ? "可抽輪盤，祝你好運！" : "目前無可抽次數。";
      wheelStatus.className = "status-line";
      if (drawChances > 0) spinBtn.removeAttribute("disabled");
      else spinBtn.setAttribute("disabled", "true");
      syncPageHeadSession(profileNick);
    } catch (e) {
      walletBalance = 0;
      drawChances = 0;
      memberExtrasWrap.hidden = false;
      walletStatus.textContent = errorMessage(e);
      walletStatus.className = "status-line error";
      spinBtn.setAttribute("disabled", "true");
      wheelStatus.textContent = "無法讀取抽獎狀態。";
      wheelStatus.className = "status-line error";
      syncPageHeadSession();
    }
  }

  async function fetchWheelPrizeLabelsForSpectacle() {
    const fn = listActiveWheelPrizesCall();
    const res = await fn();
    const data = res.data as { prizes: { id: string; name: string; weight: number }[] };
    return data.prizes;
  }

  /** 預覽輪盤用：固定示範獎項（不連後端），格內可立即看到文字與比例 */
  const wheelPreviewMockPrizes: { id: string; name: string; weight: number }[] = [
    { id: "pv-c10", name: "+10 儲值金", weight: 22 },
    { id: "pv-c5", name: "+5 儲值金", weight: 26 },
    { id: "pv-ch", name: "再抽一次", weight: 16 },
    { id: "pv-th", name: "銘謝惠顧", weight: 24 },
    { id: "pv-pn", name: "小處罰文案", weight: 12 },
  ];

  spinBtn.addEventListener("click", async () => {
    wheelStatus.textContent = "";
    wheelStatus.className = "status-line";
    if (!auth.currentUser) {
      wheelStatus.textContent = "請先登入會員。";
      wheelStatus.classList.add("error");
      return;
    }
    if (!auth.currentUser.emailVerified) {
      wheelStatus.textContent = "請先完成 Email 驗證。";
      wheelStatus.classList.add("error");
      return;
    }
    if (drawChances < 1) {
      wheelStatus.textContent = "目前沒有可抽次數。";
      wheelStatus.classList.add("error");
      return;
    }
    spinBtn.setAttribute("disabled", "true");
    try {
      const data = await runWheelSpectacle(
        async () => {
          const fn = spinWheelCall();
          const res = await fn();
          return res.data as {
            prize: { name: string; type: string; value: number };
            drawChances: number;
            walletBalance: number;
          };
        },
        { splitAnchor: wheelRow, fetchPrizeLabels: fetchWheelPrizeLabelsForSpectacle },
      );
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

  function refillSlots(
    taken: Set<string>,
    disabled: boolean,
    selectedDateKey: string,
    blockedReasonBySlot: Map<string, string> = new Map(),
  ) {
    const prev = slotSelect.value;
    slotSelect.innerHTML = "";
    slotSelect.disabled = disabled;
    const opt0 = el("option", { value: "" }, ["請選擇開始時間"]);
    slotSelect.append(opt0);
    for (const s of allStartSlots()) {
      const takenHere = taken.has(s);
      const pastHere = isStartSlotInPastForTaipeiToday(selectedDateKey, s);
      const blockReason = blockedReasonBySlot.get(s);
      const blockedHere = blockReason !== undefined;
      const blockNote =
        blockedHere && blockReason ? `（不開放：${blockReason}）` : blockedHere ? "（不開放預約）" : "";
      const o = el("option", { value: s, disabled: takenHere || pastHere || blockedHere }, [
        `${s}${takenHere ? "（已佔用）" : pastHere ? "（已過）" : blockNote}`,
      ]);
      slotSelect.append(o);
    }
    if (prev) {
      const keep = [...slotSelect.options].some((o) => o.value === prev && !o.disabled);
      if (!keep) slotSelect.value = "";
      else slotSelect.value = prev;
    }
  }

  refillSlots(new Set(), true, "", new Map());

  async function refreshAvailability() {
    bookStatus.textContent = "";
    bookStatus.className = "status-line";
    meta.innerHTML = "";
    const dk = dateInput.value;
    if (!dk) {
      refillSlots(new Set(), true, "", new Map());
      meta.append(
        el("span", { class: "pill" }, ["先選擇日期後，會顯示可選時段與名額"]),
      );
      return;
    }

    const minKey = taipeiTodayDateKey();
    if (dk < minKey) {
      refillSlots(new Set(), true, "", new Map());
      bookStatus.textContent = "不可選擇今天以前的日期。";
      bookStatus.classList.add("error");
      dateInput.value = "";
      return;
    }

    if (!isDateKeyMonFri(dk)) {
      refillSlots(new Set(), true, dk, new Map());
      bookStatus.textContent = "僅能預約週一到週五。";
      bookStatus.classList.add("error");
      return;
    }

    try {
      const fn = getAvailabilityCall();
      const res = await fn({ dateKey: dk });
      const data = res.data as {
        taken: string[];
        blockedSlots?: { startSlot: string; reason?: string }[];
        dayCount: number;
        weekCount: number;
        dayCap: number;
        weekCap: number;
      };
      const taken = new Set(data.taken);
      const dayFull = data.dayCount >= data.dayCap;
      const weekFull = data.weekCount >= data.weekCap;
      const blocked = dayFull || weekFull;
      const blockedMap = new Map<string, string>();
      for (const b of data.blockedSlots ?? []) {
        if (b && typeof b.startSlot === "string") {
          blockedMap.set(b.startSlot, typeof b.reason === "string" ? b.reason : "");
        }
      }

      setBookFooterFromCaps(data.dayCap, data.weekCap);
      refillSlots(taken, blocked, dk, blockedMap);
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
      refillSlots(new Set(), true, dk, new Map());
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
    if (dateKey < taipeiTodayDateKey()) {
      bookStatus.textContent = "不可預約今天以前的日期。";
      bookStatus.classList.add("error");
      return;
    }
    if (isStartSlotInPastForTaipeiToday(dateKey, startSlot)) {
      bookStatus.textContent = "此開始時間已過，請選擇較晚的時段。";
      bookStatus.classList.add("error");
      return;
    }
    if (bookingMode !== "guest_cash" && bookingMode !== "guest_beverage" && !auth.currentUser) {
      bookStatus.textContent = "會員付款模式需先登入。";
      bookStatus.classList.add("error");
      return;
    }
    if (
      bookingMode !== "guest_cash" &&
      bookingMode !== "guest_beverage" &&
      auth.currentUser &&
      !auth.currentUser.emailVerified
    ) {
      bookStatus.textContent = "會員付款需先完成 Email 驗證，請至信箱點擊驗證連結。";
      bookStatus.classList.add("error");
      return;
    }
    if (bookingMode === "member_wallet" && walletBalance < 50) {
      bookStatus.textContent = "儲值餘額不足，請改用現金、「請師傅一杯飲料」或先儲值。";
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

  const wheelTestBtn = el("button", { class: "ghost", type: "button" }, ["預覽輪盤特效"]);
  wheelTestBtn.hidden = true;
  wheelTestBtn.title = "僅畫面預覽，不呼叫抽獎、不扣次數";
  const wheelRow = el("div", { class: "book-wheel-row" }, [spinBtn, wheelTestBtn, wheelStatus, wheelResult]);
  memberExtrasWrap.append(emailVerifyBanner, walletStatus, myBookingsSection, wheelRow);

  const wheelSpectacleSettingsRef = doc(db, "siteSettings", "wheelSpectacle");
  onSnapshot(
    wheelSpectacleSettingsRef,
    (snap) => {
      const data = snap.data() as { showTestButton?: unknown } | undefined;
      wheelTestBtn.hidden = data?.showTestButton !== true;
    },
    () => {
      wheelTestBtn.hidden = true;
    },
  );

  wheelTestBtn.addEventListener("click", async () => {
    wheelTestBtn.setAttribute("disabled", "true");
    try {
      await runWheelSpectacle(
        async () => {
          await new Promise((r) => setTimeout(r, 1200));
          return {
            prize: { id: "pv-c5", name: "【預覽】+5 儲值金", type: "credit", value: 5 },
            drawChances,
            walletBalance,
          };
        },
        {
          splitAnchor: wheelRow,
          fetchPrizeLabels: async () => wheelPreviewMockPrizes,
        },
      );
      wheelStatus.textContent = "以上為特效預覽，未實際抽獎、未扣除次數。";
      wheelStatus.className = "status-line";
    } finally {
      wheelTestBtn.removeAttribute("disabled");
    }
  });

  panelBook.append(
    el("div", { class: "grid grid-2" }, [
      el("label", { class: "field" }, [
        "姓名",
        nameInput,
        el("span", { class: "hint" }, [
          "可不登入，打個暱稱即可；若已登入且帳號有設定稱呼，會自動帶入（仍可改）。",
        ]),
      ]),
      el("label", { class: "field" }, ["日期（週一至週五）", dateInput]),
    ]),
    el("div", { class: "grid" }, [
      el("label", { class: "field" }, [
        "開始時間（15 分鐘一格）",
        slotSelect,
        el("span", { class: "hint" }, ["開始時間為 15 分鐘一格；單次服務約15~50分鐘, 看情況."]),
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
    bookFooterNote,
  );

  /** --- 管理後台 --- */
  const adminWrap = el("div", {}, []);
  panelAdmin.append(adminWrap);

  let adminUnsub: (() => void) | null = null;
  let adminMarqueeTextUnsub: (() => void) | null = null;
  let adminMarqueeLedUnsub: (() => void) | null = null;
  let adminWheelSpectacleUnsub: (() => void) | null = null;
  let adminBookingCapsUnsub: (() => void) | null = null;
  let adminBookingBlocksUnsub: (() => void) | null = null;
  let adminPushSettingsUnsub: (() => void) | null = null;

  function stopAdminListener() {
    if (adminUnsub) {
      adminUnsub();
      adminUnsub = null;
    }
    if (adminMarqueeTextUnsub) {
      adminMarqueeTextUnsub();
      adminMarqueeTextUnsub = null;
    }
    if (adminMarqueeLedUnsub) {
      adminMarqueeLedUnsub();
      adminMarqueeLedUnsub = null;
    }
    if (adminWheelSpectacleUnsub) {
      adminWheelSpectacleUnsub();
      adminWheelSpectacleUnsub = null;
    }
    if (adminBookingCapsUnsub) {
      adminBookingCapsUnsub();
      adminBookingCapsUnsub = null;
    }
    if (adminBookingBlocksUnsub) {
      adminBookingBlocksUnsub();
      adminBookingBlocksUnsub = null;
    }
    if (adminPushSettingsUnsub) {
      adminPushSettingsUnsub();
      adminPushSettingsUnsub = null;
    }
  }

  function renderAdminLoggedOut() {
    stopAdminListener();
    adminWrap.innerHTML = "";
    const box = el("div", { class: "admin-login" }, []);
    const email = el("input", { type: "email", autocomplete: "username" });
    const password = el("input", { type: "password", autocomplete: "current-password" });
    const loginBtn = el("button", { class: "primary", type: "button" }, ["登入"]);
    const resetBtn = el("button", { class: "ghost", type: "button" }, ["寄送重設密碼信"]);
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
    resetBtn.addEventListener("click", async () => {
      adminStatus.textContent = "";
      adminStatus.className = "status-line";
      const em = email.value.trim();
      if (!em) {
        adminStatus.textContent = "請先輸入 Email。";
        adminStatus.classList.add("error");
        return;
      }
      resetBtn.setAttribute("disabled", "true");
      try {
        await sendPasswordResetEmail(auth, em);
        adminStatus.textContent =
          "若此 Email 已註冊，您將很快收到重設密碼信（請一併查看垃圾郵件）。點信內連結即可設定新密碼。";
        adminStatus.classList.add("ok");
      } catch (e) {
        adminStatus.textContent = e instanceof Error ? e.message : "寄送失敗";
        adminStatus.classList.add("error");
      } finally {
        resetBtn.removeAttribute("disabled");
      }
    });
    box.append(
      el("p", { class: "hint" }, [
        "僅限管理員。請先在 Firebase Console 建立 Email/Password 帳號，並在 Firestore 新增文件 ",
        el("code", {}, ["admins/<你的 UID>"]),
        "（可用空物件 `{}`）。",
      ]),
      el("label", { class: "field" }, ["Email", email]),
      el("label", { class: "field" }, ["密碼", wrapPasswordField(password)]),
      el("div", { class: "row-actions" }, [loginBtn, resetBtn]),
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
    const u = auth.currentUser;
    const whoLabel =
      u != null
        ? `已登入：${adminSessionCallName(u)}（${shortUidForDisplay(u.uid)}）`
        : `已登入：（${shortUidForDisplay(userId)}）`;
    const who = el("span", { class: "hint" }, [whoLabel]);
    const outBtn = el("button", { class: "ghost", type: "button" }, ["登出"]);
    outBtn.addEventListener("click", async () => {
      await unregisterWebPushForCurrentUser();
      await signOut(auth);
    });
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

    const marqueeTextEnabled = el("input", { type: "checkbox" });
    const marqueeTextBody = el("input", {
      type: "text",
      maxLength: 240,
      placeholder: "頂部橫幅：例如本週三 15:00-16:00 暫停服務",
      autocomplete: "off",
    });
    const saveMarqueeTextBtn = el("button", { class: "ghost", type: "button" }, ["儲存頂部跑馬燈"]);
    const marqueeTextStatus = el("div", { class: "status-line" });
    const marqueeTextDocRef = doc(db, "siteSettings", "marqueeText");

    const marqueeLedEnabled = el("input", { type: "checkbox" });
    const marqueeLedBody = el("input", {
      type: "text",
      maxLength: 500,
      placeholder: "底部 LED：可較長，例如活動標語",
      autocomplete: "off",
    });
    const marqueeLedSpeed = el("input", {
      type: "range",
      min: String(LED_SPEED_MIN),
      max: String(LED_SPEED_MAX),
      step: "1",
    });
    const marqueeLedSpeedValue = el("span", { class: "led-speed-readout" }, [
      String(clampLedSpeed(undefined)),
    ]);
    marqueeLedSpeed.addEventListener("input", () => {
      marqueeLedSpeedValue.textContent = marqueeLedSpeed.value;
    });
    const saveMarqueeLedBtn = el("button", { class: "ghost", type: "button" }, ["儲存底部 LED"]);
    const marqueeLedStatus = el("div", { class: "status-line" });
    const marqueeLedDocRef = doc(db, "siteSettings", "marqueeLed");
    const wheelSpectacleDocRef = doc(db, "siteSettings", "wheelSpectacle");
    const wheelSpectacleShowTest = el("input", { type: "checkbox" });
    const saveWheelSpectacleBtn = el("button", { class: "ghost", type: "button" }, ["儲存輪盤預覽開關"]);
    const wheelSpectacleStatus = el("div", { class: "status-line" });

    adminWheelSpectacleUnsub = onSnapshot(
      wheelSpectacleDocRef,
      (snap) => {
        const data = snap.data() as { showTestButton?: unknown } | undefined;
        wheelSpectacleShowTest.checked = data?.showTestButton === true;
      },
      () => {
        wheelSpectacleStatus.textContent = "無法讀取輪盤預覽設定。";
        wheelSpectacleStatus.className = "status-line error";
      },
    );

    saveWheelSpectacleBtn.addEventListener("click", async () => {
      wheelSpectacleStatus.textContent = "";
      wheelSpectacleStatus.className = "status-line";
      saveWheelSpectacleBtn.setAttribute("disabled", "true");
      try {
        await setDoc(
          wheelSpectacleDocRef,
          {
            showTestButton: wheelSpectacleShowTest.checked,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        wheelSpectacleStatus.textContent = "已更新前台「預覽輪盤特效」按鈕顯示設定";
        wheelSpectacleStatus.classList.add("ok");
      } catch (e) {
        wheelSpectacleStatus.textContent = e instanceof Error ? e.message : "儲存失敗";
        wheelSpectacleStatus.classList.add("error");
      } finally {
        saveWheelSpectacleBtn.removeAttribute("disabled");
      }
    });

    const bookingCapsDocRef = doc(db, "siteSettings", "bookingCaps");
    const capMaxPerDayInput = el("input", {
      type: "number",
      min: "1",
      max: "50",
      step: "1",
      value: "2",
    });
    const capMaxPerWorkWeekInput = el("input", {
      type: "number",
      min: "1",
      max: "50",
      step: "1",
      value: "4",
    });
    const saveBookingCapsBtn = el("button", { type: "button", class: "ghost" }, ["儲存名額上限"]);
    const bookingCapsStatus = el("div", { class: "status-line" });

    function clampBookingCapInput(n: number, fallback: number): number {
      const r = Math.round(n);
      if (!Number.isFinite(r) || !Number.isInteger(r)) return fallback;
      return Math.min(50, Math.max(1, r));
    }

    adminBookingCapsUnsub = onSnapshot(
      bookingCapsDocRef,
      (snap) => {
        const data = snap.data() as { maxPerDay?: unknown; maxPerWorkWeek?: unknown } | undefined;
        const dRaw = data?.maxPerDay;
        const wRaw = data?.maxPerWorkWeek;
        const dNum = typeof dRaw === "number" && Number.isFinite(dRaw) ? dRaw : Number(dRaw);
        const wNum = typeof wRaw === "number" && Number.isFinite(wRaw) ? wRaw : Number(wRaw);
        capMaxPerDayInput.value = String(clampBookingCapInput(dNum, 2));
        capMaxPerWorkWeekInput.value = String(clampBookingCapInput(wNum, 4));
      },
      () => {
        bookingCapsStatus.textContent = "無法讀取名額上限設定。";
        bookingCapsStatus.className = "status-line error";
      },
    );

    saveBookingCapsBtn.addEventListener("click", async () => {
      bookingCapsStatus.textContent = "";
      bookingCapsStatus.className = "status-line";
      const maxPerDay = clampBookingCapInput(Number(capMaxPerDayInput.value), 2);
      const maxPerWorkWeek = clampBookingCapInput(Number(capMaxPerWorkWeekInput.value), 4);
      capMaxPerDayInput.value = String(maxPerDay);
      capMaxPerWorkWeekInput.value = String(maxPerWorkWeek);
      saveBookingCapsBtn.setAttribute("disabled", "true");
      bookingCapsStatus.textContent = "儲存中…";
      try {
        await setDoc(
          bookingCapsDocRef,
          { maxPerDay, maxPerWorkWeek, updatedAt: serverTimestamp() },
          { merge: true },
        );
        bookingCapsStatus.textContent = "名額上限已更新（新預約立即套用）";
        bookingCapsStatus.classList.add("ok");
      } catch (e) {
        bookingCapsStatus.textContent = e instanceof Error ? e.message : "儲存失敗";
        bookingCapsStatus.classList.add("error");
      } finally {
        saveBookingCapsBtn.removeAttribute("disabled");
      }
    });

    const bookingBlocksDocRef = doc(db, "siteSettings", "bookingBlocks");
    const bookingBlocksRows = el("div", { class: "admin-booking-blocks-rows" });
    const addBookingBlockRowBtn = el("button", { type: "button", class: "ghost" }, ["新增一筆"]);
    const saveBookingBlocksBtn = el("button", { type: "button", class: "ghost" }, ["儲存不開放時段"]);
    const bookingBlocksStatus = el("div", { class: "status-line" });

    type BookingBlockRowModel = { weekday: number; start: string; end: string; reason: string };

    function normalizeTimeForBookingBlock(v: string): string | null {
      const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
      if (!m) return null;
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) {
        return null;
      }
      return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
    }

    function parseBookingBlocksDoc(raw: { windows?: unknown } | undefined): BookingBlockRowModel[] {
      if (!raw || !Array.isArray(raw.windows)) return [];
      const out: BookingBlockRowModel[] = [];
      for (const item of raw.windows) {
        if (!item || typeof item !== "object") continue;
        const o = item as Record<string, unknown>;
        const wd = typeof o.weekday === "number" ? o.weekday : Number(o.weekday);
        const start = typeof o.start === "string" ? o.start.trim() : "";
        const end = typeof o.end === "string" ? o.end.trim() : "";
        const reason = typeof o.reason === "string" ? o.reason.trim() : "";
        if (!Number.isInteger(wd) || wd < 1 || wd > 5) continue;
        const ns = normalizeTimeForBookingBlock(start);
        const ne = normalizeTimeForBookingBlock(end);
        if (!ns || !ne) continue;
        const m0 = Number(ns.slice(0, 2)) * 60 + Number(ns.slice(3, 5));
        const m1 = Number(ne.slice(0, 2)) * 60 + Number(ne.slice(3, 5));
        if (m0 >= m1) continue;
        out.push({ weekday: wd, start: ns, end: ne, reason: reason.slice(0, 200) });
      }
      return out;
    }

    function renderBookingBlockRow(model: BookingBlockRowModel): HTMLElement {
      const row = el("div", { class: "admin-booking-block-row" });
      const weekdaySel = el("select", { class: "bb-weekday", "aria-label": "星期" });
      const dayLabels = ["一", "二", "三", "四", "五"];
      for (let d = 1; d <= 5; d++) {
        weekdaySel.append(el("option", { value: String(d) }, [`週${dayLabels[d - 1]}`]));
      }
      weekdaySel.value = String(model.weekday);
      const startIn = el("input", {
        type: "time",
        class: "bb-start",
        step: "900",
        "aria-label": "不開放起點",
      });
      startIn.value = model.start;
      const endIn = el("input", {
        type: "time",
        class: "bb-end",
        step: "900",
        "aria-label": "不開放終點（不含）",
      });
      endIn.value = model.end;
      const reasonIn = el("input", {
        type: "text",
        class: "bb-reason",
        maxLength: 200,
        placeholder: "例如：師傅運動、外出",
        autocomplete: "off",
      });
      reasonIn.value = model.reason;
      const removeBtn = el("button", { type: "button", class: "ghost" }, ["刪除此列"]);
      removeBtn.addEventListener("click", () => {
        row.remove();
      });
      row.append(
        el("label", { class: "field bb-field-wd" }, ["星期", weekdaySel]),
        el("label", { class: "field bb-field-t" }, ["起（含）", startIn]),
        el("label", { class: "field bb-field-t" }, ["迄（不含）", endIn]),
        el("label", { class: "field bb-field-reason" }, ["前台顯示原因", reasonIn]),
        removeBtn,
      );
      return row;
    }

    function refillBookingBlockRows(models: BookingBlockRowModel[]) {
      bookingBlocksRows.innerHTML = "";
      for (const m of models) {
        bookingBlocksRows.append(renderBookingBlockRow(m));
      }
    }

    addBookingBlockRowBtn.addEventListener("click", () => {
      bookingBlocksRows.append(
        renderBookingBlockRow({ weekday: 1, start: "16:30", end: "17:30", reason: "" }),
      );
    });

    adminBookingBlocksUnsub = onSnapshot(
      bookingBlocksDocRef,
      (snap) => {
        const models = parseBookingBlocksDoc(snap.data() as { windows?: unknown } | undefined);
        refillBookingBlockRows(models);
      },
      () => {
        bookingBlocksStatus.textContent = "無法讀取不開放時段設定。";
        bookingBlocksStatus.className = "status-line error";
      },
    );

    saveBookingBlocksBtn.addEventListener("click", async () => {
      bookingBlocksStatus.textContent = "";
      bookingBlocksStatus.className = "status-line";
      const rowEls = bookingBlocksRows.querySelectorAll(".admin-booking-block-row");
      const windows: { weekday: number; start: string; end: string; reason: string }[] = [];
      if (rowEls.length > 40) {
        bookingBlocksStatus.textContent = "最多 40 筆規則，請刪減後再儲存。";
        bookingBlocksStatus.classList.add("error");
        return;
      }
      for (const row of rowEls) {
        const wd = Number((row.querySelector(".bb-weekday") as HTMLSelectElement)?.value);
        const st = (row.querySelector(".bb-start") as HTMLInputElement)?.value ?? "";
        const en = (row.querySelector(".bb-end") as HTMLInputElement)?.value ?? "";
        const re = (row.querySelector(".bb-reason") as HTMLInputElement)?.value ?? "";
        if (!Number.isInteger(wd) || wd < 1 || wd > 5) {
          bookingBlocksStatus.textContent = "每一列的星期需為週一到週五。";
          bookingBlocksStatus.classList.add("error");
          return;
        }
        const ns = normalizeTimeForBookingBlock(st);
        const ne = normalizeTimeForBookingBlock(en);
        if (!ns || !ne) {
          bookingBlocksStatus.textContent = "請確認每一列的時間格式正確。";
          bookingBlocksStatus.classList.add("error");
          return;
        }
        const m0 = Number(ns.slice(0, 2)) * 60 + Number(ns.slice(3, 5));
        const m1 = Number(ne.slice(0, 2)) * 60 + Number(ne.slice(3, 5));
        if (m0 >= m1) {
          bookingBlocksStatus.textContent =
            "每一列的「迄」需晚於「起」。區間為左閉右開：迄那一刻起已不再封鎖。";
          bookingBlocksStatus.classList.add("error");
          return;
        }
        windows.push({ weekday: wd, start: ns, end: ne, reason: re.trim().slice(0, 200) });
      }
      saveBookingBlocksBtn.setAttribute("disabled", "true");
      bookingBlocksStatus.textContent = "儲存中…";
      try {
        await setDoc(
          bookingBlocksDocRef,
          { windows, updatedAt: serverTimestamp() },
          { merge: true },
        );
        bookingBlocksStatus.textContent = "不開放時段已更新";
        bookingBlocksStatus.classList.add("ok");
      } catch (e) {
        bookingBlocksStatus.textContent = e instanceof Error ? e.message : "儲存失敗";
        bookingBlocksStatus.classList.add("error");
      } finally {
        saveBookingBlocksBtn.removeAttribute("disabled");
      }
    });

    adminMarqueeTextUnsub = onSnapshot(
      marqueeTextDocRef,
      (snap) => {
        const data = snap.data() as { text?: unknown; enabled?: unknown } | undefined;
        marqueeTextBody.value = typeof data?.text === "string" ? data.text : "";
        marqueeTextEnabled.checked = typeof data?.enabled === "boolean" ? data.enabled : false;
      },
      () => {
        marqueeTextStatus.textContent = "無法讀取頂部跑馬燈設定。";
        marqueeTextStatus.className = "status-line error";
      },
    );
    adminMarqueeLedUnsub = onSnapshot(
      marqueeLedDocRef,
      (snap) => {
        const data = snap.data() as { text?: unknown; enabled?: unknown; speed?: unknown } | undefined;
        marqueeLedBody.value = typeof data?.text === "string" ? data.text : "";
        marqueeLedEnabled.checked = typeof data?.enabled === "boolean" ? data.enabled : false;
        const s = clampLedSpeed(data?.speed);
        marqueeLedSpeed.value = String(s);
        marqueeLedSpeedValue.textContent = String(s);
      },
      () => {
        marqueeLedStatus.textContent = "無法讀取底部 LED 設定。";
        marqueeLedStatus.className = "status-line error";
      },
    );

    saveMarqueeTextBtn.addEventListener("click", async () => {
      marqueeTextStatus.textContent = "儲存中…";
      marqueeTextStatus.className = "status-line";
      saveMarqueeTextBtn.setAttribute("disabled", "true");
      try {
        await setDoc(
          marqueeTextDocRef,
          {
            text: marqueeTextBody.value.trim(),
            enabled: marqueeTextEnabled.checked,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        marqueeTextStatus.textContent = "頂部跑馬燈已更新";
        marqueeTextStatus.classList.add("ok");
      } catch (e) {
        marqueeTextStatus.textContent = e instanceof Error ? e.message : "儲存失敗";
        marqueeTextStatus.classList.add("error");
      } finally {
        saveMarqueeTextBtn.removeAttribute("disabled");
      }
    });

    saveMarqueeLedBtn.addEventListener("click", async () => {
      marqueeLedStatus.textContent = "儲存中…";
      marqueeLedStatus.className = "status-line";
      saveMarqueeLedBtn.setAttribute("disabled", "true");
      try {
        await setDoc(
          marqueeLedDocRef,
          {
            text: marqueeLedBody.value.trim(),
            enabled: marqueeLedEnabled.checked,
            speed: clampLedSpeed(Number(marqueeLedSpeed.value)),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        marqueeLedStatus.textContent = "底部 LED 已更新";
        marqueeLedStatus.classList.add("ok");
      } catch (e) {
        marqueeLedStatus.textContent = e instanceof Error ? e.message : "儲存失敗";
        marqueeLedStatus.classList.add("error");
      } finally {
        saveMarqueeLedBtn.removeAttribute("disabled");
      }
    });

    announcementSection.append(
      el("h3", {}, ["跑馬燈公告"]),
      el("p", { class: "hint" }, [
        "頂部與底部分開設定：Firestore `siteSettings/marqueeText`、`siteSettings/marqueeLed`。",
      ]),
      el("h4", { class: "admin-subhead" }, ["頂部 · 文字跑馬燈"]),
      el("label", { class: "field" }, ["內容", marqueeTextBody]),
      el("label", { class: "field checkbox-field" }, [marqueeTextEnabled, el("span", {}, ["啟用"])]),
      el("div", { class: "row-actions" }, [saveMarqueeTextBtn]),
      marqueeTextStatus,
      el("h4", { class: "admin-subhead" }, ["底部 · LED 跑馬燈"]),
      el("label", { class: "field" }, ["內容", marqueeLedBody]),
      el("label", { class: "field led-speed-field" }, [
        "捲動速度",
        el("div", { class: "led-speed-row" }, [marqueeLedSpeed, marqueeLedSpeedValue]),
        el("span", { class: "hint" }, [
          `約 ${LED_SPEED_MIN}～${LED_SPEED_MAX}（數字愈大移動愈快，單位：像素／秒）。`,
        ]),
      ]),
      el("label", { class: "field checkbox-field" }, [marqueeLedEnabled, el("span", {}, ["啟用"])]),
      el("div", { class: "row-actions" }, [saveMarqueeLedBtn]),
      marqueeLedStatus,
      el("h4", { class: "admin-subhead" }, ["前台 · 輪盤特效預覽"]),
      el("p", { class: "hint" }, [
        "勾選並儲存後，預約頁「會員區」會出現「預覽輪盤特效」按鈕；僅播放動畫，不呼叫抽獎 API、不扣次數。正式上線建議關閉。Firestore：",
        el("code", {}, ["siteSettings/wheelSpectacle"]),
        "。",
      ]),
      el("label", { class: "field checkbox-field" }, [
        wheelSpectacleShowTest,
        el("span", {}, ["顯示前台「預覽輪盤特效」按鈕"]),
      ]),
      el("div", { class: "row-actions" }, [saveWheelSpectacleBtn]),
      wheelSpectacleStatus,
      el("h4", { class: "admin-subhead" }, ["預約名額上限"]),
      el("p", { class: "hint" }, [
        "控制「同一天」「同一工作週（週一至週五曆）」各最多幾筆有效預約（",
        el("code", {}, ["pending"]),
        "／",
        el("code", {}, ["confirmed"]),
        "／",
        el("code", {}, ["done"]),
        "）。Firestore：",
        el("code", {}, ["siteSettings/bookingCaps"]),
        "（",
        el("code", {}, ["maxPerDay"]),
        "、",
        el("code", {}, ["maxPerWorkWeek"]),
        "，整數 1～50；未建立文件時後端預設 2 與 4）。",
      ]),
      el("div", { class: "grid grid-2" }, [
        el("label", { class: "field" }, ["同一天最多幾筆", capMaxPerDayInput]),
        el("label", { class: "field" }, ["同一工作週最多幾筆", capMaxPerWorkWeekInput]),
      ]),
      el("div", { class: "row-actions" }, [saveBookingCapsBtn]),
      bookingCapsStatus,
      el("h4", { class: "admin-subhead" }, ["不開放預約時段"]),
      el("p", { class: "hint" }, [
        "依星期與當日時段關閉預約：若一次服務（約 30 分鐘）與關閉區間重疊，該開始時間無法選取。例：週一、週四 16:30–17:30 關閉，則 16:30、16:45、17:00 皆不可開始。Firestore：",
        el("code", {}, ["siteSettings/bookingBlocks"]),
        " 的 ",
        el("code", {}, ["windows"]),
        "。區間為左閉右開（「迄」該分鐘起已不封鎖）。",
      ]),
      bookingBlocksRows,
      el("div", { class: "row-actions" }, [addBookingBlockRowBtn, saveBookingBlocksBtn]),
      bookingBlocksStatus,
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
    const createMemberNickname = el("input", {
      type: "text",
      maxLength: 80,
      placeholder: "例如：小陳（選填，會寫入預約姓名預設）",
      autocomplete: "off",
    });
    const createMemberBtn = el("button", { class: "ghost", type: "button" }, ["建立會員帳號"]);
    const createMemberStatus = el("div", { class: "status-line" });
    createMemberBtn.addEventListener("click", async () => {
      createMemberStatus.textContent = "";
      createMemberStatus.className = "status-line";
      const email = createMemberEmail.value.trim();
      const password = createMemberPassword.value;
      const nickname = createMemberNickname.value.trim();
      if (!email || !password) {
        createMemberStatus.textContent = "請輸入 Email 與密碼。";
        createMemberStatus.classList.add("error");
        return;
      }
      createMemberBtn.setAttribute("disabled", "true");
      try {
        const fn = createMemberAccountCall();
        const res = await fn({ email, password, nickname });
        const data = res.data as { uid: string };
        createMemberStatus.textContent = `建立成功，UID：${data.uid}（儲值欄已帶入 Email）`;
        createMemberStatus.classList.add("ok");
        createMemberPassword.value = "";
        createMemberNickname.value = "";
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
      el("label", { class: "field" }, ["稱呼（選填）", createMemberNickname]),
      el("div", { class: "hint" }, [
        "稱呼會存進會員資料，登入預約時若姓名欄為空會自動帶入；亦會寫入 Firebase Auth 顯示名稱。",
      ]),
      el("div", { class: "hint" }, [
        "會員也可於前台「會員登入／註冊」自行註冊；註冊後須完成信箱驗證才可使用儲值與會員預約。",
      ]),
      el("div", { class: "row-actions" }, [createMemberBtn]),
      createMemberStatus,
    );
    const tableHolder = el("div", { class: "table-wrap admin-bookings-table" });
    const table = el("table", {}, []);
    table.append(
      el("tr", {}, [
        el("th", {}, ["時間"]),
        el("th", {}, ["姓名"]),
        el("th", { title: "是否為訪客預約" }, ["訪客"]),
        el("th", {}, ["備註"]),
        el("th", {}, ["狀態"]),
        el("th", {}, ["操作"]),
      ]),
    );
    tableHolder.append(table);

    const hiddenBookingsStatus = el("div", { class: "status-line" });
    const hiddenTableHolder = el("div", { class: "table-wrap admin-bookings-table" });
    const hiddenTable = el("table", {}, []);
    hiddenTable.append(
      el("tr", {}, [
        el("th", {}, ["時間"]),
        el("th", {}, ["姓名"]),
        el("th", { title: "是否為訪客預約" }, ["訪客"]),
        el("th", {}, ["備註"]),
        el("th", {}, ["狀態"]),
        el("th", {}, ["操作"]),
      ]),
    );
    hiddenTableHolder.append(hiddenTable);

    const hiddenPager = el("div", { class: "admin-hidden-pager" });
    const hiddenPagePrev = el("button", { type: "button", class: "ghost" }, ["上一頁"]);
    const hiddenPageInfo = el("span", { class: "hint admin-hidden-pager-meta" }, ["—"]);
    const hiddenPageNext = el("button", { type: "button", class: "ghost" }, ["下一頁"]);
    hiddenPager.append(hiddenPagePrev, hiddenPageInfo, hiddenPageNext);

    const memberListSection = el("div", { class: "admin-member-list" }, []);
    const memberListRefreshBtn = el("button", { class: "ghost", type: "button" }, ["重新載入會員清單"]);
    const memberListStatus = el("div", { class: "status-line" });
    const memberListTableWrap = el("div", { class: "table-wrap admin-member-list-table" });
    const memberListTable = el("table", {}, []);
    memberListTable.append(
      el("tr", {}, [
        el("th", {}, ["Email"]),
        el("th", {}, ["信箱驗證"]),
        el("th", {}, ["UID"]),
        el("th", {}, ["稱呼"]),
        el("th", {}, ["儲值餘額"]),
        el("th", {}, ["可抽次數"]),
        el("th", { class: "admin-member-th-actions" }, ["操作"]),
      ]),
    );
    memberListTableWrap.append(memberListTable);

    async function loadMemberList() {
      memberListStatus.textContent = "載入會員清單中…";
      memberListStatus.className = "status-line";
      memberListRefreshBtn.setAttribute("disabled", "true");
      try {
        const fn = listMembersAdminCall();
        const res = await fn({});
        const data = res.data as {
          members: {
            uid: string;
            email: string | null;
            emailVerified?: boolean;
            nickname: string;
            walletBalance: number;
            drawChances: number;
          }[];
        };
        const members = Array.isArray(data.members) ? data.members : [];
        memberListTable.innerHTML = "";
        memberListTable.append(
          el("tr", {}, [
            el("th", {}, ["Email"]),
            el("th", {}, ["信箱驗證"]),
            el("th", {}, ["UID"]),
            el("th", {}, ["稱呼"]),
            el("th", {}, ["儲值餘額"]),
            el("th", {}, ["可抽次數"]),
            el("th", { class: "admin-member-th-actions" }, ["操作"]),
          ]),
        );
        for (const m of members) {
          const nickInput = el("input", {
            type: "text",
            maxLength: 80,
            value: m.nickname,
            class: "admin-member-nick-input",
            autocomplete: "off",
          });
          const saveBtn = el("button", { class: "ghost admin-save-nick-btn", type: "button" }, ["儲存稱呼"]);
          saveBtn.addEventListener("click", async () => {
            memberListStatus.textContent = "";
            memberListStatus.className = "status-line";
            saveBtn.setAttribute("disabled", "true");
            try {
              const updateFn = updateMemberNicknameAdminCall();
              await updateFn({ customerId: m.uid, nickname: nickInput.value });
              memberListStatus.textContent = `已更新 ${m.email ?? m.uid} 的稱呼。`;
              memberListStatus.classList.add("ok");
            } catch (e) {
              memberListStatus.textContent = e instanceof Error ? e.message : "儲存失敗";
              memberListStatus.classList.add("error");
            } finally {
              saveBtn.removeAttribute("disabled");
            }
          });
          const verified = m.emailVerified === true;
          const verifyCell = el("td", { class: verified ? "admin-member-verify ok" : "admin-member-verify" }, [
            verified ? "已驗證" : "未驗證",
          ]);
          memberListTable.append(
            el("tr", {}, [
              el("td", {}, [m.email ?? "（無 Email）"]),
              verifyCell,
              el("td", { class: "mono admin-member-uid" }, [m.uid]),
              el("td", {}, [nickInput]),
              el("td", { class: "mono" }, [String(m.walletBalance)]),
              el("td", { class: "mono" }, [String(m.drawChances)]),
              el("td", { class: "admin-member-td-actions" }, [saveBtn]),
            ]),
          );
        }
        memberListStatus.textContent = `已載入 ${members.length} 位使用者。`;
        memberListStatus.classList.add("ok");
      } catch (e) {
        memberListStatus.textContent = e instanceof Error ? e.message : "載入失敗";
        memberListStatus.classList.add("error");
      } finally {
        memberListRefreshBtn.removeAttribute("disabled");
      }
    }

    memberListRefreshBtn.addEventListener("click", () => {
      void loadMemberList();
    });

    memberListSection.append(
      el("h3", {}, ["會員清單"]),
      el("p", { class: "hint" }, [
        "資料來自 Firebase Authentication 全部使用者，並合併 Firestore ",
        el("code", {}, ["customers/{uid}"]),
        " 的餘額與稱呼。人數極多時載入可能較久。",
      ]),
      el("div", { class: "row-actions" }, [memberListRefreshBtn]),
      memberListStatus,
      memberListTableWrap,
    );

    function clampPushReminderMinutes(raw: unknown): number {
      const n = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : 60;
      return Math.min(24 * 60, Math.max(5, n));
    }

    const pushSettingsSection = el("div", { class: "admin-announce" }, []);
    const pushDocRef = doc(db, "siteSettings", "pushNotifications");
    const bookingReminderEnabled = el("input", { type: "checkbox" });
    const bookingReminderMinutesBefore = el("input", {
      type: "number",
      min: "5",
      max: "1440",
      step: "5",
      value: "60",
    });
    const bookingReminderTitle = el("input", {
      type: "text",
      maxLength: 80,
      placeholder: "留空則由發送端使用預設標題（例如：按摩預約提醒）",
      autocomplete: "off",
    });
    const savePushSettingsBtn = el("button", { class: "ghost", type: "button" }, ["儲存推播設定"]);
    const pushSettingsStatus = el("div", { class: "status-line" });

    adminPushSettingsUnsub = onSnapshot(
      pushDocRef,
      (snap) => {
        const data = snap.data() as
          | {
              bookingReminderEnabled?: unknown;
              bookingReminderMinutesBefore?: unknown;
              bookingReminderTitle?: unknown;
            }
          | undefined;
        bookingReminderEnabled.checked =
          typeof data?.bookingReminderEnabled === "boolean" ? data.bookingReminderEnabled : false;
        bookingReminderMinutesBefore.value = String(clampPushReminderMinutes(data?.bookingReminderMinutesBefore));
        bookingReminderTitle.value =
          typeof data?.bookingReminderTitle === "string" ? data.bookingReminderTitle : "";
      },
      () => {
        pushSettingsStatus.textContent = "無法讀取推播設定。";
        pushSettingsStatus.className = "status-line error";
      },
    );

    savePushSettingsBtn.addEventListener("click", async () => {
      pushSettingsStatus.textContent = "";
      pushSettingsStatus.className = "status-line";
      const minutes = clampPushReminderMinutes(Number(bookingReminderMinutesBefore.value));
      bookingReminderMinutesBefore.value = String(minutes);
      savePushSettingsBtn.setAttribute("disabled", "true");
      pushSettingsStatus.textContent = "儲存中…";
      try {
        await setDoc(
          pushDocRef,
          {
            bookingReminderEnabled: bookingReminderEnabled.checked,
            bookingReminderMinutesBefore: minutes,
            bookingReminderTitle: bookingReminderTitle.value.trim(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        pushSettingsStatus.textContent = "推播設定已更新";
        pushSettingsStatus.classList.add("ok");
      } catch (e) {
        pushSettingsStatus.textContent = e instanceof Error ? e.message : "儲存失敗";
        pushSettingsStatus.classList.add("error");
      } finally {
        savePushSettingsBtn.removeAttribute("disabled");
      }
    });

    const immediateTitle = el("input", {
      type: "text",
      maxLength: 50,
      placeholder: "推播標題（必填，最多 50 字）",
      autocomplete: "off",
    });
    const immediateBody = el("textarea", {
      rows: 3,
      maxLength: 500,
      placeholder: "內文（選填，最多 500 字）",
    });
    const scopeSelf = el("input", { type: "radio", name: "admin-immediate-push-scope", value: "self" });
    scopeSelf.checked = true;
    const scopeAll = el("input", { type: "radio", name: "admin-immediate-push-scope", value: "all" });
    const sendImmediatePushBtn = el("button", { class: "primary", type: "button" }, ["立即送出推播"]);
    const immediatePushStatus = el("div", { class: "status-line" });
    sendImmediatePushBtn.addEventListener("click", async () => {
      immediatePushStatus.textContent = "";
      immediatePushStatus.className = "status-line";
      const title = immediateTitle.value.trim();
      const body = immediateBody.value.trim();
      if (title.length < 1) {
        immediatePushStatus.textContent = "請填寫標題。";
        immediatePushStatus.classList.add("error");
        return;
      }
      sendImmediatePushBtn.setAttribute("disabled", "true");
      immediatePushStatus.textContent = "送出中…";
      try {
        const fn = sendImmediatePushCall();
        const scope = scopeAll.checked ? "all" : "self";
        const res = await fn({ title, body, scope });
        const data = res.data as {
          successCount?: unknown;
          failureCount?: unknown;
          attempted?: unknown;
          message?: unknown;
          failureDetails?: unknown;
        };
        const msg = typeof data.message === "string" ? data.message : "已處理。";
        const details = Array.isArray(data.failureDetails)
          ? data.failureDetails.filter((x): x is string => typeof x === "string" && x.length > 0)
          : [];
        const extra = details.length > 0 ? ` 詳情：${details.join("；")}` : "";
        immediatePushStatus.textContent = msg + extra;
        const okN = typeof data.successCount === "number" ? data.successCount : 0;
        const failN = typeof data.failureCount === "number" ? data.failureCount : 0;
        immediatePushStatus.classList.add(failN > 0 && okN === 0 ? "error" : "ok");
      } catch (e) {
        immediatePushStatus.textContent = errorMessage(e);
        immediatePushStatus.classList.add("error");
      } finally {
        sendImmediatePushBtn.removeAttribute("disabled");
      }
    });

    pushSettingsSection.append(
      el("h3", {}, ["推播設定"]),
      el("p", { class: "hint" }, [
        "「預約提醒」參數存在 Firestore ",
        el("code", {}, ["siteSettings/pushNotifications"]),
        "，供日後排程＋ FCM 使用。「立即推播」則由 Cloud Function ",
        el("code", {}, ["sendImmediatePush"]),
        " 透過 FCM 發送；會員須於前台「會員中心」按「訂閱推播通知」並允許通知。",
      ]),
      el("label", { class: "field checkbox-field" }, [
        bookingReminderEnabled,
        el("span", {}, ["啟用「預約開始前」提醒（總開關）"]),
      ]),
      el("label", { class: "field" }, [
        "於預約開始前（分鐘）",
        bookingReminderMinutesBefore,
        el("span", { class: "hint" }, ["範圍 5～1440（24 小時），常用值：60。"]),
      ]),
      el("label", { class: "field" }, ["提醒推播標題（選填）", bookingReminderTitle]),
      el("div", { class: "row-actions" }, [savePushSettingsBtn]),
      pushSettingsStatus,
      el("h4", { class: "admin-subhead" }, ["立即推播"]),
      el("p", { class: "hint" }, [
        "「僅發給自己」會只送到目前管理員帳號在本機已訂閱的瀏覽器，適合自測；「發給全部」會送到所有已訂閱裝置，請謹慎使用。",
      ]),
      el("label", { class: "field" }, ["標題", immediateTitle]),
      el("label", { class: "field" }, ["內文", immediateBody]),
      el("fieldset", { class: "admin-push-scope-fieldset" }, [
        el("legend", {}, ["發送對象"]),
        el("label", { class: "field checkbox-field" }, [
          scopeSelf,
          el("span", {}, ["僅發給自己（測試）"]),
        ]),
        el("label", { class: "field checkbox-field" }, [scopeAll, el("span", {}, ["發給所有已訂閱裝置"])]),
      ]),
      el("div", { class: "row-actions" }, [sendImmediatePushBtn]),
      immediatePushStatus,
    );

    const tabBookings = el("button", { type: "button", class: "admin-tab", role: "tab" }, ["預約管理"]);
    tabBookings.id = "admin-tab-trigger-bookings";
    const tabHiddenBookings = el("button", { type: "button", class: "admin-tab", role: "tab" }, ["已隱藏"]);
    tabHiddenBookings.id = "admin-tab-trigger-hidden";
    const tabMembers = el("button", { type: "button", class: "admin-tab", role: "tab" }, ["會員與儲值"]);
    tabMembers.id = "admin-tab-trigger-members";
    const tabAnnounce = el("button", { type: "button", class: "admin-tab", role: "tab" }, ["跑馬燈公告"]);
    tabAnnounce.id = "admin-tab-trigger-announce";
    const tabPush = el("button", { type: "button", class: "admin-tab", role: "tab" }, ["推播設定"]);
    tabPush.id = "admin-tab-trigger-push";

    const adminTablist = el("div", { class: "admin-tabs", role: "tablist" });
    adminTablist.append(tabBookings, tabHiddenBookings, tabMembers, tabAnnounce, tabPush);

    const panelBookingsEl = el("div", { class: "admin-tab-panel", role: "tabpanel", id: "admin-tab-panel-bookings" });
    panelBookingsEl.setAttribute("aria-labelledby", "admin-tab-trigger-bookings");
    const panelHiddenBookingsEl = el("div", {
      class: "admin-tab-panel",
      role: "tabpanel",
      id: "admin-tab-panel-hidden",
      hidden: true,
    });
    panelHiddenBookingsEl.setAttribute("aria-labelledby", "admin-tab-trigger-hidden");
    panelHiddenBookingsEl.append(
      el("p", { class: "hint" }, [
        "以下為自「預約管理」主列表隱藏之預約，或舊版於資料庫標記為已刪除之筆。額度與可預約時段與主列表相同，仍依預約狀態計算（僅影響後台列表是否顯示）。筆數多時每頁 10 筆，請用列表下方「上一頁／下一頁」切換。",
      ]),
      hiddenBookingsStatus,
      hiddenTableHolder,
      hiddenPager,
    );
    const panelMembersEl = el("div", {
      class: "admin-tab-panel",
      role: "tabpanel",
      id: "admin-tab-panel-members",
      hidden: true,
    });
    panelMembersEl.setAttribute("aria-labelledby", "admin-tab-trigger-members");
    const panelAnnounceEl = el("div", {
      class: "admin-tab-panel",
      role: "tabpanel",
      id: "admin-tab-panel-announce",
      hidden: true,
    });
    panelAnnounceEl.setAttribute("aria-labelledby", "admin-tab-trigger-announce");
    const panelPushEl = el("div", {
      class: "admin-tab-panel",
      role: "tabpanel",
      id: "admin-tab-panel-push",
      hidden: true,
    });
    panelPushEl.setAttribute("aria-labelledby", "admin-tab-trigger-push");

    tabBookings.setAttribute("aria-controls", "admin-tab-panel-bookings");
    tabHiddenBookings.setAttribute("aria-controls", "admin-tab-panel-hidden");
    tabMembers.setAttribute("aria-controls", "admin-tab-panel-members");
    tabAnnounce.setAttribute("aria-controls", "admin-tab-panel-announce");
    tabPush.setAttribute("aria-controls", "admin-tab-panel-push");

    panelBookingsEl.append(adminStatus, tableHolder);
    panelMembersEl.append(accountCreateSection, walletTopupSection, memberListSection);
    panelAnnounceEl.append(announcementSection);
    panelPushEl.append(pushSettingsSection);

    const adminPanelsWrap = el("div", { class: "admin-tab-panels" });
    adminPanelsWrap.append(panelBookingsEl, panelHiddenBookingsEl, panelMembersEl, panelAnnounceEl, panelPushEl);

    const adminTabButtons = [tabBookings, tabHiddenBookings, tabMembers, tabAnnounce, tabPush] as const;
    const adminTabPanels = [panelBookingsEl, panelHiddenBookingsEl, panelMembersEl, panelAnnounceEl, panelPushEl] as const;

    function selectAdminTab(index: 0 | 1 | 2 | 3 | 4) {
      adminTabButtons.forEach((btn, i) => {
        const on = i === index;
        btn.setAttribute("aria-selected", String(on));
        btn.classList.toggle("is-active", on);
        btn.tabIndex = on ? 0 : -1;
      });
      adminTabPanels.forEach((panel, i) => {
        panel.hidden = i !== index;
        panel.classList.toggle("is-active", i === index);
      });
    }

    tabBookings.addEventListener("click", () => selectAdminTab(0));
    tabHiddenBookings.addEventListener("click", () => selectAdminTab(1));
    tabMembers.addEventListener("click", () => selectAdminTab(2));
    tabAnnounce.addEventListener("click", () => selectAdminTab(3));
    tabPush.addEventListener("click", () => selectAdminTab(4));

    adminTablist.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      ev.preventDefault();
      const cur = adminTabButtons.findIndex((b) => b.getAttribute("aria-selected") === "true");
      if (cur < 0) return;
      const delta = ev.key === "ArrowRight" ? 1 : -1;
      const n = adminTabButtons.length;
      const next = ((cur + delta) % n + n) % n;
      selectAdminTab(next as 0 | 1 | 2 | 3 | 4);
      adminTabButtons[next].focus();
    });

    selectAdminTab(0);

    adminWrap.append(top, adminTablist, adminPanelsWrap);

    void loadMemberList();

    const HIDDEN_ADMIN_PAGE_SIZE = 10;
    let hiddenAdminPageIndex = 0;
    type AdminHiddenQueueItem = { kind: "deleted" | "invisible"; b: Booking };
    const hiddenAdminQueue: AdminHiddenQueueItem[] = [];

    function appendHiddenDeletedRowAdmin(b: Booking) {
      hiddenTable.append(
        el("tr", {}, [
          el("td", { class: "mono" }, [formatWhen(b)]),
          el("td", {}, [b.displayName ?? ""]),
          el("td", {}, [bookingGuestYesNo(b)]),
          el("td", {}, [b.note ?? ""]),
          el("td", {}, [
            el("span", { class: "admin-booking-status-readonly" }, ["已刪除（舊資料）"]),
          ]),
          el("td", {}, [el("span", { class: "hint" }, ["—"])]),
        ]),
      );
    }

    function appendHiddenInvisibleRowAdmin(b: Booking) {
      const statusCell: HTMLElement =
        b.status === "cancelled"
          ? el("span", { class: "admin-booking-status-readonly" }, [bookingStatusLabel("cancelled")])
          : el("select", {}, []);
      const sel = b.status === "cancelled" ? null : (statusCell as HTMLSelectElement);
      if (sel) {
        for (const opt of ADMIN_STATUS_SELECT_OPTIONS) {
          const o = el("option", { value: opt.value }, [opt.label]);
          if (opt.value === b.status) o.setAttribute("selected", "selected");
          sel.append(o);
        }
        sel.addEventListener("change", async () => {
          const nextStatus = sel.value;
          const prevStatus = b.status;
          hiddenBookingsStatus.textContent = "更新中…";
          hiddenBookingsStatus.className = "status-line";
          try {
            if (nextStatus === "done") {
              const fn = completeBookingCall();
              await fn({ bookingId: b.id });
            } else {
              await updateDoc(doc(db, "bookings", b.id), {
                status: nextStatus,
                updatedAt: serverTimestamp(),
              });
            }
            hiddenBookingsStatus.textContent = "已更新";
            hiddenBookingsStatus.classList.add("ok");
            if (nextStatus === "done") {
              await refreshWalletStatus();
            }
          } catch (e) {
            sel.value = prevStatus;
            hiddenBookingsStatus.textContent =
              e instanceof Error ? e.message : "更新失敗（你是否已加入 admins 集合？）";
            hiddenBookingsStatus.classList.add("error");
          }
        });
      }
      const cancelBtn = el("button", { class: "ghost", type: "button" }, ["取消"]);
      const canAdminCancel = b.status !== "done" && b.status !== "cancelled";
      cancelBtn.disabled = !canAdminCancel;
      cancelBtn.title = !canAdminCancel
        ? b.status === "done"
          ? "已完成預約不可取消"
          : "已取消"
        : "";
      cancelBtn.addEventListener("click", async () => {
        if (!canAdminCancel) return;
        const summary = [
          "即將取消以下預約。取消原因可留空。",
          "",
          `姓名：${b.displayName ?? ""}`,
          `日期：${b.dateKey ?? ""}`,
          `開始時間：${b.startSlot ?? ""}`,
          `備註：${(b.note ?? "").trim() || "（無）"}`,
        ].join("\n");
        const reason = await showAdminCancelBookingModal(summary);
        if (reason === null) return;
        hiddenBookingsStatus.textContent = "取消中…";
        hiddenBookingsStatus.className = "status-line";
        cancelBtn.setAttribute("disabled", "true");
        try {
          const fn = cancelBookingCall();
          const payload: { bookingId: string; cancelReason?: string } = { bookingId: b.id };
          if (reason.length > 0) {
            payload.cancelReason = reason;
          }
          await fn(payload);
          hiddenBookingsStatus.textContent = "已取消";
          hiddenBookingsStatus.classList.add("ok");
          await refreshWalletStatus();
        } catch (e) {
          hiddenBookingsStatus.textContent = e instanceof Error ? e.message : "取消失敗";
          hiddenBookingsStatus.classList.add("error");
          cancelBtn.removeAttribute("disabled");
        }
      });
      const unhideBtn = el("button", { class: "ghost", type: "button" }, ["取消隱藏"]);
      unhideBtn.addEventListener("click", async () => {
        hiddenBookingsStatus.textContent = "處理中…";
        hiddenBookingsStatus.className = "status-line";
        unhideBtn.setAttribute("disabled", "true");
        try {
          await updateDoc(doc(db, "bookings", b.id), {
            invisible: false,
            updatedAt: serverTimestamp(),
          });
          hiddenBookingsStatus.textContent = "已恢復至預約管理列表";
          hiddenBookingsStatus.classList.add("ok");
        } catch (e) {
          hiddenBookingsStatus.textContent =
            e instanceof Error ? e.message : "還原失敗（你是否已加入 admins 集合？）";
          hiddenBookingsStatus.classList.add("error");
          unhideBtn.removeAttribute("disabled");
        }
      });
      const actionCell = el("div", { class: "admin-booking-actions" }, [cancelBtn, unhideBtn]);
      hiddenTable.append(
        el("tr", {}, [
          el("td", { class: "mono" }, [formatWhen(b)]),
          el("td", {}, [b.displayName ?? ""]),
          el("td", {}, [bookingGuestYesNo(b)]),
          el("td", {}, [b.note ?? ""]),
          el("td", {}, [statusCell]),
          el("td", {}, [actionCell]),
        ]),
      );
    }

    function paintHiddenAdminPage() {
      while (hiddenTable.rows.length > 1) {
        hiddenTable.deleteRow(1);
      }
      const total = hiddenAdminQueue.length;
      if (total === 0) {
        hiddenTable.append(
          el("tr", {}, [
            el("td", { class: "hint", colSpan: 6 }, ["目前沒有自列表隱藏或舊版已刪除之預約。"]),
          ]),
        );
        hiddenPagePrev.disabled = true;
        hiddenPageNext.disabled = true;
        hiddenPageInfo.textContent = "共 0 筆";
        return;
      }
      const totalPages = Math.ceil(total / HIDDEN_ADMIN_PAGE_SIZE);
      hiddenAdminPageIndex = Math.max(0, Math.min(hiddenAdminPageIndex, totalPages - 1));
      const from = hiddenAdminPageIndex * HIDDEN_ADMIN_PAGE_SIZE;
      for (const item of hiddenAdminQueue.slice(from, from + HIDDEN_ADMIN_PAGE_SIZE)) {
        if (item.kind === "deleted") appendHiddenDeletedRowAdmin(item.b);
        else appendHiddenInvisibleRowAdmin(item.b);
      }
      hiddenPagePrev.disabled = hiddenAdminPageIndex <= 0;
      hiddenPageNext.disabled = hiddenAdminPageIndex >= totalPages - 1;
      hiddenPageInfo.textContent = `第 ${hiddenAdminPageIndex + 1} / ${totalPages} 頁 · 共 ${total} 筆（每頁 ${HIDDEN_ADMIN_PAGE_SIZE} 筆）`;
    }

    hiddenPagePrev.addEventListener("click", () => {
      if (hiddenAdminPageIndex <= 0) return;
      hiddenAdminPageIndex -= 1;
      paintHiddenAdminPage();
    });
    hiddenPageNext.addEventListener("click", () => {
      const total = hiddenAdminQueue.length;
      if (total === 0) return;
      const totalPages = Math.ceil(total / HIDDEN_ADMIN_PAGE_SIZE);
      if (hiddenAdminPageIndex >= totalPages - 1) return;
      hiddenAdminPageIndex += 1;
      paintHiddenAdminPage();
    });

    const q = query(collection(db, "bookings"), orderBy("startAt", "desc"));
    adminUnsub = onSnapshot(
      q,
      (snap) => {
        adminStatus.textContent = "";
        adminStatus.className = "status-line";
        hiddenBookingsStatus.textContent = "";
        hiddenBookingsStatus.className = "status-line";
        const bookingTableHeader = () =>
          el("tr", {}, [
            el("th", {}, ["時間"]),
            el("th", {}, ["姓名"]),
            el("th", { title: "是否為訪客預約" }, ["訪客"]),
            el("th", {}, ["備註"]),
            el("th", {}, ["狀態"]),
            el("th", {}, ["操作"]),
          ]);
        table.innerHTML = "";
        table.append(bookingTableHeader());
        hiddenTable.innerHTML = "";
        hiddenTable.append(bookingTableHeader());
        hiddenAdminQueue.length = 0;
        for (const d of snap.docs) {
          const b = { id: d.id, ...d.data() } as Booking;
          if (b.status === "deleted" || b.invisible === true) {
            hiddenAdminQueue.push(
              b.status === "deleted" ? { kind: "deleted", b } : { kind: "invisible", b },
            );
            continue;
          }
          const statusCell: HTMLElement =
            b.status === "cancelled"
              ? el("span", { class: "admin-booking-status-readonly" }, [bookingStatusLabel("cancelled")])
              : el("select", {}, []);
          const sel = b.status === "cancelled" ? null : (statusCell as HTMLSelectElement);
          if (sel) {
            for (const opt of ADMIN_STATUS_SELECT_OPTIONS) {
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
                } else {
                  await updateDoc(doc(db, "bookings", b.id), {
                    status: nextStatus,
                    updatedAt: serverTimestamp(),
                  });
                }
                adminStatus.textContent = "已更新";
                adminStatus.classList.add("ok");
                if (nextStatus === "done") {
                  await refreshWalletStatus();
                }
              } catch (e) {
                sel.value = prevStatus;
                adminStatus.textContent =
                  e instanceof Error ? e.message : "更新失敗（你是否已加入 admins 集合？）";
                adminStatus.classList.add("error");
              }
            });
          }
          const cancelBtn = el("button", { class: "ghost", type: "button" }, ["取消"]);
          const canAdminCancel = b.status !== "done" && b.status !== "cancelled";
          cancelBtn.disabled = !canAdminCancel;
          cancelBtn.title = !canAdminCancel
            ? b.status === "done"
              ? "已完成預約不可取消"
              : "已取消"
            : "";
          cancelBtn.addEventListener("click", async () => {
            if (!canAdminCancel) return;
            const summary = [
              "即將取消以下預約。取消原因可留空。",
              "",
              `姓名：${b.displayName ?? ""}`,
              `日期：${b.dateKey ?? ""}`,
              `開始時間：${b.startSlot ?? ""}`,
              `備註：${(b.note ?? "").trim() || "（無）"}`,
            ].join("\n");
            const reason = await showAdminCancelBookingModal(summary);
            if (reason === null) return;
            adminStatus.textContent = "取消中…";
            adminStatus.className = "status-line";
            cancelBtn.setAttribute("disabled", "true");
            try {
              const fn = cancelBookingCall();
              const payload: { bookingId: string; cancelReason?: string } = { bookingId: b.id };
              if (reason.length > 0) {
                payload.cancelReason = reason;
              }
              await fn(payload);
              adminStatus.textContent = "已取消";
              adminStatus.classList.add("ok");
              await refreshWalletStatus();
            } catch (e) {
              adminStatus.textContent = e instanceof Error ? e.message : "取消失敗";
              adminStatus.classList.add("error");
              cancelBtn.removeAttribute("disabled");
            }
          });
          const deleteBtn = el("button", { class: "ghost", type: "button" }, ["隱藏"]);
          deleteBtn.addEventListener("click", async () => {
            const confirmed = await showConfirmModal(
              "確認自後台隱藏",
              `確定從後台列表隱藏這筆預約嗎？\n\n（不改變預約狀態；會員端仍顯示原狀態。額度與可預約時段仍依預約狀態計算，與主列表邏輯相同。）\n\n姓名：${b.displayName ?? ""}\n日期：${b.dateKey ?? ""}\n開始時間：${b.startSlot ?? ""}`,
              "隱藏",
            );
            if (!confirmed) return;
            adminStatus.textContent = "隱藏中…";
            adminStatus.className = "status-line";
            deleteBtn.setAttribute("disabled", "true");
            try {
              await updateDoc(doc(db, "bookings", b.id), {
                invisible: true,
                updatedAt: serverTimestamp(),
              });
              adminStatus.textContent = "已自後台隱藏";
              adminStatus.classList.add("ok");
            } catch (e) {
              adminStatus.textContent =
                e instanceof Error ? e.message : "隱藏失敗（你是否已加入 admins 集合？）";
              adminStatus.classList.add("error");
              deleteBtn.removeAttribute("disabled");
            }
          });
          const actionCell = el("div", { class: "admin-booking-actions" }, [cancelBtn, deleteBtn]);
          table.append(
            el("tr", {}, [
              el("td", { class: "mono" }, [formatWhen(b)]),
              el("td", {}, [b.displayName ?? ""]),
              el("td", {}, [bookingGuestYesNo(b)]),
              el("td", {}, [b.note ?? ""]),
              el("td", {}, [statusCell]),
              el("td", {}, [actionCell]),
            ]),
          );
        }
        paintHiddenAdminPage();
      },
      (err) => {
        console.error(err);
        const msg =
          "無法讀取預約（常見原因：Firestore Rules 拒絕，或尚未建立索引／admins 文件）。";
        adminStatus.textContent = msg;
        adminStatus.classList.add("error");
        hiddenBookingsStatus.textContent = msg;
        hiddenBookingsStatus.classList.add("error");
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
    titleGuestHint.hidden = !isBook;
    titleHeading.textContent = isBook ? "辦公室按摩預約" : "管理後台";
    titleDesc.textContent = isBook
      ? "週一至週五 · 開始時間 15 分鐘一格 · 單次服務約15~50分鐘, 看情況. · 午休 11:45–13:15 不開放 · 最晚 17:30 開始、18:00 前結束"
      : "以分頁切換：預約管理、會員與儲值、跑馬燈公告、推播設定。";
    panelBook.hidden = !isBook;
    panelAdmin.hidden = isBook;
    hostPortrait.hidden = !isBook;
    syncMarqueeVisibilityForTab();
    if (isBook) {
      stopAdminListener();
    } else {
      void syncAdminView();
    }
    syncPageHeadSession();
  }

  window.addEventListener("popstate", () => setTab(tabFromPath()));

  setTab(tabFromPath());
  void refreshWalletStatus();
}

render();
