import type { Auth } from "firebase/auth";
import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  cancelBookingCall,
  settleBookingWithSessionsAdminCall,
  completeBookingCall,
  adjustSessionCreditsAdminCall,
  grantDrawChancesAdminCall,
  listWalletTransactionsAdminCall,
  getConsumptionStatsAdminCall,
  listMembersAdminCall,
  searchMemberUsersCall,
  topupWalletCall,
  batchGetCustomerAdminBriefsAdminCall,
  getBookingDayCountsCall,
  rescheduleBookingAdminCall,
} from "./firebase";
import {
  applyAdminBriefsToBookingTable,
  collectMemberCustomerIdsFromBookings,
  createAdminBookingBriefCell,
  openAdminCustomerProfileModal,
} from "./adminCustomerProfile";
import { renderAdminForbidden as paintAdminForbiddenView, renderAdminLoggedOut as paintAdminLoginView } from "./adminLoginViews";
import { resolveCapOverflowSettingsClient } from "./capOverflow";
import { resolveBookingCapsClient } from "./bookingCaps";
import { resolveWheelPreviewSettingsClient } from "./wheelPreviewSetting";
import {
  roundSessionPriceNtdForCash,
  resolveSessionPriceNtdClient,
} from "./sitePricingResolve";
import {
  memberBookingGetsStatusEmail,
  showAdminBookingStatusEmailNoteModal,
  showAdminCancelBookingModal,
  showAdminSettleBookingSessionsModal,
} from "./adminBookingModals";
import { adminRescheduleErrorMessage, showAdminRescheduleBookingModal } from "./adminRescheduleModal";
import {
  adminBookingStatusUpdateError,
  adminSelectableBookingStatus,
  formatWhen,
  createAdminBookingPriceCell,
  bookingCountsTowardAvailabilityCap,
  bookingIsCancelledForAdmin,
  bookingIsDoneForAdmin,
  bookingCanSettleWithSessions,
  bookingMemberYesNo,
  bookingModeLabel,
  bookingModeLabelSafe,
  bookingStatusLabel,
  bookingStatusNorm,
  populateAdminBookingStatusSelect,
} from "./bookingDisplay";
import type { Booking } from "./bookingTypes";
import { el } from "./domUtil";
import { errorMessage } from "./errorUtil";
import {
  dateKeyFromYmdTaipei,
  daysInMonthFromOneIndexed,
  defaultAdminCapacityProbeDateKey,
  isDateKeyMonFri,
  isDateKeySatSun,
  taipeiLatestBookableDateKey,
  taipeiMondayOfSameWeek,
  taipeiTodayDateKey,
  taipeiWeekdayNumMon1Sun7,
  taipeiWeekdaySun0FromDateKey,
  weekdayZhFromDateKeyTaipei,
} from "./taipeiDates";
import { intlLocaleTag, localeApiParam, t } from "./i18n";
import type { Firestore } from "firebase/firestore";
import { showConfirmModal } from "./modals";

export type AdminDashboardContext = {
  adminWrap: HTMLElement;
  auth: Auth;
  db: Firestore;
  syncAdminHeadSignedInHint: (fallbackUid?: string) => void;
  /** 後台操作後同步前台錢包／次數顯示（與 `main` 內實作相同） */
  refreshWalletStatus: (opts?: { keepWalletSummaryDuringFetch?: boolean }) => Promise<void>;
};

export type AdminDashboardControls = {
  stopAdminListener: () => void;
  renderAdminLoggedOut: () => void;
  renderAdminForbidden: () => void;
  renderAdminTable: (userId: string) => void;
  /** 後台「不開放預約時段」有未儲存變更時為 true（無後台表單時為 false） */
  hasUnsavedBookingBlocks: () => boolean;
  /** 若有未儲存的不開放時段，顯示確認；回傳 true 表示可繼續離開／切換 */
  confirmLeaveUnsavedBookingBlocks: () => Promise<boolean>;
};

