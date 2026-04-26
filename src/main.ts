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
import { mountAdminReportsPanel } from "./adminReports";
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
  spinWheelCall,
  listActiveWheelPrizesCall,
  topupWalletCall,
} from "./firebase";
import { mountGuestbook } from "./guestbook";
import { mountMusicMiniPlayer } from "./musicPlayer";
import { attachMusicMiniPlayerFloatDrag } from "./musicMiniPlayerFloatDock";
import { mountAdminSupportChat, mountMemberSupportChat, type SupportChatUnmount } from "./supportChat";
import { attachSupportChatFloatDrag } from "./supportChatFloatDock";
import { createVisitorStatsLine } from "./visitorStats";
import { mountLuckySlotMachine } from "./luckySlotMachine";
import { allStartSlots } from "./slots";
import { runWheelSpectacle } from "./wheelSpectacle";
import {
  clampLedSpeed,
  createLedMarquee,
  LED_SPEED_MAX,
  LED_SPEED_MIN,
  type LedMarqueeHandle,
} from "./ledMarquee";
import { getLocale, initI18n, intlLocaleTag, localeApiParam, setLocale, t } from "./i18n";

type Booking = {
  id: string;
  displayName: string;
  note: string;
  dateKey: string;
  startSlot: string;
  status: string;
  startAt?: { seconds: number };
  cancelReason?: string;
  /** 與後端一致：該預約曆日所屬週的週一 dateKey */
  weekStart?: string;
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

function beverageOptionLabel(): string {
  return t("booking.beverageOption", "請師傅一杯飲料");
}

function bookingModeLabel(mode: BookingMode): string {
  const labels: Record<BookingMode, string> = {
    guest_cash: t("booking.mode.guest_cash", "訪客現金"),
    guest_beverage: beverageOptionLabel(),
    member_cash: t("booking.mode.member_cash", "會員現金"),
    member_wallet: t("booking.mode.member_wallet", "會員儲值"),
    member_beverage: beverageOptionLabel(),
  };
  return labels[mode];
}

/** 後台狀態下拉：不含「已取消」（改由「取消」按鈕呼叫 cancelBooking） */
function getAdminStatusSelectOptions(): { value: string; label: string }[] {
  return [
    { value: "pending", label: t("status.pending", "待確認") },
    { value: "confirmed", label: t("status.confirmed", "已確認") },
    { value: "done", label: t("status.done", "已完成") },
  ];
}

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
  return t("errors.generic", "發生錯誤");
}

/** 密碼輸入框右側「顯示／隱藏」切換（不改變 input 的 value） */
function wrapPasswordField(input: HTMLInputElement): HTMLElement {
  const row = el("div", { class: "field-password-row" });
  const btn = el("button", { type: "button", class: "ghost password-reveal-btn" }, [t("pwd.show", "顯示")]);
  btn.setAttribute("aria-label", t("pwd.ariaShow", "顯示密碼"));
  btn.setAttribute("aria-pressed", "false");
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.textContent = show ? t("pwd.hide", "隱藏") : t("pwd.show", "顯示");
    btn.setAttribute("aria-label", show ? t("pwd.ariaHide", "隱藏密碼") : t("pwd.ariaShow", "顯示密碼"));
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

const TAIPEI_LONG_WD: Record<string, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

function addDaysTaipeiDateKey(dateKey: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const inst = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
  inst.setTime(inst.getTime() + deltaDays * 86_400_000);
  return inst.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function taipeiWeekdayNumMon1Sun7(dateKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return Number.NaN;
  const inst = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
  const long = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "long" }).format(inst);
  return TAIPEI_LONG_WD[long as keyof typeof TAIPEI_LONG_WD] ?? Number.NaN;
}

function taipeiMondayOfSameWeek(dateKey: string): string {
  const wd = taipeiWeekdayNumMon1Sun7(dateKey);
  if (!Number.isFinite(wd)) return dateKey;
  return addDaysTaipeiDateKey(dateKey, -(wd - 1));
}

/** 與後端 `bookingLogic.taipeiLatestBookableDateKey` 一致：本週一起算，最遠可選「下週日」 */
function taipeiLatestBookableDateKey(): string {
  return addDaysTaipeiDateKey(taipeiMondayOfSameWeek(taipeiTodayDateKey()), 13);
}

/** 例如 2026-04-23（週三），供名額說明用 */
function dateKeyLabelTaipei(dateKey: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  try {
    const inst = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
    const wd = new Intl.DateTimeFormat(intlLocaleTag(), { timeZone: "Asia/Taipei", weekday: "short" }).format(
      inst,
    );
    return `${m[1]}-${m[2]}-${m[3]}（${wd}）`;
  } catch {
    return dateKey;
  }
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
  if (b.startAt?.seconds) {
    const d = new Date(b.startAt.seconds * 1000);
    return d.toLocaleString(intlLocaleTag(), { timeZone: "Asia/Taipei" });
  }
  return `${b.dateKey} ${b.startSlot}`;
}

function bookingStartMs(b: Booking): number {
  if (b.startAt?.seconds) return b.startAt.seconds * 1000;
  const t = slotStartInstantMsTaipei(b.dateKey, b.startSlot);
  return Number.isFinite(t) ? t : 0;
}

/** 「尚未開始」分頁：待確認／已確認，且預約開始時刻尚未到 */
function isMyBookingUpcomingTab(b: Booking): boolean {
  if (b.status !== "pending" && b.status !== "confirmed") return false;
  const start = bookingStartMs(b);
  if (!Number.isFinite(start) || start <= 0) return false;
  return start > Date.now();
}

function bookingStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: t("status.pending", "待確認"),
    confirmed: t("status.confirmed", "已確認"),
    done: t("status.done", "已完成"),
    cancelled: t("status.cancelled", "已取消"),
    deleted: t("status.deleted", "已刪除"),
  };
  return map[status] ?? status;
}

/** 後台預約表：是否為訪客預約（是／否） */
function bookingGuestYesNo(b: Pick<Booking, "bookingMode" | "customerId">): string {
  const mode = b.bookingMode;
  if (mode === "guest_cash" || mode === "guest_beverage") return t("guest.yes", "是");
  if (typeof mode === "string" && mode.startsWith("member_")) return t("guest.no", "否");
  if (typeof b.customerId === "string" && b.customerId.length > 0) return t("guest.no", "否");
  return t("guest.dash", "—");
}

/** 會員「我的預約」：後台取消有填原因時顯示 */
function myBookingReasonBlock(b: Booking): HTMLElement | null {
  if (b.status !== "cancelled") return null;
  const cr = typeof b.cancelReason === "string" ? b.cancelReason.trim() : "";
  if (!cr) return null;
  return el("div", { class: "my-booking-reason" }, [
    el("span", { class: "my-booking-reason-label" }, [t("myBooking.cancelReasonLabel", "取消說明：")]),
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
  const noteSummary = note || t("booking.summary.noteEmpty", "（未填寫）");
  return [
    t("booking.summary.intro", "請確認以下預約資訊："),
    `${t("booking.summary.name", "姓名")}：${displayName}`,
    `${t("booking.summary.date", "日期")}：${dateKey}`,
    `${t("booking.summary.start", "開始時間")}：${startSlot}`,
    `${t("booking.summary.mode", "付款方式")}：${bookingModeLabel(bookingMode)}`,
    `${t("booking.summary.note", "備註")}：${noteSummary}`,
    "",
    t("booking.summary.footer", "確認無誤後按「確定」送出。"),
  ].join("\n");
}

function showConfirmModal(
  title: string,
  message: string,
  confirmText = t("modal.confirmDefault", "確定"),
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "confirm-modal-title");
    const heading = el("h3", { id: "confirm-modal-title" }, [title]);
    const body = el("pre", { class: "modal-message" }, [message]);
    const cancelBtn = el("button", { class: "ghost", type: "button" }, [t("modal.cancel", "取消")]);
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
  return t("adminSession.fallbackName", "管理員");
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
    const dismissBtn = el("button", { class: "ghost", type: "button" }, [t("modal.close", "關閉")]);
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
    title: t("admin.cancelBooking.title", "取消預約"),
    summaryLines,
    reasonLabel: t("admin.cancelBooking.reasonLabel", "取消原因"),
    placeholder: t("admin.cancelBooking.reasonPlaceholder", "取消原因（選填，可不填）"),
    confirmText: t("admin.cancelBooking.confirm", "確認取消"),
  });
}

