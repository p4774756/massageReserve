import "./style.css";
import "@fontsource/dseg7/classic-400.css";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import {
  createBookingCall,
  getAvailabilityCall,
  getBookingDayCountsCall,
  getBookingPricingCall,
  getDb,
  getFirebaseAuth,
  getMyWalletCall,
  isFirebaseConfigured,
  redeemWheelPointsCall,
  spinWheelCall,
  listActiveWheelPrizesCall,
} from "./firebase";
import { createVisitorStatsLine } from "./visitorStats";
import { runSlotSpectacle } from "./slotSpectacle";
import { initI18n, intlLocaleTag, localeApiParam, t } from "./i18n";
import { createMyBookingsPanel } from "./myBookingsPanel";
import { createAdminDashboard } from "./adminDashboard";
import { canCurrentUserAccessAdmin } from "./adminAccess";
import { adminSessionCallName, shortUidForDisplay } from "./adminSessionUtil";
import { resolveBookingCapsClient } from "./bookingCaps";
import { bookingModeLabel } from "./bookingDisplay";
import type { BookingMode } from "./bookingTypes";
import { refillSlots } from "./bookingSlotSelect";
import { buildBookingSummary } from "./bookingSummary";
import { el, truncateOneLine } from "./domUtil";
import { errorMessage } from "./errorUtil";
import {
  dateKeyFromYmdTaipei,
  daysInMonthFromOneIndexed,
  firstBookableDateKeyInWindow,
  isDateKeyMonFri,
  isDateKeySatSun,
  isStartSlotInPastForTaipeiToday,
  monthHasBookableDayInBookWindow,
  taipeiLatestBookableDateKey,
  taipeiTodayDateKey,
  taipeiWeekdaySun0FromDateKey,
  weekdayZhFromDateKeyTaipei,
} from "./taipeiDates";
import { showAlertModal, showConfirmModal } from "./modals";
import { wrapPasswordField } from "./passwordField";
import { paintMemberWalletSummary, type MemberWalletSummaryOpts } from "./walletSummaryUi";
import {
  resolveAddon15PriceNtdClient,
  resolvePointsPerMassageClient,
  resolveSessionPriceNtdClient,
} from "./sitePricingResolve";

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
  const pricingDocRef = doc(db, "siteSettings", "pricing");
  const wheelUiSettingsRef = doc(db, "siteSettings", "ui");
  /** `siteSettings/ui.showWheelSlotPreviewButton`；預設 true（會員中心顯示「預覽拉霸特效」） */
  let wheelSlotPreviewSettingFromFirestore = true;

  /** 會員中心關閉時將輪盤區塊移回隱藏 holder（於下方建構後賦值） */
  let parkMemberHubGames: () => void = () => {};
  let memberHubGamesRoot: HTMLElement | null = null;
  /** 會員中心 modal 內錢包摘要節點（勿用 cloneNode，須與 `walletStatus` 同步更新） */
  let memberModalWalletMirror: HTMLElement | null = null;

  function tabFromPath(): "book" | "admin" {
    const path = (window.location.pathname.replace(/\/+$/, "") || "/").toLowerCase();
    return path === "/admin" ? "admin" : "book";
  }

  let tab: "book" | "admin" = tabFromPath();

  const titleHeading = el("h1", {}, [t("home.title", "辦公室按摩預約")]);
  const titleDesc = el("p");
  const visitorStats = createVisitorStatsLine(tabFromPath() !== "admin");
  const visitorStatsLine = visitorStats.element;
  const titleTextCol = el("div", { class: "page-head-text" }, [titleDesc, visitorStatsLine]);

  const memberLoginBtn = el("button", { class: "ghost member-entry member-login", type: "button" }, [
    t("member.entryLogin", "會員登入"),
  ]);
  const memberCenterBtn = el("button", { class: "ghost member-entry member-center", type: "button" }, [
    t("member.entryCenter", "會員中心"),
  ]);
  const headerSignOutBtn = el("button", { class: "ghost member-entry member-sign-out", type: "button" }, [
    t("member.entrySignOut", "登出"),
  ]);
  const adminHeadSignedInHint = el("span", { class: "hint admin-head-signed-in", hidden: true });
  const headMemberActions = el("div", { class: "head-member-actions" }, [
    adminHeadSignedInHint,
    memberLoginBtn,
    memberCenterBtn,
    headerSignOutBtn,
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
  const headSession = el("div", { class: "head-session" }, [headSessionStatus, headMemberActions]);
  const headToolbarAside = el("div", { class: "head-toolbar-aside" }, [headSession]);
  /** 標題與會員同一列；極窄寬時工具列可換行 */
  const pageHeadTopRow = el("div", { class: "page-head-top-row" }, [titleHeading, headToolbarAside]);
  const pageHeadBody = el("div", { class: "page-head-body" }, [pageHeadTopRow, titleTextCol]);

  const panelBook = el("main", { class: "panel" });
  const panelAdmin = el("main", { class: "panel", hidden: true });

  const shell = el("div", { class: "shell" }, [
    el("header", { class: "page-head" }, [pageHeadBody]),
    panelBook,
    panelAdmin,
  ]);

  const shellStage = el("div", { class: "shell-stage" });
  shellStage.append(shell);
  root.append(shellStage);

  const appVersionFooter = el("footer", { class: "app-version-footer" }, []);
  appVersionFooter.textContent = t("footer.version", "版號 {{ver}} · 最後更新 {{date}}（台北）", {
    ver: __APP_VERSION__,
    date: __APP_BUILD_DATE__,
  });
  shell.append(appVersionFooter);

  /** --- 預約表單 --- */
  const nameInput = el("input", {
    type: "text",
    autocomplete: "name",
    maxLength: 80,
    required: true,
    name: "displayName",
  });
  nameInput.setAttribute("aria-required", "true");
  const dateInput = el("input", { type: "hidden", id: "booking-date-value" });
  let bookingPickCalYear = 0;
  let bookingPickCalMonth = 0;
  let bookingPickCalDayCounts: Record<string, number> = {};
  let bookingPickCalDayPeers: Record<string, string[]> = {};
  let bookingPickCalCountsReq = 0;
  const bookingPickCalPeersFetch = new Map<string, Promise<string[]>>();
  let bookPickCalHoverHideTimer = 0;
  let bookPickCalHoverShowDk = "";
  const dateLabelSpan = el("span", {});
  const dateCalendarHint = el("p", {
    class: "hint book-date-calendar-hint",
    id: "book-date-calendar-hint",
  });
  const bookPickCalMonthLabel = el("span", { class: "book-pick-calendar__month-label" });
  const bookPickCalGrid = el("div", { class: "book-pick-calendar__grid", role: "grid" });
  bookPickCalGrid.setAttribute("aria-label", t("booking.pickCalendarAria", "可預約日期"));
  const bookPickCalPrev = el("button", { type: "button", class: "ghost book-pick-calendar__nav-btn" }, ["‹"]);
  const bookPickCalNext = el("button", { type: "button", class: "ghost book-pick-calendar__nav-btn" }, ["›"]);
  bookPickCalPrev.setAttribute("aria-label", t("booking.pickCalPrev", "上個月"));
  bookPickCalNext.setAttribute("aria-label", t("booking.pickCalNext", "下個月"));
  const bookPickCalToolbar = el("div", { class: "book-pick-calendar__toolbar" }, [
    bookPickCalPrev,
    bookPickCalMonthLabel,
    bookPickCalNext,
  ]);
  const bookPickCalHoverTip = el("div", { class: "book-pick-calendar__hover-tip" });
  bookPickCalHoverTip.hidden = true;
  const bookPickCalendar = el("div", { class: "book-pick-calendar" }, [
    bookPickCalToolbar,
    bookPickCalGrid,
    bookPickCalHoverTip,
  ]);
  const radioOfficeWeek = el("input", {
    type: "radio",
    name: "bookingServiceKind",
    id: "booking-svc-office",
    value: "office",
  }) as HTMLInputElement;
  radioOfficeWeek.checked = true;
  const radioHolidayOutcall = el("input", {
    type: "radio",
    name: "bookingServiceKind",
    id: "booking-svc-holiday",
    value: "holiday",
  }) as HTMLInputElement;
  const holidayOutcallTransportHint = el(
    "p",
    { class: "hint book-holiday-outcall-transport-hint", hidden: true },
    [
      t(
        "booking.holidayOutcallTransportHint",
        "單次按摩費用與平日相同；開始時間以每半小時為單位可選。師傅前往外約地點的交通費由您負擔，實際金額請當日與師傅確認。",
      ),
    ],
  );
  const serviceKindFieldset = el("fieldset", { class: "book-service-kind" });
  serviceKindFieldset.append(
    el("legend", { class: "book-service-kind__legend" }, [t("booking.serviceKindTitle", "預約類型")]),
    el("div", { class: "book-service-kind__options" }, [
      el("div", { class: "book-service-kind__option" }, [
        radioOfficeWeek,
        el("label", { htmlFor: "booking-svc-office" }, [
          t("booking.serviceKind.office", "平日｜辦公室時段（週一至週五）"),
        ]),
      ]),
      el("div", { class: "book-service-kind__option" }, [
        radioHolidayOutcall,
        el("label", { htmlFor: "booking-svc-holiday" }, [
          t("booking.serviceKind.holidayOutcall", "假日｜外約（僅能選週六、週日）"),
        ]),
      ]),
    ]),
    holidayOutcallTransportHint,
  );

  function isBookingHolidayOutcallMode(): boolean {
    return radioHolidayOutcall.checked;
  }

  function syncDateFieldLabelText(): void {
    const hol = isBookingHolidayOutcallMode();
    dateLabelSpan.textContent = hol
      ? t("field.dateHolidayOutcall", "日期（週六、週日）")
      : t("field.date", "日期（週一至週五）");
    dateCalendarHint.textContent = t(
      "booking.datePickCalendarHint",
      "請點選下方月曆；僅可選與「預約類型」相符的日期（平日為週一至週五，假日外約為週六、週日）。",
    );
    dateInput.setAttribute("aria-describedby", "book-date-calendar-hint");
  }

  function dateAllowedForCurrentBookingMode(dk: string): boolean {
    if (!dk) return false;
    return isBookingHolidayOutcallMode() ? isDateKeySatSun(dk) : isDateKeyMonFri(dk);
  }

  function bookablePickCell(dk: string): boolean {
    const minKey = taipeiTodayDateKey();
    const maxKey = taipeiLatestBookableDateKey();
    if (dk < minKey || dk > maxKey) return false;
    return dateAllowedForCurrentBookingMode(dk);
  }

  function syncBookingPickCalendarCursorFromValue(): void {
    const dk = dateInput.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) {
      const [y, m] = dk.split("-").map(Number);
      bookingPickCalYear = y;
      bookingPickCalMonth = m;
      return;
    }
    const office = !isBookingHolidayOutcallMode();
    const first = firstBookableDateKeyInWindow(office);
    if (first) {
      const [y, m] = first.split("-").map(Number);
      bookingPickCalYear = y;
      bookingPickCalMonth = m;
    } else {
      const [y, m] = taipeiTodayDateKey().split("-").map(Number);
      bookingPickCalYear = y;
      bookingPickCalMonth = m;
    }
  }

  function bookingPickCalPrevMonth(y: number, m: number): { y: number; m: number } {
    if (m <= 1) return { y: y - 1, m: 12 };
    return { y, m: m - 1 };
  }

  function bookingPickCalNextMonth(y: number, m: number): { y: number; m: number } {
    if (m >= 12) return { y: y + 1, m: 1 };
    return { y, m: m + 1 };
  }

  function bookingPickCalCanGoPrev(y: number, m: number): boolean {
    const office = !isBookingHolidayOutcallMode();
    const { y: py, m: pm } = bookingPickCalPrevMonth(y, m);
    return monthHasBookableDayInBookWindow(py, pm, office);
  }

  function bookingPickCalCanGoNext(y: number, m: number): boolean {
    const office = !isBookingHolidayOutcallMode();
    const { y: ny, m: nm } = bookingPickCalNextMonth(y, m);
    return monthHasBookableDayInBookWindow(ny, nm, office);
  }

  function bookingPickCalDayHoverTitle(dk: string): string {
    const peers = bookingPickCalDayPeers[dk];
    if (!peers?.length) return "";
    return t("booking.calDayPeers", "當日預約：{{list}}", { list: peers.join("、") });
  }

  function hideBookPickCalHoverTip(): void {
    bookPickCalHoverTip.hidden = true;
    bookPickCalHoverShowDk = "";
  }

  function positionBookPickCalHoverTip(anchor: HTMLElement): void {
    const calRect = bookPickCalendar.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    const left = anchorRect.left + anchorRect.width / 2 - calRect.left;
    const top = anchorRect.top - calRect.top - 6;
    bookPickCalHoverTip.style.left = `${left}px`;
    bookPickCalHoverTip.style.top = `${top}px`;
  }

  async function ensureBookingPickCalDayPeers(dk: string): Promise<string[]> {
    const cached = bookingPickCalDayPeers[dk];
    if (cached?.length) return cached;
    const pending = bookingPickCalPeersFetch.get(dk);
    if (pending) return pending;
    const task = (async () => {
      try {
        const fn = getAvailabilityCall();
        const res = await fn({
          dateKey: dk,
          holidayOutcall: isBookingHolidayOutcallMode(),
          ...localeApiParam(),
        });
        const data = res.data as { dayPeersMasked?: string[] };
        const peers =
          Array.isArray(data.dayPeersMasked) ?
            data.dayPeersMasked.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          : [];
        mergeBookingPickCalDayPeers(dk, peers);
        return peers;
      } finally {
        bookingPickCalPeersFetch.delete(dk);
      }
    })();
    bookingPickCalPeersFetch.set(dk, task);
    return task;
  }

  async function refreshBookingPickCalDayPeersForCounts(keys: string[], reqId: number): Promise<void> {
    await Promise.all(
      keys.map(async (dk) => {
        if (reqId !== bookingPickCalCountsReq) return;
        await ensureBookingPickCalDayPeers(dk);
      }),
    );
  }

  async function showBookPickCalHoverTip(anchor: HTMLElement, dk: string): Promise<void> {
    window.clearTimeout(bookPickCalHoverHideTimer);
    bookPickCalHoverShowDk = dk;
    const peers = bookingPickCalDayPeers[dk];
    if (peers?.length) {
      bookPickCalHoverTip.textContent = bookingPickCalDayHoverTitle(dk);
      positionBookPickCalHoverTip(anchor);
      bookPickCalHoverTip.hidden = false;
      return;
    }
    bookPickCalHoverTip.textContent = t("booking.calDayPeersLoading", "載入預約名單…");
    positionBookPickCalHoverTip(anchor);
    bookPickCalHoverTip.hidden = false;
    const loaded = await ensureBookingPickCalDayPeers(dk);
    if (bookPickCalHoverShowDk !== dk) return;
    bookPickCalHoverTip.textContent =
      loaded.length ?
        bookingPickCalDayHoverTitle(dk)
      : t("booking.calDayPeersEmpty", "當日無其他有效預約");
  }

  function wireBookPickCalDayHover(node: HTMLElement, dk: string): void {
    if ((bookingPickCalDayCounts[dk] ?? 0) <= 0) return;
    node.addEventListener("mouseenter", () => {
      void showBookPickCalHoverTip(node, dk);
    });
    node.addEventListener("mouseleave", () => {
      window.clearTimeout(bookPickCalHoverHideTimer);
      bookPickCalHoverHideTimer = window.setTimeout(() => hideBookPickCalHoverTip(), 150);
    });
    node.addEventListener("focusin", () => {
      void showBookPickCalHoverTip(node, dk);
    });
    node.addEventListener("focusout", () => hideBookPickCalHoverTip());
  }

  function appendBookingPickCalDayBadge(parent: HTMLElement, dk: string): void {
    const count = bookingPickCalDayCounts[dk] ?? 0;
    if (count <= 0) return;
    const badge = el("span", { class: "book-pick-calendar__badge" }, [String(count)]);
    parent.append(badge);
  }

  function mergeBookingPickCalDayCount(dk: string, count: number): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return;
    const n = Math.trunc(count);
    if (n > 0) bookingPickCalDayCounts[dk] = n;
    else delete bookingPickCalDayCounts[dk];
  }

  function mergeBookingPickCalDayPeers(dk: string, peers: string[]): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return;
    const list = peers.filter((x) => x.trim().length > 0);
    if (list.length) bookingPickCalDayPeers[dk] = list;
    else delete bookingPickCalDayPeers[dk];
  }

  function bookableDateKeysInPickMonth(y: number, mo: number): string[] {
    const dim = daysInMonthFromOneIndexed(y, mo);
    const keys: string[] = [];
    for (let dayNum = 1; dayNum <= dim; dayNum++) {
      const dk = dateKeyFromYmdTaipei(y, mo, dayNum);
      if (bookablePickCell(dk)) keys.push(dk);
    }
    return keys;
  }

  async function refreshBookingPickCalDayCountsViaAvailability(
    y: number,
    mo: number,
    reqId: number,
  ): Promise<void> {
    const keys = bookableDateKeysInPickMonth(y, mo);
    if (keys.length === 0) {
      bookingPickCalDayCounts = {};
      bookingPickCalDayPeers = {};
      return;
    }
    const fn = getAvailabilityCall();
    const holidayOutcall = isBookingHolidayOutcallMode();
    const next: Record<string, number> = {};
    const nextPeers: Record<string, string[]> = {};
    await Promise.all(
      keys.map(async (dateKey) => {
        try {
          const res = await fn({ dateKey, holidayOutcall, ...localeApiParam() });
          if (reqId !== bookingPickCalCountsReq) return;
          const data = res.data as { dayCount?: number; dayPeersMasked?: string[] };
          if (typeof data.dayCount === "number" && data.dayCount > 0) {
            next[dateKey] = Math.trunc(data.dayCount);
          }
          const peers =
            Array.isArray(data.dayPeersMasked) ?
              data.dayPeersMasked.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            : [];
          if (peers.length) nextPeers[dateKey] = peers;
        } catch {
          /* 單日失敗略過 */
        }
      }),
    );
    if (reqId !== bookingPickCalCountsReq) return;
    bookingPickCalDayCounts = next;
    bookingPickCalDayPeers = nextPeers;
  }

  async function refreshBookingPickCalDayCounts(): Promise<void> {
    if (bookingPickCalYear === 0) syncBookingPickCalendarCursorFromValue();
    const y = bookingPickCalYear;
    const mo = bookingPickCalMonth;
    if (y === 0 || mo === 0) return;
    const reqId = ++bookingPickCalCountsReq;
    try {
      const fn = getBookingDayCountsCall();
      const res = await fn({ year: y, month: mo, ...localeApiParam() });
      if (reqId !== bookingPickCalCountsReq) return;
      const data = res.data as { counts?: Record<string, number>; peersByDay?: Record<string, string[]> };
      const raw = data.counts;
      if (raw && typeof raw === "object") {
        const next: Record<string, number> = {};
        for (const [dk, n] of Object.entries(raw)) {
          if (typeof n === "number" && Number.isFinite(n) && n > 0) next[dk] = Math.trunc(n);
        }
        bookingPickCalDayCounts = next;
      } else {
        bookingPickCalDayCounts = {};
      }
      const rawPeers = data.peersByDay;
      if (rawPeers && typeof rawPeers === "object") {
        const nextPeers: Record<string, string[]> = {};
        for (const [dk, list] of Object.entries(rawPeers)) {
          if (!Array.isArray(list)) continue;
          const peers = list.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
          if (peers.length) nextPeers[dk] = peers;
        }
        bookingPickCalDayPeers = nextPeers;
      } else {
        bookingPickCalDayPeers = {};
        const keysWithCounts = Object.keys(bookingPickCalDayCounts);
        if (keysWithCounts.length > 0) {
          await refreshBookingPickCalDayPeersForCounts(keysWithCounts, reqId);
        }
      }
    } catch {
      if (reqId !== bookingPickCalCountsReq) return;
      await refreshBookingPickCalDayCountsViaAvailability(y, mo, reqId);
    }
    if (reqId !== bookingPickCalCountsReq) return;
    paintBookingPickCalendar();
  }

  function paintBookingPickCalendar(): void {
    if (bookingPickCalYear === 0) {
      syncBookingPickCalendarCursorFromValue();
    }
    const y = bookingPickCalYear;
    const mo = bookingPickCalMonth;
    const selected = dateInput.value;
    const todayK = taipeiTodayDateKey();

    bookPickCalMonthLabel.textContent = new Intl.DateTimeFormat(intlLocaleTag(), {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "long",
    }).format(new Date(`${y}-${String(mo).padStart(2, "0")}-15T12:00:00+08:00`));

    bookPickCalGrid.replaceChildren();
    const hdrRow = el("div", { class: "book-pick-calendar__row book-pick-calendar__row--head" });
    for (const lab of [
      t("admin.calendar.weekSun", "日"),
      t("admin.calendar.weekMon", "一"),
      t("admin.calendar.weekTue", "二"),
      t("admin.calendar.weekWed", "三"),
      t("admin.calendar.weekThu", "四"),
      t("admin.calendar.weekFri", "五"),
      t("admin.calendar.weekSat", "六"),
    ]) {
      hdrRow.append(el("div", { class: "book-pick-calendar__wd" }, [lab]));
    }
    bookPickCalGrid.append(hdrRow);

    const firstKey = dateKeyFromYmdTaipei(y, mo, 1);
    const lead = taipeiWeekdaySun0FromDateKey(firstKey);
    const dim = daysInMonthFromOneIndexed(y, mo);
    const padCell = () => el("div", { class: "book-pick-calendar__cell book-pick-calendar__cell--pad" });
    const cells: HTMLElement[] = [];
    for (let i = 0; i < lead; i++) cells.push(padCell());
    for (let dayNum = 1; dayNum <= dim; dayNum++) {
      const dk = dateKeyFromYmdTaipei(y, mo, dayNum);
      const wrap = el("div", { class: "book-pick-calendar__cell" });
      const canPick = bookablePickCell(dk);

      if (!canPick) {
        const inactive = el("div", { class: "book-pick-calendar__day book-pick-calendar__day--inactive" });
        inactive.append(el("span", { class: "book-pick-calendar__day-num" }, [String(dayNum)]));
        appendBookingPickCalDayBadge(inactive, dk);
        if (dk === todayK) inactive.classList.add("book-pick-calendar__day--today");
        if (dk === selected) inactive.classList.add("book-pick-calendar__day--selected");
        wireBookPickCalDayHover(wrap, dk);
        wrap.append(inactive);
        cells.push(wrap);
        continue;
      }

      const btn = el("button", { type: "button", class: "book-pick-calendar__day" });
      if (dk === selected) btn.classList.add("book-pick-calendar__day--selected");
      if (dk === todayK) btn.classList.add("book-pick-calendar__day--today");
      btn.append(el("span", { class: "book-pick-calendar__day-num" }, [String(dayNum)]));
      appendBookingPickCalDayBadge(btn, dk);
      wireBookPickCalDayHover(btn, dk);
      btn.addEventListener("click", () => {
        dateInput.value = dk;
        paintBookingPickCalendar();
        void refreshAvailability();
      });
      wrap.append(btn);
      cells.push(wrap);
    }
    while (cells.length % 7 !== 0) cells.push(padCell());
    for (let i = 0; i < cells.length; i += 7) {
      const row = el("div", { class: "book-pick-calendar__row" });
      for (let j = 0; j < 7; j++) row.append(cells[i + j]!);
      bookPickCalGrid.append(row);
    }

    bookPickCalPrev.disabled = !bookingPickCalCanGoPrev(y, mo);
    bookPickCalNext.disabled = !bookingPickCalCanGoNext(y, mo);
  }

  function shiftBookingPickCalMonth(delta: number): void {
    let y = bookingPickCalYear;
    let m = bookingPickCalMonth + delta;
    while (m < 1) {
      m += 12;
      y -= 1;
    }
    while (m > 12) {
      m -= 12;
      y += 1;
    }
    bookingPickCalYear = y;
    bookingPickCalMonth = m;
    void refreshBookingPickCalDayCounts();
  }

  bookPickCalPrev.addEventListener("click", () => shiftBookingPickCalMonth(-1));
  bookPickCalNext.addEventListener("click", () => shiftBookingPickCalMonth(1));
  bookPickCalHoverTip.addEventListener("mouseenter", () => {
    window.clearTimeout(bookPickCalHoverHideTimer);
  });
  bookPickCalHoverTip.addEventListener("mouseleave", () => hideBookPickCalHoverTip());

  function onBookingServiceKindChange(): void {
    holidayOutcallTransportHint.hidden = !radioHolidayOutcall.checked;
    syncDateFieldLabelText();
    const office = !isBookingHolidayOutcallMode();
    if (dateInput.value && !dateAllowedForCurrentBookingMode(dateInput.value)) {
      dateInput.value = firstBookableDateKeyInWindow(office);
    } else if (!dateInput.value) {
      dateInput.value = firstBookableDateKeyInWindow(office);
    }
    syncBookingPickCalendarCursorFromValue();
    paintBookingPickCalendar();
    void refreshBookingPickCalDayCounts();
    void refreshAvailability();
  }
  radioOfficeWeek.addEventListener("change", onBookingServiceKindChange);
  radioHolidayOutcall.addEventListener("change", onBookingServiceKindChange);

  const slotSelect = el("select", {}, []);
  function runRefillSlots(
    taken: Set<string>,
    disabled: boolean,
    selectedDateKey: string,
    blockedReasonBySlot: Map<string, string> = new Map(),
  ) {
    refillSlots(
      { slotSelect, isHolidayOutcallMode: () => isBookingHolidayOutcallMode() },
      taken,
      disabled,
      selectedDateKey,
      blockedReasonBySlot,
    );
  }
  const noteInput = el("textarea", { maxLength: 500 });
  const bookingModeSelect = el("select", { id: "booking-mode-select" }, []);
  /** 未驗證會員時覆蓋於 select 上，避免部分瀏覽器仍會開啟原生下拉 */
  const bookingPaymentWrap = el("div", { class: "booking-payment-wrap" }, [bookingModeSelect]);
  const bookingModeHint = el("span", { class: "hint" }, []);
  const submitBtn = el("button", { class: "primary", type: "button" }, [t("booking.submit", "送出預約")]);
  /** 選日期／載入空檔與名額相關提示，緊接在時段選擇下方，避免訊息落在頁面底部 */
  const scheduleStatus = el("div", {
    class: "status-line schedule-status",
    role: "status",
    ariaLive: "polite",
  });
  const bookStatus = el("div", { class: "status-line book-submit-status", role: "status", ariaLive: "polite" });
  const meta = el("div", { class: "meta-pills" });
  /** getAvailability 回傳之匿名預約者（首字 + x），置於名額 pill 下方 */
  const bookingPeersHint = el("div", { class: "booking-peers-hint hint", hidden: true });
  const slotFieldWrap = el(
    "div",
    { class: "grid" },
    [
      el("label", { class: "field" }, [
        t("field.startSlot", "開始時間（請選預約時段）"),
        slotSelect,
      ]),
    ],
  );
  const slotStepSection = el("div", { class: "book-step book-step--slots" }, [
    slotFieldWrap,
    scheduleStatus,
    meta,
    bookingPeersHint,
  ]);
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
  const spinBtn = el("button", { class: "ghost", type: "button" }, [t("booking.spinWheel", "拉霸開獎")]);
  /** 僅登入後顯示：餘額／抽輪盤（訪客預約不需此區） */
  const memberExtrasWrap = el("div", { class: "book-member-extras", hidden: true });
  const finalizeSection = el("div", { class: "book-step book-step--finalize" }, [
    el("div", { class: "grid" }, [
      el("label", { class: "field" }, [t("field.payment", "付款方式"), bookingPaymentWrap, bookingModeHint]),
    ]),
    el("div", { class: "grid" }, [
      el("label", { class: "field" }, [
        t("field.note", "備註（選填）"),
        noteInput,
        el("span", { class: "hint" }, [t("field.noteHint", "可填寫需求，例如：頭痛、背部痠痛、腿部需要按壓等")]),
      ]),
    ]),
    el("div", { class: "row-actions" }, [submitBtn]),
    bookStatus,
  ]);
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
  let sessionCreditsCount = 0;
  let wheelPointsCount = 0;
  let pointsPerMassageSetting = 10;
  /** 與後端 `functions/src/pricing.ts` 預設對齊（定價 API 失敗時的首屏 fallback） */
  let sessionPriceNtdSetting = 70;
  let addon15PriceNtdSetting = 30;
  let drawChances = 0;
  const redeemPointsStatus = el("div", { class: "status-line", hidden: true });
  const redeemPointsBtn = el("button", { type: "button", class: "ghost" }, [
    t("member.redeemPointsBtn", "用 {{per}} 點換 1 次按摩", { per: pointsPerMassageSetting }),
  ]);
  const redeemRow = el("div", { class: "row-actions book-redeem-row", hidden: true }, [redeemPointsBtn]);
  redeemPointsBtn.addEventListener("click", async () => {
    redeemPointsStatus.textContent = "";
    redeemPointsStatus.className = "status-line";
    redeemPointsStatus.hidden = false;
    redeemPointsBtn.setAttribute("disabled", "true");
    try {
      const fn = redeemWheelPointsCall();
      await fn({ ...localeApiParam() });
      redeemPointsStatus.textContent = t("member.redeemOk", "兌換成功。");
      redeemPointsStatus.classList.add("ok");
      await refreshWalletStatus({ keepWalletSummaryDuringFetch: true });
    } catch (e) {
      redeemPointsStatus.textContent = errorMessage(e);
      redeemPointsStatus.classList.add("error");
    } finally {
      syncRedeemPointsUi();
    }
  });

  function syncRedeemPointsUi() {
    redeemPointsBtn.textContent = t("member.redeemPointsBtn", "用 {{per}} 點換 1 次按摩", { per: pointsPerMassageSetting });
    const u = auth.currentUser;
    const vis = Boolean(u && !u.isAnonymous && u.emailVerified);
    redeemRow.hidden = !vis;
    if (!vis) {
      redeemPointsStatus.hidden = true;
      return;
    }
    redeemPointsStatus.hidden = (redeemPointsStatus.textContent ?? "").length === 0;
    if (wheelPointsCount >= pointsPerMassageSetting) redeemPointsBtn.removeAttribute("disabled");
    else redeemPointsBtn.setAttribute("disabled", "true");
  }

  const myBookingsHooks: { afterCancel: () => Promise<void> } = {
    afterCancel: async () => {},
  };
  const myBookingsPanel = createMyBookingsPanel({
    afterCancelSuccess: () => myBookingsHooks.afterCancel(),
  });
  const { stopMyBookingsListener, ensureMyBookingsListener } = myBookingsPanel;
  const myBookingsSection = myBookingsPanel.root;

  function syncHeadMemberButtons() {
    const user = auth.currentUser;
    const bookUi = tab === "book";
    memberLoginBtn.hidden = Boolean(user) || !bookUi;
    /** 後台不顯示會員中心／會員登入（登出保留於標題列） */
    memberCenterBtn.hidden = !user || !bookUi;
    headerSignOutBtn.hidden = !user;
  }

  /** 後台：將「已登入…」放在標題列右上角（登出鈕左側）；預約頁不顯示 */
  function syncAdminHeadSignedInHint(fallbackUid?: string) {
    if (tab !== "admin") {
      adminHeadSignedInHint.hidden = true;
      adminHeadSignedInHint.textContent = "";
      return;
    }
    const u = auth.currentUser;
    const uidRaw = u?.uid ?? fallbackUid ?? "";
    if (!uidRaw) {
      adminHeadSignedInHint.hidden = true;
      adminHeadSignedInHint.textContent = "";
      return;
    }
    const whoLabel =
      u != null
        ? t("admin.signedInLabel", "已登入：{{name}}（{{uid}}）", {
            name: adminSessionCallName(u),
            uid: shortUidForDisplay(u.uid),
          })
        : t("admin.signedInUidOnly", "已登入：（{{uid}}）", { uid: shortUidForDisplay(uidRaw) });
    adminHeadSignedInHint.textContent = whoLabel;
    adminHeadSignedInHint.hidden = false;
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
        t("session.signInLine1", "已登入 · "),
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
    const prefix = t("session.signInLine1", "已登入 · ");
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
        : t(
            "member.verifyPendingReload",
            "尚未偵測到驗證完成，請確認已點擊信內連結（亦可查看垃圾／販促信件匣）後再試。",
          );
    } catch (e) {
      emailVerifyText.textContent = errorMessage(e);
    } finally {
      reloadVerifyBtn.removeAttribute("disabled");
    }
  });

  function openLoginModal() {
    memberModalWalletMirror = null;
    if (auth.currentUser) return;
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card member-modal" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const status = el("div", { class: "status-line" });
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
            "註冊成功，已寄出驗證信。請至信箱（含垃圾／販促信件匣）點擊連結後，再按主畫面的「我已驗證，重新整理狀態」或重新登入。",
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

    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        overlay.remove();
      }
    });
    overlay.append(dialog);
    document.body.append(overlay);
  }

  function openMemberCenterModal() {
    memberModalWalletMirror = null;
    const user = auth.currentUser;
    if (!user) return;
    const overlay = el("div", { class: "modal-overlay" });
    const dialog = el("div", { class: "modal-card member-modal" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const closeBtn = el("button", { class: "ghost", type: "button" }, [t("modal.close", "關閉")]);
    const dismissOverlay = () => {
      parkMemberHubGames();
      memberModalWalletMirror = null;
      overlay.remove();
    };
    closeBtn.addEventListener("click", dismissOverlay);
    if (user.isAnonymous) {
      dialog.append(
        el("h3", {}, [t("member.center", "會員中心")]),
        el("div", { class: "hint" }, [
          t(
            "member.anonymousIntro",
            "您正以訪客身分使用「聯絡店家」。若要儲值、查看預約或抽獎，請先點選右上角「登出」再使用「會員登入」註冊或登入；登入會員後，此裝置上的訪客留言紀錄不會自動合併。",
          ),
        ]),
        el("div", { class: "hint mono" }, [`${t("member.anonymousUid", "匿名身分 UID：")}${shortUidForDisplay(user.uid)}`]),
        el("div", { class: "modal-actions" }, [closeBtn]),
      );
      overlay.addEventListener("click", (ev) => {
        if (ev.target === overlay) dismissOverlay();
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
          t(
            "member.verifyModalHint",
            "請至信箱（含垃圾／販促信件匣）點擊驗證連結後，才能使用儲值、預約與抽獎。",
          ),
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
    const modalWalletHost = el("div", { class: "status-line" });
    memberModalWalletMirror = modalWalletHost;
    modalBody.push(modalWalletHost);
    if (user.emailVerified && memberHubGamesRoot) {
      dialog.classList.add("member-modal--hub");
      const gamesShell = el("div", { class: "member-modal__games" });
      gamesShell.append(memberHubGamesRoot);
      modalBody.push(gamesShell);
    }
    modalBody.push(el("div", { class: "modal-actions" }, [closeBtn]));
    dialog.append(...modalBody);
    void refreshWalletStatus();

    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        parkMemberHubGames();
        memberModalWalletMirror = null;
        overlay.remove();
      }
    });
    overlay.append(dialog);
    document.body.append(overlay);
  }

  function cleanupMemberModalResources() {
    parkMemberHubGames();
    memberModalWalletMirror = null;
  }

  memberLoginBtn.addEventListener("click", openLoginModal);
  memberCenterBtn.addEventListener("click", openMemberCenterModal);
  headerSignOutBtn.addEventListener("click", async () => {
    headerSignOutBtn.setAttribute("disabled", "true");
    try {
      cleanupMemberModalResources();
      document.querySelectorAll(".modal-overlay").forEach((n) => n.remove());
      await signOut(auth);
    } finally {
      headerSignOutBtn.removeAttribute("disabled");
    }
  });

  function refillBookingModes(isMember: boolean) {
    const current = bookingModeSelect.value as BookingMode;
    bookingModeSelect.innerHTML = "";
    const price = sessionPriceNtdSetting;
    bookingModeSelect.disabled = false;
    bookingModeSelect.removeAttribute("disabled");
    bookingModeSelect.removeAttribute("aria-disabled");
    bookingPaymentWrap.querySelector(".booking-payment-lock-shield")?.remove();

    const modes: { value: BookingMode; label: string; disabled?: boolean }[] = [
      { value: "member_wallet", label: t("member.mode.wallet", "會員次數（扣 1 次）") },
      { value: "member_cash", label: t("member.mode.cash", "會員現金（{{price}} 元）", { price }) },
      { value: "member_beverage", label: bookingModeLabel("member_beverage") },
    ];
    for (const mode of modes) {
      const opt = el("option", { value: mode.value, disabled: mode.disabled }, [mode.label]);
      bookingModeSelect.append(opt);
    }
    const values = modes.map((m) => m.value);
    bookingModeSelect.value = values.includes(current) ? current : modes[0].value;

    if (isMember) {
      bookingModeHint.textContent = t(
        "member.modeHint.member",
        "可選次數扣 1 次、會員現金（{{price}} 元），或「請師傅一杯飲料」（依現場約定）。",
        { price },
      );
    } else {
      const loggedInUnverified = Boolean(
        auth.currentUser && !auth.currentUser.isAnonymous && !auth.currentUser.emailVerified,
      );
      bookingModeHint.textContent = loggedInUnverified
        ? t(
            "member.modeHint.unverifiedBook",
            "請至信箱點擊驗證連結；若未收到信，請查看垃圾／販促信件匣，或使用上方「重新寄送驗證信」。",
          )
        : t(
            "member.modeHint.signUpFirst",
            "預約僅開放給會員；可先選好付款方式，送出時須已登入並完成信箱驗證（右上角「會員登入」）。",
          );
    }
  }

  function buildMembersOnlyReminderBody(): string {
    const loggedInUnverified = Boolean(
      auth.currentUser && !auth.currentUser.isAnonymous && !auth.currentUser.emailVerified,
    );
    const head = t(
      "booking.mode.membersOnlyPlaceholder",
      "請先註冊／登入並完成信箱驗證後才可選擇付款方式（右上角「會員登入」）",
    );
    const detail = loggedInUnverified
      ? t(
          "member.modeHint.unverifiedBook",
          "請至信箱點擊驗證連結；若未收到信，請查看垃圾／販促信件匣，或使用上方「重新寄送驗證信」。",
        )
      : t(
          "member.modeHint.signUpFirst",
          "預約僅開放給會員。請點右上角「會員登入」註冊或登入；註冊後請至信箱完成驗證（若未見來信，請查看垃圾／販促信件匣）。",
        );
    return `${head}\n\n${detail}`;
  }

  /** 與下方 `setBookSubTab` 一併指派：非會員登入時關閉「我的預約」並切回預約表單 */
  let syncBookMyBookingsTabVisibility: () => void = () => {};

  function setMemberWalletLinePlain(text: string, className: string) {
    walletStatus.textContent = text;
    walletStatus.className = className;
    if (memberModalWalletMirror) {
      memberModalWalletMirror.textContent = text;
      memberModalWalletMirror.className = className;
    }
  }

  function paintMemberWalletSummaryBoth(opts: MemberWalletSummaryOpts) {
    paintMemberWalletSummary(walletStatus, opts);
    if (memberModalWalletMirror) paintMemberWalletSummary(memberModalWalletMirror, opts);
  }

  type RefreshWalletStatusOpts = {
    /** 為 true 時不先把摘要換成「讀取中」，避免剛操作完（兌換／抽獎等）畫面閃一下 */
    keepWalletSummaryDuringFetch?: boolean;
  };

  async function refreshWalletStatus(opts?: RefreshWalletStatusOpts) {
    try {
      const user = auth.currentUser;
      refillBookingModes(isVerifiedMember());
      syncHeadMemberButtons();
      if (!user) {
        stopMyBookingsListener();
        walletBalance = 0;
        sessionCreditsCount = 0;
        wheelPointsCount = 0;
        drawChances = 0;
        memberExtrasWrap.hidden = true;
        emailVerifyBanner.hidden = true;
        setMemberWalletLinePlain("", "status-line");
        spinBtn.setAttribute("disabled", "true");
        wheelStatus.textContent = "";
        wheelStatus.className = "status-line";
        wheelResult.hidden = true;
        syncRedeemPointsUi();
        syncPageHeadSession();
        return;
      }
      if (user.isAnonymous) {
        stopMyBookingsListener();
        walletBalance = 0;
        sessionCreditsCount = 0;
        wheelPointsCount = 0;
        drawChances = 0;
        memberExtrasWrap.hidden = true;
        emailVerifyBanner.hidden = true;
        setMemberWalletLinePlain("", "status-line");
        spinBtn.setAttribute("disabled", "true");
        wheelStatus.textContent = "";
        wheelStatus.className = "status-line";
        wheelResult.hidden = true;
        syncRedeemPointsUi();
        syncPageHeadSession();
        return;
      }
      if (!user.emailVerified) {
        memberExtrasWrap.hidden = false;
        stopMyBookingsListener();
        walletBalance = 0;
        sessionCreditsCount = 0;
        wheelPointsCount = 0;
        drawChances = 0;
        emailVerifyBanner.hidden = false;
        emailVerifyText.textContent = t(
          "member.verifyBanner",
          "已登入，但尚未完成 Email 驗證。請至信箱（含垃圾／販促信件匣）點擊驗證連結；完成後請按「我已驗證，重新整理狀態」。",
        );
        setMemberWalletLinePlain("", "status-line");
        spinBtn.setAttribute("disabled", "true");
        wheelStatus.textContent = t("member.wheelNeedVerifyFirst", "完成信箱驗證後才可拉霸開獎。");
        wheelStatus.className = "status-line";
        wheelResult.hidden = true;
        syncRedeemPointsUi();
        syncPageHeadSession();
        return;
      }
      emailVerifyBanner.hidden = true;
      memberExtrasWrap.hidden = true;
      ensureMyBookingsListener(user.uid);
      if (!opts?.keepWalletSummaryDuringFetch) {
        setMemberWalletLinePlain(t("member.walletLoading", "讀取會員餘額中…"), "status-line");
      }
      redeemPointsStatus.textContent = "";
      redeemPointsStatus.className = "status-line";
      syncPageHeadSession(user.displayName?.trim() || user.email?.trim());
      try {
        const fn = getMyWalletCall();
        const res = await fn({ ...localeApiParam() });
        const data = res.data as {
          walletBalance: number;
          sessionCredits: number;
          wheelPoints: number;
          drawChances: number;
          nickname?: string;
          sessionPriceNtd?: number;
          addon15PriceNtd?: number;
          pointsPerMassage?: number;
        };
        walletBalance = typeof data.walletBalance === "number" ? data.walletBalance : 0;
        sessionCreditsCount = typeof data.sessionCredits === "number" ? data.sessionCredits : 0;
        wheelPointsCount = typeof data.wheelPoints === "number" ? data.wheelPoints : 0;
        drawChances = typeof data.drawChances === "number" ? data.drawChances : 0;
        if (typeof data.sessionPriceNtd === "number" && Number.isFinite(data.sessionPriceNtd)) {
          sessionPriceNtdSetting = Math.max(1, Math.round(data.sessionPriceNtd));
        }
        if (typeof data.addon15PriceNtd === "number" && Number.isFinite(data.addon15PriceNtd)) {
          addon15PriceNtdSetting = Math.max(1, Math.round(data.addon15PriceNtd));
        }
        if (typeof data.pointsPerMassage === "number" && Number.isFinite(data.pointsPerMassage)) {
          pointsPerMassageSetting = Math.max(2, Math.round(data.pointsPerMassage));
        }
        syncHomePageSubtitle();
        refillBookingModes(isVerifiedMember());
        const nickFromDb =
          typeof data.nickname === "string" && data.nickname.trim() ? data.nickname.trim() : "";
        const nickFromAuth = user.displayName?.trim() ?? "";
        const profileNick = nickFromDb || nickFromAuth;
        if (profileNick && !nameInput.value.trim()) {
          nameInput.value = profileNick.slice(0, 80);
        }
        const legacyLine =
          walletBalance > 0
            ? t("member.walletLegacyLine", "尚有 {{n}} 元未折成次數。", { n: walletBalance })
            : "";
        paintMemberWalletSummaryBoth({
          sessions: sessionCreditsCount,
          points: wheelPointsCount,
          per: pointsPerMassageSetting,
          chances: drawChances,
          legacy: legacyLine,
        });
        wheelStatus.textContent =
          drawChances > 0 ? t("member.wheelLuck", "可拉霸開獎，祝你好運！") : t("member.wheelNone", "目前無可抽次數。");
        wheelStatus.className = "status-line";
        if (drawChances > 0) spinBtn.removeAttribute("disabled");
        else spinBtn.setAttribute("disabled", "true");
        syncRedeemPointsUi();
        syncPageHeadSession(profileNick);
      } catch (e) {
        walletBalance = 0;
        sessionCreditsCount = 0;
        wheelPointsCount = 0;
        drawChances = 0;
        memberExtrasWrap.hidden = true;
        setMemberWalletLinePlain(errorMessage(e), "status-line error");
        spinBtn.setAttribute("disabled", "true");
        wheelStatus.textContent = t("member.wheelStateFail", "無法讀取抽獎狀態。");
        wheelStatus.className = "status-line error";
        syncRedeemPointsUi();
        syncPageHeadSession();
      }
    } finally {
      syncBookMyBookingsTabVisibility();
    }
  }

  myBookingsHooks.afterCancel = () => refreshWalletStatus({ keepWalletSummaryDuringFetch: true });

  async function fetchWheelPrizeLabelsForSpectacle() {
    const fn = listActiveWheelPrizesCall();
    const res = await fn({ ...localeApiParam() });
    const data = res.data as { prizes: { id: string; name: string; weight: number }[] };
    return data.prizes;
  }

  /** 預覽輪盤用：固定示範獎項（不連後端），格內可立即看到文字與比例 */
  const wheelPreviewMockPrizes: { id: string; name: string; weight: number }[] = [
    { id: "pv-p5", name: t("wheel.previewPrizePts5", "【預覽】+5 點"), weight: 26 },
    { id: "pv-p3", name: t("wheel.previewPrizePts3", "【預覽】+3 點"), weight: 30 },
    { id: "pv-ch", name: t("wheel.previewPrizeExtra", "再抽一次"), weight: 18 },
    { id: "pv-th", name: t("wheel.previewPrizeThanks", "銘謝惠顧"), weight: 26 },
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
      const data = await runSlotSpectacle(
        async () => {
          const fn = spinWheelCall();
          const res = await fn({ ...localeApiParam() });
          return res.data as {
            prize: { id?: string; name: string; type: string; value: number };
            drawChances: number;
            walletBalance: number;
            wheelPoints: number;
            sessionCredits: number;
          };
        },
        { splitAnchor: wheelRow, fetchPrizeLabels: fetchWheelPrizeLabelsForSpectacle },
      );
      wheelResult.textContent = `${t("wheel.spinWonPrefix", "抽中：")}${data.prize.name}`;
      wheelResult.hidden = false;
      wheelStatus.textContent = t("wheel.spinDone", "抽獎完成！");
      wheelStatus.classList.add("ok");
      await refreshWalletStatus({ keepWalletSummaryDuringFetch: true });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        wheelStatus.textContent = "";
        wheelStatus.className = "status-line";
      } else {
        wheelStatus.textContent = errorMessage(e);
        wheelStatus.classList.add("error");
      }
      if (drawChances > 0) spinBtn.removeAttribute("disabled");
    }
  });

  /** 當日／本工作週名額已滿時後端會停用所有時段；隱藏時段選單以免以為還能選時間 */
  let bookingCapacityBlocksSlots = false;
  /** 查詢空檔中：隱藏整段開始時間 UI，避免長下拉或舊資料閃現 */
  let bookingAvailabilityLoading = false;

  /** 依日期／時段顯示「時段＋名額」區與「付款＋備註＋送出」區，減少一進頁的視覺負擔 */
  function syncBookingStepVisibility() {
    const dk = dateInput.value;
    const minKey = taipeiTodayDateKey();
    const maxKey = taipeiLatestBookableDateKey();
    const inWindow = dk !== "" && dk >= minKey && dk <= maxKey;
    const dateOkForMode =
      dk !== "" && (isBookingHolidayOutcallMode() ? isDateKeySatSun(dk) : isDateKeyMonFri(dk));
    const showSlotFields = inWindow && dateOkForMode;

    const pickable =
      !slotSelect.disabled &&
      Array.from(slotSelect.options).some((o) => o.value !== "" && !o.disabled);
    const hideStartTimeRow =
      !showSlotFields ||
      bookingCapacityBlocksSlots ||
      bookingAvailabilityLoading ||
      (showSlotFields && !bookingAvailabilityLoading && !pickable);

    slotStepSection.hidden = dk === "";
    slotFieldWrap.hidden = hideStartTimeRow;

    const slotPicked = Boolean(slotSelect.value);
    /** 與時段列一致：無可選時段／載入中／額滿時一併隱藏付款與送出 */
    finalizeSection.hidden = !slotPicked || !showSlotFields || hideStartTimeRow;
  }

  syncDateFieldLabelText();
  if (!dateInput.value) {
    dateInput.value = firstBookableDateKeyInWindow(!isBookingHolidayOutcallMode());
  }
  syncBookingPickCalendarCursorFromValue();
  paintBookingPickCalendar();
  void refreshBookingPickCalDayCounts();
  void refreshAvailability();

  function syncHomePageSubtitle() {
    if (tab !== "book") return;
    titleDesc.textContent = t(
      "home.subtitle",
      "按次 {{first}} 元；超過半小時再加 {{addon}} 元（現場收費）",
      { first: sessionPriceNtdSetting, addon: addon15PriceNtdSetting },
    );
  }

  async function refreshBookingPricing() {
    try {
      const fn = getBookingPricingCall();
      const res = await fn({ ...localeApiParam() });
      const d = res.data as {
        sessionPriceNtd?: number;
        addon15PriceNtd?: number;
        pointsPerMassage?: number;
      };
      if (typeof d.sessionPriceNtd === "number" && Number.isFinite(d.sessionPriceNtd)) {
        sessionPriceNtdSetting = Math.max(1, Math.round(d.sessionPriceNtd));
      }
      if (typeof d.addon15PriceNtd === "number" && Number.isFinite(d.addon15PriceNtd)) {
        addon15PriceNtdSetting = Math.max(1, Math.round(d.addon15PriceNtd));
      }
      if (typeof d.pointsPerMassage === "number" && Number.isFinite(d.pointsPerMassage)) {
        pointsPerMassageSetting = Math.max(2, Math.round(d.pointsPerMassage));
      }
    } catch {
      /* 使用預設 */
    }
    syncHomePageSubtitle();
    refillBookingModes(isVerifiedMember());
  }

  async function refreshAvailability() {
    try {
      bookingCapacityBlocksSlots = false;
      bookingAvailabilityLoading = false;
      meta.innerHTML = "";
      bookingPeersHint.replaceChildren();
      bookingPeersHint.hidden = true;

      const minKey = taipeiTodayDateKey();
      const maxKey = taipeiLatestBookableDateKey();

      let dk = dateInput.value;
      if (dk && !dateAllowedForCurrentBookingMode(dk)) {
        dateInput.value = "";
        dk = "";
        scheduleStatus.textContent = t(
          "booking.dateClearedWrongWeekday",
          "此日期與目前「預約類型」不符，已清除。平日請選週一至週五；假日外約請選週六、週日。",
        );
        scheduleStatus.className = "status-line schedule-status error";
        runRefillSlots(new Set(), true, "", new Map());
        syncBookingStepVisibility();
        syncBookingPickCalendarCursorFromValue();
        paintBookingPickCalendar();
        return;
      }

      scheduleStatus.textContent = "";
      scheduleStatus.className = "status-line schedule-status";

      if (!dk) {
        runRefillSlots(new Set(), true, "", new Map());
        paintBookingPickCalendar();
        return;
      }

      if (dk < minKey) {
        runRefillSlots(new Set(), true, "", new Map());
        scheduleStatus.textContent = t("booking.datePast", "不可選擇今天以前的日期。");
        scheduleStatus.classList.add("error");
        dateInput.value = "";
        syncBookingPickCalendarCursorFromValue();
        paintBookingPickCalendar();
        return;
      }

      if (dk > maxKey) {
        runRefillSlots(new Set(), true, "", new Map());
        scheduleStatus.textContent = t("booking.dateBeyond", "僅能預約至下週日為止。");
        scheduleStatus.classList.add("error");
        dateInput.value = "";
        syncBookingPickCalendarCursorFromValue();
        paintBookingPickCalendar();
        return;
      }

      try {
        bookingAvailabilityLoading = true;
        scheduleStatus.textContent = t("booking.slotsLoading", "正在載入可預約時段…");
        scheduleStatus.className = "status-line schedule-status";
        syncBookingStepVisibility();
        const fn = getAvailabilityCall();
        const res = await fn({
          dateKey: dk,
          holidayOutcall: isBookingHolidayOutcallMode(),
          ...localeApiParam(),
        });
        const data = res.data as {
          taken: string[];
          blockedSlots?: { startSlot: string; reason?: string }[];
          dayCount: number;
          weekCount: number;
          dayCap: number;
          weekCap: number;
          dayPeersMasked?: string[];
          weekPeersMasked?: string[];
        };
        const taken = new Set(data.taken);
        const dayFull = data.dayCount >= data.dayCap;
        const weekFull = data.weekCount >= data.weekCap;
        mergeBookingPickCalDayCount(dk, data.dayCount);
        const dayPeersForCal =
          Array.isArray(data.dayPeersMasked) ?
            data.dayPeersMasked.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          : [];
        mergeBookingPickCalDayPeers(dk, dayPeersForCal);
        paintBookingPickCalendar();
        const blocked = dayFull || weekFull;
        bookingCapacityBlocksSlots = blocked;
        const blockedMap = new Map<string, string>();
        for (const b of data.blockedSlots ?? []) {
          if (b && typeof b.startSlot === "string") {
            blockedMap.set(b.startSlot, typeof b.reason === "string" ? b.reason : "");
          }
        }

        setBookFooterFromCaps(data.dayCap, data.weekCap);
        runRefillSlots(taken, blocked, dk, blockedMap);
        const weekdayZh = weekdayZhFromDateKeyTaipei(dk);
        meta.replaceChildren(
          el("span", { class: "pill" }, [
            weekdayZh ?
              t("booking.metaDayWithWeekday", "當日（{{weekday}}）已預約 ", { weekday: weekdayZh })
            : t("booking.metaDay", "當日已預約 "),
            el("strong", {}, [String(data.dayCount)]),
            ` / ${data.dayCap}`,
          ]),
          el("span", { class: "pill" }, [
            t("booking.metaWeek", "本工作週已預約 "),
            el("strong", {}, [String(data.weekCount)]),
            ` / ${data.weekCap}`,
          ]),
        );
        const dayPeers =
          Array.isArray(data.dayPeersMasked) ?
            data.dayPeersMasked.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          : [];
        const weekPeers =
          Array.isArray(data.weekPeersMasked) ?
            data.weekPeersMasked.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
          : [];
        const peerLines: HTMLElement[] = [];
        if (dayPeers.length) {
          peerLines.push(
            el("div", { class: "booking-peers-line" }, [
              weekdayZh ?
                t("booking.peersDayWithWeekday", "當日（{{weekday}}｜匿名）：{{list}}", {
                  weekday: weekdayZh,
                  list: dayPeers.join("、"),
                })
              : t("booking.peersDay", "當日（匿名）：{{list}}", { list: dayPeers.join("、") }),
            ]),
          );
        }
        if (weekPeers.length) {
          peerLines.push(
            el("div", { class: "booking-peers-line" }, [
              t("booking.peersWeek", "本工作週（匿名）：{{list}}", { list: weekPeers.join("、") }),
            ]),
          );
        }
        if (peerLines.length) {
          bookingPeersHint.replaceChildren(...peerLines);
          bookingPeersHint.hidden = false;
        } else {
          bookingPeersHint.replaceChildren();
          bookingPeersHint.hidden = true;
        }
        if (dayFull) {
          scheduleStatus.textContent = t("booking.dayFull", "這一天已額滿。");
          scheduleStatus.classList.add("error");
        } else if (weekFull) {
          scheduleStatus.textContent = t("booking.weekFull", "本工作週已達上限。");
          scheduleStatus.classList.add("error");
        } else {
          scheduleStatus.textContent = "";
          scheduleStatus.className = "status-line schedule-status";
          const hasPickable = Array.from(slotSelect.options).some((o) => o.value !== "" && !o.disabled);
          if (!hasPickable) {
            scheduleStatus.textContent = t("booking.noPickableSlot", "當日已無可選的開始時間。");
            scheduleStatus.classList.add("error");
          }
        }
      } catch (e) {
        console.error(e);
        bookingPeersHint.replaceChildren();
        bookingPeersHint.hidden = true;
        runRefillSlots(new Set(), true, dk, new Map());
        const detail = errorMessage(e);
        const genericErr = t("errors.generic", "發生錯誤");
        const base = t("booking.loadSlotsFail", "無法載入空檔，請稍後再試。");
        let msg = base;
        if (isBookingHolidayOutcallMode() && detail !== genericErr && /週一.*週五|weekday/i.test(detail)) {
          msg = t(
            "booking.loadSlotsFailOutcallBackend",
            "無法載入假日外約空檔：後端仍僅開放週一至週五查詢。請部署已支援假日外約的 Cloud Functions（getAvailability），或暫改選「平日｜辦公室」。詳情：{{detail}}",
            { detail },
          );
        } else if (detail && detail !== genericErr) {
          msg = t("booking.loadSlotsFailWithDetail", "{{base}} 詳情：{{detail}}", { base, detail });
        }
        scheduleStatus.textContent = msg;
        scheduleStatus.classList.add("error");
      } finally {
        bookingAvailabilityLoading = false;
      }
    } finally {
      syncBookingStepVisibility();
      paintBookingPickCalendar();
    }
  }

  slotSelect.addEventListener("change", syncBookingStepVisibility);

  onSnapshot(
    doc(db, "siteSettings", "bookingCaps"),
    (snap) => {
      const caps = resolveBookingCapsClient(snap.data());
      setBookFooterFromCaps(caps.maxPerDay, caps.maxPerWorkWeek);
      void refreshAvailability();
    },
    () => {
      /* 讀取失敗時保留現有頁尾（通常為預設句或最近一次空檔 API） */
    },
  );

  submitBtn.addEventListener("click", async () => {
    bookStatus.textContent = "";
    bookStatus.className = "status-line";
    const displayName = nameInput.value.trim();
    const dateKey = dateInput.value;
    const startSlot = slotSelect.value;
    const note = noteInput.value.trim();
    const bookingMode = bookingModeSelect.value as BookingMode;
    if (!displayName) {
      bookStatus.textContent = t("booking.fillName", "請填寫姓名（必填）。");
      bookStatus.classList.add("error");
      nameInput.focus();
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
    const holidayOutcall = isBookingHolidayOutcallMode();
    if (holidayOutcall && !isDateKeySatSun(dateKey)) {
      bookStatus.textContent = t("booking.weekendOutcallOnly", "假日外約僅能選週六、週日。");
      bookStatus.classList.add("error");
      return;
    }
    if (!holidayOutcall && !isDateKeyMonFri(dateKey)) {
      bookStatus.textContent = t("booking.weekdayOnly", "僅能預約週一到週五。");
      bookStatus.classList.add("error");
      return;
    }
    const allowedModes: BookingMode[] = ["member_cash", "member_wallet", "member_beverage"];
    const canBookAsMember =
      allowedModes.includes(bookingMode) &&
      Boolean(auth.currentUser?.emailVerified);
    if (!canBookAsMember) {
      await showAlertModal(
        t("booking.membersOnlyModalTitle", "預約須先完成會員登入與信箱驗證"),
        buildMembersOnlyReminderBody(),
        t("modal.ok", "我知道了"),
      );
      return;
    }
    if (bookingMode === "member_wallet" && sessionCreditsCount < 1) {
      bookStatus.textContent = t(
        "booking.sessionShort",
        "預約次數不足，請改用現金、「請師傅一杯飲料」或先儲值次數。",
      );
      bookStatus.classList.add("error");
      return;
    }
    const confirmed = await showConfirmModal(
      t("booking.confirmTitle", "確認送出預約"),
      buildBookingSummary(displayName, dateKey, startSlot, note, bookingMode, holidayOutcall),
      t("booking.confirmSubmit", "確認送出"),
    );
    if (!confirmed) {
      bookStatus.textContent = t("booking.cancelledSubmit", "已取消送出。");
      return;
    }
    submitBtn.setAttribute("disabled", "true");
    try {
      const fn = createBookingCall();
      await fn({
        displayName,
        note,
        dateKey,
        startSlot,
        bookingMode,
        ...(holidayOutcall ? { holidayOutcall: true } : {}),
        ...localeApiParam(),
      });
      const submittedLine = t(
        "booking.submitted",
        "已送出！狀態為「待確認」，實際時間會依現場情況微調。",
      );
      const myBookingsHint = t("booking.submittedMyBookingsHint", "可到上方「我的預約」分頁查看預約狀態。");
      bookStatus.textContent = `${submittedLine} ${myBookingsHint}`;
      bookStatus.classList.add("ok");
      nameInput.value = "";
      noteInput.value = "";
      await refreshAvailability();
      void refreshBookingPickCalDayCounts();
      await refreshWalletStatus({ keepWalletSummaryDuringFetch: true });
    } catch (e) {
      bookStatus.textContent = errorMessage(e);
      bookStatus.classList.add("error");
    } finally {
      submitBtn.removeAttribute("disabled");
    }
  });

  const wheelTestBtn = el("button", { class: "ghost", type: "button" }, [
    t("wheel.previewBtn", "預覽拉霸特效"),
  ]);
  wheelTestBtn.hidden = true;
  wheelTestBtn.title = t("wheel.previewTitle", "僅畫面預覽，不呼叫抽獎、不扣次數");
  const wheelRow = el("div", { class: "book-wheel-row member-hub-wheel-card__spin-row" }, [
    spinBtn,
    wheelTestBtn,
    wheelStatus,
    wheelResult,
  ]);
  memberExtrasWrap.append(emailVerifyBanner);

  wheelTestBtn.addEventListener("click", async () => {
    wheelTestBtn.setAttribute("disabled", "true");
    try {
      await runSlotSpectacle(
        async () => {
          await new Promise((r) => setTimeout(r, 1200));
          return {
            prize: {
              id: "pv-p3",
              name: t("wheel.previewPrizePts3", "【預覽】+3 點"),
              type: "points",
              value: 3,
            },
            drawChances,
            walletBalance,
            wheelPoints: wheelPointsCount,
            sessionCredits: sessionCreditsCount,
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
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        wheelStatus.textContent = errorMessage(e);
        wheelStatus.className = "status-line error";
      }
    } finally {
      wheelTestBtn.removeAttribute("disabled");
    }
  });

  let bookSubTab: "book" | "mybookings" = "book";

  const bookTabList = el("div", { class: "book-tabs", role: "tablist" });
  bookTabList.setAttribute(
    "aria-label",
    t(
      "book.tabsAria",
      "預約按摩、我的預約；「我的預約」於登入會員後顯示。抽拉霸請開啟會員中心。",
    ),
  );
  const tabBook = el("button", { type: "button", class: "tab book-tab", role: "tab", id: "book-tab-book" }, [
    t("book.tab.booking", "預約按摩"),
  ]);
  const tabMyBookings = el("button", { type: "button", class: "tab book-tab", role: "tab", id: "book-tab-my-bookings" }, [
    t("book.tab.myBookings", "我的預約"),
  ]);
  tabBook.setAttribute("aria-controls", "book-tab-panel-book");
  tabMyBookings.setAttribute("aria-controls", "book-tab-panel-my-bookings");
  tabBook.setAttribute("aria-selected", "true");
  tabMyBookings.setAttribute("aria-selected", "false");
  tabBook.tabIndex = 0;
  tabMyBookings.tabIndex = -1;
  tabMyBookings.hidden = true;
  bookTabList.append(tabBook, tabMyBookings);

  const bookPanelBook = el("div", {
    class: "book-tab-panel",
    id: "book-tab-panel-book",
    role: "tabpanel",
  });
  bookPanelBook.setAttribute("aria-labelledby", "book-tab-book");
  bookPanelBook.append(
    serviceKindFieldset,
    el("div", { class: "grid grid-2" }, [
      el("label", { class: "field" }, [t("field.name", "姓名（必填）"), nameInput]),
      el("label", { class: "field field--booking-date" }, [
        dateLabelSpan,
        dateCalendarHint,
        bookPickCalendar,
        dateInput,
      ]),
    ]),
    /** 與選時段／付款區分離：未完成信箱驗證時顯示提示（餘額／輪盤／兌換在會員中心） */
    memberExtrasWrap,
    slotStepSection,
    finalizeSection,
    bookFooterNote,
  );

  const memberHubGamesHolder = el("div", {
    id: "member-hub-games-holder",
    class: "member-hub-games-holder",
  });
  memberHubGamesHolder.setAttribute("aria-hidden", "true");
  root.append(memberHubGamesHolder);

  const memberHubPanelWheel = el("div", {
    class: "book-tab-panel book-tab-panel--wheel member-hub-games__panel",
    id: "member-hub-panel-wheel",
    role: "tabpanel",
  });
  const wheelRedeemBlock = el("div", { class: "book-wheel-redeem member-hub-wheel-card__redeem" }, [
    redeemRow,
    redeemPointsStatus,
  ]);
  const memberHubWheelCard = el("section", { class: "member-hub-wheel-card" });
  memberHubWheelCard.append(
    el("h4", { class: "member-hub-wheel-card__title" }, [t("member.wheelSectionTitle", "拉霸")]),
    wheelRedeemBlock,
    wheelRow,
  );
  memberHubPanelWheel.append(memberHubWheelCard);

  const bookPanelMyBookings = el("div", {
    class: "book-tab-panel book-tab-panel--my-bookings",
    id: "book-tab-panel-my-bookings",
    role: "tabpanel",
    hidden: true,
  });
  bookPanelMyBookings.setAttribute("aria-labelledby", "book-tab-my-bookings");
  bookPanelMyBookings.append(myBookingsSection);

  memberHubGamesRoot = el("div", { class: "member-hub-games member-hub-games--wheel-only" });
  memberHubGamesRoot.append(memberHubPanelWheel);
  memberHubGamesHolder.append(memberHubGamesRoot);

  parkMemberHubGames = () => {
    memberHubGamesHolder.append(memberHubGamesRoot!);
  };

  function setBookSubTab(which: "book" | "mybookings") {
    bookSubTab = which;
    tabBook.setAttribute("aria-selected", String(which === "book"));
    tabMyBookings.setAttribute("aria-selected", String(which === "mybookings"));
    tabBook.tabIndex = which === "book" ? 0 : -1;
    tabMyBookings.tabIndex = which === "mybookings" ? 0 : -1;
    bookPanelBook.hidden = which !== "book";
    bookPanelMyBookings.hidden = which !== "mybookings";
  }
  tabBook.addEventListener("click", () => setBookSubTab("book"));
  tabMyBookings.addEventListener("click", () => setBookSubTab("mybookings"));

  syncBookMyBookingsTabVisibility = () => {
    const u = auth.currentUser;
    const show = Boolean(u && !u.isAnonymous);
    tabMyBookings.hidden = !show;
    if (!show && bookSubTab === "mybookings") {
      setBookSubTab("book");
    } else {
      setBookSubTab(bookSubTab);
    }
  };
  syncBookMyBookingsTabVisibility();

  panelBook.append(bookTabList, bookPanelBook, bookPanelMyBookings);

  /** --- 管理後台 --- */
  const adminWrap = el("div", {}, []);
  panelAdmin.append(adminWrap);

  const adminDashboard = createAdminDashboard({
    adminWrap,
    auth,
    db,
    wheelUiSettingsRef,
    syncAdminHeadSignedInHint,
    refreshWalletStatus,
  });
  const { stopAdminListener, renderAdminLoggedOut, renderAdminForbidden, renderAdminTable } = adminDashboard;


  /** 輪盤特效預覽按鈕：由後台「其他設定」`siteSettings/ui.showWheelSlotPreviewButton` 控制（所有會員皆可見，與是否管理員無關） */
  function syncWheelPreviewBtnVisibility() {
    wheelTestBtn.hidden = !wheelSlotPreviewSettingFromFirestore;
  }

  onSnapshot(
    wheelUiSettingsRef,
    (snap) => {
      const raw = snap.data()?.showWheelSlotPreviewButton;
      wheelSlotPreviewSettingFromFirestore = typeof raw === "boolean" ? raw : true;
      syncWheelPreviewBtnVisibility();
    },
    () => {
      wheelSlotPreviewSettingFromFirestore = true;
      syncWheelPreviewBtnVisibility();
    },
  );

  /** 後台寫入 `siteSettings/pricing` 後即時反映（不依賴 Cloud Functions 是否已部署 `addon15PriceNtd`） */
  onSnapshot(
    pricingDocRef,
    (snap) => {
      const raw = snap.data() as Record<string, unknown> | undefined;
      sessionPriceNtdSetting = resolveSessionPriceNtdClient(raw);
      addon15PriceNtdSetting = resolveAddon15PriceNtdClient(raw);
      pointsPerMassageSetting = resolvePointsPerMassageClient(raw);
      syncHomePageSubtitle();
      refillBookingModes(isVerifiedMember());
      syncRedeemPointsUi();
    },
    () => {
      /* 讀取失敗時保留上一輪數值與 Callable 結果 */
    },
  );

  async function syncAdminView() {
    if (tab !== "admin") return;
    const user = auth.currentUser;
    if (!user) {
      renderAdminLoggedOut();
      return;
    }
    const allowed = await canCurrentUserAccessAdmin(auth);
    if (!allowed) {
      renderAdminForbidden();
      return;
    }
    renderAdminTable(user.uid);
  }

  onAuthStateChanged(auth, () => {
    void (async () => {
      await refreshBookingPricing();
      await refreshWalletStatus();
      syncWheelPreviewBtnVisibility();
    })();
    syncAdminHeadSignedInHint();
    if (tab !== "admin") return;
    void syncAdminView();
  });

  function setTab(next: "book" | "admin") {
    tab = next;
    const isBook = next === "book";
    shell.classList.toggle("admin-mode", !isBook);
    visitorStats.setVisible(isBook);
    titleHeading.textContent = isBook ? t("home.title", "辦公室按摩預約") : t("admin.backTitle", "管理後台");
    titleDesc.hidden = !isBook;
    if (isBook) {
      syncHomePageSubtitle();
    } else {
      titleDesc.textContent = "";
    }
    document.title = isBook ? t("meta.docTitle", "辦公室按摩預約") : t("admin.backTitle", "管理後台");
    panelBook.hidden = !isBook;
    panelAdmin.hidden = isBook;
    if (isBook) {
      stopAdminListener();
    } else {
      void syncAdminView();
    }
    syncHeadMemberButtons();
    syncAdminHeadSignedInHint();
    syncPageHeadSession();
  }

  window.addEventListener("popstate", () => setTab(tabFromPath()));

  setTab(tabFromPath());
  void (async () => {
    await refreshBookingPricing();
    await refreshWalletStatus();
  })();
}

render();