export function createAdminDashboard(ctx: AdminDashboardContext): AdminDashboardControls {
  const { adminWrap, auth, db, syncAdminHeadSignedInHint, refreshWalletStatus } = ctx;

  let adminUnsub: (() => void) | null = null;
  let adminPricingUnsub: (() => void) | null = null;
  let adminBookingCapsUnsub: (() => void) | null = null;
  let adminBookingBlocksUnsub: (() => void) | null = null;
  let adminWheelPreviewUnsub: (() => void) | null = null;
  let bookingBlocksBeforeUnloadHandler: ((ev: BeforeUnloadEvent) => void) | null = null;
  let bookingBlocksHasUnsavedSnapshot: () => boolean = () => false;
  let bookingBlocksConfirmLeave: () => Promise<boolean> = async () => true;

  function stopAdminListener() {
    if (bookingBlocksBeforeUnloadHandler) {
      window.removeEventListener("beforeunload", bookingBlocksBeforeUnloadHandler);
      bookingBlocksBeforeUnloadHandler = null;
    }
    bookingBlocksHasUnsavedSnapshot = () => false;
    bookingBlocksConfirmLeave = async () => true;
    if (adminUnsub) {
      adminUnsub();
      adminUnsub = null;
    }
    if (adminPricingUnsub) {
      adminPricingUnsub();
      adminPricingUnsub = null;
    }
    if (adminBookingCapsUnsub) {
      adminBookingCapsUnsub();
      adminBookingCapsUnsub = null;
    }
    if (adminBookingBlocksUnsub) {
      adminBookingBlocksUnsub();
      adminBookingBlocksUnsub = null;
    }
    if (adminWheelPreviewUnsub) {
      adminWheelPreviewUnsub();
      adminWheelPreviewUnsub = null;
    }
  }

  function renderAdminLoggedOut() {
    paintAdminLoginView({
      adminWrap,
      auth,
      stopAdminListener,
      syncAdminHeadSignedInHint,
    });
  }

  function renderAdminForbidden() {
    paintAdminForbiddenView({
      adminWrap,
      auth,
      stopAdminListener,
      syncAdminHeadSignedInHint,
    });
  }

  function renderAdminTable(userId: string) {
    stopAdminListener();
    adminWrap.innerHTML = "";
    syncAdminHeadSignedInHint(userId);
    bookingBlocksHasUnsavedSnapshot = () => false;
    bookingBlocksConfirmLeave = async () => true;

    const adminStatus = el("div", { class: "status-line" });
    let adminBookingCapsLive = {
      maxPerDay: 2,
      maxPerWorkWeek: 4,
      capOverflowEnabled: true,
    };
    let repaintAdminBookingsCapSummary: () => void = () => {};
    const walletTopupSection = el("div", { class: "admin-announce admin-announce--wallet" }, []);
    const topupCustomerId = el("input", {
      type: "text",
      placeholder: t("admin.placeholder.memberId", "會員 Email 或暱稱"),
      autocomplete: "off",
    });
    const topupSuggestions = el("ul", {
      class: "member-typeahead-list",
      hidden: true,
      role: "listbox",
    });
    function wireMemberTypeahead(input: HTMLInputElement, suggestions: HTMLUListElement) {
      let searchTimer: ReturnType<typeof setTimeout> | null = null;
      async function runSearch() {
        const q = input.value.trim();
        if (q.length < 2) {
          suggestions.hidden = true;
          suggestions.innerHTML = "";
          return;
        }
        try {
          const fn = searchMemberUsersCall();
          const res = await fn({ prefix: q, ...localeApiParam() });
          const users =
            (res.data as { users?: { uid: string; email: string; nickname?: string }[] }).users ?? [];
          suggestions.innerHTML = "";
          if (users.length === 0) {
            suggestions.hidden = true;
            return;
          }
          for (const u of users) {
            const nick = (u.nickname ?? "").trim();
            const label = nick ? `${nick} · ${u.email}` : u.email;
            const li = el("li", { class: "member-typeahead-item", role: "option" }, [label]);
            li.addEventListener("mousedown", (ev) => {
              ev.preventDefault();
              input.value = u.email;
              input.dispatchEvent(new Event("input", { bubbles: true }));
              suggestions.hidden = true;
              suggestions.innerHTML = "";
            });
            suggestions.append(li);
          }
          suggestions.hidden = false;
        } catch {
          suggestions.hidden = true;
        }
      }

      input.addEventListener("input", () => {
        const raw = input.value.trim();
        if (raw.length < 2) {
          suggestions.hidden = true;
          suggestions.innerHTML = "";
          return;
        }
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => void runSearch(), 280);
      });
      input.addEventListener("focus", () => {
        void runSearch();
      });
      input.addEventListener("blur", () => {
        setTimeout(() => {
          suggestions.hidden = true;
        }, 200);
      });
    }

    const topupTypeaheadWrap = el("div", { class: "member-typeahead-wrap" });
    topupTypeaheadWrap.append(topupCustomerId, topupSuggestions);
    wireMemberTypeahead(topupCustomerId, topupSuggestions);

    const historyCustomerId = el("input", {
      type: "text",
      placeholder: t("admin.placeholder.memberId", "會員 Email 或暱稱"),
      autocomplete: "off",
    });
    const historySuggestions = el("ul", {
      class: "member-typeahead-list",
      hidden: true,
      role: "listbox",
    });
    const historyTypeaheadWrap = el("div", { class: "member-typeahead-wrap" });
    historyTypeaheadWrap.append(historyCustomerId, historySuggestions);
    wireMemberTypeahead(historyCustomerId, historySuggestions);

    const statsCustomerId = el("input", {
      type: "text",
      placeholder: t("admin.placeholder.memberId", "會員 Email 或暱稱"),
      autocomplete: "off",
    });
    const statsSuggestions = el("ul", {
      class: "member-typeahead-list",
      hidden: true,
      role: "listbox",
    });
    const statsTypeaheadWrap = el("div", { class: "member-typeahead-wrap" });
    statsTypeaheadWrap.append(statsCustomerId, statsSuggestions);
    wireMemberTypeahead(statsCustomerId, statsSuggestions);

    function syncAllMemberIdInputs(changed: HTMLInputElement) {
      for (const input of [topupCustomerId, historyCustomerId, statsCustomerId]) {
        if (input !== changed && input.value !== changed.value) input.value = changed.value;
      }
    }
    for (const input of [topupCustomerId, historyCustomerId, statsCustomerId]) {
      input.addEventListener("input", () => syncAllMemberIdInputs(input));
    }
    const topupAmount = el("input", { type: "number", value: "100", min: "1", step: "1" });
    const topupSessions = el("input", { type: "number", value: "1", min: "1", step: "1" });
    const topupNote = el("input", {
      type: "text",
      placeholder: t("admin.topup.notePlaceholder", "備註（選填）"),
    });
    const topupBtn = el("button", { class: "primary", type: "button" }, [t("admin.topup.btn", "儲值")]);
    const topupStatus = el("div", { class: "status-line" });
    const adjustSessionDelta = el("input", { type: "number", value: "-1", min: "-50", max: "50", step: "1" });
    const adjustSessionNote = el("input", {
      type: "text",
      maxLength: 500,
      placeholder: t("admin.adjustSessions.notePlaceholder", "例：現場 walk-in 2 次，無預約紀錄"),
    });
    const adjustSessionBtn = el("button", { class: "primary", type: "button" }, [
      t("admin.adjustSessions.btn", "調整可預約次數"),
    ]);
    const adjustSessionStatus = el("div", { class: "status-line" });
    const grantDrawDelta = el("input", { type: "number", value: "1", min: "1", max: "50", step: "1" });
    const grantDrawNote = el("input", {
      type: "text",
      maxLength: 200,
      placeholder: t("admin.grantDraw.notePlaceholder", "備註（選填，最多 200 字）"),
    });
    const grantDrawBtn = el("button", { class: "primary", type: "button" }, [t("admin.grantDraw.btn", "贈送抽獎次數")]);
    const grantDrawStatus = el("div", { class: "status-line" });
    const pricingDocRef = doc(db, "siteSettings", "pricing");
    const pricingPriceInput = el("input", { type: "number", min: "1", step: "1", value: "110" });
    const wheelPointsPerInput = el("input", { type: "number", min: "2", step: "1", value: "10" });
    const pricingCurrentPriceLine = el("p", { class: "hint admin-pricing-current-price" });
    const savePricingBtn = el("button", { type: "button", class: "primary" }, [t("admin.pricing.save", "儲存定價")]);
    const pricingAdminStatus = el("div", { class: "status-line" });
    const saveWheelRedeemBtn = el("button", { type: "button", class: "primary" }, [
      t("admin.wheelRedeem.save", "儲存兌換門檻"),
    ]);
    const wheelRedeemAdminStatus = el("div", { class: "status-line" });
    function paintPricingAdminView(d: Record<string, unknown> | undefined) {
      const displayPrice = resolveSessionPriceNtdClient(d);
      pricingCurrentPriceLine.textContent = t("admin.pricing.currentPriceFixed", "前台目前顯示：{{price}} 元", {
        price: displayPrice,
      });
    }
    adminPricingUnsub = onSnapshot(
      pricingDocRef,
      (snap) => {
        const d = snap.data() as { pointsPerMassage?: unknown; sessionPriceNtd?: unknown; tsmcPricingBaseNtd?: unknown } | undefined;
        const priceRaw = d?.sessionPriceNtd ?? d?.tsmcPricingBaseNtd;
        if (typeof priceRaw === "number" && Number.isFinite(priceRaw)) {
          pricingPriceInput.value = String(Math.max(1, Math.round(priceRaw)));
        }
        const pp = d?.pointsPerMassage;
        if (typeof pp === "number" && Number.isFinite(pp)) {
          wheelPointsPerInput.value = String(Math.max(2, Math.round(pp)));
        }
        paintPricingAdminView(d as Record<string, unknown> | undefined);
      },
      () => {
        pricingAdminStatus.textContent = t("admin.pricing.loadFail", "無法讀取定價設定。");
        pricingAdminStatus.className = "status-line error";
      },
    );
    pricingPriceInput.addEventListener("input", () => {
      const base = Number(pricingPriceInput.value);
      const rounded =
        Number.isFinite(base) && base >= 1 ? roundSessionPriceNtdForCash(Math.round(base)) : 110;
      paintPricingAdminView({ sessionPriceNtd: rounded });
    });

    savePricingBtn.addEventListener("click", async () => {
      pricingAdminStatus.textContent = "";
      pricingAdminStatus.className = "status-line";
      const priceRaw = Number(pricingPriceInput.value);
      if (!Number.isFinite(priceRaw) || priceRaw < 1 || !Number.isInteger(priceRaw)) {
        pricingAdminStatus.textContent = t("admin.pricing.badSessionPrice", "每次金額需為 ≥1 的整數。");
        pricingAdminStatus.classList.add("error");
        return;
      }
      const roundedPrice = roundSessionPriceNtdForCash(Math.round(priceRaw));
      savePricingBtn.setAttribute("disabled", "true");
      try {
        await setDoc(
          pricingDocRef,
          {
            unitMinutes: deleteField(),
            maxUnitsPerBooking: deleteField(),
            sessionPriceNtd: roundedPrice,
            tsmcPricingEnabled: false,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        pricingAdminStatus.textContent = t("admin.pricing.savedWithPrice", "已更新；前台金額 {{price}} 元。", {
          price: roundedPrice,
        });
        pricingAdminStatus.classList.add("ok");
      } catch (e) {
        pricingAdminStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
        pricingAdminStatus.classList.add("error");
      } finally {
        savePricingBtn.removeAttribute("disabled");
      }
    });

    saveWheelRedeemBtn.addEventListener("click", async () => {
      wheelRedeemAdminStatus.textContent = "";
      wheelRedeemAdminStatus.className = "status-line";
      const pp = Number(wheelPointsPerInput.value);
      if (!Number.isFinite(pp) || pp < 2 || !Number.isInteger(pp)) {
        wheelRedeemAdminStatus.textContent = t("admin.pricing.badPointsPer", "兌換門檻需為 ≥2 的整數（點）。");
        wheelRedeemAdminStatus.classList.add("error");
        return;
      }
      saveWheelRedeemBtn.setAttribute("disabled", "true");
      try {
        await setDoc(
          pricingDocRef,
          {
            pointsPerMassage: Math.round(pp),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        wheelRedeemAdminStatus.textContent = t("admin.status.updated", "已更新");
        wheelRedeemAdminStatus.classList.add("ok");
      } catch (e) {
        wheelRedeemAdminStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
        wheelRedeemAdminStatus.classList.add("error");
      } finally {
        saveWheelRedeemBtn.removeAttribute("disabled");
      }
    });

    const announcePricingFlat = el("section", { class: "admin-announce__block admin-announce__block--pricing" }, [
      el("h4", { class: "admin-announce__block-title" }, [t("admin.pricing.heading", "預約定價")]),
      el("label", { class: "field" }, [t("admin.pricing.sessionPrice", "每次金額（元）"), pricingPriceInput]),
      el("p", { class: "hint admin-pricing-base-hint" }, [
        t("admin.pricing.baseHint", "前台副標與現場收現金額；須為整數。"),
      ]),
      pricingCurrentPriceLine,
      el("div", { class: "row-actions admin-pricing-actions" }, [savePricingBtn]),
      pricingAdminStatus,
    ]);

    const announceWheelRedeemBlock = el("section", { class: "admin-announce__block admin-announce__block--wheel-redeem" }, [
      el("h4", { class: "admin-announce__block-title" }, [t("admin.wheelRedeem.heading", "輪盤點數兌換")]),
      el("p", { class: "hint admin-announce__block-lead" }, [
        t("admin.wheelRedeem.lead", "會員累積輪盤點數達門檻時，可兌換 1 次預約。"),
      ]),
      el("label", { class: "field" }, [t("admin.wheelRedeem.pointsPer", "幾點換 1 次"), wheelPointsPerInput]),
      el("div", { class: "row-actions" }, [saveWheelRedeemBtn]),
      wheelRedeemAdminStatus,
    ]);

    const wheelPreviewDocRef = doc(db, "siteSettings", "wheel");
    const wheelPreviewEnabledInput = el("input", { type: "checkbox" });
    const saveWheelPreviewBtn = el("button", { type: "button", class: "primary" }, [
      t("admin.wheelPreview.save", "儲存拉霸預覽設定"),
    ]);
    const wheelPreviewAdminStatus = el("div", { class: "status-line" });

    adminWheelPreviewUnsub = onSnapshot(
      wheelPreviewDocRef,
      (snap) => {
        const settings = resolveWheelPreviewSettingsClient(snap.data());
        wheelPreviewEnabledInput.checked = settings.previewEnabledForMembers;
      },
      () => {
        wheelPreviewAdminStatus.textContent = t("admin.snapshot.loadFail", "無法讀取拉霸預覽設定。");
        wheelPreviewAdminStatus.className = "status-line error";
      },
    );

    saveWheelPreviewBtn.addEventListener("click", async () => {
      wheelPreviewAdminStatus.textContent = "";
      wheelPreviewAdminStatus.className = "status-line";
      saveWheelPreviewBtn.setAttribute("disabled", "true");
      wheelPreviewAdminStatus.textContent = t("admin.status.processing", "處理中…");
      try {
        await setDoc(
          wheelPreviewDocRef,
          {
            previewEnabledForMembers: wheelPreviewEnabledInput.checked,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        wheelPreviewAdminStatus.textContent = t("admin.status.updated", "已更新");
        wheelPreviewAdminStatus.classList.add("ok");
      } catch (e) {
        wheelPreviewAdminStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
        wheelPreviewAdminStatus.classList.add("error");
      } finally {
        saveWheelPreviewBtn.removeAttribute("disabled");
      }
    });

    const announceWheelPreviewBlock = el("section", { class: "admin-announce__block admin-announce__block--wheel-preview" }, [
      el("h4", { class: "admin-announce__block-title" }, [t("admin.wheelPreview.heading", "拉霸特效預覽")]),
      el("p", { class: "hint admin-announce__block-lead" }, [
        t(
          "admin.wheelPreview.lead",
          "管理員在會員中心永遠可見「預覽拉霸特效」（不扣次數）。勾選下方後，一般會員登入後也可使用。",
        ),
      ]),
      el("label", { class: "field checkbox-field" }, [
        wheelPreviewEnabledInput,
        t("admin.wheelPreview.enableForMembers", "開放一般會員使用「預覽拉霸特效」"),
      ]),
      el("div", { class: "row-actions" }, [saveWheelPreviewBtn]),
      wheelPreviewAdminStatus,
    ]);

    topupBtn.addEventListener("click", async () => {
      topupStatus.textContent = "";
      topupStatus.className = "status-line";
      const customerId = topupCustomerId.value.trim();
      const amount = Number(topupAmount.value);
      const sessions = Number(topupSessions.value);
      const note = topupNote.value.trim();
      if (!customerId) {
        topupStatus.textContent = t("admin.topup.needId", "請輸入會員 Email 或暱稱。");
        topupStatus.classList.add("error");
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
        topupStatus.textContent = t("admin.topup.amountInt", "儲值金額需為正整數。");
        topupStatus.classList.add("error");
        return;
      }
      if (!Number.isFinite(sessions) || sessions <= 0 || !Number.isInteger(sessions)) {
        topupStatus.textContent = t("admin.topup.sessionsInt", "儲值次數需為正整數。");
        topupStatus.classList.add("error");
        return;
      }
      topupBtn.setAttribute("disabled", "true");
      topupStatus.textContent = t("admin.topup.processing", "儲值中…");
      try {
        const fn = topupWalletCall();
        await fn({ customerId, amount, sessions, note, ...localeApiParam() });
        topupStatus.textContent = t("admin.topup.ok", "儲值成功");
        topupStatus.classList.add("ok");
      } catch (e) {
        topupStatus.textContent = errorMessage(e);
        topupStatus.classList.add("error");
      } finally {
        topupBtn.removeAttribute("disabled");
      }
    });
    adjustSessionBtn.addEventListener("click", async () => {
      adjustSessionStatus.textContent = "";
      adjustSessionStatus.className = "status-line";
      const customerId = topupCustomerId.value.trim();
      const sessionsDelta = Number(adjustSessionDelta.value);
      const note = adjustSessionNote.value.trim();
      if (!customerId) {
        adjustSessionStatus.textContent = t("admin.topup.needId", "請輸入會員 Email 或暱稱。");
        adjustSessionStatus.classList.add("error");
        return;
      }
      if (
        !Number.isFinite(sessionsDelta) ||
        sessionsDelta === 0 ||
        !Number.isInteger(sessionsDelta) ||
        Math.abs(sessionsDelta) > 50
      ) {
        adjustSessionStatus.textContent = t(
          "admin.adjustSessions.badDelta",
          "調整量須為非零整數，且絕對值不可超過 50。",
        );
        adjustSessionStatus.classList.add("error");
        return;
      }
      if (note.length < 3) {
        adjustSessionStatus.textContent = t("admin.adjustSessions.noteShort", "備註至少 3 字，請簡述原因。");
        adjustSessionStatus.classList.add("error");
        return;
      }
      adjustSessionBtn.setAttribute("disabled", "true");
      adjustSessionStatus.textContent = t("admin.adjustSessions.processing", "處理中…");
      try {
        const fn = adjustSessionCreditsAdminCall();
        const res = await fn({ customerId, sessionsDelta, note, ...localeApiParam() });
        const data = res.data as { sessionCredits?: number };
        adjustSessionStatus.textContent = t("admin.adjustSessions.ok", "已更新，該會員目前可預約次數為 {{sessions}} 次。", {
          sessions: typeof data.sessionCredits === "number" ? data.sessionCredits : "—",
        });
        adjustSessionStatus.classList.add("ok");
      } catch (e) {
        adjustSessionStatus.textContent = errorMessage(e);
        adjustSessionStatus.classList.add("error");
      } finally {
        adjustSessionBtn.removeAttribute("disabled");
      }
    });
    grantDrawBtn.addEventListener("click", async () => {
      grantDrawStatus.textContent = "";
      grantDrawStatus.className = "status-line";
      const customerId = topupCustomerId.value.trim();
      const delta = Number(grantDrawDelta.value);
      const note = grantDrawNote.value.trim();
      if (!customerId) {
        grantDrawStatus.textContent = t("admin.topup.needId", "請輸入會員 Email 或暱稱。");
        grantDrawStatus.classList.add("error");
        return;
      }
      if (!Number.isFinite(delta) || delta <= 0 || !Number.isInteger(delta) || delta > 50) {
        grantDrawStatus.textContent = t("admin.grantDraw.badDelta", "贈送次數需為 1～50 的整數。");
        grantDrawStatus.classList.add("error");
        return;
      }
      grantDrawBtn.setAttribute("disabled", "true");
      grantDrawStatus.textContent = t("admin.grantDraw.processing", "處理中…");
      try {
        const fn = grantDrawChancesAdminCall();
        const res = await fn({ customerId, delta, note, ...localeApiParam() });
        const data = res.data as { drawChancesAdded?: number; drawChancesTotal?: number };
        grantDrawStatus.textContent = t("admin.grantDraw.ok", "已贈送 {{added}} 次，該會員目前可抽 {{total}} 次。", {
          added: typeof data.drawChancesAdded === "number" ? data.drawChancesAdded : delta,
          total: typeof data.drawChancesTotal === "number" ? data.drawChancesTotal : "—",
        });
        grantDrawStatus.classList.add("ok");
      } catch (e) {
        grantDrawStatus.textContent = errorMessage(e);
        grantDrawStatus.classList.add("error");
      } finally {
        grantDrawBtn.removeAttribute("disabled");
      }
    });
    const announcementSection = el("div", { class: "admin-announce admin-announce--settings" }, []);

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
    const capOverflowEnabledInput = el("input", { type: "checkbox" });
    capOverflowEnabledInput.checked = true;
    const capOverflowSurchargeInput = el("input", {
      type: "number",
      min: "0",
      max: "50000",
      step: "1",
      value: "100",
    });
    const saveBookingCapsBtn = el("button", { type: "button", class: "primary" }, [t("admin.caps.save", "儲存名額上限")]);
    const bookingCapsStatus = el("div", { class: "status-line" });

    function clampBookingCapInput(n: number, fallback: number): number {
      const r = Math.round(n);
      if (!Number.isFinite(r) || !Number.isInteger(r)) return fallback;
      return Math.min(50, Math.max(1, r));
    }

    adminBookingCapsUnsub = onSnapshot(
      bookingCapsDocRef,
      (snap) => {
        const data = snap.data() as {
          maxPerDay?: unknown;
          maxPerWorkWeek?: unknown;
          capOverflowEnabled?: unknown;
          capOverflowSurchargeNtd?: unknown;
        } | undefined;
        const dRaw = data?.maxPerDay;
        const wRaw = data?.maxPerWorkWeek;
        const dNum = typeof dRaw === "number" && Number.isFinite(dRaw) ? dRaw : Number(dRaw);
        const wNum = typeof wRaw === "number" && Number.isFinite(wRaw) ? wRaw : Number(wRaw);
        capMaxPerDayInput.value = String(clampBookingCapInput(dNum, 2));
        capMaxPerWorkWeekInput.value = String(clampBookingCapInput(wNum, 4));
        const overflow = resolveCapOverflowSettingsClient(data);
        capOverflowEnabledInput.checked = overflow.enabled;
        capOverflowSurchargeInput.value = String(overflow.surchargeNtd);
        adminBookingCapsLive = {
          ...resolveBookingCapsClient(data),
          capOverflowEnabled: overflow.enabled,
        };
        repaintAdminBookingsCapSummary();
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
      const capOverflowEnabled = capOverflowEnabledInput.checked;
      const surchargeRaw = Number(capOverflowSurchargeInput.value);
      const capOverflowSurchargeNtd =
        Number.isFinite(surchargeRaw) && surchargeRaw >= 0 ?
          Math.min(50_000, Math.round(surchargeRaw))
        : 100;
      capOverflowSurchargeInput.value = String(capOverflowSurchargeNtd);
      saveBookingCapsBtn.setAttribute("disabled", "true");
      bookingCapsStatus.textContent = t("admin.status.processing", "處理中…");
      try {
        await setDoc(
          bookingCapsDocRef,
          {
            maxPerDay,
            maxPerWorkWeek,
            capOverflowEnabled,
            capOverflowSurchargeNtd,
            updatedAt: serverTimestamp(),
          },
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
    const addBookingBlockRowBtn = el("button", { type: "button", class: "ghost admin-btn--add" }, [
      t("admin.blocks.addRow", "新增一筆"),
    ]);
    const saveBookingBlocksBtn = el("button", { type: "button", class: "primary" }, [
      t("admin.blocks.save", "儲存不開放時段"),
    ]);
    const bookingBlocksStatus = el("div", { class: "status-line" });

    type BookingBlockRowModel = {
      weekday: number;
      start: string;
      end: string;
      reason: string;
      /** 空字串 = 每週該星期重複；有值 = 僅該曆日 */
      dateKey: string;
    };

    type BookingBlockPersistRow = {
      weekday: number;
      start: string;
      end: string;
      reason: string;
      dateKey?: string;
    };

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
        const ns = normalizeTimeForBookingBlock(start);
        const ne = normalizeTimeForBookingBlock(end);
        if (!ns || !ne) continue;
        const m0 = Number(ns.slice(0, 2)) * 60 + Number(ns.slice(3, 5));
        const m1 = Number(ne.slice(0, 2)) * 60 + Number(ne.slice(3, 5));
        if (m0 >= m1) continue;
        const dkRaw = o.dateKey;
        if (typeof dkRaw === "string" && dkRaw.trim() !== "") {
          const dk = dkRaw.trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) {
            const wn = taipeiWeekdayNumMon1Sun7(dk);
            if (Number.isFinite(wn) && wn >= 1 && wn <= 5) {
              out.push({ weekday: wn, start: ns, end: ne, reason: reason.slice(0, 200), dateKey: dk });
              continue;
            }
          }
        }
        if (!Number.isInteger(wd) || wd < 1 || wd > 5) continue;
        out.push({ weekday: wd, start: ns, end: ne, reason: reason.slice(0, 200), dateKey: "" });
      }
      return out;
    }

    function normalizeBookingBlocksWindowsForSign(windows: BookingBlockPersistRow[]): string {
      const sorted = [...windows].sort((a, b) => {
        const dkA = a.dateKey ?? "";
        const dkB = b.dateKey ?? "";
        return (
          a.weekday - b.weekday ||
          dkA.localeCompare(dkB) ||
          a.start.localeCompare(b.start) ||
          a.end.localeCompare(b.end) ||
          a.reason.localeCompare(b.reason)
        );
      });
      return JSON.stringify(sorted);
    }

    function signatureFromBookingBlockModels(models: BookingBlockRowModel[]): string {
      const windows: BookingBlockPersistRow[] = [];
      for (const m of models) {
        const dk = m.dateKey.trim();
        if (dk !== "") {
          windows.push({ weekday: m.weekday, start: m.start, end: m.end, reason: m.reason, dateKey: dk });
        } else {
          windows.push({ weekday: m.weekday, start: m.start, end: m.end, reason: m.reason });
        }
      }
      return normalizeBookingBlocksWindowsForSign(windows);
    }

    function appendBookingBlockRowToWindows(row: Element, windows: BookingBlockPersistRow[]): string | null {
      const wd = Number((row.querySelector(".bb-weekday") as HTMLSelectElement)?.value);
      const st = (row.querySelector(".bb-start") as HTMLInputElement)?.value ?? "";
      const en = (row.querySelector(".bb-end") as HTMLInputElement)?.value ?? "";
      const re = (row.querySelector(".bb-reason") as HTMLInputElement)?.value ?? "";
      const dateRaw = ((row.querySelector(".bb-date") as HTMLInputElement)?.value ?? "").trim();
      if (!Number.isInteger(wd) || wd < 1 || wd > 5) {
        return t("admin.blocks.invalidWeekday", "每一列的星期需為週一到週五。");
      }
      const ns = normalizeTimeForBookingBlock(st);
      const ne = normalizeTimeForBookingBlock(en);
      if (!ns || !ne) {
        return t("admin.blocks.invalidTime", "請確認每一列的時間格式正確。");
      }
      const m0 = Number(ns.slice(0, 2)) * 60 + Number(ns.slice(3, 5));
      const m1 = Number(ne.slice(0, 2)) * 60 + Number(ne.slice(3, 5));
      if (m0 >= m1) {
        return t(
          "admin.blocks.invalidRange",
          "每一列的「迄」需晚於「起」。區間為左閉右開：迄那一刻起已不再封鎖。",
        );
      }
      const reasonTrim = re.trim().slice(0, 200);
      if (dateRaw !== "") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
          return t(
            "admin.blocks.invalidSpecificDate",
            "「特定日期」須為 YYYY-MM-DD 之週一至週五，且與「星期」欄一致。",
          );
        }
        const wn = taipeiWeekdayNumMon1Sun7(dateRaw);
        if (!Number.isFinite(wn) || wn < 1 || wn > 5 || wn !== wd) {
          return t(
            "admin.blocks.invalidSpecificDate",
            "「特定日期」須為 YYYY-MM-DD 之週一至週五，且與「星期」欄一致。",
          );
        }
        windows.push({ weekday: wd, start: ns, end: ne, reason: reasonTrim, dateKey: dateRaw });
      } else {
        windows.push({ weekday: wd, start: ns, end: ne, reason: reasonTrim });
      }
      return null;
    }

    function collectBookingBlockWindowsWithErrors():
      | { ok: true; windows: BookingBlockPersistRow[] }
      | { ok: false; error: string } {
      const rowEls = bookingBlocksRows.querySelectorAll(".admin-booking-block-row");
      if (rowEls.length > 40) {
        return { ok: false, error: t("admin.blocks.tooMany", "最多 40 筆規則，請刪減後再儲存。") };
      }
      const windows: BookingBlockPersistRow[] = [];
      for (const row of rowEls) {
        const err = appendBookingBlockRowToWindows(row, windows);
        if (err !== null) return { ok: false, error: err };
      }
      return { ok: true, windows };
    }

    let bookingBlocksSavedSig = normalizeBookingBlocksWindowsForSign([]);

    const bookingBlocksDirtyBanner = el(
      "div",
      {
        class: "admin-booking-blocks-dirty-banner",
        hidden: true,
        role: "status",
      },
      [
        t(
          "admin.blocks.unsavedBanner",
          "有未儲存的變更，請按「儲存不開放時段」寫入資料庫。",
        ),
      ],
    );

    function isBookingBlocksDirty(): boolean {
      const collected = collectBookingBlockWindowsWithErrors();
      if (!collected.ok) return true;
      return normalizeBookingBlocksWindowsForSign(collected.windows) !== bookingBlocksSavedSig;
    }

    function syncBookingBlocksDirtyUi(): void {
      const dirty = isBookingBlocksDirty();
      bookingBlocksDirtyBanner.hidden = !dirty;
      bookingBlocksDirtyBanner.classList.toggle("admin-booking-blocks-dirty-banner--on", dirty);
      saveBookingBlocksBtn.classList.toggle("admin-booking-blocks-save--attention", dirty);
    }

    function renderBookingBlockRow(model: BookingBlockRowModel): HTMLElement {
      const row = el("div", { class: "admin-booking-block-row" });
      const weekdaySel = el("select", { class: "bb-weekday", ariaLabel: t("admin.blocks.weekday", "星期") });
      const dayLabels = t("admin.dayLabels", "一,二,三,四,五").split(",");
      for (let d = 1; d <= 5; d++) {
        weekdaySel.append(el("option", { value: String(d) }, [dayLabels[d - 1] ?? String(d)]));
      }
      weekdaySel.value = String(model.weekday);
      const dateIn = el("input", {
        type: "date",
        class: "bb-date",
        ariaLabel: t("admin.blocks.specificDate", "特定日期（選填）"),
      });
      dateIn.value = model.dateKey;
      const syncWeekdayFromDate = () => {
        const dk = dateIn.value.trim();
        if (!dk) return;
        const wn = taipeiWeekdayNumMon1Sun7(dk);
        if (Number.isFinite(wn) && wn >= 1 && wn <= 5) {
          weekdaySel.value = String(wn);
        }
      };
      dateIn.addEventListener("change", syncWeekdayFromDate);
      weekdaySel.addEventListener("change", () => {
        const dk = dateIn.value.trim();
        if (!dk) return;
        const wn = taipeiWeekdayNumMon1Sun7(dk);
        const wd = Number(weekdaySel.value);
        if (!Number.isFinite(wn) || wn !== wd) {
          dateIn.value = "";
        }
      });
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
      reasonIn.setAttribute("aria-label", t("admin.blocks.reason", "前台顯示原因"));
      const removeBtn = el(
        "button",
        { type: "button", class: "ghost admin-btn--danger admin-booking-block-row__remove" },
        [t("admin.blocks.rowRemove", "刪除此列")],
      );
      removeBtn.addEventListener("click", () => {
        row.remove();
        syncBookingBlocksDirtyUi();
      });
      const whenFields = el("div", { class: "bb-group-fields bb-group-fields--when" }, [
        el("label", { class: "field bb-field-wd" }, [t("admin.blocks.weekday", "星期"), weekdaySel]),
        el("label", { class: "field bb-field-date" }, [t("admin.blocks.specificDate", "特定日期（選填）"), dateIn]),
        el("div", { class: "admin-booking-block-row__remove-wrap" }, [removeBtn]),
      ]);
      const timeFields = el("div", { class: "bb-group-fields bb-group-fields--time" }, [
        el("label", { class: "field bb-field-t" }, [t("admin.blocks.start", "起（含）"), startIn]),
        el("span", { class: "bb-time-sep", ariaHidden: "true" }, ["～"]),
        el("label", { class: "field bb-field-t" }, [t("admin.blocks.end", "迄（不含）"), endIn]),
      ]);
      const rowBody = el("div", { class: "admin-booking-block-row__body" }, [
        el("div", { class: "bb-group bb-group--when" }, [
          el("span", { class: "bb-group-title" }, [t("admin.blocks.groupWhen", "套用日期")]),
          whenFields,
        ]),
        el("div", { class: "bb-group bb-group--slot" }, [
          el("span", { class: "bb-group-title" }, [t("admin.blocks.groupSlot", "不開放區間（當日）")]),
          timeFields,
        ]),
      ]);
      row.append(
        rowBody,
        el("div", { class: "bb-group bb-group--reason" }, [
          el("span", { class: "bb-group-title" }, [t("admin.blocks.reason", "前台顯示原因")]),
          reasonIn,
        ]),
      );
      return row;
    }

    function refillBookingBlockRows(models: BookingBlockRowModel[]) {
      bookingBlocksRows.innerHTML = "";
      for (const m of models) {
        bookingBlocksRows.append(renderBookingBlockRow(m));
      }
      bookingBlocksSavedSig = signatureFromBookingBlockModels(models);
      syncBookingBlocksDirtyUi();
    }

    addBookingBlockRowBtn.addEventListener("click", () => {
      bookingBlocksRows.append(
        renderBookingBlockRow({ weekday: 1, start: "15:30", end: "16:30", reason: "", dateKey: "" }),
      );
      syncBookingBlocksDirtyUi();
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
      const collected = collectBookingBlockWindowsWithErrors();
      if (!collected.ok) {
        bookingBlocksStatus.textContent = collected.error;
        bookingBlocksStatus.classList.add("error");
        syncBookingBlocksDirtyUi();
        return;
      }
      const { windows } = collected;
      saveBookingBlocksBtn.setAttribute("disabled", "true");
      bookingBlocksStatus.textContent = t("admin.status.processing", "處理中…");
      try {
        await setDoc(
          bookingBlocksDocRef,
          { windows, updatedAt: serverTimestamp() },
          { merge: true },
        );
        bookingBlocksSavedSig = normalizeBookingBlocksWindowsForSign(windows);
        syncBookingBlocksDirtyUi();
        bookingBlocksStatus.textContent = t("admin.status.updated", "已更新");
        bookingBlocksStatus.classList.add("ok");
      } catch (e) {
        bookingBlocksStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
        bookingBlocksStatus.classList.add("error");
      } finally {
        saveBookingBlocksBtn.removeAttribute("disabled");
      }
    });

    bookingBlocksRows.addEventListener("input", () => {
      syncBookingBlocksDirtyUi();
    });
    bookingBlocksRows.addEventListener("change", () => {
      syncBookingBlocksDirtyUi();
    });

    bookingBlocksBeforeUnloadHandler = (ev: BeforeUnloadEvent) => {
      if (!isBookingBlocksDirty()) return;
      ev.preventDefault();
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", bookingBlocksBeforeUnloadHandler);

    const blockCaps = el("section", { class: "admin-announce__block admin-announce__block--caps" }, [
      el("h4", { class: "admin-announce__block-title" }, [t("admin.announce.blockCapsTitle", "預約名額")]),
      el("p", { class: "hint admin-announce__block-lead" }, [
        t(
          "admin.caps.lead",
          "「張」＝一張預約單（每次 15 分鐘）；與名額張數無關。已取消不計入。",
        ),
      ]),
      el("div", { class: "grid grid-2" }, [
        el("label", { class: "field" }, [t("admin.caps.perDay", "同一天最多幾張"), capMaxPerDayInput]),
        el("label", { class: "field" }, [t("admin.caps.perWeek", "同一工作週最多幾張"), capMaxPerWorkWeekInput]),
      ]),
      el("div", { class: "grid grid-2 admin-caps-overflow-grid" }, [
        el("label", { class: "field checkbox-field" }, [
          capOverflowEnabledInput,
          t("admin.caps.overflowEnable", "名額已滿時允許「加價現金」預約"),
        ]),
        el("label", { class: "field" }, [
          t("admin.caps.overflowSurcharge", "加價金額（元／張預約，不含按摩費）"),
          capOverflowSurchargeInput,
        ]),
      ]),
      el("p", { class: "hint" }, [
        t(
          "admin.caps.overflowHint",
          "當日或本工作週「張數」已滿時，會員可再以加價現金多預約一張（加價每張收一次；按摩費仍依單位數計）。須仍有可選時段且不重疊。",
        ),
      ]),
      el("div", { class: "row-actions" }, [saveBookingCapsBtn]),
      bookingCapsStatus,
    ]);

    const blockClosedWindows = el("section", { class: "admin-announce__block admin-announce__block--blocks" }, [
      el("h4", { class: "admin-announce__block-title" }, [t("admin.announce.blockBlocksTitle", "不開放預約時段")]),
      el("div", { class: "admin-blocks-intro" }, [
        el("p", { class: "hint admin-announce__block-lead" }, [
          t("admin.announce.blockBlocksLead", "依星期或特定日期關閉預約時段；與「預約名額」分開設定。"),
        ]),
        el("p", { class: "hint admin-blocks-intro-note" }, [
          t(
            "admin.announce.blockBlocksNote",
            "未填「特定日期」表示每週該日重複生效。區間為起（含）、迄（不含）。",
          ),
        ]),
      ]),
      bookingBlocksDirtyBanner,
      bookingBlocksRows,
      el("div", { class: "row-actions admin-booking-blocks-actions" }, [addBookingBlockRowBtn, saveBookingBlocksBtn]),
      bookingBlocksStatus,
    ]);

    const bookingBlocksPanelInner = el("div", { class: "admin-announce admin-announce--settings" }, [blockClosedWindows]);

    announcementSection.append(
      el("h3", { class: "admin-announce__page-title" }, [t("admin.announce.heading", "前台與預約規則")]),
      blockCaps,
      announcePricingFlat,
      announceWheelPreviewBlock,
      announceWheelRedeemBlock,
    );

    function wireWalletAccordionsExclusive(roots: HTMLElement[]) {
      for (const acc of roots) {
        const btn = acc.querySelector<HTMLButtonElement>(".admin-wallet-accordion__trigger");
        const panel = acc.querySelector<HTMLElement>(".admin-wallet-accordion__panel");
        if (!btn || !panel) continue;
        btn.addEventListener("click", () => {
          const wasOpen = !panel.hidden;
          for (const a of roots) {
            const p = a.querySelector<HTMLElement>(".admin-wallet-accordion__panel");
            const b = a.querySelector<HTMLButtonElement>(".admin-wallet-accordion__trigger");
            if (p && b) {
              p.hidden = true;
              b.setAttribute("aria-expanded", "false");
              a.classList.remove("admin-wallet-accordion--open");
            }
          }
          if (!wasOpen) {
            panel.hidden = false;
            btn.setAttribute("aria-expanded", "true");
            acc.classList.add("admin-wallet-accordion--open");
          }
        });
      }
    }

    function walletAccordion(
      variant: "topup" | "adjust" | "grant",
      summary: string,
      panelChildren: HTMLElement[],
      defaultOpen: boolean,
    ): HTMLElement {
      const panelId = `admin-wallet-acc-${variant}`;
      const titleEl = el("span", { class: "admin-wallet-accordion__title" }, [summary]);
      const chev = el("span", { class: "admin-wallet-accordion__chev", ariaHidden: "true" }, ["▾"]);
      const trigger = el("button", { type: "button", class: `admin-wallet-accordion__trigger admin-wallet-accordion__trigger--${variant}` }, [
        titleEl,
        chev,
      ]);
      trigger.setAttribute("aria-expanded", defaultOpen ? "true" : "false");
      trigger.setAttribute("aria-controls", panelId);
      const panel = el("div", {
        class: `admin-wallet-accordion__panel admin-wallet-accordion__panel--${variant}`,
        id: panelId,
        hidden: !defaultOpen,
      });
      for (const c of panelChildren) panel.append(c);
      const root = el("div", { class: `admin-wallet-accordion admin-wallet-accordion--${variant}` }, [trigger, panel]);
      if (defaultOpen) root.classList.add("admin-wallet-accordion--open");
      return root;
    }

    const accordionTopup = walletAccordion(
      "topup",
      t("admin.wallet.accordionTopup", "儲值（次數與金額）"),
      [
        el("label", { class: "field" }, [t("admin.wallet.sessions", "儲值次數（必填）"), topupSessions]),
        el("label", { class: "field" }, [t("admin.wallet.amount", "儲值金額（必填）"), topupAmount]),
        el("label", { class: "field" }, [t("admin.wallet.note", "備註（選填）"), topupNote]),
        el("div", { class: "row-actions" }, [topupBtn]),
        topupStatus,
      ],
      false,
    );
    const accordionAdjust = walletAccordion(
      "adjust",
      t("admin.adjustSessions.heading", "調整可預約次數（增／減）"),
      [
        el("label", { class: "field" }, [t("admin.adjustSessions.deltaLabel", "可預約次數增減（−50～+50，扣點填負數）"), adjustSessionDelta]),
        el("label", { class: "field" }, [t("admin.adjustSessions.noteLabel", "備註（必填，3～500 字）"), adjustSessionNote]),
        el("div", { class: "row-actions" }, [adjustSessionBtn]),
        adjustSessionStatus,
      ],
      false,
    );
    const accordionGrant = walletAccordion(
      "grant",
      t("admin.grantDraw.heading", "贈送輪盤抽獎次數"),
      [
        el("label", { class: "field" }, [t("admin.grantDraw.deltaLabel", "贈送次數（1～50）"), grantDrawDelta]),
        el("label", { class: "field" }, [t("admin.grantDraw.noteLabel", "備註（選填）"), grantDrawNote]),
        el("div", { class: "row-actions" }, [grantDrawBtn]),
        grantDrawStatus,
      ],
      false,
    );
    wireWalletAccordionsExclusive([accordionTopup, accordionAdjust, accordionGrant]);

    const walletMemberBar = el("section", { class: "admin-announce__wallet-segment admin-announce__wallet-segment--member" }, [
      el("label", { class: "field" }, [t("admin.wallet.memberLabel", "會員（Email 或暱稱）"), topupTypeaheadWrap]),
      el("p", { class: "hint admin-wallet-member-bar__hint" }, [
        t(
          "admin.wallet.memberHint",
          "以下儲值與調整皆套用此會員；輸入至少 2 字元可搜尋 Email 或暱稱。",
        ),
      ]),
    ]);

    const walletMemberOpsCard = el("section", { class: "admin-announce__wallet-segment admin-announce__wallet-segment--member-ops" }, [
      el("h3", {}, [t("admin.wallet.opsHeading", "會員儲值與調整")]),
      el("div", { class: "admin-wallet-accordion-stack" }, [accordionTopup, accordionAdjust, accordionGrant]),
    ]);

    type WalletHistoryRow = {
      id: string;
      type: string;
      amount: number;
      sessionsDelta: number | null;
      drawChancesDelta: number | null;
      note: string;
      operatorId: string;
      createdAt: number | null;
    };
    type WalletHistoryTypeFilter =
      | ""
      | "topup"
      | "admin_session_adjust"
      | "admin_grant_draw"
      | "session_charge"
      | "session_refund"
      | "refund"
      | "points_redeem"
      | "prize_points"
      | "member_cash"
      | "member_qr"
      | "member_cap_overflow";

    const walletHistoryTypeFilter = el("select", { class: "admin-wallet-history__type-filter" });
    const walletHistoryTypeOptions: { value: WalletHistoryTypeFilter; label: string }[] = [
      { value: "", label: t("admin.walletHistory.typeAll", "全部類型") },
      { value: "member_cash", label: t("admin.walletHistory.typeMemberCash", "會員現金預約") },
      { value: "member_qr", label: t("admin.walletHistory.typeMemberQr", "QR 轉帳預約") },
      { value: "member_cap_overflow", label: t("admin.walletHistory.typeCapOverflow", "加價現金預約") },
      { value: "session_charge", label: t("admin.walletHistory.typeSessionCharge", "預約扣次") },
      { value: "session_refund", label: t("admin.walletHistory.typeSessionRefund", "取消退回次數") },
      { value: "topup", label: t("admin.walletHistory.typeTopup", "儲值") },
      { value: "admin_session_adjust", label: t("admin.walletHistory.typeAdjust", "調整可預約次數") },
      { value: "admin_grant_draw", label: t("admin.walletHistory.typeGrant", "贈送輪盤抽獎次數") },
      { value: "points_redeem", label: t("admin.walletHistory.typePointsRedeem", "點數兌換") },
      { value: "prize_points", label: t("admin.walletHistory.typePrizePoints", "輪盤點數獎勵") },
      { value: "refund", label: t("admin.walletHistory.typeRefund", "取消退回儲值金（早期資料）") },
    ];
    for (const opt of walletHistoryTypeOptions) {
      const o = el("option", { value: opt.value }, [opt.label]);
      walletHistoryTypeFilter.append(o);
    }

    const walletHistoryQueryBtn = el("button", { type: "button", class: "ghost" }, [
      t("admin.walletHistory.queryBtn", "查詢紀錄"),
    ]);
    const walletHistoryStatus = el("div", { class: "status-line" });
    const walletHistoryTableWrap = el("div", { class: "table-wrap admin-wallet-history-table" });
    const walletHistoryTable = el("table", {}, []);
    walletHistoryTableWrap.append(walletHistoryTable);

    const WALLET_HISTORY_PAGE_SIZE = 10;
    let walletHistoryPageIndex = 0;
    let walletHistoryAllRows: WalletHistoryRow[] = [];

    const walletHistoryPager = el("div", { class: "admin-hidden-pager admin-wallet-history-pager", hidden: true });
    const walletHistoryPagePrev = el("button", { type: "button", class: "ghost" }, [
      t("admin.pager.prev", "上一頁"),
    ]);
    const walletHistoryPageInfo = el("span", { class: "hint admin-hidden-pager-meta" }, [""]);
    const walletHistoryPageNext = el("button", { type: "button", class: "ghost" }, [
      t("admin.pager.next", "下一頁"),
    ]);
    walletHistoryPager.append(walletHistoryPagePrev, walletHistoryPageNext, walletHistoryPageInfo);

    function walletHistoryTypeLabel(type: string): string {
      if (type === "member_cash" || type === "member_qr" || type === "member_cap_overflow") {
        return bookingModeLabel(type);
      }
      switch (type) {
        case "topup":
          return t("admin.walletHistory.typeTopup", "儲值");
        case "admin_session_adjust":
          return t("admin.walletHistory.typeAdjust", "調整可預約次數");
        case "admin_grant_draw":
          return t("admin.walletHistory.typeGrant", "贈送輪盤抽獎次數");
        case "monthly_champion_reward":
          return t("admin.walletHistory.typeMonthlyChampion", "月消費冠軍獎勵");
        case "session_charge":
          return t("admin.walletHistory.typeSessionCharge", "預約扣次");
        case "session_refund":
          return t("admin.walletHistory.typeSessionRefund", "取消退回次數");
        case "refund":
          return t("admin.walletHistory.typeRefund", "取消退回儲值金（早期資料）");
        case "points_redeem":
          return t("admin.walletHistory.typePointsRedeem", "點數兌換");
        case "prize_points":
          return t("admin.walletHistory.typePrizePoints", "輪盤點數獎勵");
        default:
          return type || "—";
      }
    }

    function walletHistoryAmountLabel(row: WalletHistoryRow): string {
      const cashTypes = new Set(["member_cash", "member_qr", "member_cap_overflow", "topup", "refund"]);
      if (cashTypes.has(row.type) && row.amount > 0) return String(row.amount);
      return "—";
    }

    function formatWalletHistoryWhen(seconds: number | null): string {
      if (seconds == null) return "—";
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
        return "—";
      }
    }

    function formatWalletHistoryDelta(n: number | null): string {
      if (n == null) return "—";
      const sign = n > 0 ? "+" : "";
      return `${sign}${n}`;
    }

    function formatWalletHistoryOperator(operatorId: string): string {
      const id = operatorId.trim();
      if (!id) return "—";
      if (id.length <= 12) return id;
      return `${id.slice(0, 8)}…`;
    }

    function paintWalletHistoryTable() {
      walletHistoryTable.replaceChildren();
      walletHistoryTable.append(
        el("tr", {}, [
          el("th", {}, [t("admin.walletHistory.colWhen", "時間")]),
          el("th", {}, [t("admin.walletHistory.colType", "類型")]),
          el("th", {}, [t("admin.walletHistory.colAmount", "金額（元）")]),
          el("th", {}, [t("admin.walletHistory.colSessions", "次數變更")]),
          el("th", {}, [t("admin.walletHistory.colDraw", "抽獎變更")]),
          el("th", {}, [t("admin.walletHistory.colNote", "備註")]),
          el("th", {}, [t("admin.walletHistory.colOperator", "操作者")]),
        ]),
      );
      if (walletHistoryAllRows.length === 0) {
        walletHistoryPager.hidden = true;
        walletHistoryTable.append(
          el("tr", {}, [
            el("td", { colSpan: 7, class: "admin-wallet-history__empty" }, [
              t("admin.walletHistory.empty", "尚無符合條件的紀錄。"),
            ]),
          ]),
        );
        return;
      }
      const total = walletHistoryAllRows.length;
      const totalPages = Math.max(1, Math.ceil(total / WALLET_HISTORY_PAGE_SIZE));
      walletHistoryPageIndex = Math.max(0, Math.min(walletHistoryPageIndex, totalPages - 1));
      const from = walletHistoryPageIndex * WALLET_HISTORY_PAGE_SIZE;
      const pageRows = walletHistoryAllRows.slice(from, from + WALLET_HISTORY_PAGE_SIZE);

      for (const row of pageRows) {
        walletHistoryTable.append(
          el("tr", {}, [
            el("td", { class: "mono admin-wallet-history__when" }, [formatWalletHistoryWhen(row.createdAt)]),
            el("td", {}, [walletHistoryTypeLabel(row.type)]),
            el("td", { class: "mono" }, [walletHistoryAmountLabel(row)]),
            el("td", { class: "mono" }, [formatWalletHistoryDelta(row.sessionsDelta)]),
            el("td", { class: "mono" }, [formatWalletHistoryDelta(row.drawChancesDelta)]),
            el("td", { class: "admin-wallet-history__note" }, [row.note || "—"]),
            el("td", { class: "mono", title: row.operatorId || undefined }, [
              formatWalletHistoryOperator(row.operatorId),
            ]),
          ]),
        );
      }

      walletHistoryPager.hidden = false;
      walletHistoryPagePrev.disabled = walletHistoryPageIndex <= 0;
      walletHistoryPageNext.disabled = walletHistoryPageIndex >= totalPages - 1;
      walletHistoryPageInfo.textContent = t(
        "admin.pager.walletHistoryPage",
        "第 {{cur}} / {{total}} 頁 · 共 {{count}} 筆（每頁 {{size}} 筆）",
        {
          cur: walletHistoryPageIndex + 1,
          total: totalPages,
          count: total,
          size: WALLET_HISTORY_PAGE_SIZE,
        },
      );
    }

    walletHistoryPagePrev.addEventListener("click", () => {
      if (walletHistoryPageIndex <= 0) return;
      walletHistoryPageIndex -= 1;
      paintWalletHistoryTable();
    });
    walletHistoryPageNext.addEventListener("click", () => {
      if (walletHistoryAllRows.length === 0) return;
      const totalPages = Math.ceil(walletHistoryAllRows.length / WALLET_HISTORY_PAGE_SIZE);
      if (walletHistoryPageIndex >= totalPages - 1) return;
      walletHistoryPageIndex += 1;
      paintWalletHistoryTable();
    });

    async function loadWalletHistory() {
      walletHistoryStatus.textContent = "";
      walletHistoryStatus.className = "status-line";
      const customerId = historyCustomerId.value.trim();
      if (!customerId) {
        walletHistoryStatus.textContent = t("admin.topup.needId", "請輸入會員 Email 或暱稱。");
        walletHistoryStatus.classList.add("error");
        return;
      }
      const typeFilter = walletHistoryTypeFilter.value as WalletHistoryTypeFilter;
      walletHistoryQueryBtn.setAttribute("disabled", "true");
      walletHistoryStatus.textContent = t("admin.walletHistory.loading", "查詢中…");
      try {
        const fn = listWalletTransactionsAdminCall();
        const res = await fn({
          customerId,
          ...(typeFilter ? { typeFilter } : {}),
          limit: 100,
          ...localeApiParam(),
        });
        const data = res.data as { transactions?: WalletHistoryRow[] };
        walletHistoryAllRows = Array.isArray(data.transactions) ? data.transactions : [];
        walletHistoryPageIndex = 0;
        paintWalletHistoryTable();
        walletHistoryStatus.textContent =
          walletHistoryAllRows.length > 0
            ? t("admin.walletHistory.found", "共 {{n}} 筆紀錄。", { n: walletHistoryAllRows.length })
            : t("admin.walletHistory.none", "查無紀錄。");
        if (walletHistoryAllRows.length > 0) walletHistoryStatus.classList.add("ok");
      } catch (e) {
        walletHistoryAllRows = [];
        walletHistoryPageIndex = 0;
        paintWalletHistoryTable();
        walletHistoryStatus.textContent = errorMessage(e);
        walletHistoryStatus.classList.add("error");
      } finally {
        walletHistoryQueryBtn.removeAttribute("disabled");
      }
    }

    walletHistoryQueryBtn.addEventListener("click", () => void loadWalletHistory());

    const memberHistorySection = el("div", { class: "admin-announce admin-announce--wallet" }, []);
    const historyMemberBar = el("section", { class: "admin-announce__wallet-segment admin-announce__wallet-segment--member" }, [
      el("label", { class: "field" }, [t("admin.wallet.memberLabel", "會員（Email 或暱稱）"), historyTypeaheadWrap]),
      el("p", { class: "hint admin-wallet-member-bar__hint" }, [
        t(
          "admin.walletHistory.memberHint",
          "查詢前請先指定會員；輸入至少 2 字元可搜尋 Email 或暱稱（與「會員儲值」分頁共用）。",
        ),
      ]),
    ]);
    const walletHistoryCard = el("section", {
      class: "admin-announce__wallet-segment admin-announce__wallet-segment--history",
    }, [
      el("h3", {}, [t("admin.walletHistory.heading", "消費與調整紀錄")]),
      el("p", { class: "hint" }, [
        t(
          "admin.walletHistory.lead",
          "查詢會員現金／QR／加價現金預約、預約扣次、取消退回，以及後台儲值與手動調整之稽核紀錄。",
        ),
      ]),
      el("div", { class: "admin-wallet-history__toolbar" }, [
        el("label", { class: "field admin-wallet-history__filter" }, [
          t("admin.walletHistory.typeFilterLabel", "類型篩選"),
          walletHistoryTypeFilter,
        ]),
        walletHistoryQueryBtn,
      ]),
      walletHistoryStatus,
      walletHistoryTableWrap,
      walletHistoryPager,
    ]);
    paintWalletHistoryTable();
    memberHistorySection.append(historyMemberBar, walletHistoryCard);

    type ConsumptionStatsSummary = {
      bookingCount: number;
      cashTotalNtd: number;
      sessionsConsumed: number;
      topupAmountNtd: number;
      topupSessions: number;
      adminAdjustSessionsNet: number;
    };
    type ConsumptionStatsByMode = {
      mode: string;
      bookingCount: number;
      cashNtd: number;
      sessions: number;
    };
    type ConsumptionStatsTopMember = {
      customerId: string;
      email: string | null;
      bookingCount: number;
      cashNtd: number;
      sessions: number;
    };

    function defaultConsumptionStatsDateFrom(): string {
      const today = taipeiTodayDateKey();
      return `${today.slice(0, 8)}01`;
    }

    const statsDateFromInput = el("input", { type: "date", value: defaultConsumptionStatsDateFrom() });
    const statsDateToInput = el("input", { type: "date", value: taipeiTodayDateKey() });
    const statsQueryBtn = el("button", { type: "button", class: "ghost" }, [
      t("admin.consumptionStats.queryBtn", "查詢統計"),
    ]);
    const statsStatus = el("div", { class: "status-line" });
    const statsSummaryGrid = el("div", { class: "admin-consumption-stats__cards" });
    const statsByModeTableWrap = el("div", { class: "table-wrap admin-consumption-stats-table" });
    const statsByModeTable = el("table", {}, []);
    statsByModeTableWrap.append(statsByModeTable);
    const statsTopMembersSection = el("section", { class: "admin-consumption-stats__top-members", hidden: true });
    const statsTopMembersTableWrap = el("div", { class: "table-wrap admin-consumption-stats-table" });
    const statsTopMembersTable = el("table", {}, []);
    statsTopMembersTableWrap.append(statsTopMembersTable);
    statsTopMembersSection.append(
      el("h4", { class: "admin-consumption-stats__subheading" }, [
        t("admin.consumptionStats.topMembersHeading", "現金消費排行（前 10）"),
      ]),
      statsTopMembersTableWrap,
    );

    function paintConsumptionStatsSummary(summary: ConsumptionStatsSummary | null) {
      statsSummaryGrid.replaceChildren();
      if (!summary) return;
      const cards: { label: string; value: string }[] = [
        {
          label: t("admin.consumptionStats.cardBookings", "有效預約筆數"),
          value: String(summary.bookingCount),
        },
        {
          label: t("admin.consumptionStats.cardCash", "現金收入合計（元）"),
          value: String(summary.cashTotalNtd),
        },
        {
          label: t("admin.consumptionStats.cardSessions", "扣次合計"),
          value: String(summary.sessionsConsumed),
        },
        {
          label: t("admin.consumptionStats.cardTopup", "後台儲值（元／次）"),
          value: `${summary.topupAmountNtd}／${summary.topupSessions}`,
        },
        {
          label: t("admin.consumptionStats.cardAdjust", "後台調整次數（淨增減）"),
          value: summary.adminAdjustSessionsNet > 0 ? `+${summary.adminAdjustSessionsNet}` : String(summary.adminAdjustSessionsNet),
        },
      ];
      for (const card of cards) {
        statsSummaryGrid.append(
          el("div", { class: "admin-consumption-stats__card" }, [
            el("span", { class: "admin-consumption-stats__card-label" }, [card.label]),
            el("strong", { class: "admin-consumption-stats__card-value mono" }, [card.value]),
          ]),
        );
      }
    }

    function paintConsumptionStatsByMode(rows: ConsumptionStatsByMode[]) {
      statsByModeTable.replaceChildren();
      statsByModeTable.append(
        el("tr", {}, [
          el("th", {}, [t("admin.consumptionStats.colMode", "付款方式")]),
          el("th", {}, [t("admin.consumptionStats.colCount", "預約筆數")]),
          el("th", {}, [t("admin.consumptionStats.colCash", "現金（元）")]),
          el("th", {}, [t("admin.consumptionStats.colSessions", "扣次")]),
        ]),
      );
      if (rows.length === 0) {
        statsByModeTable.append(
          el("tr", {}, [
            el("td", { colSpan: 4, class: "admin-consumption-stats__empty" }, [
              t("admin.consumptionStats.empty", "此區間尚無有效預約紀錄。"),
            ]),
          ]),
        );
        return;
      }
      for (const row of rows) {
        statsByModeTable.append(
          el("tr", {}, [
            el("td", {}, [bookingModeLabelSafe(row.mode)]),
            el("td", { class: "mono" }, [String(row.bookingCount)]),
            el("td", { class: "mono" }, [row.cashNtd > 0 ? String(row.cashNtd) : "—"]),
            el("td", { class: "mono" }, [row.sessions > 0 ? String(row.sessions) : "—"]),
          ]),
        );
      }
    }

    function paintConsumptionStatsTopMembers(rows: ConsumptionStatsTopMember[] | undefined, memberFiltered: boolean) {
      statsTopMembersSection.hidden = memberFiltered || !rows || rows.length === 0;
      statsTopMembersTable.replaceChildren();
      if (memberFiltered || !rows || rows.length === 0) return;
      statsTopMembersTable.append(
        el("tr", {}, [
          el("th", {}, [t("admin.consumptionStats.colMember", "會員")]),
          el("th", {}, [t("admin.consumptionStats.colCount", "預約筆數")]),
          el("th", {}, [t("admin.consumptionStats.colCash", "現金（元）")]),
          el("th", {}, [t("admin.consumptionStats.colSessions", "扣次")]),
        ]),
      );
      for (const row of rows) {
        const label = row.email?.trim() || `${row.customerId.slice(0, 8)}…`;
        statsTopMembersTable.append(
          el("tr", {}, [
            el("td", { title: row.customerId }, [label]),
            el("td", { class: "mono" }, [String(row.bookingCount)]),
            el("td", { class: "mono" }, [row.cashNtd > 0 ? String(row.cashNtd) : "—"]),
            el("td", { class: "mono" }, [row.sessions > 0 ? String(row.sessions) : "—"]),
          ]),
        );
      }
    }

    async function loadConsumptionStats() {
      statsStatus.textContent = "";
      statsStatus.className = "status-line";
      const dateFrom = statsDateFromInput.value.trim();
      const dateTo = statsDateToInput.value.trim();
      if (!dateFrom || !dateTo) {
        statsStatus.textContent = t("admin.consumptionStats.needDates", "請選擇起訖日期。");
        statsStatus.classList.add("error");
        return;
      }
      const memberRaw = statsCustomerId.value.trim();
      statsQueryBtn.setAttribute("disabled", "true");
      statsStatus.textContent = t("admin.consumptionStats.loading", "統計中…");
      try {
        const fn = getConsumptionStatsAdminCall();
        const res = await fn({
          dateFrom,
          dateTo,
          ...(memberRaw ? { customerId: memberRaw } : {}),
          ...localeApiParam(),
        });
        const data = res.data as {
          summary?: ConsumptionStatsSummary;
          byPaymentMode?: ConsumptionStatsByMode[];
          topMembers?: ConsumptionStatsTopMember[];
          truncated?: boolean;
          walletTxTruncated?: boolean;
          customerId?: string | null;
        };
        const summary = data.summary ?? null;
        paintConsumptionStatsSummary(summary);
        paintConsumptionStatsByMode(Array.isArray(data.byPaymentMode) ? data.byPaymentMode : []);
        paintConsumptionStatsTopMembers(data.topMembers, Boolean(data.customerId || memberRaw));
        const parts: string[] = [];
        if (summary) {
          parts.push(
            t("admin.consumptionStats.found", "統計完成：{{bookings}} 筆預約。", {
              bookings: summary.bookingCount,
            }),
          );
        }
        if (data.truncated) {
          parts.push(t("admin.consumptionStats.truncatedBookings", "預約資料已達查詢上限，數字可能偏低。"));
        }
        if (data.walletTxTruncated) {
          parts.push(t("admin.consumptionStats.truncatedWallet", "儲值／調整資料已達查詢上限，數字可能偏低。"));
        }
        statsStatus.textContent = parts.join(" ") || t("admin.consumptionStats.none", "查無資料。");
        if (summary && summary.bookingCount > 0) statsStatus.classList.add("ok");
      } catch (e) {
        paintConsumptionStatsSummary(null);
        paintConsumptionStatsByMode([]);
        paintConsumptionStatsTopMembers(undefined, Boolean(statsCustomerId.value.trim()));
        statsStatus.textContent = errorMessage(e);
        statsStatus.classList.add("error");
      } finally {
        statsQueryBtn.removeAttribute("disabled");
      }
    }

    statsQueryBtn.addEventListener("click", () => void loadConsumptionStats());

    const memberConsumptionStatsSection = el("div", { class: "admin-announce admin-announce--wallet" }, []);
    const consumptionStatsCard = el("section", { class: "admin-announce__wallet-segment admin-consumption-stats" }, [
      el("h3", {}, [t("admin.consumptionStats.heading", "消費統計")]),
      el("p", { class: "hint" }, [
        t(
          "admin.consumptionStats.lead",
          "依預約日期（台北）統計現金收入、扣次與付款方式分布；可選會員或留空查全站。不含已取消／已刪除預約。",
        ),
      ]),
      el("div", { class: "admin-consumption-stats__toolbar" }, [
        el("label", { class: "field" }, [t("admin.consumptionStats.dateFrom", "起始日期"), statsDateFromInput]),
        el("label", { class: "field" }, [t("admin.consumptionStats.dateTo", "結束日期"), statsDateToInput]),
        el("label", { class: "field admin-consumption-stats__member" }, [
          t("admin.consumptionStats.memberOptional", "會員（選填）"),
          statsTypeaheadWrap,
        ]),
        statsQueryBtn,
      ]),
      statsStatus,
      statsSummaryGrid,
      el("h4", { class: "admin-consumption-stats__subheading" }, [
        t("admin.consumptionStats.byModeHeading", "依付款方式"),
      ]),
      statsByModeTableWrap,
      statsTopMembersSection,
    ]);
    memberConsumptionStatsSection.append(consumptionStatsCard);
    paintConsumptionStatsSummary(null);
    paintConsumptionStatsByMode([]);

    walletTopupSection.append(walletMemberBar, walletMemberOpsCard);
    const tableHolder = el("div", { class: "table-wrap admin-bookings-table" });
    const table = el("table", {}, []);
    function adminBookingsHeaderRow(): HTMLTableRowElement {
      const memberThTitle = t("admin.table.memberTitle", "是否為會員預約");
      return el("tr", {}, [
        el("th", {}, [t("admin.table.when", "預約時間")]),
        el("th", {}, [t("admin.table.name", "姓名")]),
        el("th", { title: memberThTitle }, [t("admin.table.member", "會員")]),
        el("th", {}, [t("admin.table.note", "備註")]),
        el("th", {}, [t("admin.table.price", "價格")]),
        el("th", {}, [t("admin.customerProfile.thBrief", "客戶摘要（內部）")]),
        el("th", {}, [t("admin.table.status", "狀態")]),
        el("th", {}, [t("admin.table.actions", "操作")]),
      ]);
    }

    let adminBriefByCustomerId: Record<string, string> = {};
    let adminBriefFetchGen = 0;

    function openMemberCustomerProfile(customerId: string, email?: string | null) {
      openAdminCustomerProfileModal({
        customerId,
        email,
        onSaved: () => {
          void loadMemberList();
          void refreshAdminBookingBriefsFromTables();
        },
      });
    }

    async function refreshAdminBookingBriefsForBookings(bookings: Booking[]) {
      const ids = collectMemberCustomerIdsFromBookings(bookings);
      if (ids.length === 0) {
        adminBriefByCustomerId = {};
        applyAdminBriefsToBookingTable(table, {});
        return;
      }
      const gen = ++adminBriefFetchGen;
      try {
        const fn = batchGetCustomerAdminBriefsAdminCall();
        const res = await fn({ customerIds: ids, ...localeApiParam() });
        if (gen !== adminBriefFetchGen) return;
        const data = res.data as { briefs?: Record<string, string> };
        adminBriefByCustomerId = data.briefs && typeof data.briefs === "object" ? data.briefs : {};
        applyAdminBriefsToBookingTable(table, adminBriefByCustomerId);
        paintAdminBookingsCalendar();
      } catch (e) {
        console.error("refreshAdminBookingBriefsForBookings", e);
      }
    }

    async function refreshAdminBookingBriefsFromTables() {
      const ids = new Set<string>();
      for (const td of table.querySelectorAll<HTMLElement>("[data-admin-brief-for]")) {
        const cid = td.getAttribute("data-admin-brief-for");
        if (cid) ids.add(cid);
      }
      await refreshAdminBookingBriefsForBookings(
        [...ids].map((customerId) => ({ customerId } as Booking)),
      );
    }
    table.append(adminBookingsHeaderRow());
    tableHolder.append(table);

    let adminBookingsCalendarSelectedDateKey = defaultAdminCapacityProbeDateKey();

    let adminCalendarYear = 0;
    let adminCalendarMonth = 0;
    let adminCalendarLastVisible: Booking[] = [];
    let adminCalendarDayCounts: Record<string, number> = {};
    let adminCalendarCountsReq = 0;

    function syncAdminCalendarMonthFromDateInput(): void {
      const dk = adminBookingsCalendarSelectedDateKey;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return;
      const [y, m] = dk.split("-").map(Number);
      adminCalendarYear = y;
      adminCalendarMonth = m;
    }

    function ensureAdminCalendarCursor(): void {
      if (adminCalendarYear !== 0) return;
      syncAdminCalendarMonthFromDateInput();
      if (adminCalendarYear === 0) {
        const [y, m] = taipeiTodayDateKey().split("-").map(Number);
        adminCalendarYear = y;
        adminCalendarMonth = m;
      }
    }

    const adminCalendarMonthLabel = el("span", { class: "admin-calendar__month-label" });
    const adminCalendarGrid = el("div", { class: "admin-calendar__grid", role: "grid" });
    adminCalendarGrid.setAttribute("aria-label", t("admin.calendar.gridAria", "預約月曆"));

    function shiftAdminCalendarMonth(delta: number): void {
      ensureAdminCalendarCursor();
      let y = adminCalendarYear;
      let mo = adminCalendarMonth + delta;
      while (mo < 1) {
        mo += 12;
        y -= 1;
      }
      while (mo > 12) {
        mo -= 12;
        y += 1;
      }
      adminCalendarYear = y;
      adminCalendarMonth = mo;
      paintAdminBookingsCalendar();
      void refreshAdminCalendarDayCounts();
    }

    async function refreshAdminCalendarDayCounts(): Promise<void> {
      ensureAdminCalendarCursor();
      const y = adminCalendarYear;
      const mo = adminCalendarMonth;
      if (y === 0 || mo === 0) return;
      const reqId = ++adminCalendarCountsReq;
      try {
        const fn = getBookingDayCountsCall();
        const res = await fn({ year: y, month: mo, ...localeApiParam() });
        if (reqId !== adminCalendarCountsReq) return;
        const raw = (res.data as { counts?: Record<string, number> } | undefined)?.counts;
        const next: Record<string, number> = {};
        if (raw && typeof raw === "object") {
          for (const [dk, n] of Object.entries(raw)) {
            if (typeof n === "number" && Number.isFinite(n) && n > 0) next[dk] = Math.trunc(n);
          }
        }
        adminCalendarDayCounts = next;
        paintAdminBookingsCalendar();
      } catch (e) {
        console.error("refreshAdminCalendarDayCounts", e);
      }
    }

    function attachAdminCalendarCellTooltip(wrap: HTMLElement, lines: string[]): void {
      wrap.classList.add("admin-calendar__cell--has-tip");
      wrap.setAttribute("aria-label", lines.join("；"));
      const tip = el("div", { class: "admin-calendar__tip", role: "tooltip" });
      for (const line of lines) {
        tip.append(el("div", { class: "admin-calendar__tip-line" }, [line]));
      }
      wrap.append(tip);
    }

    function buildAdminCapSummaryPill(
      label: string,
      count: number,
      cap: number,
      full: boolean,
      showOverflowTag: boolean,
    ): HTMLElement {
      const children: (Node | string)[] = [
        el("span", { class: "pill__label" }, [label]),
        el("span", { class: "pill__value" }, [
          el("strong", {}, [String(count)]),
          ` / ${cap}`,
        ]),
      ];
      if (full && showOverflowTag) {
        children.push(el("span", { class: "pill__tag" }, [t("booking.metaOverflowTag", "已滿可加價")]));
      }
      return el("span", { class: full ? "pill pill--cap-full" : "pill" }, children);
    }

    const adminBookingsCapSummary = el("div", {
      class: "admin-bookings-cap-summary meta-pills",
    });

    function paintAdminBookingsCapSummary(): void {
      const dk = adminBookingsCalendarSelectedDateKey;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) {
        adminBookingsCapSummary.replaceChildren();
        adminBookingsCapSummary.hidden = true;
        return;
      }
      adminBookingsCapSummary.hidden = false;
      const weekStart = taipeiMondayOfSameWeek(dk);
      const { maxPerDay, maxPerWorkWeek, capOverflowEnabled } = adminBookingCapsLive;
      let dayCount = 0;
      let weekCount = 0;
      for (const b of adminCalendarLastVisible) {
        if (!bookingCountsTowardAvailabilityCap(b.status)) continue;
        const bdk = b.dateKey;
        if (!bdk || !/^\d{4}-\d{2}-\d{2}$/.test(bdk)) continue;
        if (b.capOverflow === true) continue;
        const bWeek =
          typeof b.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.weekStart)
            ? b.weekStart
            : taipeiMondayOfSameWeek(bdk);
        if (bdk === dk) dayCount += 1;
        if (bWeek === weekStart) weekCount += 1;
      }
      const dayFull = dayCount >= maxPerDay;
      const weekFull = weekCount >= maxPerWorkWeek;
      const showOverflowTag = capOverflowEnabled && (dayFull || weekFull);
      const weekdayZh = weekdayZhFromDateKeyTaipei(dk);
      const dayLabel =
        weekdayZh ?
          t("booking.metaDayWithWeekday", "當日（{{weekday}}）已預約", { weekday: weekdayZh })
        : t("booking.metaDay", "當日已預約（張）");
      adminBookingsCapSummary.replaceChildren(
        buildAdminCapSummaryPill(dayLabel, dayCount, maxPerDay, dayFull, showOverflowTag),
        buildAdminCapSummaryPill(
          t("booking.metaWeek", "本工作週已預約（張）"),
          weekCount,
          maxPerWorkWeek,
          weekFull,
          showOverflowTag,
        ),
      );
    }
    repaintAdminBookingsCapSummary = paintAdminBookingsCapSummary;

    function paintAdminBookingsCalendar(): void {
      ensureAdminCalendarCursor();
      const y = adminCalendarYear;
      const mo = adminCalendarMonth;
      const minK = taipeiTodayDateKey();
      const maxK = taipeiLatestBookableDateKey();
      const selected = adminBookingsCalendarSelectedDateKey;
      const todayK = taipeiTodayDateKey();

      adminCalendarMonthLabel.textContent = new Intl.DateTimeFormat(intlLocaleTag(), {
        timeZone: "Asia/Taipei",
        year: "numeric",
        month: "long",
      }).format(new Date(`${y}-${String(mo).padStart(2, "0")}-15T12:00:00+08:00`));

      const byDay = new Map<string, Booking[]>();
      for (const b of adminCalendarLastVisible) {
        const dk0 = b.dateKey;
        if (!dk0 || !/^\d{4}-\d{2}-\d{2}$/.test(dk0)) continue;
        const arr = byDay.get(dk0) ?? [];
        arr.push(b);
        byDay.set(dk0, arr);
      }

      adminCalendarGrid.replaceChildren();
      const hdrRow = el("div", { class: "admin-calendar__row admin-calendar__row--head" });
      for (const lab of [
        t("admin.calendar.weekSun", "日"),
        t("admin.calendar.weekMon", "一"),
        t("admin.calendar.weekTue", "二"),
        t("admin.calendar.weekWed", "三"),
        t("admin.calendar.weekThu", "四"),
        t("admin.calendar.weekFri", "五"),
        t("admin.calendar.weekSat", "六"),
      ]) {
        hdrRow.append(el("div", { class: "admin-calendar__wd" }, [lab]));
      }
      adminCalendarGrid.append(hdrRow);

      const firstKey = dateKeyFromYmdTaipei(y, mo, 1);
      const lead = taipeiWeekdaySun0FromDateKey(firstKey);
      const dim = daysInMonthFromOneIndexed(y, mo);
      const padCell = () => el("div", { class: "admin-calendar__cell admin-calendar__cell--pad" });
      const cells: HTMLElement[] = [];
      for (let i = 0; i < lead; i++) cells.push(padCell());

      for (let dayNum = 1; dayNum <= dim; dayNum++) {
        const dk = dateKeyFromYmdTaipei(y, mo, dayNum);
        const inWin = dk >= minK && dk <= maxK;
        const bookableCalDay = inWin && (isDateKeyMonFri(dk) || isDateKeySatSun(dk));
        const list = byDay.get(dk) ?? [];
        const capFromApi = adminCalendarDayCounts[dk];
        const capLocal = list.filter((bb) => bookingCountsTowardAvailabilityCap(bb.status)).length;
        const cap =
          typeof capFromApi === "number" && capFromApi > 0
            ? capFromApi
            : capLocal;
        const sorted = list.slice().sort((a, b) => (a.startSlot ?? "").localeCompare(b.startSlot ?? "", "zh-Hant"));
        const tipLines = sorted.map((bb) => {
          const st = bookingStatusNorm(bb.status);
          const cid = typeof bb.customerId === "string" ? bb.customerId.trim() : "";
          const brief = cid ? (adminBriefByCustomerId[cid] ?? "").trim() : "";
          const briefPart = brief ? ` · ${brief}` : "";
          return `${bb.startSlot ?? ""} ${(bb.displayName ?? "").trim()} · ${bookingStatusLabel(st)}${briefPart}`;
        });
        const wrap = el("div", { class: "admin-calendar__cell" });
        const isToday = dk === todayK;
        const isSelected = dk === selected;

        if (!bookableCalDay) {
          const inactive = el("div", { class: "admin-calendar__day admin-calendar__day--inactive" });
          inactive.append(el("span", { class: "admin-calendar__day-num" }, [String(dayNum)]));
          if (cap > 0) {
            inactive.append(el("span", { class: "admin-calendar__badge" }, [String(cap)]));
          } else if (list.length > 0) {
            inactive.append(
              el("span", { class: "admin-calendar__badge admin-calendar__badge--weak" }, [String(list.length)]),
            );
          }
          if (isToday) inactive.classList.add("admin-calendar__day--today");
          if (isSelected) inactive.classList.add("admin-calendar__day--selected");
          wrap.append(inactive);
        } else {
          const btn = el("button", { type: "button", class: "admin-calendar__day" });
          if (isSelected) btn.classList.add("admin-calendar__day--selected");
          if (isToday) btn.classList.add("admin-calendar__day--today");
          btn.append(el("span", { class: "admin-calendar__day-num" }, [String(dayNum)]));
          if (cap > 0) {
            btn.append(el("span", { class: "admin-calendar__badge" }, [String(cap)]));
          } else if (list.length > 0) {
            btn.append(
              el("span", { class: "admin-calendar__badge admin-calendar__badge--weak" }, [String(list.length)]),
            );
          }
          btn.addEventListener("click", () => {
            adminBookingsCalendarSelectedDateKey = dk;
            syncAdminCalendarMonthFromDateInput();
            paintAdminBookingsCalendar();
          });
          wrap.append(btn);
        }
        if (tipLines.length > 0) attachAdminCalendarCellTooltip(wrap, tipLines);
        cells.push(wrap);
      }

      while (cells.length % 7 !== 0) cells.push(padCell());
      for (let i = 0; i < cells.length; i += 7) {
        const row = el("div", { class: "admin-calendar__row" });
        for (let j = 0; j < 7; j++) row.append(cells[i + j]!);
        adminCalendarGrid.append(row);
      }
      paintAdminBookingsCapSummary();
    }

    const adminCalPrev = el("button", { type: "button", class: "ghost admin-calendar__nav-btn" }, ["‹"]);
    adminCalPrev.setAttribute("aria-label", t("admin.calendar.prevMonth", "上個月"));
    const adminCalNext = el("button", { type: "button", class: "ghost admin-calendar__nav-btn" }, ["›"]);
    adminCalNext.setAttribute("aria-label", t("admin.calendar.nextMonth", "下個月"));
    const adminCalThisMonth = el("button", { type: "button", class: "ghost" }, [
      t("admin.calendar.thisMonth", "回到本月"),
    ]);
    adminCalPrev.addEventListener("click", () => shiftAdminCalendarMonth(-1));
    adminCalNext.addEventListener("click", () => shiftAdminCalendarMonth(1));
    adminCalThisMonth.addEventListener("click", () => {
      const [y0, m0] = taipeiTodayDateKey().split("-").map(Number);
      adminCalendarYear = y0;
      adminCalendarMonth = m0;
      paintAdminBookingsCalendar();
      void refreshAdminCalendarDayCounts();
    });

    const adminCalendarToolbar = el("div", { class: "admin-calendar__toolbar" });
    adminCalendarToolbar.append(adminCalPrev, adminCalendarMonthLabel, adminCalNext, adminCalThisMonth);

    const adminBookingsCalendarSection = el("section", { class: "admin-bookings-calendar" }, [
      el("h4", { class: "admin-subhead" }, [t("admin.calendar.heading", "預約月曆")]),
      adminCalendarToolbar,
      adminCalendarGrid,
    ]);

    syncAdminCalendarMonthFromDateInput();
    if (adminCalendarYear === 0) {
      const [yInit, mInit] = taipeiTodayDateKey().split("-").map(Number);
      adminCalendarYear = yInit;
      adminCalendarMonth = mInit;
    }
    paintAdminBookingsCalendar();
    void refreshAdminCalendarDayCounts();

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
      nickname: string;
      adminBrief: string;
      sessionCredits: number;
      wheelPoints: number;
      drawChances: number;
    };
    type MemberListSortKey =
      | "email"
      | "nickname"
      | "sessionCredits"
      | "wheelPoints"
      | "drawChances";

    const MEMBER_LIST_PAGE_SIZE = 5;
    let memberListCache: AdminMemberListRow[] = [];
    let memberListPageIndex = 0;
    let memberListSortKey: MemberListSortKey = "email";
    let memberListSortAsc = true;
    let memberListSearchQuery = "";
    const memberListSearchInput = el("input", {
      type: "search",
      class: "admin-member-list-search-input",
      maxLength: 200,
      autocomplete: "off",
      placeholder: t("admin.memberList.searchPlaceholder", "Email、UID 或稱呼…"),
    });
    memberListSearchInput.setAttribute("aria-label", t("admin.memberList.searchAria", "篩選會員清單"));
    memberListSearchInput.addEventListener("input", () => {
      memberListSearchQuery = memberListSearchInput.value;
      memberListPageIndex = 0;
      paintMemberListTable();
    });

    const memberListPager = el("div", { class: "admin-hidden-pager admin-member-list-pager" });
    const memberListPagePrev = el("button", { type: "button", class: "ghost" }, [t("admin.pager.prev", "上一頁")]);
    const memberListPageInfo = el("span", { class: "hint admin-hidden-pager-meta" }, [
      t("admin.pager.none", "—"),
    ]);
    const memberListPageNext = el("button", { type: "button", class: "ghost" }, [t("admin.pager.next", "下一頁")]);
    memberListPager.append(memberListPagePrev, memberListPageNext, memberListPageInfo);

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
            .localeCompare((b.email ?? "").toLowerCase(), "zh-Hant", {
              numeric: true,
            });
          break;
        }
        case "nickname": {
          cmp = a.nickname.localeCompare(b.nickname, "zh-Hant", { numeric: true });
          break;
        }
        case "sessionCredits": {
          cmp = a.sessionCredits === b.sessionCredits ? 0 : a.sessionCredits < b.sessionCredits ? -1 : 1;
          break;
        }
        case "wheelPoints": {
          cmp = a.wheelPoints === b.wheelPoints ? 0 : a.wheelPoints < b.wheelPoints ? -1 : 1;
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
        const arrowChar = memberListSortKey === key ? (memberListSortAsc ? "▲" : "▼") : "";
        const btn = el("button", {
            type: "button",
            class: "ghost admin-member-sort-btn",
            title: t("admin.memberList.sortTitle", "依「{{label}}」排序；再按一次反向", { label }),
        });
        btn.append(
          el("span", { class: "admin-member-sort-btn__label" }, [label]),
          el("span", { class: "admin-member-sort-btn__arrow", ariaHidden: "true" }, [arrowChar]),
        );
        btn.setAttribute("data-member-sort", key);
        th.append(btn);
        return th;
      };
      return el("tr", {}, [
        mk(t("admin.memberList.th.email", "Email"), "email"),
        mk(t("admin.memberList.th.nickname", "稱呼"), "nickname"),
        mk(t("admin.memberList.th.sessions", "可預約次數"), "sessionCredits"),
        mk(t("admin.memberList.th.points", "輪盤點數"), "wheelPoints"),
        mk(t("admin.memberList.th.draws", "可抽次數"), "drawChances"),
      ]);
    }

    function memberListRowMatchesQuery(m: AdminMemberListRow, qRaw: string): boolean {
      const q = qRaw.trim().toLowerCase();
      if (!q) return true;
      const blob = `${m.email ?? ""} ${m.uid} ${m.nickname}`.toLowerCase();
      return blob.includes(q);
    }

    function memberListRowHasEmail(m: AdminMemberListRow): boolean {
      return typeof m.email === "string" && m.email.trim().length > 0;
    }

    function getMemberListFiltered(): AdminMemberListRow[] {
      return memberListCache.filter(
        (m) => memberListRowHasEmail(m) && memberListRowMatchesQuery(m, memberListSearchQuery),
      );
    }

    function openAdminMemberProfileModal(m: AdminMemberListRow) {
      openMemberCustomerProfile(m.uid, m.email);
    }

    function paintMemberListTable() {
      const filtered = getMemberListFiltered();
      const sorted = [...filtered].sort((a, b) => {
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
        const withEmailCount = memberListCache.filter(memberListRowHasEmail).length;
        let emptyMsg: string;
        if (memberListCache.length === 0) {
          emptyMsg = t("admin.memberList.empty", "目前沒有使用者資料。請按「重新載入會員清單」。");
        } else if (withEmailCount === 0) {
          emptyMsg = t(
            "admin.memberList.emptyNoEmail",
            "後端有使用者資料，但沒有帶 Email 的帳號可顯示（清單僅列出有 Email 者）。",
          );
        } else {
          emptyMsg = t("admin.memberList.searchEmpty", "沒有符合關鍵字的會員。請改關鍵字或清空篩選欄。");
        }
        memberListTable.append(
          el("tr", {}, [el("td", { class: "hint", colSpan: 5 }, [emptyMsg])]),
        );
        memberListPagePrev.disabled = true;
        memberListPageNext.disabled = true;
        memberListPageInfo.textContent = t("admin.pager.total0", "共 0 筆");
        return;
      }

      for (const m of pageRows) {
        const nickTrimmed = (m.nickname ?? "").trim();
        const nickEmpty = nickTrimmed.length === 0;
        const nickOpen = el("button", {
          type: "button",
          class: nickEmpty
            ? "admin-member-nick-trigger admin-member-nick-trigger--empty"
            : "admin-member-nick-trigger",
        });
        nickOpen.title = nickEmpty
          ? t("admin.memberList.nickUnsetTitle", "目前無稱呼，點擊開啟客戶檔案")
          : t("admin.memberList.nickClickToEdit", "點擊開啟客戶檔案");
        if (nickEmpty) {
          nickOpen.textContent = t("admin.memberList.nickUnsetClick", "未設定");
          nickOpen.setAttribute(
            "aria-label",
            t("admin.memberList.nickUnsetAria", "尚未設定稱呼，點擊以編輯"),
          );
        } else {
          nickOpen.textContent = m.nickname;
        }
        nickOpen.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openAdminMemberProfileModal(m);
        });
        const emailStr = (m.email ?? "").trim();
        const emailCell = el("td", {
          class: "admin-member-email-cell-wrap",
          title: emailStr,
        });
        const emailInner = el("span", { class: "admin-member-email-cell__text admin-member-email-cell" }, [
          emailStr,
        ]);
        if ((m.adminBrief ?? "").trim().length > 0) {
          emailInner.append(
            el("span", {
              class: "admin-member-brief-dot",
              title: t("admin.customerProfile.hasBrief", "已設定客戶摘要"),
              ariaHidden: "true",
            }),
          );
        }
        emailCell.append(emailInner);
        memberListTable.append(
          el("tr", {}, [
            emailCell,
            el("td", { class: "admin-member-nick-cell" }, [nickOpen]),
            el("td", { class: "mono" }, [String(m.sessionCredits)]),
            el("td", { class: "mono" }, [String(m.wheelPoints)]),
            el("td", { class: "mono" }, [String(m.drawChances)]),
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
      const total = getMemberListFiltered().length;
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
          nickname: typeof m.nickname === "string" ? m.nickname : "",
          adminBrief: typeof m.adminBrief === "string" ? m.adminBrief.trim() : "",
          sessionCredits: typeof m.sessionCredits === "number" ? m.sessionCredits : 0,
          wheelPoints: typeof m.wheelPoints === "number" ? m.wheelPoints : 0,
          drawChances: typeof m.drawChances === "number" ? m.drawChances : 0,
        }));
        memberListPageIndex = 0;
        memberListSortKey = "email";
        memberListSortAsc = true;
        memberListSearchQuery = "";
        memberListSearchInput.value = "";
        paintMemberListTable();
        memberListStatus.textContent = "";
        memberListStatus.className = "status-line";
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
      el("div", { class: "admin-member-list__head" }, [
        el("h3", {}, [t("admin.memberList.title", "會員清單")]),
        el("div", { class: "row-actions admin-member-list__reload" }, [memberListRefreshBtn]),
      ]),
      el("label", { class: "field admin-member-list-search" }, [
        t("admin.memberList.searchLabel", "快速篩選"),
        memberListSearchInput,
      ]),
      memberListStatus,
      memberListTableWrap,
      memberListPager,
    );

    paintMemberListTable();

    const subTabMemberWallet = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.memberTab.wallet", "會員儲值"),
    ]);
    subTabMemberWallet.id = "admin-member-subtab-wallet";
    const subTabMemberHistory = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.memberTab.history", "消費與紀錄"),
    ]);
    subTabMemberHistory.id = "admin-member-subtab-history";
    const subTabMemberStats = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.memberTab.stats", "消費統計"),
    ]);
    subTabMemberStats.id = "admin-member-subtab-stats";
    const subTabMemberList = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.memberTab.list", "會員清單"),
    ]);
    subTabMemberList.id = "admin-member-subtab-list";

    const panelMemberListSub = el("div", {
      class: "admin-tab-panel admin-member-subpanel",
      role: "tabpanel",
      id: "admin-member-subpanel-list",
    });
    panelMemberListSub.setAttribute("aria-labelledby", "admin-member-subtab-list");
    panelMemberListSub.append(memberListSection);

    const panelMemberWalletSub = el("div", {
      class: "admin-tab-panel admin-member-subpanel",
      role: "tabpanel",
      id: "admin-member-subpanel-wallet",
      hidden: true,
    });
    panelMemberWalletSub.setAttribute("aria-labelledby", "admin-member-subtab-wallet");
    panelMemberWalletSub.append(walletTopupSection);

    const panelMemberHistorySub = el("div", {
      class: "admin-tab-panel admin-member-subpanel",
      role: "tabpanel",
      id: "admin-member-subpanel-history",
      hidden: true,
    });
    panelMemberHistorySub.setAttribute("aria-labelledby", "admin-member-subtab-history");
    panelMemberHistorySub.append(memberHistorySection);

    const panelMemberStatsSub = el("div", {
      class: "admin-tab-panel admin-member-subpanel",
      role: "tabpanel",
      id: "admin-member-subpanel-stats",
      hidden: true,
    });
    panelMemberStatsSub.setAttribute("aria-labelledby", "admin-member-subtab-stats");
    panelMemberStatsSub.append(memberConsumptionStatsSection);

    subTabMemberList.setAttribute("aria-controls", "admin-member-subpanel-list");
    subTabMemberWallet.setAttribute("aria-controls", "admin-member-subpanel-wallet");
    subTabMemberHistory.setAttribute("aria-controls", "admin-member-subpanel-history");
    subTabMemberStats.setAttribute("aria-controls", "admin-member-subpanel-stats");

    const membersSubTablist = el("div", { class: "admin-tabs admin-member-subtabs", role: "tablist" });
    membersSubTablist.append(subTabMemberList, subTabMemberWallet, subTabMemberHistory, subTabMemberStats);
    const membersSubPanelsWrap = el("div", { class: "admin-member-subpanels" });
    membersSubPanelsWrap.append(
      panelMemberListSub,
      panelMemberWalletSub,
      panelMemberHistorySub,
      panelMemberStatsSub,
    );

    const memberSubTabButtons = [
      subTabMemberList,
      subTabMemberWallet,
      subTabMemberHistory,
      subTabMemberStats,
    ] as const;
    const memberSubTabPanels = [
      panelMemberListSub,
      panelMemberWalletSub,
      panelMemberHistorySub,
      panelMemberStatsSub,
    ] as const;

    function selectMembersSubTab(index: 0 | 1 | 2 | 3) {
      memberSubTabButtons.forEach((btn, i) => {
        const on = i === index;
        btn.setAttribute("aria-selected", String(on));
        btn.classList.toggle("is-active", on);
        btn.tabIndex = on ? 0 : -1;
      });
      memberSubTabPanels.forEach((panel, i) => {
        panel.hidden = i !== index;
        panel.classList.toggle("is-active", i === index);
      });
    }

    subTabMemberList.addEventListener("click", () => selectMembersSubTab(0));
    subTabMemberWallet.addEventListener("click", () => selectMembersSubTab(1));
    subTabMemberHistory.addEventListener("click", () => selectMembersSubTab(2));
    subTabMemberStats.addEventListener("click", () => selectMembersSubTab(3));

    membersSubTablist.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      ev.preventDefault();
      const cur = memberSubTabButtons.findIndex((b) => b.getAttribute("aria-selected") === "true");
      if (cur < 0) return;
      const delta = ev.key === "ArrowRight" ? 1 : -1;
      const n = memberSubTabButtons.length;
      const next = ((cur + delta) % n + n) % n;
      selectMembersSubTab(next as 0 | 1 | 2 | 3);
      memberSubTabButtons[next].focus();
    });

    selectMembersSubTab(0);

    const tabBookingsHub = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.bookingsHub", "預約管理"),
    ]);
    tabBookingsHub.id = "admin-tab-trigger-bookings-hub";
    const tabMembers = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.members", "會員與儲值"),
    ]);
    tabMembers.id = "admin-tab-trigger-members";
    const tabBookingBlocks = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.bookingBlocks", "不開放時段"),
    ]);
    tabBookingBlocks.id = "admin-tab-trigger-booking-blocks";
    const tabAnnounce = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.announce", "其他設定"),
    ]);
    tabAnnounce.id = "admin-tab-trigger-announce";

    const adminTablist = el("div", { class: "admin-tabs", role: "tablist" });
    adminTablist.append(tabBookingsHub, tabMembers, tabBookingBlocks, tabAnnounce);

    const panelBookingsHubEl = el("div", {
      class: "admin-tab-panel",
      role: "tabpanel",
      id: "admin-tab-panel-bookings-hub",
    });
    panelBookingsHubEl.setAttribute("aria-labelledby", "admin-tab-trigger-bookings-hub");

    const panelMembersEl = el("div", {
      class: "admin-tab-panel",
      role: "tabpanel",
      id: "admin-tab-panel-members",
      hidden: true,
    });
    panelMembersEl.setAttribute("aria-labelledby", "admin-tab-trigger-members");
    const panelBookingBlocksEl = el("div", {
      class: "admin-tab-panel",
      role: "tabpanel",
      id: "admin-tab-panel-booking-blocks",
      hidden: true,
    });
    panelBookingBlocksEl.setAttribute("aria-labelledby", "admin-tab-trigger-booking-blocks");
    panelBookingBlocksEl.append(bookingBlocksPanelInner);
    const panelAnnounceEl = el("div", {
      class: "admin-tab-panel",
      role: "tabpanel",
      id: "admin-tab-panel-announce",
      hidden: true,
    });
    panelAnnounceEl.setAttribute("aria-labelledby", "admin-tab-trigger-announce");

    tabBookingsHub.setAttribute("aria-controls", "admin-tab-panel-bookings-hub");
    tabMembers.setAttribute("aria-controls", "admin-tab-panel-members");
    tabBookingBlocks.setAttribute("aria-controls", "admin-tab-panel-booking-blocks");
    tabAnnounce.setAttribute("aria-controls", "admin-tab-panel-announce");

    panelBookingsHubEl.append(adminBookingsCalendarSection, adminBookingsCapSummary, adminStatus, tableHolder);
    panelMembersEl.append(membersSubTablist, membersSubPanelsWrap);
    panelAnnounceEl.append(announcementSection);

    const adminPanelsWrap = el("div", { class: "admin-tab-panels" });
    adminPanelsWrap.append(panelBookingsHubEl, panelMembersEl, panelBookingBlocksEl, panelAnnounceEl);

    const adminTabButtons = [tabBookingsHub, tabMembers, tabBookingBlocks, tabAnnounce] as const;
    const adminTabPanels = [panelBookingsHubEl, panelMembersEl, panelBookingBlocksEl, panelAnnounceEl] as const;

    function selectAdminTab(index: 0 | 1 | 2 | 3) {
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

    async function trySelectAdminTab(next: 0 | 1 | 2 | 3) {
      const cur = adminTabButtons.findIndex((b) => b.getAttribute("aria-selected") === "true");
      if (cur === 2 && next !== 2 && isBookingBlocksDirty()) {
        const ok = await showConfirmModal(
          t("admin.blocks.unsavedLeaveTitle", "不開放時段尚未儲存"),
          t(
            "admin.blocks.unsavedLeaveMessage",
            "目前有未儲存的變更。若離開此分頁，這些修改將不會寫入資料庫。\n\n仍要離開嗎？請先按「儲存不開放時段」以保留設定。",
          ),
          t("admin.blocks.unsavedLeaveConfirm", "仍要離開"),
        );
        if (!ok) return;
      }
      selectAdminTab(next);
    }

    bookingBlocksHasUnsavedSnapshot = isBookingBlocksDirty;
    bookingBlocksConfirmLeave = async () => {
      if (!isBookingBlocksDirty()) return true;
      return showConfirmModal(
        t("admin.blocks.unsavedLeaveTitle", "不開放時段尚未儲存"),
        t(
          "admin.blocks.unsavedLeaveMessage",
          "目前有未儲存的變更。若離開此分頁或重新整理，未儲存的內容將不會寫入資料庫。\n\n仍要離開嗎？請先按「儲存不開放時段」以保留設定。",
        ),
        t("admin.blocks.unsavedLeaveConfirm", "仍要離開"),
      );
    };

    tabBookingsHub.addEventListener("click", () => void trySelectAdminTab(0));
    tabMembers.addEventListener("click", () => void trySelectAdminTab(1));
    tabBookingBlocks.addEventListener("click", () => void trySelectAdminTab(2));
    tabAnnounce.addEventListener("click", () => void trySelectAdminTab(3));

    adminTablist.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      ev.preventDefault();
      const cur = adminTabButtons.findIndex((b) => b.getAttribute("aria-selected") === "true");
      if (cur < 0) return;
      const delta = ev.key === "ArrowRight" ? 1 : -1;
      const n = adminTabButtons.length;
      const next = ((cur + delta) % n + n) % n;
      void (async () => {
        await trySelectAdminTab(next as 0 | 1 | 2 | 3);
        const sel = adminTabButtons.findIndex((b) => b.getAttribute("aria-selected") === "true");
        if (sel >= 0) adminTabButtons[sel].focus();
      })();
    });

    selectAdminTab(0);

    adminWrap.className = "admin-dashboard";
    adminWrap.append(
      el("div", { class: "admin-dashboard__shell" }, [adminTablist, adminPanelsWrap]),
    );

    void loadMemberList();

    const q = query(collection(db, "bookings"), orderBy("startAt", "desc"));
    adminUnsub = onSnapshot(
      q,
      (snap) => {
        adminStatus.textContent = "";
        adminStatus.className = "status-line";
        table.innerHTML = "";
        table.append(adminBookingsHeaderRow());
        const bookingsForAdminCalendar: Booking[] = [];
        for (const d of snap.docs) {
          const b = { id: d.id, ...d.data() } as Booking;
          if (b.status !== "deleted") {
            bookingsForAdminCalendar.push(b);
          }
          if (b.status === "deleted" || b.invisible === true) {
            continue;
          }
          const statusCell: HTMLElement =
            bookingIsCancelledForAdmin(b.status)
              ? el("span", { class: "admin-booking-status-readonly" }, [bookingStatusLabel("cancelled")])
              : bookingIsDoneForAdmin(b)
                ? el("span", { class: "admin-booking-status-readonly" }, [bookingStatusLabel("done")])
                : el("select", {}, []);
          const sel =
            bookingIsCancelledForAdmin(b.status) || bookingIsDoneForAdmin(b) ? null : (statusCell as HTMLSelectElement);
          if (sel) {
            populateAdminBookingStatusSelect(sel, b.status);
            sel.addEventListener("change", async () => {
              const nextStatus = sel.value;
              const prevStatus = b.status;
              let statusEmailMessage: string | undefined;
              if (memberBookingGetsStatusEmail(b)) {
                const summaryCore = [
                  `${t("booking.summary.name", "姓名")}：${b.displayName ?? ""}`,
                  `${t("booking.summary.date", "日期")}：${b.dateKey ?? ""}`,
                  `${t("booking.summary.start", "開始時間")}：${b.startSlot ?? ""}`,
                  `${t("booking.summary.note", "備註")}：${(b.note ?? "").trim() || t("admin.hidden.cancelSummaryNone", "（無）")}`,
                ].join("\n");
                const note = await showAdminBookingStatusEmailNoteModal({
                  summaryLines: summaryCore,
                  prevStatusKey: prevStatus,
                  nextStatusKey: nextStatus,
                });
                if (note === null) {
                  sel.value = adminSelectableBookingStatus(prevStatus);
                  return;
                }
                if (note.length > 0) statusEmailMessage = note;
              }
              adminStatus.textContent = t("admin.status.updating", "更新中…");
              adminStatus.className = "status-line";
              try {
                if (nextStatus === "done") {
                  const fn = completeBookingCall();
                  await fn({
                    bookingId: b.id,
                    ...(statusEmailMessage ? { statusEmailMessage } : {}),
                    ...localeApiParam(),
                  });
                } else {
                  await updateDoc(doc(db, "bookings", b.id), {
                    status: nextStatus,
                    ...(statusEmailMessage ? { statusEmailMessage } : {}),
                    updatedAt: serverTimestamp(),
                  });
                }
                adminStatus.textContent = t("admin.status.updated", "已更新");
                adminStatus.classList.add("ok");
                if (nextStatus === "done") {
                  await refreshWalletStatus({ keepWalletSummaryDuringFetch: true });
                }
              } catch (e) {
                sel.value = adminSelectableBookingStatus(prevStatus);
                adminStatus.textContent = adminBookingStatusUpdateError(e);
                adminStatus.classList.add("error");
              }
            });
          }
          const cancelBtn = el("button", { class: "ghost admin-btn--danger", type: "button" }, [
            t("admin.booking.cancel", "取消"),
          ]);
          const canAdminCancel = !bookingIsDoneForAdmin(b) && !bookingIsCancelledForAdmin(b.status);
          cancelBtn.disabled = !canAdminCancel;
          cancelBtn.title = !canAdminCancel
            ? bookingIsDoneForAdmin(b)
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
              await refreshWalletStatus({ keepWalletSummaryDuringFetch: true });
            } catch (e) {
              adminStatus.textContent = e instanceof Error ? e.message : t("admin.status.cancelFail", "取消失敗");
              adminStatus.classList.add("error");
              cancelBtn.removeAttribute("disabled");
            }
          });
          const canArchive = bookingIsDoneForAdmin(b) || bookingIsCancelledForAdmin(b.status);
          const archiveBtn = el("button", { class: "ghost admin-btn--warn", type: "button" }, [
            t("admin.booking.hide", "封存"),
          ]);
          archiveBtn.disabled = !canArchive;
          archiveBtn.title = canArchive
            ? ""
            : t("admin.booking.hideNeedTerminal", "須先取消預約或標記為完成後才能封存");
          archiveBtn.addEventListener("click", async () => {
            if (!canArchive) return;
            const confirmed = await showConfirmModal(
              t("admin.booking.hideConfirmTitle", "確認封存此筆預約"),
              t(
                "admin.booking.hideConfirmBody",
                "確定將此筆預約從後台主列表封存嗎？\n\n（僅限已取消或已完成之預約。不改變預約狀態；會員端仍顯示原狀態。額度與可預約時段仍依預約狀態計算，與主列表邏輯相同。）\n\n姓名：{{name}}\n日期：{{date}}\n開始時間：{{start}}",
                { name: b.displayName ?? "", date: b.dateKey ?? "", start: b.startSlot ?? "" },
              ),
              t("admin.booking.hideBtn", "封存"),
            );
            if (!confirmed) return;
            adminStatus.textContent = t("admin.status.hiding", "封存中…");
            adminStatus.className = "status-line";
            archiveBtn.setAttribute("disabled", "true");
            try {
              await updateDoc(doc(db, "bookings", b.id), {
                invisible: true,
                updatedAt: serverTimestamp(),
              });
              adminStatus.textContent = t("admin.status.hidden", "已封存");
              adminStatus.classList.add("ok");
            } catch (e) {
              adminStatus.textContent =
                e instanceof Error ? e.message : t("admin.status.hideFail", "封存失敗（你是否已加入 admins 集合？）");
              adminStatus.classList.add("error");
              archiveBtn.removeAttribute("disabled");
            }
          });
          const settleBtn = el("button", { class: "ghost", type: "button" }, [
            t("admin.settleBooking.btn", "改扣次"),
          ]);
          const canSettle = bookingCanSettleWithSessions(b);
          settleBtn.hidden = !canSettle;
          settleBtn.title = canSettle
            ? t("admin.settleBooking.btnTitle", "現金／加價現金預約改為扣次結帳")
            : "";
          settleBtn.addEventListener("click", async () => {
            if (!canSettle) return;
            const payload = await showAdminSettleBookingSessionsModal(b);
            if (!payload) return;
            adminStatus.textContent = t("admin.settleBooking.processing", "扣次結帳中…");
            adminStatus.className = "status-line";
            settleBtn.setAttribute("disabled", "true");
            try {
              const fn = settleBookingWithSessionsAdminCall();
              await fn({
                bookingId: b.id,
                sessions: payload.sessions,
                note: payload.note,
                ...(payload.alreadyDeducted ? { alreadyDeducted: true } : {}),
                ...localeApiParam(),
              });
              adminStatus.textContent = t("admin.settleBooking.done", "已改扣次結帳");
              adminStatus.classList.add("ok");
              await refreshWalletStatus({ keepWalletSummaryDuringFetch: true });
            } catch (e) {
              adminStatus.textContent = errorMessage(e);
              adminStatus.classList.add("error");
              settleBtn.removeAttribute("disabled");
            }
          });
          const actionCell = el("div", { class: "admin-booking-actions" }, [
            settleBtn,
            cancelBtn,
            archiveBtn,
          ]);
          const cid = typeof b.customerId === "string" ? b.customerId.trim() : "";
          const canReschedule =
            !bookingIsCancelledForAdmin(b.status) && !bookingIsDoneForAdmin(b);
          const whenCell = el("td", { class: "mono admin-booking-when-cell" });
          let whenTrigger: HTMLButtonElement | null = null;
          const runReschedule = async () => {
            if (whenTrigger?.disabled) return;
            const picked = await showAdminRescheduleBookingModal(b);
            if (!picked) return;
            adminStatus.textContent = t("admin.reschedule.updating", "改時間中…");
            adminStatus.className = "status-line";
            if (whenTrigger) whenTrigger.disabled = true;
            try {
              const fn = rescheduleBookingAdminCall();
              await fn({
                bookingId: b.id,
                dateKey: picked.dateKey,
                startSlot: picked.startSlot,
                ...(picked.emailNote ? { rescheduleEmailMessage: picked.emailNote } : {}),
                ...localeApiParam(),
              });
              adminStatus.textContent = t("admin.reschedule.updated", "已更新預約時間");
              adminStatus.classList.add("ok");
            } catch (e) {
              adminStatus.textContent = adminRescheduleErrorMessage(e);
              adminStatus.classList.add("error");
              if (whenTrigger) whenTrigger.disabled = false;
            }
          };
          if (canReschedule) {
            whenTrigger = el(
              "button",
              {
                class: "admin-booking-when-trigger",
                type: "button",
                title: t("admin.reschedule.btn", "改時間"),
              },
              [formatWhen(b)],
            );
            whenTrigger.addEventListener("click", () => {
              void runReschedule();
            });
            whenCell.append(whenTrigger);
          } else {
            whenCell.append(formatWhen(b));
          }
          if (b.holidayOutcall === true) {
            whenCell.append(
              el("div", { class: "admin-booking-kind-tag" }, [
                t("booking.kind.holidayOutcallShort", "假日外約"),
              ]),
            );
          }
          table.append(
            el("tr", {}, [
              whenCell,
              el("td", {}, [b.displayName ?? ""]),
              el("td", {}, [bookingMemberYesNo(b)]),
              el("td", {}, [b.note ?? ""]),
              createAdminBookingPriceCell(b),
              createAdminBookingBriefCell(cid || null, cid ? adminBriefByCustomerId[cid] : undefined, openMemberCustomerProfile),
              el("td", {}, [statusCell]),
              el("td", {}, [actionCell]),
            ]),
          );
        }
        adminCalendarLastVisible = bookingsForAdminCalendar;
        void refreshAdminBookingBriefsForBookings(bookingsForAdminCalendar);
        paintAdminBookingsCalendar();
        void refreshAdminCalendarDayCounts();
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
        adminCalendarLastVisible = [];
        paintAdminBookingsCalendar();
      },
    );
  }

  return {
    stopAdminListener,
    renderAdminLoggedOut,
    renderAdminForbidden,
    renderAdminTable,
    hasUnsavedBookingBlocks: () => bookingBlocksHasUnsavedSnapshot(),
    confirmLeaveUnsavedBookingBlocks: () => bookingBlocksConfirmLeave(),
  };
}