function render() {
  initI18n();
  const root = document.querySelector<HTMLDivElement>("#app")!;
  root.innerHTML = "";
  root.className = "";

  if (!isFirebaseConfigured()) {
    root.append(
      el("div", { class: "banner" }, [
        t(
          "errors.firebaseConfig",
          "尚未設定 Firebase：請複製 `.env.example` 為 `.env`，填入專案設定後執行 `npm run dev`。",
        ),
      ]),
    );
    return;
  }

  const auth = getFirebaseAuth();
  const db = getDb();

  let tab: "book" | "admin" = "book";

  const titleHeading = el("h1", {}, [t("home.title", "辦公室按摩預約")]);
  const titleDesc = el("p", {}, [
    t(
      "home.subtitle",
      "週一至週五 · 開始時間 15 分鐘一格 · 單次服務約15~50分鐘, 看情況. · 午休 11:45–13:15 不開放 · 最晚 17:30 開始、18:00 前結束",
    ),
  ]);
  const titleGuestHint = el("p", { class: "page-head-guest-hint" }, [
    t(
      "home.guestHint",
      "免事先註冊也可預約，選「訪客」付款方式即可；註冊會員則可儲值與抽獎。",
    ),
  ]);
  const visitorStats = createVisitorStatsLine(tabFromPath() !== "admin");
  const visitorStatsLine = visitorStats.element;
  const musicMiniRoot = el("div", {
    class: "music-mini-player-root music-mini-player-root--float",
    id: "music-mini-player-root",
  });
  const titleTextCol = el("div", { class: "page-head-text" }, [titleDesc, titleGuestHint, visitorStatsLine]);

  const memberEntryBtn = el("button", { class: "ghost member-entry", type: "button" }, [
    t("member.entryLogin", "會員登入"),
  ]);
  const headSessionLine1 = el("span", { class: "page-head-session__line" });
  const headSessionLine2 = el("span", { class: "page-head-session__line" });
  const headSessionStatus = el(
    "span",
    {
      class: "page-head-session",
      role: "status",
      ariaLive: "polite",
    },
    [headSessionLine1, headSessionLine2],
  );
  const localeField = el("label", { class: "locale-switch", htmlFor: "site-locale-select" }, [
    t("locale.fieldLabel", "介面語言"),
  ]);
  const localeSelect = el("select", { id: "site-locale-select", class: "locale-select" });
  localeSelect.append(
    el("option", { value: "zh-Hant" }, [t("locale.option.zh", "繁體中文")]),
    el("option", { value: "en" }, [t("locale.option.en", "English")]),
  );
  localeSelect.value = getLocale();
  localeSelect.addEventListener("change", () => {
    const v = localeSelect.value === "en" ? "en" : "zh-Hant";
    setLocale(v);
  });
  const headLocale = el("div", { class: "head-locale" }, [localeField, localeSelect]);
  const headSession = el("div", { class: "head-session" }, [headSessionStatus, memberEntryBtn]);
  const headToolbarAside = el("div", { class: "head-toolbar-aside" }, [headLocale, headSession]);
  /** 標題獨立一整列；語系／會員為下一列（登入狀態可換行顯示全文） */
  const pageHeadTitleRow = el("div", { class: "page-head-title-row" }, [titleHeading]);
  const pageHeadControlsRow = el("div", { class: "page-head-controls-row" }, [headToolbarAside]);
  const pageHeadBody = el("div", { class: "page-head-body" }, [pageHeadTitleRow, pageHeadControlsRow, titleTextCol]);

  const hostPortrait = el("figure", { class: "host-atelier" }, [
    el("div", { class: "host-atelier__frame" }, [
      el("img", {
        class: "host-atelier__img",
        src: "/host-portrait.png",
        alt: t(
          "home.hostAlt",
          "主理人肖像：由凝視、伏案書寫與窗邊沉思三幅畫面組成的直式影像。",
        ),
        loading: "lazy",
        decoding: "async",
      }),
    ]),
    el("figcaption", { class: "host-atelier__cap" }, [t("home.hostCaption", "片刻的暗影與光，也是留給身體的空白。")]),
  ]);

  const panelBook = el("main", { class: "panel" });
  const panelAdmin = el("main", { class: "panel", hidden: true });

  const shell = el("div", { class: "shell" }, [
    el("header", { class: "page-head" }, [pageHeadBody]),
    hostPortrait,
    panelBook,
    panelAdmin,
  ]);

  root.append(shell);
  root.append(musicMiniRoot);
  let musicFloatDock: ReturnType<typeof attachMusicMiniPlayerFloatDrag> | null = null;
  const musicPlayerHandle = mountMusicMiniPlayer(musicMiniRoot, {
    onBoundsChange: () => musicFloatDock?.relayout(),
  });
  musicFloatDock = attachMusicMiniPlayerFloatDrag(musicMiniRoot, musicPlayerHandle.floatDragTarget);

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

  const appVersionFooter = el("footer", { class: "app-version-footer" }, []);
  appVersionFooter.textContent = t("footer.version", "版號 {{ver}} · 最後更新 {{date}}（台北）", {
    ver: __APP_VERSION__,
    date: __APP_BUILD_DATE__,
  });
  shell.append(appVersionFooter);

  /** --- 預約表單 --- */
  const nameInput = el("input", { type: "text", autocomplete: "name", maxLength: 80 });
  const dateInput = el("input", { type: "date" });
  dateInput.min = taipeiTodayDateKey();
  dateInput.max = taipeiLatestBookableDateKey();
  const slotSelect = el("select", {}, []);
  const noteInput = el("textarea", { maxLength: 500 });
  const bookingModeSelect = el("select", {}, []);
  const bookingModeHint = el("span", { class: "hint" }, [
    t("booking.modeHintGuest", "訪客預約以現金 50 元結帳；儲值與抽獎請使用右上角登入。"),
  ]);
  const submitBtn = el("button", { class: "primary", type: "button" }, [t("booking.submit", "送出預約")]);
  /** 選日期／載入空檔與名額相關提示，緊接在時段選擇下方，避免訊息落在頁面底部 */
  const scheduleStatus = el("div", {
    class: "status-line schedule-status",
    role: "status",
    ariaLive: "polite",
  });
  const bookStatus = el("div", { class: "status-line book-submit-status", role: "status", ariaLive: "polite" });
  const meta = el("div", { class: "meta-pills" });
  const bookFooterNote = el("div", { class: "footer-note" });
  bookFooterNote.textContent = t(
    "booking.rulesFooterDefault",
    "規則：同一天最多 2 筆、同一工作週最多 4 筆；已取消的不計入名額。",
  );
  function setBookFooterFromCaps(dayCap: number, weekCap: number) {
    bookFooterNote.textContent = t("booking.rulesFooter", "規則：同一天最多 {{dayCap}} 筆、同一工作週最多 {{weekCap}} 筆；已取消的不計入名額。", {
      dayCap,
      weekCap,
    });
  }
  const walletStatus = el("div", { class: "status-line" });
  const wheelStatus = el("div", { class: "status-line" });
  const wheelResult = el("div", { class: "pill", hidden: true });
  const spinBtn = el("button", { class: "ghost", type: "button" }, [t("booking.spinWheel", "抽輪盤")]);
  /** 僅登入後顯示：餘額／抽輪盤（訪客預約不需此區） */
  const memberExtrasWrap = el("div", { class: "book-member-extras", hidden: true });
  const emailVerifyBanner = el("div", { class: "email-verify-banner", hidden: true });
  const emailVerifyText = el("p", { class: "hint" }, []);
  const resendVerifyBtn = el("button", { class: "ghost", type: "button" }, [
    t("booking.resendVerify", "重新寄送驗證信"),
  ]);
  const reloadVerifyBtn = el("button", { class: "ghost", type: "button" }, [
    t("booking.reloadVerify", "我已驗證，重新整理狀態"),
  ]);
  emailVerifyBanner.append(emailVerifyText, el("div", { class: "row-actions" }, [resendVerifyBtn, reloadVerifyBtn]));
  let walletBalance = 0;
  let drawChances = 0;

  let myBookingsUnsub: (() => void) | null = null;
  let myBookingsListenerUid: string | null = null;
  const myBookingsSection = el("div", { class: "my-bookings" }, []);
  const myBookingsHint = el("div", { class: "status-line" });
  const myBookingsTabList = el("div", { class: "book-tabs my-bookings-tabs", role: "tablist" }, []);
  myBookingsTabList.setAttribute("aria-label", t("myBookings.tabsAria", "我的預約分類"));
  const myBookingsTabUpcoming = el(
    "button",
    { type: "button", class: "tab book-tab", role: "tab", id: "my-bookings-tab-upcoming" },
    [t("myBookings.tab.upcoming", "尚未開始")],
  );
  const myBookingsTabEnded = el(
    "button",
    { type: "button", class: "tab book-tab", role: "tab", id: "my-bookings-tab-ended" },
    [t("myBookings.tab.ended", "已結束")],
  );
  myBookingsTabUpcoming.setAttribute("aria-controls", "my-bookings-panel-upcoming");
  myBookingsTabEnded.setAttribute("aria-controls", "my-bookings-panel-ended");
  myBookingsTabList.append(myBookingsTabUpcoming, myBookingsTabEnded);

  const myBookingsPanelUpcoming = el("div", {
    class: "book-tab-panel my-bookings-tab-panel",
    id: "my-bookings-panel-upcoming",
  });
  const myBookingsPanelEnded = el("div", {
    class: "book-tab-panel my-bookings-tab-panel",
    id: "my-bookings-panel-ended",
  });
  myBookingsPanelUpcoming.setAttribute("aria-labelledby", "my-bookings-tab-upcoming");
  myBookingsPanelEnded.setAttribute("aria-labelledby", "my-bookings-tab-ended");

  const myBookingsListUpcoming = el("div", { class: "my-bookings-list" }, []);
  const myBookingsListEnded = el("div", { class: "my-bookings-list" }, []);
  myBookingsPanelUpcoming.append(myBookingsListUpcoming);
  myBookingsPanelEnded.append(myBookingsListEnded);
  myBookingsPanelEnded.hidden = true;

  function setMyBookingsSubTab(which: "upcoming" | "ended") {
    const isUpcoming = which === "upcoming";
    myBookingsTabUpcoming.setAttribute("aria-selected", String(isUpcoming));
    myBookingsTabEnded.setAttribute("aria-selected", String(!isUpcoming));
    myBookingsTabUpcoming.tabIndex = isUpcoming ? 0 : -1;
    myBookingsTabEnded.tabIndex = isUpcoming ? -1 : 0;
    myBookingsPanelUpcoming.hidden = !isUpcoming;
    myBookingsPanelEnded.hidden = isUpcoming;
  }
  myBookingsTabUpcoming.addEventListener("click", () => setMyBookingsSubTab("upcoming"));
  myBookingsTabEnded.addEventListener("click", () => setMyBookingsSubTab("ended"));
  setMyBookingsSubTab("upcoming");

  myBookingsSection.append(
    el("p", { class: "hint my-bookings-intro" }, [
      t(
        "myBookings.intro",
        "以下為綁定你帳號的預約（須使用會員付款方式送出）。訪客預約不會出現在此。「尚未開始」僅含待確認／已確認且尚未到開始時間；其餘在「已結束」。",
      ),
    ]),
    myBookingsTabList,
    myBookingsHint,
    myBookingsPanelUpcoming,
    myBookingsPanelEnded,
  );

  function appendMyBookingRow(list: HTMLElement, b: Booking) {
    const canCancel = b.status === "pending" || b.status === "confirmed";
    const row = el("div", { class: "my-booking-row" }, []);
    const mainCol = el("div", { class: "my-booking-main" }, []);
    mainCol.append(
      el("div", { class: "mono my-booking-when" }, [formatWhen(b)]),
      el("div", { class: "my-booking-status" }, [bookingStatusLabel(b.status)]),
    );
    const actions = el("div", { class: "my-booking-actions" }, []);
    if (canCancel) {
      const btn = el("button", { class: "ghost", type: "button" }, [t("myBookings.cancel", "取消預約")]);
      btn.addEventListener("click", async () => {
        const ok = await showConfirmModal(
          t("myBookings.cancel", "取消預約"),
          t("myBookings.confirmCancelBody", "確定取消這筆預約？\n\n{{when}}", { when: formatWhen(b) }),
          t("myBookings.cancel", "取消預約"),
        );
        if (!ok) return;
        btn.setAttribute("disabled", "true");
        try {
          const fn = cancelBookingCall();
          await fn({ bookingId: b.id, ...localeApiParam() });
          await refreshWalletStatus();
        } catch (e) {
          myBookingsHint.textContent = e instanceof Error ? e.message : t("myBookings.cancelFail", "取消失敗");
          myBookingsHint.classList.add("error");
          btn.removeAttribute("disabled");
        }
      });
      actions.append(btn);
    }
    row.append(mainCol, actions);
    const reasonEl = myBookingReasonBlock(b);
    if (reasonEl) row.append(reasonEl);
    list.append(row);
  }

  function stopMyBookingsListener() {
    if (myBookingsUnsub) {
      myBookingsUnsub();
      myBookingsUnsub = null;
    }
    myBookingsListenerUid = null;
    myBookingsListUpcoming.innerHTML = "";
    myBookingsListEnded.innerHTML = "";
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
        myBookingsListUpcoming.innerHTML = "";
        myBookingsListEnded.innerHTML = "";
        myBookingsHint.textContent = "";
        myBookingsHint.className = "status-line";
        if (snap.empty) {
          myBookingsListUpcoming.append(
            el("p", { class: "hint my-bookings-empty" }, [
              t(
                "myBookings.emptyUpcoming",
                "尚無進行中的預約。請用會員儲值／現金／飲料折抵送出預約後，待確認或已確認且尚未到開始時間的會顯示於此。",
              ),
            ]),
          );
          myBookingsListEnded.append(
            el("p", { class: "hint my-bookings-empty" }, [
              t("myBookings.emptyEnded", "尚無已結束的紀錄（已完成、已取消、已刪除或已過開始時間）。"),
            ]),
          );
          return;
        }
        const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Booking));
        const upcoming = all.filter(isMyBookingUpcomingTab).sort((a, b) => bookingStartMs(a) - bookingStartMs(b));
        const ended = all.filter((b) => !isMyBookingUpcomingTab(b)).sort((a, b) => bookingStartMs(b) - bookingStartMs(a));

        if (upcoming.length === 0) {
          myBookingsListUpcoming.append(
            el("p", { class: "hint my-bookings-empty" }, [
              t(
                "myBookings.emptyUpcoming",
                "尚無進行中的預約。請用會員儲值／現金／飲料折抵送出預約後，待確認或已確認且尚未到開始時間的會顯示於此。",
              ),
            ]),
          );
        } else {
          for (const b of upcoming) appendMyBookingRow(myBookingsListUpcoming, b);
        }

        if (ended.length === 0) {
          myBookingsListEnded.append(
            el("p", { class: "hint my-bookings-empty" }, [
              t("myBookings.emptyEnded", "尚無已結束的紀錄（已完成、已取消、已刪除或已過開始時間）。"),
            ]),
          );
        } else {
          for (const b of ended) appendMyBookingRow(myBookingsListEnded, b);
        }
      },
      (err) => {
        console.error(err);
        myBookingsHint.textContent = t(
          "myBookings.loadFail",
          "無法載入我的預約。若專案剛新增索引，請執行 firebase deploy 並等待索引建立完成。",
        );
        myBookingsHint.classList.add("error");
      },
    );
  }

  function updateMemberEntryLabel() {
    const user = auth.currentUser;
    memberEntryBtn.textContent = user ? t("member.entryCenter", "會員中心") : t("member.entryLogin", "會員登入");
  }

  /** 預約頁右上角：訪客／登入與驗證狀態／稱呼（單行；過長省略，完整字串放 title） */
  function syncPageHeadSession(profileLabel?: string) {
    if (tab !== "book") {
      headSessionStatus.hidden = true;
      return;
    }
    headSessionStatus.hidden = false;
    const setLines = (line1: string, line2: string | null) => {
      const text = line2 == null || line2 === "" ? line1 : `${line1}${line2}`;
      headSessionLine1.textContent = text;
      headSessionLine2.textContent = "";
      headSessionLine2.setAttribute("hidden", "");
    };
    const u = auth.currentUser;
    if (!u) {
      setLines(t("session.guest", "訪客"), null);
      headSessionStatus.removeAttribute("title");
      headSessionStatus.className = "page-head-session";
      return;
    }
    if (u.isAnonymous) {
      setLines(t("session.guestChat", "訪客留言模式"), null);
      headSessionStatus.title = t("session.guestChatTitle", "已建立匿名身分，僅用於聯絡店家");
      headSessionStatus.className = "page-head-session page-head-session--pending";
      return;
    }
    if (!u.emailVerified) {
      setLines(
        t("session.signInLine1", "已登入 ·"),
        t("session.verifyPendingLine2", "待驗證信箱"),
      );
      headSessionStatus.title = u.email ?? t("session.verifyTitleFallback", "尚未驗證信箱");
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
            : t("session.memberFallback", "會員");
    const prefix = t("session.signInLine1", "已登入 ·");
    const combinedFull = `${prefix}${raw}`;
    const displayed = truncateOneLine(combinedFull, 28);
    setLines(displayed, null);
    headSessionStatus.title = displayed !== combinedFull ? combinedFull : "";
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
      emailVerifyText.textContent = t("member.verifyResent", "已再次寄出驗證信，請檢查信箱（含垃圾郵件）。");
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
        ? t("member.verifyDone", "驗證完成，已可使用會員功能。")
        : t("member.verifyPendingReload", "尚未偵測到驗證完成，請確認已點擊信內連結後再試。");
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
      const modalTitle = el("h3", {}, [t("auth.modal.title", "會員登入／註冊")]);
      const loginStack = el("div", { class: "member-auth-stack" });
      const registerStack = el("div", { class: "member-auth-stack", hidden: true });
      const resetStack = el("div", { class: "member-auth-stack", hidden: true });

      const loginEmail = el("input", {
        type: "email",
        autocomplete: "username",
        placeholder: t("auth.placeholder.email", "會員 Email"),
      });
      const loginPassword = el("input", {
        type: "password",
        autocomplete: "current-password",
        placeholder: t("auth.placeholder.password", "會員密碼"),
      });
      const loginBtn = el("button", { class: "primary", type: "button" }, [t("auth.login", "登入")]);
      const registerEmail = el("input", {
        type: "email",
        autocomplete: "username",
        placeholder: t("auth.placeholder.email", "會員 Email"),
      });
      const registerPassword = el("input", {
        type: "password",
        autocomplete: "new-password",
        placeholder: t("auth.placeholder.newPassword", "密碼（至少 6 碼）"),
      });
      const registerPassword2 = el("input", {
        type: "password",
        autocomplete: "new-password",
        placeholder: t("auth.placeholder.newPassword2", "再次輸入密碼"),
      });
      const registerBtn = el("button", { class: "primary", type: "button" }, [t("auth.registerSend", "註冊並寄驗證信")]);
      const resetSendBtn = el("button", { class: "primary", type: "button" }, [t("auth.resetSend", "寄送重設密碼信")]);
      const cancelBtn = el("button", { class: "ghost", type: "button" }, [t("modal.close", "關閉")]);
      const switchToRegister = el("button", { class: "ghost", type: "button" }, [t("auth.switchRegister", "還沒有帳號？註冊")]);
      const switchToLogin = el("button", { class: "ghost", type: "button" }, [t("auth.switchLogin", "返回登入")]);
      const switchToForgot = el("button", { class: "ghost", type: "button" }, [t("auth.forgot", "忘記密碼？")]);
      const switchToForgotFromRegister = el("button", { class: "ghost", type: "button" }, [t("auth.forgot", "忘記密碼？")]);
      const switchToLoginFromReset = el("button", { class: "ghost", type: "button" }, [t("auth.switchLogin", "返回登入")]);
      const resetEmail = el("input", {
        type: "email",
        autocomplete: "username",
        placeholder: t("auth.placeholder.resetEmail", "註冊時使用的 Email"),
      });

      function syncAuthModalPrimaryButtons() {
        loginBtn.hidden = loginStack.hidden;
        registerBtn.hidden = registerStack.hidden;
        resetSendBtn.hidden = resetStack.hidden;
      }
      function showLoginStack() {
        loginStack.hidden = false;
        registerStack.hidden = true;
        resetStack.hidden = true;
        modalTitle.textContent = t("auth.modal.title", "會員登入／註冊");
        status.textContent = "";
        status.className = "status-line";
        syncAuthModalPrimaryButtons();
      }
      function showRegisterStack() {
        loginStack.hidden = true;
        registerStack.hidden = false;
        resetStack.hidden = true;
        modalTitle.textContent = t("auth.modal.title", "會員登入／註冊");
        status.textContent = "";
        status.className = "status-line";
        syncAuthModalPrimaryButtons();
      }
      function showResetStack() {
        loginStack.hidden = true;
        registerStack.hidden = true;
        resetStack.hidden = false;
        modalTitle.textContent = t("auth.resetTitle", "重設密碼");
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
          status.textContent = e instanceof Error ? e.message : t("auth.loginFail", "登入失敗");
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
          status.textContent = t("auth.needEmailPassword", "請輸入 Email 與密碼。");
          status.classList.add("error");
          return;
        }
        if (pw.length < 6) {
          status.textContent = t("auth.passwordMin", "密碼至少 6 碼。");
          status.classList.add("error");
          return;
        }
        if (pw !== pw2) {
          status.textContent = t("auth.passwordMismatch", "兩次輸入的密碼不一致。");
          status.classList.add("error");
          return;
        }
        registerBtn.setAttribute("disabled", "true");
        try {
          const cred = await createUserWithEmailAndPassword(auth, em, pw);
          await sendEmailVerification(cred.user);
          status.textContent = t(
            "auth.registerSuccess",
            "註冊成功，已寄出驗證信。請至信箱點擊連結後，再按主畫面的「我已驗證，重新整理狀態」或重新登入。",
          );
          status.classList.add("ok");
          overlay.remove();
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : t("auth.registerFail", "註冊失敗");
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
          status.textContent = t("auth.needEmail", "請輸入 Email。");
          status.classList.add("error");
          return;
        }
        resetSendBtn.setAttribute("disabled", "true");
        try {
          await sendPasswordResetEmail(auth, em);
          status.textContent = t(
            "auth.resetHintSent",
            "若此 Email 已註冊，您將很快收到重設密碼信（請一併查看垃圾郵件）。收到信後點連結即可設定新密碼。",
          );
          status.classList.add("ok");
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : t("auth.resetSendFail", "寄送失敗");
          status.classList.add("error");
        } finally {
          resetSendBtn.removeAttribute("disabled");
        }
      });

      loginStack.append(
        el("label", { class: "field" }, ["Email", loginEmail]),
        el("label", { class: "field" }, [t("auth.label.password", "密碼"), wrapPasswordField(loginPassword)]),
        el("div", { class: "hint member-auth-links" }, [switchToRegister, switchToForgot]),
      );
      registerStack.append(
        el("label", { class: "field" }, ["Email", registerEmail]),
        el("label", { class: "field" }, [t("auth.label.password", "密碼"), wrapPasswordField(registerPassword)]),
        el("label", { class: "field" }, [t("auth.label.confirmPassword", "確認密碼"), wrapPasswordField(registerPassword2)]),
        el("div", { class: "hint member-auth-links" }, [switchToLogin, switchToForgotFromRegister]),
      );
      resetStack.append(
        el("p", { class: "hint" }, [
          t(
            "auth.resetHint",
            "輸入註冊時使用的 Email，我們將寄出重設密碼連結。若未收到信，請確認信箱正確並檢查垃圾郵件匣。",
          ),
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
      const closeBtn = el("button", { class: "ghost", type: "button" }, [t("modal.close", "關閉")]);
      const logoutBtn = el("button", { class: "primary", type: "button" }, [t("admin.signOut", "登出")]);
      closeBtn.addEventListener("click", () => overlay.remove());
      logoutBtn.addEventListener("click", async () => {
        await signOut(auth);
        overlay.remove();
      });
      if (user.isAnonymous) {
        dialog.append(
          el("h3", {}, [t("member.center", "會員中心")]),
          el("div", { class: "hint" }, [
            t(
              "member.anonymousIntro",
              "您正以訪客身分使用「聯絡店家」。若要儲值、查看預約或抽獎，請先按「登出」再使用「會員登入／註冊」；登入會員後，此裝置上的訪客留言紀錄不會自動合併。",
            ),
          ]),
          el("div", { class: "hint mono" }, [`${t("member.anonymousUid", "匿名身分 UID：")}${shortUidForDisplay(user.uid)}`]),
          el("div", { class: "modal-actions" }, [closeBtn, logoutBtn]),
        );
        overlay.addEventListener("click", (ev) => {
          if (ev.target === overlay) overlay.remove();
        });
        overlay.append(dialog);
        document.body.append(overlay);
        return;
      }
      const modalBody: HTMLElement[] = [
        el("h3", {}, [t("member.center", "會員中心")]),
        el("div", { class: "hint" }, [
          t("member.signedInAs", "目前登入：{{email}}（UID：{{uid}}）", {
            email: user.email ?? t("member.noEmail", "（無 Email）"),
            uid: shortUidForDisplay(user.uid),
          }),
        ]),
      ];
      if (!user.emailVerified) {
        const verifyHint = el("div", { class: "status-line" }, [
          t("member.verifyModalHint", "請至信箱點擊驗證連結後，才能使用儲值、會員預約與抽獎。"),
        ]);
        const modalVerifyStatus = el("div", { class: "status-line" });
        const modalResendBtn = el("button", { class: "ghost", type: "button" }, [t("booking.resendVerify", "重新寄送驗證信")]);
        const modalReloadBtn = el("button", { class: "ghost", type: "button" }, [t("booking.reloadVerify", "我已驗證，重新整理")]);
        modalResendBtn.addEventListener("click", async () => {
          const u = auth.currentUser;
          if (!u || u.emailVerified) return;
          modalVerifyStatus.textContent = "";
          modalVerifyStatus.className = "status-line";
          modalResendBtn.setAttribute("disabled", "true");
          try {
            await sendEmailVerification(u);
            modalVerifyStatus.textContent = t("auth.verifySentShort", "已寄出驗證信。");
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
              ? t("auth.verifyDoneShort", "驗證完成。")
              : t("auth.verifyPendingShort", "尚未偵測到驗證完成，請確認已點擊信內連結。");
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
          { value: "member_wallet", label: t("member.mode.wallet", "會員儲值（扣 50 元）") },
          { value: "member_cash", label: t("member.mode.cash", "會員現金（50 元）") },
          { value: "member_beverage", label: beverageOptionLabel() },
        ]
      : [
          { value: "guest_cash", label: t("booking.mode.guest_cash", "訪客現金") },
          { value: "guest_beverage", label: beverageOptionLabel() },
        ];
    for (const mode of modes) {
      const opt = el("option", { value: mode.value, disabled: mode.disabled }, [mode.label]);
      bookingModeSelect.append(opt);
    }
    const values = modes.map((m) => m.value);
    bookingModeSelect.value = values.includes(current) ? current : modes[0].value;
    const loggedInUnverified = Boolean(
      auth.currentUser && !auth.currentUser.isAnonymous && !auth.currentUser.emailVerified,
    );
    bookingModeHint.textContent = isMember
      ? t("member.modeHint.member", "可選儲值扣款、會員現金（50 元），或「請師傅一杯飲料」（依現場約定）。")
      : loggedInUnverified
        ? t(
            "member.modeHint.unverified",
            "已登入但尚未驗證信箱，暫以訪客方式預約；完成驗證後可選會員付款、儲值與抽獎。",
          )
        : t("member.modeHint.guest", "訪客可選現金 50 元或「請師傅一杯飲料」；儲值與抽獎請使用右上角登入。");
  }

  /** 與下方 `setBookSubTab` 一併指派：會員區隱藏時關閉「我的預約」分頁並切回預約表單 */
  let syncBookMyBookingsTabVisibility: () => void = () => {};

  async function refreshWalletStatus() {
    try {
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
      if (user.isAnonymous) {
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
        emailVerifyText.textContent = t(
          "member.verifyBanner",
          "已登入，但尚未完成 Email 驗證。請至信箱點擊驗證連結；完成後請按「我已驗證，重新整理狀態」。",
        );
        walletStatus.textContent = "";
        walletStatus.className = "status-line";
        spinBtn.setAttribute("disabled", "true");
        wheelStatus.textContent = t("member.wheelNeedVerifyFirst", "完成信箱驗證後才可抽輪盤。");
        wheelStatus.className = "status-line";
        wheelResult.hidden = true;
        syncPageHeadSession();
        return;
      }
      emailVerifyBanner.hidden = true;
      ensureMyBookingsListener(user.uid);
      walletStatus.textContent = t("member.walletLoading", "讀取會員餘額中…");
      walletStatus.className = "status-line";
      syncPageHeadSession(user.displayName?.trim() || user.email?.trim());
      try {
        const fn = getMyWalletCall();
        const res = await fn({ ...localeApiParam() });
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
        walletStatus.textContent = t("member.walletLine", "會員已登入：儲值餘額 {{balance}} 元，可抽次數 {{chances}}。", {
          balance: walletBalance,
          chances: drawChances,
        });
        walletStatus.className = "status-line ok";
        wheelStatus.textContent =
          drawChances > 0 ? t("member.wheelLuck", "可抽輪盤，祝你好運！") : t("member.wheelNone", "目前無可抽次數。");
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
        wheelStatus.textContent = t("member.wheelStateFail", "無法讀取抽獎狀態。");
        wheelStatus.className = "status-line error";
        syncPageHeadSession();
      }
    } finally {
      syncBookMyBookingsTabVisibility();
    }
  }

  async function fetchWheelPrizeLabelsForSpectacle() {
    const fn = listActiveWheelPrizesCall();
    const res = await fn({ ...localeApiParam() });
    const data = res.data as { prizes: { id: string; name: string; weight: number }[] };
    return data.prizes;
  }

  /** 預覽輪盤用：固定示範獎項（不連後端），格內可立即看到文字與比例 */
  const wheelPreviewMockPrizes: { id: string; name: string; weight: number }[] = [
    { id: "pv-c10", name: t("wheel.previewPrizeC10", "+10 儲值金"), weight: 22 },
    { id: "pv-c5", name: t("wheel.previewPrizeName", "【預覽】+5 儲值金"), weight: 26 },
    { id: "pv-ch", name: t("wheel.previewPrizeExtra", "再抽一次"), weight: 16 },
    { id: "pv-th", name: t("wheel.previewPrizeThanks", "銘謝惠顧"), weight: 24 },
    { id: "pv-pn", name: t("wheel.previewPrizeFun", "小處罰文案"), weight: 12 },
  ];

  spinBtn.addEventListener("click", async () => {
    wheelStatus.textContent = "";
    wheelStatus.className = "status-line";
    if (!auth.currentUser) {
      wheelStatus.textContent = t("wheel.spinNeedLogin", "請先登入會員。");
      wheelStatus.classList.add("error");
      return;
    }
    if (!auth.currentUser.emailVerified) {
      wheelStatus.textContent = t("wheel.spinNeedVerify", "請先完成 Email 驗證。");
      wheelStatus.classList.add("error");
      return;
    }
    if (drawChances < 1) {
      wheelStatus.textContent = t("wheel.spinNoChances", "目前沒有可抽次數。");
      wheelStatus.classList.add("error");
      return;
    }
    spinBtn.setAttribute("disabled", "true");
    try {
      const data = await runWheelSpectacle(
        async () => {
          const fn = spinWheelCall();
          const res = await fn({ ...localeApiParam() });
          return res.data as {
            prize: { name: string; type: string; value: number };
            drawChances: number;
            walletBalance: number;
          };
        },
        { splitAnchor: wheelRow, fetchPrizeLabels: fetchWheelPrizeLabelsForSpectacle },
      );
      wheelResult.textContent = `${t("wheel.spinWonPrefix", "抽中：")}${data.prize.name}`;
      wheelResult.hidden = false;
      wheelStatus.textContent = t("wheel.spinDone", "抽獎完成！");
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
    const opt0 = el("option", { value: "" }, [t("slot.optionPick", "請選擇開始時間")]);
    slotSelect.append(opt0);
    for (const s of allStartSlots()) {
      const takenHere = taken.has(s);
      const pastHere = isStartSlotInPastForTaipeiToday(selectedDateKey, s);
      const blockReason = blockedReasonBySlot.get(s);
      const blockedHere = blockReason !== undefined;
      const blockNote =
        blockedHere && blockReason
          ? t("slot.blockedWith", "（不開放：{{reason}}）", { reason: blockReason })
          : blockedHere
            ? t("slot.blocked", "（不開放預約）")
            : "";
      const suffix = takenHere
        ? t("slot.taken", "（已佔用）")
        : pastHere
          ? t("slot.past", "（已過）")
          : blockNote;
      const o = el("option", { value: s, disabled: takenHere || pastHere || blockedHere }, [
        `${s}${suffix}`,
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
    scheduleStatus.textContent = "";
    scheduleStatus.className = "status-line schedule-status";
    meta.innerHTML = "";
    const dk = dateInput.value;
    if (!dk) {
      refillSlots(new Set(), true, "", new Map());
      meta.append(
        el("span", { class: "pill" }, [t("booking.pickSlotFirst", "先選擇日期後，會顯示可選時段與名額")]),
      );
      return;
    }

    const minKey = taipeiTodayDateKey();
    const maxKey = taipeiLatestBookableDateKey();
    dateInput.min = minKey;
    dateInput.max = maxKey;
    if (dk < minKey) {
      refillSlots(new Set(), true, "", new Map());
      scheduleStatus.textContent = t("booking.datePast", "不可選擇今天以前的日期。");
      scheduleStatus.classList.add("error");
      dateInput.value = "";
      return;
    }

    if (dk > maxKey) {
      refillSlots(new Set(), true, "", new Map());
      scheduleStatus.textContent = t("booking.dateBeyond", "僅能預約至下週日為止。");
      scheduleStatus.classList.add("error");
      dateInput.value = "";
      return;
    }

    if (!isDateKeyMonFri(dk)) {
      refillSlots(new Set(), true, dk, new Map());
      scheduleStatus.textContent = t("booking.weekdayOnly", "僅能預約週一到週五。");
      scheduleStatus.classList.add("error");
      return;
    }

    try {
      const fn = getAvailabilityCall();
      const res = await fn({ dateKey: dk, ...localeApiParam() });
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
      const weekMon = taipeiMondayOfSameWeek(dk);
      const weekFri = addDaysTaipeiDateKey(weekMon, 4);
      meta.append(
        el("span", { class: "pill" }, [
          t("booking.metaDay", "當日已預約 "),
          el("strong", {}, [String(data.dayCount)]),
          ` / ${data.dayCap}`,
        ]),
        el("span", { class: "pill" }, [
          t("booking.metaWeek", "本工作週已預約 "),
          el("strong", {}, [String(data.weekCount)]),
          ` / ${data.weekCap}`,
        ]),
        el("div", { class: "meta-pills-note" }, [
          t("booking.metaNoteLead", "「當日」＝您所選的這一天："),
          el("strong", {}, [dateKeyLabelTaipei(dk)]),
          t("booking.metaNoteMid", "。「本工作週」＝該日所屬曆週之週一至週五："),
          el("strong", {}, [dateKeyLabelTaipei(weekMon)]),
          "～",
          el("strong", {}, [dateKeyLabelTaipei(weekFri)]),
          t("booking.metaNoteTail", "（週一與後端 "),
          el("code", {}, [t("booking.metaNoteCode", "weekStart")]),
          t("booking.metaNoteEnd", " 相同，名額為該曆週內有效預約合計）。"),
        ]),
      );
      if (dayFull) {
        scheduleStatus.textContent = t("booking.dayFull", "這一天已額滿。");
        scheduleStatus.classList.add("error");
      } else if (weekFull) {
        scheduleStatus.textContent = t("booking.weekFull", "本工作週已達上限。");
        scheduleStatus.classList.add("error");
      }
    } catch (e) {
      console.error(e);
      refillSlots(new Set(), true, dk, new Map());
      scheduleStatus.textContent = t("booking.loadSlotsFail", "無法載入空檔，請稍後再試。");
      scheduleStatus.classList.add("error");
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
      bookStatus.textContent = t("booking.fillName", "請填寫姓名。");
      bookStatus.classList.add("error");
      return;
    }
    if (!dateKey || !startSlot) {
      bookStatus.textContent = t("booking.pickDateSlot", "請選擇日期與開始時間。");
      bookStatus.classList.add("error");
      return;
    }
    if (dateKey < taipeiTodayDateKey()) {
      bookStatus.textContent = t("booking.noPastDate", "不可預約今天以前的日期。");
      bookStatus.classList.add("error");
      return;
    }
    if (dateKey > taipeiLatestBookableDateKey()) {
      bookStatus.textContent = t("booking.noBeyond", "僅能預約至下週日為止。");
      bookStatus.classList.add("error");
      return;
    }
    if (isStartSlotInPastForTaipeiToday(dateKey, startSlot)) {
      bookStatus.textContent = t("booking.slotPast", "此開始時間已過，請選擇較晚的時段。");
      bookStatus.classList.add("error");
      return;
    }
    if (bookingMode !== "guest_cash" && bookingMode !== "guest_beverage" && !auth.currentUser) {
      bookStatus.textContent = t("booking.memberModeNeedLogin", "會員付款模式需先登入。");
      bookStatus.classList.add("error");
      return;
    }
    if (
      bookingMode !== "guest_cash" &&
      bookingMode !== "guest_beverage" &&
      auth.currentUser &&
      !auth.currentUser.emailVerified
    ) {
      bookStatus.textContent = t(
        "booking.memberNeedVerify",
        "會員付款需先完成 Email 驗證，請至信箱點擊驗證連結。",
      );
      bookStatus.classList.add("error");
      return;
    }
    if (bookingMode === "member_wallet" && walletBalance < 50) {
      bookStatus.textContent = t(
        "booking.walletShort",
        "儲值餘額不足，請改用現金、「請師傅一杯飲料」或先儲值。",
      );
      bookStatus.classList.add("error");
      return;
    }
    const confirmed = await showConfirmModal(
      t("booking.confirmTitle", "確認送出預約"),
      buildBookingSummary(displayName, dateKey, startSlot, note, bookingMode),
      t("booking.confirmSubmit", "確認送出"),
    );
    if (!confirmed) {
      bookStatus.textContent = t("booking.cancelledSubmit", "已取消送出。");
      return;
    }
    submitBtn.setAttribute("disabled", "true");
    try {
      const fn = createBookingCall();
      await fn({ displayName, note, dateKey, startSlot, bookingMode, ...localeApiParam() });
      const memberBooking =
        bookingMode === "member_wallet" ||
        bookingMode === "member_cash" ||
        bookingMode === "member_beverage";
      const submittedLine = t(
        "booking.submitted",
        "已送出！狀態為「待確認」，實際時間會依現場情況微調。",
      );
      const myBookingsHint = memberBooking
        ? t("booking.submittedMyBookingsHint", "可到上方「我的預約」分頁查看預約狀態。")
        : "";
      bookStatus.textContent = myBookingsHint ? `${submittedLine} ${myBookingsHint}` : submittedLine;
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

  const wheelTestBtn = el("button", { class: "ghost", type: "button" }, [
    t("wheel.previewBtn", "預覽輪盤特效"),
  ]);
  wheelTestBtn.hidden = true;
  wheelTestBtn.title = t("wheel.previewTitle", "僅畫面預覽，不呼叫抽獎、不扣次數");
  const wheelRulesHint = el("p", { class: "hint wheel-rules-hint" }, [
    t(
      "wheel.rules",
      "輪盤規則：預約有綁定會員，且後台將該筆標為「已完成」後，可獲得 1 次抽獎機會（同一筆僅發一次）。每次按下「抽輪盤」消耗 1 次；獎項由後台依權重隨機抽出，可能為儲值金、加抽次數、銘謝惠顧或趣味文案等。須完成 Email 驗證才可抽獎。",
    ),
  ]);
  const wheelRow = el("div", { class: "book-wheel-row" }, [spinBtn, wheelTestBtn, wheelStatus, wheelResult]);
  memberExtrasWrap.append(emailVerifyBanner, walletStatus);
  const bookSupportChatMount = el("div", { class: "book-support-chat" });
  mountMemberSupportChat(db, auth, bookSupportChatMount);

  const supportChatFloatPanel = el("div", {
    class: "support-chat-float__panel",
    id: "support-chat-float-panel",
    hidden: true,
  });
  supportChatFloatPanel.append(bookSupportChatMount);
  const supportChatFab = el("button", { type: "button", class: "support-chat-float__fab" }, []);
  const supportFabGlyph = el("span", { class: "support-chat-float__fab-glyph", ariaHidden: "true" }, ["💬"]);
  const supportFabText = el("span", { class: "support-chat-float__fab-text", ariaHidden: "true" }, [
    t("support.fab.chat", "聊"),
  ]);
  supportChatFab.append(supportFabGlyph, supportFabText);
  supportChatFab.setAttribute("aria-controls", "support-chat-float-panel");
  supportChatFab.setAttribute("aria-expanded", "false");
  supportChatFab.setAttribute("aria-label", t("support.fab.open", "開啟聯絡店家"));
  supportChatFab.title = t(
    "support.fab.hint",
    "短按：開啟或收合。按住後略為移動即可拖曳；放開貼左或右下緣。",
  );
  const supportChatFloat = el("div", { class: "support-chat-float" }, [supportChatFloatPanel, supportChatFab]);
  let supportChatOpen = false;
  function setSupportChatOpen(open: boolean) {
    supportChatOpen = open;
    supportChatFloat.classList.toggle("support-chat-float--open", open);
    supportChatFloatPanel.hidden = !open;
    supportChatFab.setAttribute("aria-expanded", String(open));
    supportFabGlyph.textContent = open ? "✕" : "💬";
    supportFabText.textContent = open ? t("support.fab.collapse", "收") : t("support.fab.chat", "聊");
    supportChatFab.setAttribute(
      "aria-label",
      open ? t("support.fab.close", "收合聯絡店家") : t("support.fab.open", "開啟聯絡店家"),
    );
  }
  supportChatFab.addEventListener("click", () => setSupportChatOpen(!supportChatOpen));
  function onSupportChatEscape(ev: KeyboardEvent) {
    if (ev.key !== "Escape") return;
    if (!supportChatOpen || supportChatFloat.hidden) return;
    setSupportChatOpen(false);
  }
  document.addEventListener("keydown", onSupportChatEscape);

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
            prize: {
              id: "pv-c5",
              name: t("wheel.previewPrizeName", "【預覽】+5 儲值金"),
              type: "credit",
              value: 5,
            },
            drawChances,
            walletBalance,
          };
        },
        {
          splitAnchor: wheelRow,
          fetchPrizeLabels: async () => wheelPreviewMockPrizes,
        },
      );
      wheelStatus.textContent = t(
        "wheel.previewDone",
        "以上為特效預覽，未實際抽獎、未扣除次數。",
      );
      wheelStatus.className = "status-line";
    } finally {
      wheelTestBtn.removeAttribute("disabled");
    }
  });

  const guestbookMount = el("div", { class: "guestbook-mount" });
  mountGuestbook(db, auth, guestbookMount);

  let bookSubTab: "book" | "guestbook" | "wheel" | "luckyslot" | "mybookings" = "book";

  const bookTabList = el("div", { class: "book-tabs", role: "tablist" });
  bookTabList.setAttribute(
    "aria-label",
    t(
      "book.tabsAria",
      "預約按摩、我的預約、心得與評價、抽輪盤、試玩老虎機（「我的預約／抽輪盤」於登入會員後顯示）",
    ),
  );
  const tabBook = el("button", { type: "button", class: "tab book-tab", role: "tab", id: "book-tab-book" }, [
    t("book.tab.booking", "預約按摩"),
  ]);
  const tabGuestbook = el("button", { type: "button", class: "tab book-tab", role: "tab", id: "book-tab-guestbook" }, [
    t("book.tab.guestbook", "心得與評價"),
  ]);
  const tabWheel = el("button", { type: "button", class: "tab book-tab", role: "tab", id: "book-tab-wheel" }, [
    t("book.tab.wheel", "抽輪盤"),
  ]);
  const tabLuckySlot = el("button", { type: "button", class: "tab book-tab", role: "tab", id: "book-tab-lucky-slot" }, [
    t("book.tab.luckySlot", "老虎機（試玩）"),
  ]);
  const tabMyBookings = el("button", { type: "button", class: "tab book-tab", role: "tab", id: "book-tab-my-bookings" }, [
    t("book.tab.myBookings", "我的預約"),
  ]);
  tabBook.setAttribute("aria-controls", "book-tab-panel-book");
  tabGuestbook.setAttribute("aria-controls", "book-tab-panel-guestbook");
  tabWheel.setAttribute("aria-controls", "book-tab-panel-wheel");
  tabLuckySlot.setAttribute("aria-controls", "book-tab-panel-lucky-slot");
  tabMyBookings.setAttribute("aria-controls", "book-tab-panel-my-bookings");
  tabBook.setAttribute("aria-selected", "true");
  tabGuestbook.setAttribute("aria-selected", "false");
  tabWheel.setAttribute("aria-selected", "false");
  tabLuckySlot.setAttribute("aria-selected", "false");
  tabMyBookings.setAttribute("aria-selected", "false");
  tabBook.tabIndex = 0;
  tabGuestbook.tabIndex = -1;
  tabWheel.tabIndex = -1;
  tabLuckySlot.tabIndex = -1;
  tabMyBookings.tabIndex = -1;
  tabMyBookings.hidden = memberExtrasWrap.hidden;
  tabWheel.hidden = memberExtrasWrap.hidden;
  bookTabList.append(tabBook, tabMyBookings, tabGuestbook, tabWheel, tabLuckySlot);

  const bookPanelBook = el("div", {
    class: "book-tab-panel",
    id: "book-tab-panel-book",
    role: "tabpanel",
  });
  bookPanelBook.setAttribute("aria-labelledby", "book-tab-book");
  bookPanelBook.append(
    el("div", { class: "grid grid-2" }, [
      el("label", { class: "field" }, [
        t("field.name", "姓名"),
        nameInput,
        el("span", { class: "hint" }, [t("field.nameHint", "可不登入，打個暱稱即可；若已登入且帳號有設定稱呼，會自動帶入（仍可改）。")]),
      ]),
      el("label", { class: "field" }, [
        t("field.date", "日期（週一至週五）"),
        dateInput,
        el("span", { class: "hint" }, [t("field.dateHint", "最遠僅開放至本週曆之下週日（台北）；更後的日期無法選取。")]),
      ]),
    ]),
    el("div", { class: "grid" }, [
      el("label", { class: "field" }, [
        t("field.startSlot", "開始時間（15 分鐘一格）"),
        slotSelect,
        el("span", { class: "hint" }, [t("field.startSlotHint", "開始時間為 15 分鐘一格；單次服務約15~50分鐘, 看情況.")]),
      ]),
    ]),
    scheduleStatus,
    el("div", { class: "grid" }, [
      el("label", { class: "field" }, [t("field.payment", "付款方式"), bookingModeSelect, bookingModeHint]),
    ]),
    memberExtrasWrap,
    meta,
    el("div", { class: "grid" }, [
      el("label", { class: "field" }, [
        t("field.note", "備註（選填）"),
        noteInput,
        el("span", { class: "hint" }, [t("field.noteHint", "可填寫需求，例如：頭痛、背部痠痛、腿部需要按壓等")]),
      ]),
    ]),
    el("div", { class: "row-actions" }, [submitBtn]),
    bookStatus,
    bookFooterNote,
  );

  const bookPanelGuestbook = el("div", {
    class: "book-tab-panel book-tab-panel--guestbook",
    id: "book-tab-panel-guestbook",
    role: "tabpanel",
    hidden: true,
  });
  bookPanelGuestbook.setAttribute("aria-labelledby", "book-tab-guestbook");
  bookPanelGuestbook.append(guestbookMount);

  const bookPanelWheel = el("div", {
    class: "book-tab-panel book-tab-panel--wheel",
    id: "book-tab-panel-wheel",
    role: "tabpanel",
    hidden: true,
  });
  bookPanelWheel.setAttribute("aria-labelledby", "book-tab-wheel");
  bookPanelWheel.append(wheelRulesHint, wheelRow);

  const bookPanelLuckySlot = el("div", {
    class: "book-tab-panel book-tab-panel--lucky-slot",
    id: "book-tab-panel-lucky-slot",
    role: "tabpanel",
    hidden: true,
  });
  bookPanelLuckySlot.setAttribute("aria-labelledby", "book-tab-lucky-slot");
  mountLuckySlotMachine(bookPanelLuckySlot, t);

  const bookPanelMyBookings = el("div", {
    class: "book-tab-panel book-tab-panel--my-bookings",
    id: "book-tab-panel-my-bookings",
    role: "tabpanel",
    hidden: true,
  });
  bookPanelMyBookings.setAttribute("aria-labelledby", "book-tab-my-bookings");
  bookPanelMyBookings.append(myBookingsSection);

  function setBookSubTab(which: "book" | "guestbook" | "wheel" | "luckyslot" | "mybookings") {
    bookSubTab = which;
    tabBook.setAttribute("aria-selected", String(which === "book"));
    tabGuestbook.setAttribute("aria-selected", String(which === "guestbook"));
    tabWheel.setAttribute("aria-selected", String(which === "wheel"));
    tabLuckySlot.setAttribute("aria-selected", String(which === "luckyslot"));
    tabMyBookings.setAttribute("aria-selected", String(which === "mybookings"));
    tabBook.tabIndex = which === "book" ? 0 : -1;
    tabGuestbook.tabIndex = which === "guestbook" ? 0 : -1;
    tabWheel.tabIndex = which === "wheel" ? 0 : -1;
    tabLuckySlot.tabIndex = which === "luckyslot" ? 0 : -1;
    tabMyBookings.tabIndex = which === "mybookings" ? 0 : -1;
    bookPanelBook.hidden = which !== "book";
    bookPanelGuestbook.hidden = which !== "guestbook";
    bookPanelWheel.hidden = which !== "wheel";
    bookPanelLuckySlot.hidden = which !== "luckyslot";
    bookPanelMyBookings.hidden = which !== "mybookings";
  }
  tabBook.addEventListener("click", () => setBookSubTab("book"));
  tabGuestbook.addEventListener("click", () => setBookSubTab("guestbook"));
  tabWheel.addEventListener("click", () => setBookSubTab("wheel"));
  tabLuckySlot.addEventListener("click", () => setBookSubTab("luckyslot"));
  tabMyBookings.addEventListener("click", () => setBookSubTab("mybookings"));

  syncBookMyBookingsTabVisibility = () => {
    const show = !memberExtrasWrap.hidden;
    tabMyBookings.hidden = !show;
    tabWheel.hidden = !show;
    if (!show && (bookSubTab === "mybookings" || bookSubTab === "wheel")) {
      setBookSubTab("book");
    }
  };
  syncBookMyBookingsTabVisibility();

  panelBook.append(
    bookTabList,
    bookPanelBook,
    bookPanelGuestbook,
    bookPanelWheel,
    bookPanelLuckySlot,
    bookPanelMyBookings,
  );

  root.append(supportChatFloat);
  const supportChatFloatDock = attachSupportChatFloatDrag(supportChatFloat, supportChatFab);

  /** --- 管理後台 --- */
  const adminWrap = el("div", {}, []);
  panelAdmin.append(adminWrap);

  let adminUnsub: (() => void) | null = null;
  let adminMarqueeTextUnsub: (() => void) | null = null;
  let adminMarqueeLedUnsub: (() => void) | null = null;
  let adminWheelSpectacleUnsub: (() => void) | null = null;
  let adminBookingCapsUnsub: (() => void) | null = null;
  let adminBookingBlocksUnsub: (() => void) | null = null;
  let adminSupportChatUnmount: SupportChatUnmount | null = null;

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
    if (adminSupportChatUnmount) {
      adminSupportChatUnmount();
      adminSupportChatUnmount = null;
    }
  }

  function renderAdminLoggedOut() {
    stopAdminListener();
    adminWrap.innerHTML = "";
    const box = el("div", { class: "admin-login" }, []);
    const email = el("input", { type: "email", autocomplete: "username" });
    const password = el("input", { type: "password", autocomplete: "current-password" });
    const loginBtn = el("button", { class: "primary", type: "button" }, [t("admin.login", "登入")]);
    const resetBtn = el("button", { class: "ghost", type: "button" }, [t("admin.resetSend", "寄送重設密碼信")]);
    const adminStatus = el("div", { class: "status-line" });
    loginBtn.addEventListener("click", async () => {
      adminStatus.textContent = "";
      adminStatus.className = "status-line";
      loginBtn.setAttribute("disabled", "true");
      try {
        await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
      } catch (e) {
        adminStatus.textContent = e instanceof Error ? e.message : t("auth.loginFail", "登入失敗");
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
        adminStatus.textContent = t("admin.needEmailFirst", "請先輸入 Email。");
        adminStatus.classList.add("error");
        return;
      }
      resetBtn.setAttribute("disabled", "true");
      try {
        await sendPasswordResetEmail(auth, em);
        adminStatus.textContent = t(
          "admin.resetSentLong",
          "若此 Email 已註冊，您將很快收到重設密碼信（請一併查看垃圾郵件）。點信內連結即可設定新密碼。",
        );
        adminStatus.classList.add("ok");
      } catch (e) {
        adminStatus.textContent = e instanceof Error ? e.message : t("auth.resetSendFail", "寄送失敗");
        adminStatus.classList.add("error");
      } finally {
        resetBtn.removeAttribute("disabled");
      }
    });
    box.append(
      el("p", { class: "hint" }, [
        t(
          "admin.loginHint",
          "僅限管理員。請先在 Firebase Console 建立 Email/Password 帳號，並在 Firestore 新增文件 ",
        ),
        el("code", {}, [t("admin.placeholder.uidDoc", "admins/<你的 UID>")]),
        t("admin.loginHintEnd", "（可用空物件 `{}`）。"),
      ]),
      el("label", { class: "field" }, ["Email", email]),
      el("label", { class: "field" }, [t("auth.label.password", "密碼"), wrapPasswordField(password)]),
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
        el("p", { class: "status-line error" }, [t("admin.forbidden", "無權限：此帳號不是管理員。")]),
      ]),
    );
  }

  function renderAdminTable(userId: string) {
    stopAdminListener();
    adminWrap.innerHTML = "";
    let adminBookingsReportCache: Booking[] = [];
    const top = el("div", { class: "row-actions" }, []);
    const u = auth.currentUser;
    const whoLabel =
      u != null
        ? t("admin.signedInLabel", "已登入：{{name}}（{{uid}}）", {
            name: adminSessionCallName(u),
            uid: shortUidForDisplay(u.uid),
          })
        : t("admin.signedInUidOnly", "已登入：（{{uid}}）", { uid: shortUidForDisplay(userId) });
    const who = el("span", { class: "hint" }, [whoLabel]);
    const outBtn = el("button", { class: "ghost", type: "button" }, [t("admin.signOut", "登出")]);
    outBtn.addEventListener("click", async () => {
      await signOut(auth);
    });
    top.append(who, outBtn);

    const adminStatus = el("div", { class: "status-line" });
    const walletTopupSection = el("div", { class: "admin-announce" }, []);
    const accountCreateSection = el("div", { class: "admin-announce" }, []);
    const topupCustomerId = el("input", {
      type: "text",
      placeholder: t("admin.placeholder.memberId", "會員 Email（建議）或 UID"),
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
        const res = await fn({ prefix: q, ...localeApiParam() });
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
    const topupNote = el("input", {
      type: "text",
      placeholder: t("admin.topup.notePlaceholder", "備註（選填）"),
    });
    const topupBtn = el("button", { class: "ghost", type: "button" }, [t("admin.topup.btn", "儲值")]);
    const topupStatus = el("div", { class: "status-line" });
    topupBtn.addEventListener("click", async () => {
      topupStatus.textContent = "";
      topupStatus.className = "status-line";
      const customerId = topupCustomerId.value.trim();
      const amount = Number(topupAmount.value);
      const note = topupNote.value.trim();
      if (!customerId) {
        topupStatus.textContent = t("admin.topup.needId", "請輸入會員 Email 或 UID。");
        topupStatus.classList.add("error");
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
        topupStatus.textContent = t("admin.topup.amountInt", "儲值金額需為正整數。");
        topupStatus.classList.add("error");
        return;
      }
      topupBtn.setAttribute("disabled", "true");
      topupStatus.textContent = t("admin.topup.processing", "儲值中…");
      try {
        const fn = topupWalletCall();
        await fn({ customerId, amount, note, ...localeApiParam() });
        topupStatus.textContent = t("admin.topup.ok", "儲值成功");
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
      placeholder: t("admin.marquee.placeholderText", "頂部橫幅：例如本週三 15:00-16:00 暫停服務"),
      autocomplete: "off",
    });
    const saveMarqueeTextBtn = el("button", { class: "ghost", type: "button" }, [t("admin.marquee.saveText", "儲存頂部跑馬燈")]);
    const marqueeTextStatus = el("div", { class: "status-line" });
    const marqueeTextDocRef = doc(db, "siteSettings", "marqueeText");

    const marqueeLedEnabled = el("input", { type: "checkbox" });
    const marqueeLedBody = el("input", {
      type: "text",
      maxLength: 500,
      placeholder: t("admin.marquee.placeholderLed", "底部 LED：可較長，例如活動標語"),
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
    const saveMarqueeLedBtn = el("button", { class: "ghost", type: "button" }, [t("admin.marquee.saveLed", "儲存底部 LED")]);
    const marqueeLedStatus = el("div", { class: "status-line" });
    const marqueeLedDocRef = doc(db, "siteSettings", "marqueeLed");
    const wheelSpectacleDocRef = doc(db, "siteSettings", "wheelSpectacle");
    const wheelSpectacleShowTest = el("input", { type: "checkbox" });
    const saveWheelSpectacleBtn = el("button", { class: "ghost", type: "button" }, [t("admin.wheelSpectacle.save", "儲存輪盤預覽開關")]);
    const wheelSpectacleStatus = el("div", { class: "status-line" });

    adminWheelSpectacleUnsub = onSnapshot(
      wheelSpectacleDocRef,
      (snap) => {
        const data = snap.data() as { showTestButton?: unknown } | undefined;
        wheelSpectacleShowTest.checked = data?.showTestButton === true;
      },
      () => {
        wheelSpectacleStatus.textContent = t("admin.snapshot.loadFail", "無法讀取輪盤預覽設定。");
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
        wheelSpectacleStatus.textContent = t("admin.status.updated", "已更新");
        wheelSpectacleStatus.classList.add("ok");
      } catch (e) {
        wheelSpectacleStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
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
    const saveBookingCapsBtn = el("button", { type: "button", class: "ghost" }, [t("admin.caps.save", "儲存名額上限")]);
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
        bookingCapsStatus.textContent = t("admin.snapshot.loadFail", "無法讀取名額上限設定。");
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
      bookingCapsStatus.textContent = t("admin.status.processing", "處理中…");
      try {
        await setDoc(
          bookingCapsDocRef,
          { maxPerDay, maxPerWorkWeek, updatedAt: serverTimestamp() },
          { merge: true },
        );
        bookingCapsStatus.textContent = t("admin.status.updated", "已更新");
        bookingCapsStatus.classList.add("ok");
      } catch (e) {
        bookingCapsStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
        bookingCapsStatus.classList.add("error");
      } finally {
        saveBookingCapsBtn.removeAttribute("disabled");
      }
    });

    const bookingBlocksDocRef = doc(db, "siteSettings", "bookingBlocks");
    const bookingBlocksRows = el("div", { class: "admin-booking-blocks-rows" });
    const addBookingBlockRowBtn = el("button", { type: "button", class: "ghost" }, [t("admin.blocks.addRow", "新增一筆")]);
    const saveBookingBlocksBtn = el("button", { type: "button", class: "ghost" }, [t("admin.blocks.save", "儲存不開放時段")]);
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
      const weekdaySel = el("select", { class: "bb-weekday", ariaLabel: t("admin.blocks.weekday", "星期") });
      const dayLabels = t("admin.dayLabels", "一,二,三,四,五").split(",");
      for (let d = 1; d <= 5; d++) {
        weekdaySel.append(el("option", { value: String(d) }, [dayLabels[d - 1] ?? String(d)]));
      }
      weekdaySel.value = String(model.weekday);
      const startIn = el("input", {
        type: "time",
        class: "bb-start",
        step: "900",
        ariaLabel: t("admin.blocks.start", "起（含）"),
      });
      startIn.value = model.start;
      const endIn = el("input", {
        type: "time",
        class: "bb-end",
        step: "900",
        ariaLabel: t("admin.blocks.end", "迄（不含）"),
      });
      endIn.value = model.end;
      const reasonIn = el("input", {
        type: "text",
        class: "bb-reason",
        maxLength: 200,
        placeholder: t("admin.blocks.reasonPh", "例如：師傅運動、外出"),
        autocomplete: "off",
      });
      reasonIn.value = model.reason;
      const removeBtn = el("button", { type: "button", class: "ghost" }, [t("admin.blocks.rowRemove", "刪除此列")]);
      removeBtn.addEventListener("click", () => {
        row.remove();
      });
      row.append(
        el("label", { class: "field bb-field-wd" }, [t("admin.blocks.weekday", "星期"), weekdaySel]),
        el("label", { class: "field bb-field-t" }, [t("admin.blocks.start", "起（含）"), startIn]),
        el("label", { class: "field bb-field-t" }, [t("admin.blocks.end", "迄（不含）"), endIn]),
        el("label", { class: "field bb-field-reason" }, [t("admin.blocks.reason", "前台顯示原因"), reasonIn]),
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
        bookingBlocksStatus.textContent = t("admin.snapshot.loadFail", "無法讀取不開放時段設定。");
        bookingBlocksStatus.className = "status-line error";
      },
    );

    saveBookingBlocksBtn.addEventListener("click", async () => {
      bookingBlocksStatus.textContent = "";
      bookingBlocksStatus.className = "status-line";
      const rowEls = bookingBlocksRows.querySelectorAll(".admin-booking-block-row");
      const windows: { weekday: number; start: string; end: string; reason: string }[] = [];
      if (rowEls.length > 40) {
        bookingBlocksStatus.textContent = t("admin.blocks.tooMany", "最多 40 筆規則，請刪減後再儲存。");
        bookingBlocksStatus.classList.add("error");
        return;
      }
      for (const row of rowEls) {
        const wd = Number((row.querySelector(".bb-weekday") as HTMLSelectElement)?.value);
        const st = (row.querySelector(".bb-start") as HTMLInputElement)?.value ?? "";
        const en = (row.querySelector(".bb-end") as HTMLInputElement)?.value ?? "";
        const re = (row.querySelector(".bb-reason") as HTMLInputElement)?.value ?? "";
        if (!Number.isInteger(wd) || wd < 1 || wd > 5) {
          bookingBlocksStatus.textContent = t("admin.blocks.invalidWeekday", "每一列的星期需為週一到週五。");
          bookingBlocksStatus.classList.add("error");
          return;
        }
        const ns = normalizeTimeForBookingBlock(st);
        const ne = normalizeTimeForBookingBlock(en);
        if (!ns || !ne) {
          bookingBlocksStatus.textContent = t("admin.blocks.invalidTime", "請確認每一列的時間格式正確。");
          bookingBlocksStatus.classList.add("error");
          return;
        }
        const m0 = Number(ns.slice(0, 2)) * 60 + Number(ns.slice(3, 5));
        const m1 = Number(ne.slice(0, 2)) * 60 + Number(ne.slice(3, 5));
        if (m0 >= m1) {
          bookingBlocksStatus.textContent = t(
            "admin.blocks.invalidRange",
            "每一列的「迄」需晚於「起」。區間為左閉右開：迄那一刻起已不再封鎖。",
          );
          bookingBlocksStatus.classList.add("error");
          return;
        }
        windows.push({ weekday: wd, start: ns, end: ne, reason: re.trim().slice(0, 200) });
      }
      saveBookingBlocksBtn.setAttribute("disabled", "true");
      bookingBlocksStatus.textContent = t("admin.status.processing", "處理中…");
      try {
        await setDoc(
          bookingBlocksDocRef,
          { windows, updatedAt: serverTimestamp() },
          { merge: true },
        );
        bookingBlocksStatus.textContent = t("admin.status.updated", "已更新");
        bookingBlocksStatus.classList.add("ok");
      } catch (e) {
        bookingBlocksStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
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
        marqueeTextStatus.textContent = t("admin.snapshot.loadFail", "無法讀取頂部跑馬燈設定。");
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
        marqueeLedStatus.textContent = t("admin.snapshot.loadFail", "無法讀取底部 LED 設定。");
        marqueeLedStatus.className = "status-line error";
      },
    );

    saveMarqueeTextBtn.addEventListener("click", async () => {
      marqueeTextStatus.textContent = t("admin.status.processing", "處理中…");
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
        marqueeTextStatus.textContent = t("admin.status.updated", "已更新");
        marqueeTextStatus.classList.add("ok");
      } catch (e) {
        marqueeTextStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
        marqueeTextStatus.classList.add("error");
      } finally {
        saveMarqueeTextBtn.removeAttribute("disabled");
      }
    });

    saveMarqueeLedBtn.addEventListener("click", async () => {
      marqueeLedStatus.textContent = t("admin.status.processing", "處理中…");
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
        marqueeLedStatus.textContent = t("admin.status.updated", "已更新");
        marqueeLedStatus.classList.add("ok");
      } catch (e) {
        marqueeLedStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
        marqueeLedStatus.classList.add("error");
      } finally {
        saveMarqueeLedBtn.removeAttribute("disabled");
      }
    });

    announcementSection.append(
      el("h3", {}, [t("admin.announce.heading", "跑馬燈公告")]),
      el("p", { class: "hint" }, [
        t("admin.announce.intro", "頂部與底部分開設定：Firestore `siteSettings/marqueeText`、`siteSettings/marqueeLed`。"),
      ]),
      el("h4", { class: "admin-subhead" }, [t("admin.announce.topHeading", "頂部 · 文字跑馬燈")]),
      el("label", { class: "field" }, [t("admin.announce.topLabel", "內容"), marqueeTextBody]),
      el("label", { class: "field checkbox-field" }, [marqueeTextEnabled, el("span", {}, [t("admin.announce.enable", "啟用")])]),
      el("div", { class: "row-actions" }, [saveMarqueeTextBtn]),
      marqueeTextStatus,
      el("h4", { class: "admin-subhead" }, [t("admin.announce.bottomHeading", "底部 · LED 跑馬燈")]),
      el("label", { class: "field" }, [t("admin.announce.bottomLabel", "內容"), marqueeLedBody]),
      el("label", { class: "field led-speed-field" }, [
        t("admin.announce.speedLabel", "捲動速度"),
        el("div", { class: "led-speed-row" }, [marqueeLedSpeed, marqueeLedSpeedValue]),
        el("span", { class: "hint" }, [
          t("admin.announce.speedHint", "約 {{min}}～{{max}}（數字愈大移動愈快，單位：像素／秒）。", {
            min: LED_SPEED_MIN,
            max: LED_SPEED_MAX,
          }),
        ]),
      ]),
      el("label", { class: "field checkbox-field" }, [marqueeLedEnabled, el("span", {}, [t("admin.announce.enable", "啟用")])]),
      el("div", { class: "row-actions" }, [saveMarqueeLedBtn]),
      marqueeLedStatus,
      el("h4", { class: "admin-subhead" }, [t("admin.announce.wheelHeading", "前台 · 輪盤特效預覽")]),
      el("p", { class: "hint" }, [
        t(
          "admin.announce.wheelHintA",
          "勾選並儲存後，預約頁「會員區」會出現「預覽輪盤特效」按鈕；僅播放動畫，不呼叫抽獎 API、不扣次數。正式上線建議關閉。Firestore：",
        ),
        el("code", {}, ["siteSettings/wheelSpectacle"]),
        t("admin.announce.wheelHintB", "。"),
      ]),
      el("label", { class: "field checkbox-field" }, [
        wheelSpectacleShowTest,
        el("span", {}, [t("admin.announce.wheelToggle", "顯示前台「預覽輪盤特效」按鈕")]),
      ]),
      el("div", { class: "row-actions" }, [saveWheelSpectacleBtn]),
      wheelSpectacleStatus,
      el("h4", { class: "admin-subhead" }, [t("admin.caps.heading", "預約名額上限")]),
      el("p", { class: "hint" }, [
        t("admin.caps.hintA", "控制「同一天」「同一工作週（週一至週五曆）」各最多幾筆有效預約（"),
        el("code", {}, ["pending"]),
        " / ",
        el("code", {}, ["confirmed"]),
        " / ",
        el("code", {}, ["done"]),
        t("admin.caps.hintB", "）。Firestore："),
        el("code", {}, ["siteSettings/bookingCaps"]),
        t("admin.caps.hintC", "（"),
        el("code", {}, ["maxPerDay"]),
        ", ",
        el("code", {}, ["maxPerWorkWeek"]),
        t("admin.caps.hintD", "，整數 1～50；未建立文件時後端預設 2 與 4）。"),
      ]),
      el("div", { class: "grid grid-2" }, [
        el("label", { class: "field" }, [t("admin.caps.perDay", "同一天最多幾筆"), capMaxPerDayInput]),
        el("label", { class: "field" }, [t("admin.caps.perWeek", "同一工作週最多幾筆"), capMaxPerWorkWeekInput]),
      ]),
      el("div", { class: "row-actions" }, [saveBookingCapsBtn]),
      bookingCapsStatus,
      el("h4", { class: "admin-subhead" }, [t("admin.blocks.heading", "不開放預約時段")]),
      el("p", { class: "hint" }, [
        t(
          "admin.blocks.hintA",
          "依星期與當日時段關閉預約：若一次服務（約 30 分鐘）與關閉區間重疊，該開始時間無法選取。例：週一、週四 16:30–17:30 關閉，則 16:30、16:45、17:00 皆不可開始。Firestore：",
        ),
        el("code", {}, ["siteSettings/bookingBlocks"]),
        t("admin.blocks.hintB", " 的 "),
        el("code", {}, ["windows"]),
        t("admin.blocks.hintC", "。區間為左閉右開（「迄」該分鐘起已不封鎖）。"),
      ]),
      bookingBlocksRows,
      el("div", { class: "row-actions" }, [addBookingBlockRowBtn, saveBookingBlocksBtn]),
      bookingBlocksStatus,
    );
    walletTopupSection.append(
      el("h3", {}, [t("admin.wallet.heading", "會員儲值")]),
      el("label", { class: "field" }, [t("admin.wallet.memberLabel", "會員（Email 或 UID）"), topupTypeaheadWrap]),
      el("div", { class: "hint" }, [t("admin.wallet.searchHint", "輸入至少 2 個字元會顯示符合的 Email；亦可直接貼上 UID。")]),
      el("label", { class: "field" }, [t("admin.wallet.amount", "儲值金額"), topupAmount]),
      el("label", { class: "field" }, [t("admin.wallet.note", "備註（選填）"), topupNote]),
      el("div", { class: "row-actions" }, [topupBtn]),
      topupStatus,
    );
    const createMemberEmail = el("input", {
      type: "email",
      placeholder: t("admin.member.emailPh", "會員 Email"),
    });
    const createMemberPassword = el("input", {
      type: "password",
      placeholder: t("admin.member.passwordPh", "初始密碼（至少 6 碼）"),
      autocomplete: "new-password",
    });
    const createMemberNickname = el("input", {
      type: "text",
      maxLength: 80,
      placeholder: t("admin.member.nicknamePh", "例如：小陳（選填，會寫入預約姓名預設）"),
      autocomplete: "off",
    });
    const createMemberBtn = el("button", { class: "ghost", type: "button" }, [
      t("admin.member.createBtn", "建立會員帳號"),
    ]);
    const createMemberStatus = el("div", { class: "status-line" });
    createMemberBtn.addEventListener("click", async () => {
      createMemberStatus.textContent = "";
      createMemberStatus.className = "status-line";
      const email = createMemberEmail.value.trim();
      const password = createMemberPassword.value;
      const nickname = createMemberNickname.value.trim();
      if (!email || !password) {
        createMemberStatus.textContent = t("admin.member.needCreds", "請輸入 Email 與密碼。");
        createMemberStatus.classList.add("error");
        return;
      }
      createMemberBtn.setAttribute("disabled", "true");
      try {
        const fn = createMemberAccountCall();
        const res = await fn({ email, password, nickname, ...localeApiParam() });
        const data = res.data as { uid: string };
        createMemberStatus.textContent = t("admin.member.created", "建立成功，UID：{{uid}}（儲值欄已帶入 Email）", {
          uid: data.uid,
        });
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
      el("h3", {}, [t("admin.member.createTitle", "建立會員帳號")]),
      el("label", { class: "field" }, [t("admin.member.email", "會員 Email"), createMemberEmail]),
      el("label", { class: "field" }, [t("admin.member.password", "初始密碼"), createMemberPassword]),
      el("label", { class: "field" }, [t("admin.member.nickname", "稱呼（選填）"), createMemberNickname]),
      el("div", { class: "hint" }, [t("admin.member.nicknameHint", "稱呼會存進會員資料，登入預約時若姓名欄為空會自動帶入；亦會寫入 Firebase Auth 顯示名稱。")]),
      el("div", { class: "hint" }, [t("admin.member.selfRegisterHint", "會員也可於前台「會員登入／註冊」自行註冊；註冊後須完成信箱驗證才可使用儲值與會員預約。")]),
      el("div", { class: "row-actions" }, [createMemberBtn]),
      createMemberStatus,
    );
    const tableHolder = el("div", { class: "table-wrap admin-bookings-table" });
    const table = el("table", {}, []);
    function adminBookingsHeaderRow(): HTMLTableRowElement {
      const guestThTitle = t("admin.table.guestTitle", "是否為訪客預約");
      return el("tr", {}, [
        el("th", {}, [t("admin.table.when", "預約時間")]),
        el("th", {}, [t("admin.table.name", "姓名")]),
        el("th", { title: guestThTitle }, [t("admin.table.guest", "訪客")]),
        el("th", {}, [t("admin.table.note", "備註")]),
        el("th", {}, [t("admin.table.status", "狀態")]),
        el("th", {}, [t("admin.table.actions", "操作")]),
      ]);
    }
    table.append(adminBookingsHeaderRow());
    tableHolder.append(table);

    const hiddenBookingsStatus = el("div", { class: "status-line" });
    const hiddenTableHolder = el("div", { class: "table-wrap admin-bookings-table" });
    const hiddenTable = el("table", {}, []);
    hiddenTable.append(adminBookingsHeaderRow());
    hiddenTableHolder.append(hiddenTable);

    const hiddenPager = el("div", { class: "admin-hidden-pager" });
    const hiddenPagePrev = el("button", { type: "button", class: "ghost" }, [t("admin.pager.prev", "上一頁")]);
    const hiddenPageInfo = el("span", { class: "hint admin-hidden-pager-meta" }, [
      t("admin.pager.none", "—"),
    ]);
    const hiddenPageNext = el("button", { type: "button", class: "ghost" }, [t("admin.pager.next", "下一頁")]);
    hiddenPager.append(hiddenPagePrev, hiddenPageInfo, hiddenPageNext);

    const memberListSection = el("div", { class: "admin-member-list" }, []);
    const memberListRefreshBtn = el("button", { class: "ghost", type: "button" }, [
      t("admin.memberList.reload", "重新載入會員清單"),
    ]);
    const memberListStatus = el("div", { class: "status-line" });
    const memberListTableWrap = el("div", { class: "table-wrap admin-member-list-table" });
    const memberListTable = el("table", {}, []);
    memberListTableWrap.append(memberListTable);

    type AdminMemberListRow = {
      uid: string;
      email: string | null;
      emailVerified: boolean;
      nickname: string;
      walletBalance: number;
      drawChances: number;
    };
    type MemberListSortKey =
      | "email"
      | "emailVerified"
      | "uid"
      | "nickname"
      | "walletBalance"
      | "drawChances";

    const MEMBER_LIST_PAGE_SIZE = 10;
    let memberListCache: AdminMemberListRow[] = [];
    let memberListPageIndex = 0;
    let memberListSortKey: MemberListSortKey = "emailVerified";
    let memberListSortAsc = true;

    const memberListPager = el("div", { class: "admin-hidden-pager admin-member-list-pager" });
    const memberListPagePrev = el("button", { type: "button", class: "ghost" }, [t("admin.pager.prev", "上一頁")]);
    const memberListPageInfo = el("span", { class: "hint admin-hidden-pager-meta" }, [
      t("admin.pager.none", "—"),
    ]);
    const memberListPageNext = el("button", { type: "button", class: "ghost" }, [t("admin.pager.next", "下一頁")]);
    memberListPager.append(memberListPagePrev, memberListPageInfo, memberListPageNext);

    function compareAdminMemberRows(
      a: AdminMemberListRow,
      b: AdminMemberListRow,
      key: MemberListSortKey,
      asc: boolean,
    ): number {
      let cmp = 0;
      switch (key) {
        case "email": {
          cmp = (a.email ?? "")
            .toLowerCase()
            .localeCompare((b.email ?? "").toLowerCase(), getLocale() === "en" ? "en" : "zh-Hant", {
              numeric: true,
            });
          break;
        }
        case "emailVerified": {
          const av = a.emailVerified ? 1 : 0;
          const bv = b.emailVerified ? 1 : 0;
          cmp = asc ? bv - av : av - bv;
          return cmp;
        }
        case "uid": {
          cmp = a.uid.localeCompare(b.uid);
          break;
        }
        case "nickname": {
          cmp = a.nickname.localeCompare(b.nickname, getLocale() === "en" ? "en" : "zh-Hant", { numeric: true });
          break;
        }
        case "walletBalance": {
          cmp = a.walletBalance === b.walletBalance ? 0 : a.walletBalance < b.walletBalance ? -1 : 1;
          break;
        }
        case "drawChances": {
          cmp = a.drawChances === b.drawChances ? 0 : a.drawChances < b.drawChances ? -1 : 1;
          break;
        }
        default:
          break;
      }
      return asc ? cmp : -cmp;
    }

    function buildMemberListHeaderRow(): HTMLTableRowElement {
      const mk = (label: string, key: MemberListSortKey) => {
        const th = el("th", {});
        const arrow = memberListSortKey === key ? (memberListSortAsc ? " ▲" : " ▼") : "";
        const btn = el(
          "button",
          {
            type: "button",
            class: "ghost admin-member-sort-btn",
            title: t("admin.memberList.sortTitle", "依「{{label}}」排序；再按一次反向", { label }),
          },
          [`${label}${arrow}`],
        );
        btn.setAttribute("data-member-sort", key);
        th.append(btn);
        return th;
      };
      return el("tr", {}, [
        mk(t("admin.memberList.th.email", "Email"), "email"),
        mk(t("admin.memberList.th.verified", "信箱驗證"), "emailVerified"),
        mk(t("admin.memberList.th.uid", "UID"), "uid"),
        mk(t("admin.memberList.th.nickname", "稱呼"), "nickname"),
        mk(t("admin.memberList.th.wallet", "儲值餘額"), "walletBalance"),
        mk(t("admin.memberList.th.draws", "可抽次數"), "drawChances"),
        el("th", { class: "admin-member-th-actions" }, [t("admin.memberList.th.actions", "操作")]),
      ]);
    }

    function paintMemberListTable() {
      const sorted = [...memberListCache].sort((a, b) => {
        const c = compareAdminMemberRows(a, b, memberListSortKey, memberListSortAsc);
        if (c !== 0) return c;
        return a.uid.localeCompare(b.uid);
      });
      const total = sorted.length;
      const totalPages = Math.max(1, Math.ceil(total / MEMBER_LIST_PAGE_SIZE));
      memberListPageIndex = Math.max(0, Math.min(memberListPageIndex, totalPages - 1));
      const from = memberListPageIndex * MEMBER_LIST_PAGE_SIZE;
      const pageRows = sorted.slice(from, from + MEMBER_LIST_PAGE_SIZE);

      memberListTable.replaceChildren();
      memberListTable.append(buildMemberListHeaderRow());

      if (total === 0) {
        memberListTable.append(
          el("tr", {}, [
            el("td", { class: "hint", colSpan: 7 }, [t("admin.memberList.empty", "目前沒有使用者資料。請按「重新載入會員清單」。")]),
          ]),
        );
        memberListPagePrev.disabled = true;
        memberListPageNext.disabled = true;
        memberListPageInfo.textContent = t("admin.pager.total0", "共 0 筆");
        return;
      }

      for (const m of pageRows) {
        const nickInput = el("input", {
          type: "text",
          maxLength: 80,
          value: m.nickname,
          class: "admin-member-nick-input",
          autocomplete: "off",
        });
        const saveBtn = el("button", { class: "ghost admin-save-nick-btn", type: "button" }, [
          t("admin.memberList.saveNick", "儲存稱呼"),
        ]);
        saveBtn.addEventListener("click", async () => {
          memberListStatus.textContent = "";
          memberListStatus.className = "status-line";
          saveBtn.setAttribute("disabled", "true");
          try {
            const updateFn = updateMemberNicknameAdminCall();
            await updateFn({ customerId: m.uid, nickname: nickInput.value, ...localeApiParam() });
            const cached = memberListCache.find((r) => r.uid === m.uid);
            if (cached) cached.nickname = nickInput.value.trim();
            memberListStatus.textContent = t("admin.memberList.nickUpdated", "已更新 {{email}} 的稱呼。", {
              email: m.email ?? m.uid,
            });
            memberListStatus.classList.add("ok");
            paintMemberListTable();
          } catch (e) {
            memberListStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
            memberListStatus.classList.add("error");
          } finally {
            saveBtn.removeAttribute("disabled");
          }
        });
        const verified = m.emailVerified === true;
        const verifyCell = el("td", { class: verified ? "admin-member-verify ok" : "admin-member-verify" }, [
          verified ? t("admin.memberList.verifiedYes", "已驗證") : t("admin.memberList.verifiedNo", "未驗證"),
        ]);
        memberListTable.append(
          el("tr", {}, [
            el("td", {}, [m.email ?? t("admin.memberList.noEmailCell", "（無 Email）")]),
            verifyCell,
            el("td", { class: "mono admin-member-uid" }, [m.uid]),
            el("td", {}, [nickInput]),
            el("td", { class: "mono" }, [String(m.walletBalance)]),
            el("td", { class: "mono" }, [String(m.drawChances)]),
            el("td", { class: "admin-member-td-actions" }, [saveBtn]),
          ]),
        );
      }

      memberListPagePrev.disabled = memberListPageIndex <= 0;
      memberListPageNext.disabled = memberListPageIndex >= totalPages - 1;
      memberListPageInfo.textContent = t(
        "admin.pager.memberPage",
        "第 {{cur}} / {{total}} 頁 · 共 {{count}} 位（每頁 {{size}} 筆）",
        {
          cur: memberListPageIndex + 1,
          total: totalPages,
          count: total,
          size: MEMBER_LIST_PAGE_SIZE,
        },
      );
    }

    memberListTable.addEventListener("click", (ev) => {
      const t = ev.target as HTMLElement | null;
      const btn = t?.closest("button[data-member-sort]");
      if (!btn || !memberListTable.contains(btn)) return;
      const key = btn.getAttribute("data-member-sort") as MemberListSortKey | null;
      if (!key) return;
      if (key === memberListSortKey) memberListSortAsc = !memberListSortAsc;
      else {
        memberListSortKey = key;
        memberListSortAsc = true;
      }
      memberListPageIndex = 0;
      paintMemberListTable();
    });

    memberListPagePrev.addEventListener("click", () => {
      if (memberListPageIndex <= 0) return;
      memberListPageIndex -= 1;
      paintMemberListTable();
    });
    memberListPageNext.addEventListener("click", () => {
      const total = memberListCache.length;
      if (total === 0) return;
      const totalPages = Math.ceil(total / MEMBER_LIST_PAGE_SIZE);
      if (memberListPageIndex >= totalPages - 1) return;
      memberListPageIndex += 1;
      paintMemberListTable();
    });

    async function loadMemberList() {
      memberListStatus.textContent = t("admin.memberList.loading", "載入會員清單中…");
      memberListStatus.className = "status-line";
      memberListRefreshBtn.setAttribute("disabled", "true");
      try {
        const fn = listMembersAdminCall();
        const res = await fn({ ...localeApiParam() });
        const data = res.data as { members: AdminMemberListRow[] };
        const raw = Array.isArray(data.members) ? data.members : [];
        memberListCache = raw.map((m) => ({
          uid: m.uid,
          email: m.email ?? null,
          emailVerified: m.emailVerified === true,
          nickname: typeof m.nickname === "string" ? m.nickname : "",
          walletBalance: typeof m.walletBalance === "number" ? m.walletBalance : 0,
          drawChances: typeof m.drawChances === "number" ? m.drawChances : 0,
        }));
        memberListPageIndex = 0;
        memberListSortKey = "emailVerified";
        memberListSortAsc = true;
        paintMemberListTable();
        memberListStatus.textContent = t("admin.memberList.loaded", "已載入 {{n}} 位使用者。", {
          n: memberListCache.length,
        });
        memberListStatus.classList.add("ok");
      } catch (e) {
        memberListStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.loadFail", "載入失敗");
        memberListStatus.classList.add("error");
      } finally {
        memberListRefreshBtn.removeAttribute("disabled");
      }
    }

    memberListRefreshBtn.addEventListener("click", () => {
      void loadMemberList();
    });

    memberListSection.append(
      el("h3", {}, [t("admin.memberList.title", "會員清單")]),
      el("p", { class: "hint" }, [
        t("admin.memberList.introA", "資料來自 Firebase Authentication 全部使用者，並合併 Firestore "),
        el("code", {}, ["customers/{uid}"]),
        t("admin.memberList.introB", " 的餘額與稱呼。人數極多時載入可能較久。"),
      ]),
      el("p", { class: "hint" }, [
        t("admin.memberList.introSort", "表頭欄位可點擊排序；預設已驗證信箱在前。清單每頁顯示 10 位。"),
      ]),
      el("div", { class: "row-actions" }, [memberListRefreshBtn]),
      memberListStatus,
      memberListTableWrap,
      memberListPager,
    );

    paintMemberListTable();

    const tabBookings = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.bookings", "預約管理"),
    ]);
    tabBookings.id = "admin-tab-trigger-bookings";
    const tabHiddenBookings = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.hidden", "已隱藏的預約"),
    ]);
    tabHiddenBookings.id = "admin-tab-trigger-hidden";
    const tabMembers = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.members", "會員與儲值"),
    ]);
    tabMembers.id = "admin-tab-trigger-members";
    const tabAnnounce = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.announce", "跑馬燈公告"),
    ]);
    tabAnnounce.id = "admin-tab-trigger-announce";
    const tabSupport = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.support", "客服對話"),
    ]);
    tabSupport.id = "admin-tab-trigger-support";
    const tabReports = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.reports", "報表"),
    ]);
    tabReports.id = "admin-tab-trigger-reports";

    const adminTablist = el("div", { class: "admin-tabs", role: "tablist" });
    adminTablist.append(tabBookings, tabHiddenBookings, tabMembers, tabAnnounce, tabSupport, tabReports);

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
        t(
          "admin.hidden.intro",
          "以下為自「預約管理」主列表隱藏之預約，或舊版於資料庫標記為已刪除之筆。額度與可預約時段與主列表相同，仍依預約狀態計算（僅影響後台列表是否顯示）。筆數多時每頁 10 筆，請用列表下方「上一頁／下一頁」切換。",
        ),
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
    const panelSupportEl = el("div", {
      class: "admin-tab-panel",
      role: "tabpanel",
      id: "admin-tab-panel-support",
      hidden: true,
    });
    panelSupportEl.setAttribute("aria-labelledby", "admin-tab-trigger-support");
    const adminSupportChatHost = el("div", { class: "admin-support-chat-host" });
    panelSupportEl.append(adminSupportChatHost);
    adminSupportChatUnmount = mountAdminSupportChat(db, auth, adminSupportChatHost);

    const panelReportsEl = el("div", {
      class: "admin-tab-panel",
      role: "tabpanel",
      id: "admin-tab-panel-reports",
      hidden: true,
    });
    panelReportsEl.setAttribute("aria-labelledby", "admin-tab-trigger-reports");
    const { root: adminReportsInner, refresh: refreshAdminReports } = mountAdminReportsPanel(db, () => adminBookingsReportCache);
    panelReportsEl.append(adminReportsInner);

    tabBookings.setAttribute("aria-controls", "admin-tab-panel-bookings");
    tabHiddenBookings.setAttribute("aria-controls", "admin-tab-panel-hidden");
    tabMembers.setAttribute("aria-controls", "admin-tab-panel-members");
    tabAnnounce.setAttribute("aria-controls", "admin-tab-panel-announce");
    tabSupport.setAttribute("aria-controls", "admin-tab-panel-support");
    tabReports.setAttribute("aria-controls", "admin-tab-panel-reports");

    panelBookingsEl.append(adminStatus, tableHolder);
    panelMembersEl.append(accountCreateSection, walletTopupSection, memberListSection);
    panelAnnounceEl.append(announcementSection);

    const adminPanelsWrap = el("div", { class: "admin-tab-panels" });
    adminPanelsWrap.append(
      panelBookingsEl,
      panelHiddenBookingsEl,
      panelMembersEl,
      panelAnnounceEl,
      panelSupportEl,
      panelReportsEl,
    );

    const adminTabButtons = [tabBookings, tabHiddenBookings, tabMembers, tabAnnounce, tabSupport, tabReports] as const;
    const adminTabPanels = [
      panelBookingsEl,
      panelHiddenBookingsEl,
      panelMembersEl,
      panelAnnounceEl,
      panelSupportEl,
      panelReportsEl,
    ] as const;

    function selectAdminTab(index: 0 | 1 | 2 | 3 | 4 | 5) {
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
      if (index === 5) void refreshAdminReports();
    }

    tabBookings.addEventListener("click", () => selectAdminTab(0));
    tabHiddenBookings.addEventListener("click", () => selectAdminTab(1));
    tabMembers.addEventListener("click", () => selectAdminTab(2));
    tabAnnounce.addEventListener("click", () => selectAdminTab(3));
    tabSupport.addEventListener("click", () => selectAdminTab(4));
    tabReports.addEventListener("click", () => selectAdminTab(5));

    adminTablist.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      ev.preventDefault();
      const cur = adminTabButtons.findIndex((b) => b.getAttribute("aria-selected") === "true");
      if (cur < 0) return;
      const delta = ev.key === "ArrowRight" ? 1 : -1;
      const n = adminTabButtons.length;
      const next = ((cur + delta) % n + n) % n;
      selectAdminTab(next as 0 | 1 | 2 | 3 | 4 | 5);
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
            el("span", { class: "admin-booking-status-readonly" }, [
              t("admin.hidden.deletedLabel", "已刪除（舊資料）"),
            ]),
          ]),
          el("td", {}, [el("span", { class: "hint" }, [t("admin.hidden.dash", "—")])]),
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
        for (const opt of getAdminStatusSelectOptions()) {
          const o = el("option", { value: opt.value }, [opt.label]);
          if (opt.value === b.status) o.setAttribute("selected", "selected");
          sel.append(o);
        }
        sel.addEventListener("change", async () => {
          const nextStatus = sel.value;
          const prevStatus = b.status;
          hiddenBookingsStatus.textContent = t("admin.status.updating", "更新中…");
          hiddenBookingsStatus.className = "status-line";
          try {
            if (nextStatus === "done") {
              const fn = completeBookingCall();
              await fn({ bookingId: b.id, ...localeApiParam() });
            } else {
              await updateDoc(doc(db, "bookings", b.id), {
                status: nextStatus,
                updatedAt: serverTimestamp(),
              });
            }
            hiddenBookingsStatus.textContent = t("admin.status.updated", "已更新");
            hiddenBookingsStatus.classList.add("ok");
            if (nextStatus === "done") {
              await refreshWalletStatus();
            }
          } catch (e) {
            sel.value = prevStatus;
            hiddenBookingsStatus.textContent =
              e instanceof Error ? e.message : t("admin.status.updateFail", "更新失敗（你是否已加入 admins 集合？）");
            hiddenBookingsStatus.classList.add("error");
          }
        });
      }
      const cancelBtn = el("button", { class: "ghost", type: "button" }, [t("admin.booking.cancel", "取消")]);
      const canAdminCancel = b.status !== "done" && b.status !== "cancelled";
      cancelBtn.disabled = !canAdminCancel;
      cancelBtn.title = !canAdminCancel
        ? b.status === "done"
          ? t("admin.booking.hideTitleDone", "已完成預約不可取消")
          : t("admin.booking.hideTitleCancelled", "已取消")
        : "";
      cancelBtn.addEventListener("click", async () => {
        if (!canAdminCancel) return;
        const summary = [
          t("admin.hidden.cancelSummaryIntro", "即將取消以下預約。取消原因可留空。"),
          "",
          `${t("booking.summary.name", "姓名")}：${b.displayName ?? ""}`,
          `${t("booking.summary.date", "日期")}：${b.dateKey ?? ""}`,
          `${t("booking.summary.start", "開始時間")}：${b.startSlot ?? ""}`,
          `${t("booking.summary.note", "備註")}：${(b.note ?? "").trim() || t("admin.hidden.cancelSummaryNone", "（無）")}`,
        ].join("\n");
        const reason = await showAdminCancelBookingModal(summary);
        if (reason === null) return;
        hiddenBookingsStatus.textContent = t("admin.status.cancelling", "取消中…");
        hiddenBookingsStatus.className = "status-line";
        cancelBtn.setAttribute("disabled", "true");
        try {
          const fn = cancelBookingCall();
          const payload: { bookingId: string; cancelReason?: string } = { bookingId: b.id };
          if (reason.length > 0) {
            payload.cancelReason = reason;
          }
          await fn({ ...payload, ...localeApiParam() });
          hiddenBookingsStatus.textContent = t("admin.status.cancelled", "已取消");
          hiddenBookingsStatus.classList.add("ok");
          await refreshWalletStatus();
        } catch (e) {
          hiddenBookingsStatus.textContent = e instanceof Error ? e.message : t("admin.status.cancelFail", "取消失敗");
          hiddenBookingsStatus.classList.add("error");
          cancelBtn.removeAttribute("disabled");
        }
      });
      const unhideBtn = el("button", { class: "ghost", type: "button" }, [t("admin.hidden.unhide", "取消隱藏")]);
      unhideBtn.addEventListener("click", async () => {
        hiddenBookingsStatus.textContent = t("admin.status.processing", "處理中…");
        hiddenBookingsStatus.className = "status-line";
        unhideBtn.setAttribute("disabled", "true");
        try {
          await updateDoc(doc(db, "bookings", b.id), {
            invisible: false,
            updatedAt: serverTimestamp(),
          });
          hiddenBookingsStatus.textContent = t("admin.status.unhidden", "已恢復至預約管理列表");
          hiddenBookingsStatus.classList.add("ok");
        } catch (e) {
          hiddenBookingsStatus.textContent =
            e instanceof Error ? e.message : t("admin.status.unhideFail", "還原失敗（你是否已加入 admins 集合？）");
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
            el("td", { class: "hint", colSpan: 6 }, [t("admin.hidden.empty", "目前沒有自列表隱藏或舊版已刪除之預約。")]),
          ]),
        );
        hiddenPagePrev.disabled = true;
        hiddenPageNext.disabled = true;
        hiddenPageInfo.textContent = t("admin.pager.total0", "共 0 筆");
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
      hiddenPageInfo.textContent = t(
        "admin.pager.hiddenPage",
        "第 {{cur}} / {{total}} 頁 · 共 {{count}} 筆（每頁 {{size}} 筆）",
        {
          cur: hiddenAdminPageIndex + 1,
          total: totalPages,
          count: total,
          size: HIDDEN_ADMIN_PAGE_SIZE,
        },
      );
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
        adminBookingsReportCache = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Booking));
        adminStatus.textContent = "";
        adminStatus.className = "status-line";
        hiddenBookingsStatus.textContent = "";
        hiddenBookingsStatus.className = "status-line";
        table.innerHTML = "";
        table.append(adminBookingsHeaderRow());
        hiddenTable.innerHTML = "";
        hiddenTable.append(adminBookingsHeaderRow());
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
            for (const opt of getAdminStatusSelectOptions()) {
              const o = el("option", { value: opt.value }, [opt.label]);
              if (opt.value === b.status) o.setAttribute("selected", "selected");
              sel.append(o);
            }
            sel.addEventListener("change", async () => {
              const nextStatus = sel.value;
              const prevStatus = b.status;
              adminStatus.textContent = t("admin.status.updating", "更新中…");
              try {
                if (nextStatus === "done") {
                  const fn = completeBookingCall();
                  await fn({ bookingId: b.id, ...localeApiParam() });
                } else {
                  await updateDoc(doc(db, "bookings", b.id), {
                    status: nextStatus,
                    updatedAt: serverTimestamp(),
                  });
                }
                adminStatus.textContent = t("admin.status.updated", "已更新");
                adminStatus.classList.add("ok");
                if (nextStatus === "done") {
                  await refreshWalletStatus();
                }
              } catch (e) {
                sel.value = prevStatus;
                adminStatus.textContent =
                  e instanceof Error ? e.message : t("admin.status.updateFail", "更新失敗（你是否已加入 admins 集合？）");
                adminStatus.classList.add("error");
              }
            });
          }
          const cancelBtn = el("button", { class: "ghost", type: "button" }, [t("admin.booking.cancel", "取消")]);
          const canAdminCancel = b.status !== "done" && b.status !== "cancelled";
          cancelBtn.disabled = !canAdminCancel;
          cancelBtn.title = !canAdminCancel
            ? b.status === "done"
              ? t("admin.booking.hideTitleDone", "已完成預約不可取消")
              : t("admin.booking.hideTitleCancelled", "已取消")
            : "";
          cancelBtn.addEventListener("click", async () => {
            if (!canAdminCancel) return;
            const summary = [
              t("admin.hidden.cancelSummaryIntro", "即將取消以下預約。取消原因可留空。"),
              "",
              `${t("booking.summary.name", "姓名")}：${b.displayName ?? ""}`,
              `${t("booking.summary.date", "日期")}：${b.dateKey ?? ""}`,
              `${t("booking.summary.start", "開始時間")}：${b.startSlot ?? ""}`,
              `${t("booking.summary.note", "備註")}：${(b.note ?? "").trim() || t("admin.hidden.cancelSummaryNone", "（無）")}`,
            ].join("\n");
            const reason = await showAdminCancelBookingModal(summary);
            if (reason === null) return;
            adminStatus.textContent = t("admin.status.cancelling", "取消中…");
            adminStatus.className = "status-line";
            cancelBtn.setAttribute("disabled", "true");
            try {
              const fn = cancelBookingCall();
              const payload: { bookingId: string; cancelReason?: string } = { bookingId: b.id };
              if (reason.length > 0) {
                payload.cancelReason = reason;
              }
              await fn({ ...payload, ...localeApiParam() });
              adminStatus.textContent = t("admin.status.cancelled", "已取消");
              adminStatus.classList.add("ok");
              await refreshWalletStatus();
            } catch (e) {
              adminStatus.textContent = e instanceof Error ? e.message : t("admin.status.cancelFail", "取消失敗");
              adminStatus.classList.add("error");
              cancelBtn.removeAttribute("disabled");
            }
          });
          const deleteBtn = el("button", { class: "ghost", type: "button" }, [t("admin.booking.hide", "隱藏")]);
          deleteBtn.addEventListener("click", async () => {
            const confirmed = await showConfirmModal(
              t("admin.booking.hideConfirmTitle", "確認自後台隱藏"),
              t(
                "admin.booking.hideConfirmBody",
                "確定從後台列表隱藏這筆預約嗎？\n\n（不改變預約狀態；會員端仍顯示原狀態。額度與可預約時段仍依預約狀態計算，與主列表邏輯相同。）\n\n姓名：{{name}}\n日期：{{date}}\n開始時間：{{start}}",
                { name: b.displayName ?? "", date: b.dateKey ?? "", start: b.startSlot ?? "" },
              ),
              t("admin.booking.hideBtn", "隱藏"),
            );
            if (!confirmed) return;
            adminStatus.textContent = t("admin.status.hiding", "隱藏中…");
            adminStatus.className = "status-line";
            deleteBtn.setAttribute("disabled", "true");
            try {
              await updateDoc(doc(db, "bookings", b.id), {
                invisible: true,
                updatedAt: serverTimestamp(),
              });
              adminStatus.textContent = t("admin.status.hidden", "已自後台隱藏");
              adminStatus.classList.add("ok");
            } catch (e) {
              adminStatus.textContent =
                e instanceof Error ? e.message : t("admin.status.hideFail", "隱藏失敗（你是否已加入 admins 集合？）");
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
          t(
            "admin.snapshot.loadFail",
            "無法讀取預約（常見原因：Firestore Rules 拒絕，或尚未建立索引／admins 文件）。",
          );
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
      const res = await fn({ ...localeApiParam() });
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
    visitorStats.setVisible(isBook);
    titleHeading.textContent = isBook ? t("home.title", "辦公室按摩預約") : t("admin.backTitle", "管理後台");
    titleDesc.textContent = isBook
      ? t(
          "home.subtitle",
          "週一至週五 · 開始時間 15 分鐘一格 · 單次服務約15~50分鐘, 看情況. · 午休 11:45–13:15 不開放 · 最晚 17:30 開始、18:00 前結束",
        )
      : t(
          "admin.backSubtitle",
          "以分頁切換：預約管理、已隱藏的預約、會員與儲值、跑馬燈公告、客服對話、報表。",
        );
    document.title = isBook ? t("meta.docTitle", "辦公室按摩預約") : t("admin.backTitle", "管理後台");
    panelBook.hidden = !isBook;
    panelAdmin.hidden = isBook;
    hostPortrait.hidden = !isBook;
    musicMiniRoot.hidden = !isBook;
    supportChatFloat.hidden = !isBook;
    if (isBook) {
      supportChatFloatDock.relayout();
      musicFloatDock?.relayout();
    }
    if (!isBook) {
      setSupportChatOpen(false);
    }
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
