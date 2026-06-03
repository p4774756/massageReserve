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
  completeBookingCall,
  adjustSessionCreditsAdminCall,
  grantDrawChancesAdminCall,
  listMembersAdminCall,
  searchMemberUsersCall,
  sendMembersBroadcastAdminCall,
  sendMemberDirectEmailAdminCall,
  topupWalletCall,
  batchGetCustomerAdminBriefsAdminCall,
  syncSessionPriceFromTsmcAdminCall,
} from "./firebase";
import {
  applyAdminBriefsToBookingTable,
  collectMemberCustomerIdsFromBookings,
  createAdminBookingBriefCell,
  openAdminCustomerProfileModal,
} from "./adminCustomerProfile";
import { renderAdminForbidden as paintAdminForbiddenView, renderAdminLoggedOut as paintAdminLoginView } from "./adminLoginViews";
import { resolveCapOverflowSettingsClient } from "./capOverflow";
import { roundSessionPriceNtdForCash } from "./sitePricingResolve";
import {
  memberBookingGetsStatusEmail,
  showAdminBookingStatusEmailNoteModal,
  showAdminCancelBookingModal,
} from "./adminBookingModals";
import {
  adminBookingStatusUpdateError,
  adminSelectableBookingStatus,
  adminWhenCellParts,
  bookingCountsTowardAvailabilityCap,
  bookingIsCancelledForAdmin,
  bookingIsDoneForAdmin,
  bookingMemberYesNo,
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
  taipeiTodayDateKey,
  taipeiWeekdayNumMon1Sun7,
  taipeiWeekdaySun0FromDateKey,
} from "./taipeiDates";
import { PUBLIC_NOTICE_DOC_ID } from "./sitePublicNotice";
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
  let adminPublicNoticeUnsub: (() => void) | null = null;
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
    if (adminPublicNoticeUnsub) {
      adminPublicNoticeUnsub();
      adminPublicNoticeUnsub = null;
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
    const walletTopupSection = el("div", { class: "admin-announce admin-announce--wallet" }, []);
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
    const topupSessions = el("input", { type: "number", value: "1", min: "1", step: "1" });
    const topupNote = el("input", {
      type: "text",
      placeholder: t("admin.topup.notePlaceholder", "備註（選填）"),
    });
    const topupBtn = el("button", { class: "ghost", type: "button" }, [t("admin.topup.btn", "儲值")]);
    const topupStatus = el("div", { class: "status-line" });
    const adjustSessionDelta = el("input", { type: "number", value: "-1", min: "-50", max: "50", step: "1" });
    const adjustSessionNote = el("input", {
      type: "text",
      maxLength: 500,
      placeholder: t("admin.adjustSessions.notePlaceholder", "例：現場 walk-in 2 次，無預約紀錄"),
    });
    const adjustSessionBtn = el("button", { class: "ghost", type: "button" }, [
      t("admin.adjustSessions.btn", "調整可預約次數"),
    ]);
    const adjustSessionStatus = el("div", { class: "status-line" });
    const grantDrawDelta = el("input", { type: "number", value: "1", min: "1", max: "50", step: "1" });
    const grantDrawNote = el("input", {
      type: "text",
      maxLength: 200,
      placeholder: t("admin.grantDraw.notePlaceholder", "備註（選填，最多 200 字）"),
    });
    const grantDrawBtn = el("button", { class: "ghost", type: "button" }, [t("admin.grantDraw.btn", "贈送抽獎次數")]);
    const grantDrawStatus = el("div", { class: "status-line" });
    const pricingDocRef = doc(db, "siteSettings", "pricing");
    const pricingSessionPriceInput = el("input", { type: "number", min: "10", step: "10", value: "130" });
    const pricingUnitMinutesInput = el("input", { type: "number", min: "5", step: "1", value: "20" });
    const pricingMaxUnitsInput = el("input", { type: "number", min: "1", step: "1", value: "2" });
    const pricingPointsPerInput = el("input", { type: "number", min: "2", step: "1", value: "10" });
    const tsmcPricingEnabledInput = el("input", { type: "checkbox" });
    tsmcPricingEnabledInput.checked = true;
    const tsmcPricingBaseInput = el("input", { type: "number", min: "1", step: "1", value: "130" });
    const tsmcSyncInfo = el("div", { class: "status-line admin-pricing-tsmc-info" });
    const syncTsmcPricingBtn = el("button", { type: "button", class: "ghost" }, [
      t("admin.pricing.tsmcSyncNow", "立即依台積電同步"),
    ]);
    const tsmcSyncStatus = el("div", { class: "status-line" });
    const savePricingBtn = el("button", { type: "button", class: "ghost" }, [t("admin.pricing.save", "儲存定價")]);
    const pricingAdminStatus = el("div", { class: "status-line" });
    let persistedTsmcBaseNtd: number | null = null;
    const formatTsmcSyncInfo = (d: Record<string, unknown> | undefined): string => {
      if (!d) return t("admin.pricing.tsmcSyncNever", "尚未同步過台積電行情。");
      const err = typeof d.tsmcLastSyncError === "string" ? d.tsmcLastSyncError.trim() : "";
      if (err) {
        return t("admin.pricing.tsmcSyncError", "上次同步失敗：{{err}}", { err });
      }
      const at = d.tsmcLastSyncAt as { toDate?: () => Date } | undefined;
      const when =
        at && typeof at.toDate === "function"
          ? at.toDate().toLocaleString(intlLocaleTag(), { timeZone: "Asia/Taipei" })
          : "";
      const pct = d.tsmcLastChangePercent;
      const pctStr =
        typeof pct === "number" && Number.isFinite(pct)
          ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`
          : "—";
      const dateKey = typeof d.tsmcLastQuoteDateKey === "string" ? d.tsmcLastQuoteDateKey : "";
      const factorRaw = d.tsmcCumulativeFactor;
      const factorStr =
        typeof factorRaw === "number" && Number.isFinite(factorRaw) ? `×${factorRaw.toFixed(4)}` : "×1";
      const baseRaw = d.tsmcPricingBaseNtd;
      const baseStr =
        typeof baseRaw === "number" && Number.isFinite(baseRaw) ? String(Math.round(baseRaw)) : "—";
      if (!when) return t("admin.pricing.tsmcSyncNever", "尚未同步過台積電行情。");
      return t(
        "admin.pricing.tsmcSyncOk",
        "上次同步：{{when}}，2330 日漲跌 {{pct}}（{{date}}）；店內基準 {{base}} 元，累積係數 {{factor}}",
        {
          when,
          pct: pctStr,
          date: dateKey || "—",
          base: baseStr,
          factor: factorStr,
        },
      );
    };
    adminPricingUnsub = onSnapshot(
      pricingDocRef,
      (snap) => {
        const d = snap.data() as
          | {
              sessionPriceNtd?: unknown;
              unitMinutes?: unknown;
              maxUnitsPerBooking?: unknown;
              pointsPerMassage?: unknown;
              tsmcPricingEnabled?: unknown;
              tsmcPricingBaseNtd?: unknown;
              tsmcCumulativeFactor?: unknown;
              tsmcLastSyncAt?: unknown;
              tsmcLastChangePercent?: unknown;
              tsmcLastQuoteDateKey?: unknown;
              tsmcLastSyncError?: unknown;
            }
          | undefined;
        const sp = d?.sessionPriceNtd;
        if (typeof sp === "number" && Number.isFinite(sp)) {
          pricingSessionPriceInput.value = String(Math.max(1, Math.round(sp)));
        }
        const um = d?.unitMinutes;
        if (typeof um === "number" && Number.isFinite(um)) {
          pricingUnitMinutesInput.value = String(Math.max(5, Math.round(um)));
        }
        const mu = d?.maxUnitsPerBooking;
        if (typeof mu === "number" && Number.isFinite(mu)) {
          pricingMaxUnitsInput.value = String(Math.max(1, Math.round(mu)));
        }
        const pp = d?.pointsPerMassage;
        if (typeof pp === "number" && Number.isFinite(pp)) {
          pricingPointsPerInput.value = String(Math.max(2, Math.round(pp)));
        }
        tsmcPricingEnabledInput.checked = d?.tsmcPricingEnabled !== false;
        const base = d?.tsmcPricingBaseNtd;
        if (typeof base === "number" && Number.isFinite(base)) {
          const rounded = Math.max(1, Math.round(base));
          tsmcPricingBaseInput.value = String(rounded);
          persistedTsmcBaseNtd = rounded;
        }
        tsmcSyncInfo.textContent = formatTsmcSyncInfo(d as Record<string, unknown> | undefined);
      },
      () => {
        pricingAdminStatus.textContent = t("admin.pricing.loadFail", "無法讀取定價設定。");
        pricingAdminStatus.className = "status-line error";
      },
    );
    savePricingBtn.addEventListener("click", async () => {
      pricingAdminStatus.textContent = "";
      pricingAdminStatus.className = "status-line";
      const sp = Number(pricingSessionPriceInput.value);
      const um = Number(pricingUnitMinutesInput.value);
      const mu = Number(pricingMaxUnitsInput.value);
      const pp = Number(pricingPointsPerInput.value);
      if (!Number.isFinite(sp) || sp < 10 || !Number.isInteger(sp)) {
        pricingAdminStatus.textContent = t(
          "admin.pricing.badSessionPrice",
          "每單位金額需為 ≥10 的整數（儲存時會進位至 10 的倍數）。",
        );
        pricingAdminStatus.classList.add("error");
        return;
      }
      if (!Number.isFinite(um) || um < 5 || !Number.isInteger(um)) {
        pricingAdminStatus.textContent = t("admin.pricing.badUnitMinutes", "每單位分鐘數需為 ≥5 的整數。");
        pricingAdminStatus.classList.add("error");
        return;
      }
      if (!Number.isFinite(mu) || mu < 1 || !Number.isInteger(mu)) {
        pricingAdminStatus.textContent = t("admin.pricing.badMaxUnits", "單筆最多單位數需為 ≥1 的整數。");
        pricingAdminStatus.classList.add("error");
        return;
      }
      if (!Number.isFinite(pp) || pp < 2 || !Number.isInteger(pp)) {
        pricingAdminStatus.textContent = t("admin.pricing.badPointsPer", "兌換門檻需為 ≥2 的整數（點）。");
        pricingAdminStatus.classList.add("error");
        return;
      }
      const tsmcBase = Number(tsmcPricingBaseInput.value);
      if (!Number.isFinite(tsmcBase) || tsmcBase < 1 || !Number.isInteger(tsmcBase)) {
        pricingAdminStatus.textContent = t("admin.pricing.badTsmcBase", "台積電連動基準價需為 ≥1 的整數。");
        pricingAdminStatus.classList.add("error");
        return;
      }
      const roundedTsmcBase = Math.round(tsmcBase);
      const baseChanged = persistedTsmcBaseNtd !== null && persistedTsmcBaseNtd !== roundedTsmcBase;
      savePricingBtn.setAttribute("disabled", "true");
      try {
        const pricingPatch: Record<string, unknown> = {
          sessionPriceNtd: roundSessionPriceNtdForCash(sp),
          unitMinutes: Math.round(um),
          maxUnitsPerBooking: Math.round(mu),
          pointsPerMassage: Math.round(pp),
          tsmcPricingEnabled: tsmcPricingEnabledInput.checked,
          tsmcPricingBaseNtd: roundedTsmcBase,
          updatedAt: serverTimestamp(),
        };
        if (baseChanged) {
          pricingPatch.tsmcCumulativeFactor = 1;
          pricingPatch.tsmcLastAppliedQuoteDateKey = deleteField();
        }
        await setDoc(pricingDocRef, pricingPatch, { merge: true });
        pricingAdminStatus.textContent = t("admin.status.updated", "已更新");
        pricingAdminStatus.classList.add("ok");
      } catch (e) {
        pricingAdminStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
        pricingAdminStatus.classList.add("error");
      } finally {
        savePricingBtn.removeAttribute("disabled");
      }
    });

    syncTsmcPricingBtn.addEventListener("click", async () => {
      tsmcSyncStatus.textContent = "";
      tsmcSyncStatus.className = "status-line";
      syncTsmcPricingBtn.setAttribute("disabled", "true");
      try {
        const fn = syncSessionPriceFromTsmcAdminCall();
        const res = await fn({ ...localeApiParam() });
        const data = res.data as
          | { ok?: boolean; skipped?: boolean; reason?: string; error?: string; sessionPriceNtd?: number }
          | undefined;
        if (data?.ok === false && data.error) {
          tsmcSyncStatus.textContent = data.error;
          tsmcSyncStatus.classList.add("error");
          return;
        }
        if (data?.ok && data.skipped) {
          const reason =
            data.reason === "tsmc_pricing_disabled"
              ? t("admin.pricing.tsmcSkippedDisabled", "已關閉台積電連動，未更新單價。")
              : t("admin.pricing.tsmcSkipped", "未更新：{{reason}}", { reason: data.reason ?? "" });
          tsmcSyncStatus.textContent = reason;
          tsmcSyncStatus.classList.add("ok");
          return;
        }
        if (data?.ok && typeof data.sessionPriceNtd === "number") {
          tsmcSyncStatus.textContent = t("admin.pricing.tsmcSynced", "已更新每單位金額為 {{price}} 元。", {
            price: String(data.sessionPriceNtd),
          });
          tsmcSyncStatus.classList.add("ok");
          return;
        }
        tsmcSyncStatus.textContent = t("admin.pricing.tsmcSyncUnknown", "同步完成，請重新整理定價區塊確認。");
        tsmcSyncStatus.classList.add("ok");
      } catch (e) {
        tsmcSyncStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
        tsmcSyncStatus.classList.add("error");
      } finally {
        syncTsmcPricingBtn.removeAttribute("disabled");
      }
    });

    const announcePricingFlat = el("section", { class: "admin-announce__block admin-announce__block--pricing" }, [
      el("h4", { class: "admin-announce__block-title" }, [t("admin.pricing.heading", "定價與點數兌換")]),
      el("div", { class: "grid grid-2" }, [
        el("label", { class: "field" }, [t("admin.pricing.sessionPrice", "每單位金額（元）"), pricingSessionPriceInput]),
        el("label", { class: "field" }, [t("admin.pricing.unitMinutes", "每單位分鐘數"), pricingUnitMinutesInput]),
        el("label", { class: "field" }, [t("admin.pricing.maxUnits", "單筆最多單位數"), pricingMaxUnitsInput]),
        el("label", { class: "field" }, [t("admin.pricing.pointsPer", "輪盤：幾點換 1 單位"), pricingPointsPerInput]),
      ]),
      el("section", { class: "admin-pricing-tsmc" }, [
        el("h5", { class: "admin-announce__block-subtitle" }, [
          t("admin.pricing.tsmcHeading", "台積電連動定價（2330）"),
        ]),
        el("p", { class: "hint admin-pricing-tsmc__hint" }, [
          t(
            "admin.pricing.tsmcHint",
            "2330 日漲跌以「相對昨日收盤」計算；店內基準價（如 110）每日累乘係數（連兩天各 +2% → 110×1.02×1.02）。每單位金額無條件進位至 10 元倍數。平日 15:30 自動同步。改基準價會重設累積係數為 1。",
          ),
        ]),
        el("div", { class: "grid grid-2 admin-pricing-tsmc__grid" }, [
          el("label", { class: "field checkbox-field" }, [
            tsmcPricingEnabledInput,
            t("admin.pricing.tsmcEnabled", "啟用每日收盤後自動更新"),
          ]),
          el("label", { class: "field" }, [
            t("admin.pricing.tsmcBase", "店內基準價（元，累積起點）"),
            tsmcPricingBaseInput,
          ]),
        ]),
        tsmcSyncInfo,
        el("div", { class: "row-actions admin-pricing-tsmc__actions" }, [syncTsmcPricingBtn]),
        tsmcSyncStatus,
      ]),
      el("div", { class: "row-actions" }, [savePricingBtn]),
      pricingAdminStatus,
    ]);

    topupBtn.addEventListener("click", async () => {
      topupStatus.textContent = "";
      topupStatus.className = "status-line";
      const customerId = topupCustomerId.value.trim();
      const amount = Number(topupAmount.value);
      const sessions = Number(topupSessions.value);
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
        adjustSessionStatus.textContent = t("admin.topup.needId", "請輸入會員 Email 或 UID。");
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
        grantDrawStatus.textContent = t("admin.topup.needId", "請輸入會員 Email 或 UID。");
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
    const addBookingBlockRowBtn = el("button", { type: "button", class: "ghost" }, [t("admin.blocks.addRow", "新增一筆")]);
    const saveBookingBlocksBtn = el("button", { type: "button", class: "ghost" }, [t("admin.blocks.save", "儲存不開放時段")]);
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
        { type: "button", class: "ghost admin-booking-block-row__remove" },
        [t("admin.blocks.rowRemove", "刪除此列")],
      );
      removeBtn.addEventListener("click", () => {
        row.remove();
        syncBookingBlocksDirtyUi();
      });
      const whenFields = el("div", { class: "bb-group-fields" }, [
        el("label", { class: "field bb-field-wd" }, [t("admin.blocks.weekday", "星期"), weekdaySel]),
        el("label", { class: "field bb-field-date" }, [t("admin.blocks.specificDate", "特定日期（選填）"), dateIn]),
      ]);
      const timeFields = el("div", { class: "bb-group-fields bb-group-fields--time" }, [
        el("label", { class: "field bb-field-t" }, [t("admin.blocks.start", "起（含）"), startIn]),
        el("span", { class: "bb-time-sep", ariaHidden: "true" }, ["～"]),
        el("label", { class: "field bb-field-t" }, [t("admin.blocks.end", "迄（不含）"), endIn]),
      ]);
      row.append(
        el("div", { class: "admin-booking-block-row__head" }, [removeBtn]),
        el("div", { class: "bb-group bb-group--when" }, [
          el("span", { class: "bb-group-title" }, [t("admin.blocks.groupWhen", "套用日期")]),
          whenFields,
        ]),
        el("div", { class: "bb-group bb-group--slot" }, [
          el("span", { class: "bb-group-title" }, [t("admin.blocks.groupSlot", "不開放區間（當日）")]),
          timeFields,
        ]),
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

    const publicNoticeDocRef = doc(db, "siteSettings", PUBLIC_NOTICE_DOC_ID);
    const publicNoticeTextInput = el("textarea", {
      class: "site-public-notice-admin__text",
      rows: 3,
      maxLength: 400,
      placeholder: t("admin.notice.textPlaceholder", "例：本週五下午臨時休診，請改選其他日期。"),
    });
    const publicNoticeExpiresInput = el("input", { type: "date" });
    const savePublicNoticeBtn = el("button", { type: "button", class: "ghost" }, [
      t("admin.notice.save", "儲存前台公告"),
    ]);
    const clearPublicNoticeBtn = el("button", { type: "button", class: "ghost" }, [
      t("admin.notice.clear", "清空公告"),
    ]);
    const publicNoticeStatus = el("div", { class: "status-line" });

    adminPublicNoticeUnsub = onSnapshot(
      publicNoticeDocRef,
      (snap) => {
        const data = snap.data() as { text?: unknown; expiresOn?: unknown } | undefined;
        publicNoticeTextInput.value = typeof data?.text === "string" ? data.text : "";
        publicNoticeExpiresInput.value =
          typeof data?.expiresOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.expiresOn.trim())
            ? data.expiresOn.trim()
            : "";
      },
      () => {
        publicNoticeStatus.textContent = t("admin.notice.loadFail", "無法讀取前台公告。");
        publicNoticeStatus.className = "status-line error";
      },
    );

    async function persistPublicNotice(clear: boolean) {
      publicNoticeStatus.textContent = "";
      publicNoticeStatus.className = "status-line";
      const text = clear ? "" : publicNoticeTextInput.value.trim().slice(0, 400);
      const expiresRaw = publicNoticeExpiresInput.value.trim();
      const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(expiresRaw) ? expiresRaw : "";
      if (!clear && expiresOn && expiresOn < taipeiTodayDateKey()) {
        publicNoticeStatus.textContent = t(
          "admin.notice.expiresPast",
          "到期日不可早於今日（台北）；請改選今日或未來日期，或留空表示不自動下架。",
        );
        publicNoticeStatus.classList.add("error");
        return;
      }
      savePublicNoticeBtn.setAttribute("disabled", "true");
      clearPublicNoticeBtn.setAttribute("disabled", "true");
      publicNoticeStatus.textContent = t("admin.status.processing", "處理中…");
      try {
        const payload: Record<string, unknown> = {
          text,
          updatedAt: serverTimestamp(),
        };
        if (expiresOn) payload.expiresOn = expiresOn;
        else payload.expiresOn = deleteField();
        await setDoc(publicNoticeDocRef, payload, { merge: true });
        if (clear) {
          publicNoticeTextInput.value = "";
          publicNoticeExpiresInput.value = "";
        }
        publicNoticeStatus.textContent = t("admin.status.updated", "已更新");
        publicNoticeStatus.classList.add("ok");
      } catch (e) {
        publicNoticeStatus.textContent = e instanceof Error ? e.message : t("admin.memberList.saveFail", "儲存失敗");
        publicNoticeStatus.classList.add("error");
      } finally {
        savePublicNoticeBtn.removeAttribute("disabled");
        clearPublicNoticeBtn.removeAttribute("disabled");
      }
    }

    savePublicNoticeBtn.addEventListener("click", () => void persistPublicNotice(false));
    clearPublicNoticeBtn.addEventListener("click", () => void persistPublicNotice(true));

    const blockPublicNotice = el("section", { class: "admin-announce__block admin-announce__block--public-notice" }, [
      el("h4", { class: "admin-announce__block-title" }, [t("admin.notice.blockTitle", "前台小公告")]),
      el("p", { class: "hint admin-announce__block-lead" }, [
        t(
          "admin.notice.blockLead",
          "顯示於預約頁訪次統計下方、分頁上方；訪客與會員皆可見。可選到期日（台北）後自動隱藏；訪客可按「關閉」在本機暫時隱藏至您更新公告為止。",
        ),
      ]),
      el("label", { class: "field" }, [
        t("admin.notice.textLabel", "公告內文（留空即不顯示）"),
        publicNoticeTextInput,
      ]),
      el("label", { class: "field" }, [
        t("admin.notice.expiresLabel", "到期日（選填，台北時區）"),
        publicNoticeExpiresInput,
      ]),
      el("div", { class: "row-actions" }, [savePublicNoticeBtn, clearPublicNoticeBtn]),
      publicNoticeStatus,
    ]);

    const blockCaps = el("section", { class: "admin-announce__block admin-announce__block--caps" }, [
      el("h4", { class: "admin-announce__block-title" }, [t("admin.announce.blockCapsTitle", "預約名額")]),
      el("p", { class: "hint admin-announce__block-lead" }, [
        t(
          "admin.caps.lead",
          "「張」＝一張預約單（不論選 1 或 2 單位）；每單位時長依「定價」設定（預設 20 分鐘），與名額張數無關。已取消不計入。",
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
      blockPublicNotice,
      blockCaps,
      announcePricingFlat,
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

    const walletMemberOpsCard = el("section", { class: "admin-announce__wallet-segment admin-announce__wallet-segment--member-ops" }, [
      el("h3", {}, [t("admin.wallet.opsHeading", "會員儲值與調整")]),
      el("label", { class: "field" }, [t("admin.wallet.memberLabel", "會員（Email 或 UID）"), topupTypeaheadWrap]),
      el("div", { class: "admin-wallet-accordion-stack" }, [accordionTopup, accordionAdjust, accordionGrant]),
    ]);
    walletTopupSection.append(walletMemberOpsCard);
    const tableHolder = el("div", { class: "table-wrap admin-bookings-table" });
    const table = el("table", {}, []);
    function adminBookingsHeaderRow(): HTMLTableRowElement {
      const memberThTitle = t("admin.table.memberTitle", "是否為會員預約");
      return el("tr", {}, [
        el("th", {}, [t("admin.table.when", "預約時間")]),
        el("th", {}, [t("admin.table.name", "姓名")]),
        el("th", { title: memberThTitle }, [t("admin.table.member", "會員")]),
        el("th", {}, [t("admin.table.note", "備註")]),
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
        applyAdminBriefsToBookingTable(hiddenTable, {});
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
        applyAdminBriefsToBookingTable(hiddenTable, adminBriefByCustomerId);
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
      for (const td of hiddenTable.querySelectorAll<HTMLElement>("[data-admin-brief-for]")) {
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
        const cap = list.filter((bb) => bookingCountsTowardAvailabilityCap(bb.status)).length;
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
    hiddenPager.append(hiddenPagePrev, hiddenPageNext, hiddenPageInfo);

    const memberListSection = el("div", { class: "admin-member-list" }, []);
    const memberListRefreshBtn = el("button", { class: "ghost", type: "button" }, [
      t("admin.memberList.reload", "重新載入會員清單"),
    ]);
    const memberListEmailBtn = el(
      "button",
      {
        class: "ghost",
        type: "button",
        title: t(
          "admin.memberList.emailMenuTitle",
          "群發或寄給單一已驗證會員；純文字內文轉 HTML。需 RESEND_API_KEY 與 RESEND_FROM；群發建議先預覽收件人數。",
        ),
      },
      [t("admin.memberList.emailMenuBtn", "會員郵件")],
    );
    const memberListStatus = el("div", { class: "status-line" });
    const memberListTableWrap = el("div", { class: "table-wrap admin-member-list-table" });
    const memberListTable = el("table", {}, []);
    memberListTableWrap.append(memberListTable);

    type AdminMemberListRow = {
      uid: string;
      email: string | null;
      emailVerified: boolean;
      nickname: string;
      adminBrief: string;
      sessionCredits: number;
      wheelPoints: number;
      drawChances: number;
    };
    type MemberListSortKey =
      | "email"
      | "emailVerified"
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
        case "emailVerified": {
          const av = a.emailVerified ? 1 : 0;
          const bv = b.emailVerified ? 1 : 0;
          cmp = asc ? bv - av : av - bv;
          return cmp;
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
        mk(t("admin.memberList.th.verified", "信箱驗證"), "emailVerified"),
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
          el("tr", {}, [el("td", { class: "hint", colSpan: 6 }, [emptyMsg])]),
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
        const verified = m.emailVerified === true;
        const verifyCell = el("td", { class: verified ? "admin-member-verify ok" : "admin-member-verify" }, [
          verified ? t("admin.memberList.verifiedYes", "已驗證") : t("admin.memberList.verifiedNo", "未驗證"),
        ]);
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
        const profileBtn = el("button", { type: "button", class: "ghost admin-member-profile-btn" }, [
          t("admin.customerProfile.openProfile", "檔案"),
        ]);
        profileBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          openAdminMemberProfileModal(m);
        });
        emailCell.append(emailInner, profileBtn);
        memberListTable.append(
          el("tr", {}, [
            emailCell,
            verifyCell,
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
      memberListEmailBtn.setAttribute("disabled", "true");
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
        memberListEmailBtn.removeAttribute("disabled");
      }
    }

    memberListRefreshBtn.addEventListener("click", () => {
      void loadMemberList();
    });

    function openMemberEmailModal(initialMode: "broadcast" | "direct") {
      const overlay = el("div", { class: "modal-overlay" });
      const dialog = el("div", { class: "modal-card admin-member-broadcast-dialog" });
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      const heading = el("h3", { id: "admin-member-email-title" }, [""]);
      dialog.setAttribute("aria-labelledby", "admin-member-email-title");

      const tabBroadcast = el(
        "button",
        {
          type: "button",
          class: "admin-tab",
          role: "tab",
          id: "admin-member-email-tab-broadcast",
        },
        [t("admin.memberList.emailTabBroadcast", "群發")],
      );
      const tabDirect = el(
        "button",
        {
          type: "button",
          class: "admin-tab",
          role: "tab",
          id: "admin-member-email-tab-direct",
        },
        [t("admin.memberList.emailTabDirect", "單一會員")],
      );
      const tabRow = el("div", { class: "admin-tabs", role: "tablist" }, [tabBroadcast, tabDirect]);

      const hintBroadcast = el("p", { class: "hint" }, [
        t(
          "admin.memberList.broadcastModalHint",
          "內文為純文字（可換行），會轉成 HTML 寄出；主旨與內文會經伺服器長度檢查。建議先按「預覽收件人數」確認對象，再勾選確認並寄出。需已設定 RESEND_API_KEY 與適當的 RESEND_FROM。",
        ),
      ]);
      const paneBroadcast = el("div", {
        class: "admin-member-email-pane",
        id: "admin-member-email-pane-broadcast",
        role: "tabpanel",
      });
      paneBroadcast.append(hintBroadcast);

      const hintDirect = el("p", { class: "hint" }, [
        t(
          "admin.memberList.directEmailModalHint",
          "僅能寄給 Firebase Auth 中「Email 已驗證」的會員。請填 Email 或 UID；內文為純文字（可換行），與群發相同會轉成 HTML。需 RESEND_API_KEY 與適當的 RESEND_FROM。",
        ),
      ]);
      const memberTargetInput = el("input", {
        type: "text",
        class: "admin-member-direct-target",
        autocomplete: "off",
        placeholder: t("admin.memberList.directEmailTargetPh", "會員 Email 或 UID"),
      });
      const directTargetSuggestions = el("ul", {
        class: "member-typeahead-list",
        hidden: true,
        role: "listbox",
      });
      const directTargetTypeaheadWrap = el("div", { class: "member-typeahead-wrap" });
      directTargetTypeaheadWrap.append(memberTargetInput, directTargetSuggestions);

      let directTargetSearchTimer: ReturnType<typeof setTimeout> | null = null;

      const paneDirect = el("div", {
        class: "admin-member-email-pane",
        id: "admin-member-email-pane-direct",
        role: "tabpanel",
      });
      paneDirect.append(
        hintDirect,
        el("label", { class: "field" }, [
          t("admin.memberList.directEmailTargetLabel", "收件會員"),
          directTargetTypeaheadWrap,
        ]),
        el("div", { class: "hint" }, [
          t("admin.wallet.searchHint", "輸入至少 2 個字元會顯示符合的 Email；亦可直接貼上 UID。"),
        ]),
      );

      const subjectInput = el("input", {
        type: "text",
        maxLength: 200,
        class: "admin-member-broadcast-subject",
        autocomplete: "off",
        placeholder: t("admin.memberList.broadcastSubjectPh", "主旨，例如：感謝大家支持"),
      });
      const bodyTa = el("textarea", {
        class: "admin-member-broadcast-body",
        rows: 10,
        maxLength: 12000,
        placeholder: t("admin.memberList.broadcastBodyPh", "內文（純文字）…"),
      });

      const sendConfirmCb = el("input", { type: "checkbox" }) as HTMLInputElement;
      const sendConfirmText = el("span", {});
      const sendConfirmLabel = el("label", { class: "admin-member-broadcast-check" });
      sendConfirmLabel.append(sendConfirmCb, document.createTextNode(" "), sendConfirmText);

      const previewBtn = el("button", { class: "ghost", type: "button" }, [
        t("admin.memberList.broadcastPreview", "預覽收件人數"),
      ]);
      const sendBtn = el("button", { class: "primary", type: "button" }, [
        t("admin.memberList.broadcastSend", "寄出群發信"),
      ]);
      sendBtn.setAttribute("disabled", "true");
      const closeBtn = el("button", { class: "ghost", type: "button" }, [t("modal.close", "關閉")]);
      const actions = el("div", { class: "modal-actions" }, [closeBtn, previewBtn, sendBtn]);
      const modalStatus = el("div", { class: "status-line" });

      let mode: "broadcast" | "direct" = initialMode;
      let previewOk = false;

      function refreshSendConfirmLabel() {
        sendConfirmText.textContent = t(
                "admin.memberList.emailSendConfirmBroadcast",
                "我確認主旨、內文正確，且已按「預覽收件人數」確認收件範圍無誤，要實際寄出",
        );
      }

      function directFieldsReadyForSend(): boolean {
        const targetOk = memberTargetInput.value.trim().length > 0;
        const subOk = subjectInput.value.trim().length > 0;
        const bodyOk = bodyTa.value.trim().length >= 3;
        return targetOk && subOk && bodyOk;
      }

      function syncSendEnabled() {
        if (mode === "broadcast") {
          if (previewOk && sendConfirmCb.checked) sendBtn.removeAttribute("disabled");
          else sendBtn.setAttribute("disabled", "true");
        } else if (directFieldsReadyForSend()) sendBtn.removeAttribute("disabled");
        else sendBtn.setAttribute("disabled", "true");
      }

      function refreshHeading() {
        heading.textContent =
          mode === "broadcast"
            ? t("admin.memberList.broadcastModalTitle", "寄信給會員（群發）")
            : t("admin.memberList.directEmailModalTitle", "寄信給單一會員（已驗證）");
      }

      function refreshSendBtnLabel() {
        sendBtn.textContent =
          mode === "broadcast"
            ? t("admin.memberList.broadcastSend", "寄出群發信")
            : t("admin.memberList.directEmailSend", "寄出一封信");
      }

      function setMode(next: "broadcast" | "direct") {
        mode = next;
        tabBroadcast.setAttribute("aria-selected", next === "broadcast" ? "true" : "false");
        tabDirect.setAttribute("aria-selected", next === "direct" ? "true" : "false");
        tabBroadcast.classList.toggle("is-active", next === "broadcast");
        tabDirect.classList.toggle("is-active", next === "direct");
        paneBroadcast.hidden = next !== "broadcast";
        paneDirect.hidden = next !== "direct";
        previewBtn.hidden = next !== "broadcast";
        sendConfirmLabel.hidden = next !== "broadcast";
        previewOk = false;
        sendConfirmCb.checked = false;
        refreshSendConfirmLabel();
        refreshHeading();
        refreshSendBtnLabel();
        modalStatus.textContent = "";
        modalStatus.className = "status-line";
        syncSendEnabled();
      }

      function invalidateBroadcastPreview() {
        previewOk = false;
        syncSendEnabled();
      }
      async function runDirectTargetMemberSearch() {
        const q = memberTargetInput.value.trim();
        if (q.length < 2) {
          directTargetSuggestions.hidden = true;
          directTargetSuggestions.innerHTML = "";
          return;
        }
        try {
          const fn = searchMemberUsersCall();
          const res = await fn({ prefix: q, ...localeApiParam() });
          const users = (res.data as { users?: { uid: string; email: string }[] }).users ?? [];
          directTargetSuggestions.innerHTML = "";
          if (users.length === 0) {
            directTargetSuggestions.hidden = true;
            return;
          }
          for (const u of users) {
            const li = el("li", { class: "member-typeahead-item", role: "option" }, [u.email]);
            li.addEventListener("mousedown", (ev) => {
              ev.preventDefault();
              memberTargetInput.value = u.email;
              directTargetSuggestions.hidden = true;
              directTargetSuggestions.innerHTML = "";
              syncSendEnabled();
            });
            directTargetSuggestions.append(li);
          }
          directTargetSuggestions.hidden = false;
        } catch {
          directTargetSuggestions.hidden = true;
        }
      }

      tabBroadcast.addEventListener("click", () => setMode("broadcast"));
      tabDirect.addEventListener("click", () => setMode("direct"));

      sendConfirmCb.addEventListener("change", syncSendEnabled);
      subjectInput.addEventListener("input", () => {
        invalidateBroadcastPreview();
        syncSendEnabled();
      });
      bodyTa.addEventListener("input", () => {
        invalidateBroadcastPreview();
        syncSendEnabled();
      });
      memberTargetInput.addEventListener("input", () => {
        syncSendEnabled();
        const raw = memberTargetInput.value.trim();
        if (raw.length < 2) {
          directTargetSuggestions.hidden = true;
          directTargetSuggestions.innerHTML = "";
          return;
        }
        if (directTargetSearchTimer) clearTimeout(directTargetSearchTimer);
        directTargetSearchTimer = setTimeout(() => void runDirectTargetMemberSearch(), 280);
      });
      memberTargetInput.addEventListener("focus", () => {
        void runDirectTargetMemberSearch();
      });
      memberTargetInput.addEventListener("blur", () => {
        setTimeout(() => {
          directTargetSuggestions.hidden = true;
        }, 200);
      });

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
      closeBtn.addEventListener("click", dismiss);
      overlay.addEventListener("click", (ev) => {
        if (ev.target === overlay) dismiss();
      });
      document.addEventListener("keydown", onKeyDown);

      previewBtn.addEventListener("click", async () => {
        modalStatus.textContent = "";
        modalStatus.className = "status-line";
        previewBtn.setAttribute("disabled", "true");
        previewOk = false;
        syncSendEnabled();
        try {
          const fn = sendMembersBroadcastAdminCall();
          const res = await fn({
            subject: subjectInput.value,
            body: bodyTa.value,
            dryRun: true,
            ...localeApiParam(),
          });
          const d = res.data as {
            recipientCount?: number;
            totalUsers?: number;
            withoutEmail?: number;
            disabledSkipped?: number;
            unverifiedSkipped?: number;
            duplicateSkipped?: number;
          };
          previewOk = true;
          syncSendEnabled();
          modalStatus.className = "status-line ok";
          modalStatus.textContent = t(
            "admin.memberList.broadcastPreviewOk",
            "預覽：將寄給 {{recipients}} 人（Auth 使用者共 {{total}}；無信箱 {{noEmail}}、停權 {{disabled}}、未驗證略過 {{unver}}、重複信箱 {{dup}}）。",
            {
              recipients: typeof d.recipientCount === "number" ? d.recipientCount : "—",
              total: typeof d.totalUsers === "number" ? d.totalUsers : "—",
              noEmail: typeof d.withoutEmail === "number" ? d.withoutEmail : "—",
              disabled: typeof d.disabledSkipped === "number" ? d.disabledSkipped : "—",
              unver: typeof d.unverifiedSkipped === "number" ? d.unverifiedSkipped : "—",
              dup: typeof d.duplicateSkipped === "number" ? d.duplicateSkipped : "—",
            },
          );
        } catch (e) {
          modalStatus.className = "status-line error";
          modalStatus.textContent = errorMessage(e);
        } finally {
          previewBtn.removeAttribute("disabled");
        }
      });

      sendBtn.addEventListener("click", async () => {
        if (mode === "broadcast") {
          if (!previewOk || !sendConfirmCb.checked) return;
          const nLine = modalStatus.textContent || "";
          const ok = await showConfirmModal(
            t("admin.memberList.broadcastSendConfirmTitle", "確認群發郵件"),
            t(
              "admin.memberList.broadcastSendConfirmBody",
              "將依目前主旨與內文，對預覽統計中的每位收件人各寄一封（無法撤回）。\n\n{{previewLine}}",
              { previewLine: nLine || "（請先按「預覽收件人數」）" },
            ),
            t("admin.memberList.broadcastSendConfirmOk", "確定寄出"),
          );
          if (!ok) return;

          modalStatus.textContent = t("admin.memberList.broadcastSending", "寄送中，請稍候…");
          modalStatus.className = "status-line";
          sendBtn.setAttribute("disabled", "true");
          previewBtn.setAttribute("disabled", "true");
          closeBtn.setAttribute("disabled", "true");
          subjectInput.setAttribute("disabled", "true");
          bodyTa.setAttribute("disabled", "true");
          sendConfirmCb.setAttribute("disabled", "true");
          tabBroadcast.setAttribute("disabled", "true");
          tabDirect.setAttribute("disabled", "true");
          memberTargetInput.setAttribute("disabled", "true");
          try {
            const fn = sendMembersBroadcastAdminCall();
            const res = await fn({
              subject: subjectInput.value,
              body: bodyTa.value,
              confirmSend: true,
              dryRun: false,
              ...localeApiParam(),
            });
            const d = res.data as {
              sent?: number;
              recipientCount?: number;
              failed?: { email: string; error: string }[];
              deliverabilityWarning?: string;
            };
            const sent = typeof d.sent === "number" ? d.sent : 0;
            const total = typeof d.recipientCount === "number" ? d.recipientCount : sent;
            const failed = Array.isArray(d.failed) ? d.failed : [];
            const lines = [
              t("admin.memberList.broadcastDoneHead", "寄送完成：成功 {{sent}} / {{total}} 封。", {
                sent,
                total,
              }),
            ];
            if (failed.length > 0) {
              lines.push(
                t("admin.memberList.broadcastFailedHead", "失敗 {{n}} 筆（節錄）：", { n: failed.length }),
                ...failed.slice(0, 12).map((f) => `${f.email}: ${f.error}`),
              );
              if (failed.length > 12) lines.push("…");
            }
            if (typeof d.deliverabilityWarning === "string" && d.deliverabilityWarning.trim()) {
              lines.push("", d.deliverabilityWarning.trim());
            }
            dismiss();
            memberListStatus.className = "status-line ok admin-member-broadcast-summary";
            memberListStatus.textContent = lines.join("\n");
          } catch (e) {
            modalStatus.className = "status-line error";
            modalStatus.textContent = errorMessage(e);
          } finally {
            sendBtn.removeAttribute("disabled");
            previewBtn.removeAttribute("disabled");
            closeBtn.removeAttribute("disabled");
            subjectInput.removeAttribute("disabled");
            bodyTa.removeAttribute("disabled");
            sendConfirmCb.removeAttribute("disabled");
            tabBroadcast.removeAttribute("disabled");
            tabDirect.removeAttribute("disabled");
            memberTargetInput.removeAttribute("disabled");
            syncSendEnabled();
          }
          return;
        }

        if (!directFieldsReadyForSend()) return;
        const targetLine = memberTargetInput.value.trim();
        const subLine = subjectInput.value.trim();
        const ok = await showConfirmModal(
          t("admin.memberList.directEmailSendConfirmTitle", "確認寄出單筆郵件"),
          t(
            "admin.memberList.directEmailSendConfirmBody",
            "將寄出一封自訂郵件至已驗證對象（無法撤回）。\n\n收件：{{target}}\n主旨：{{subject}}",
            { target: targetLine, subject: subLine },
          ),
          t("admin.memberList.broadcastSendConfirmOk", "確定寄出"),
        );
        if (!ok) return;

        modalStatus.textContent = t("admin.memberList.directEmailSending", "寄送中…");
        modalStatus.className = "status-line";
        sendBtn.setAttribute("disabled", "true");
        previewBtn.setAttribute("disabled", "true");
        closeBtn.setAttribute("disabled", "true");
        memberTargetInput.setAttribute("disabled", "true");
        subjectInput.setAttribute("disabled", "true");
        bodyTa.setAttribute("disabled", "true");
        sendConfirmCb.setAttribute("disabled", "true");
        tabBroadcast.setAttribute("disabled", "true");
        tabDirect.setAttribute("disabled", "true");
        try {
          const fn = sendMemberDirectEmailAdminCall();
          const res = await fn({
            memberTarget: memberTargetInput.value,
            subject: subjectInput.value,
            body: bodyTa.value,
            confirmSend: true,
            dryRun: false,
            ...localeApiParam(),
          });
          const d = res.data as { email?: string; deliverabilityWarning?: string };
          const lines = [
            t("admin.memberList.directEmailDone", "已寄出 1 封至 {{email}}。", {
              email: typeof d.email === "string" ? d.email : "",
            }),
          ];
          if (typeof d.deliverabilityWarning === "string" && d.deliverabilityWarning.trim()) {
            lines.push("", d.deliverabilityWarning.trim());
          }
          dismiss();
          memberListStatus.className = "status-line ok admin-member-broadcast-summary";
          memberListStatus.textContent = lines.join("\n");
        } catch (e) {
          modalStatus.className = "status-line error";
          modalStatus.textContent = errorMessage(e);
        } finally {
          sendBtn.removeAttribute("disabled");
          previewBtn.removeAttribute("disabled");
          closeBtn.removeAttribute("disabled");
          memberTargetInput.removeAttribute("disabled");
          subjectInput.removeAttribute("disabled");
          bodyTa.removeAttribute("disabled");
          sendConfirmCb.removeAttribute("disabled");
          tabBroadcast.removeAttribute("disabled");
          tabDirect.removeAttribute("disabled");
          syncSendEnabled();
        }
      });

      dialog.append(
        heading,
        tabRow,
        paneBroadcast,
        paneDirect,
        el("label", { class: "field" }, [t("admin.memberList.broadcastSubjectLabel", "主旨"), subjectInput]),
        el("label", { class: "field" }, [t("admin.memberList.broadcastBodyLabel", "內文（純文字）"), bodyTa]),
        sendConfirmLabel,
        modalStatus,
        actions,
      );
      overlay.append(dialog);
      document.body.append(overlay);
      setMode(initialMode);
      if (initialMode === "direct") memberTargetInput.focus();
      else subjectInput.focus();
    }

    memberListEmailBtn.addEventListener("click", () => {
      openMemberEmailModal("broadcast");
    });

    memberListSection.append(
      el("h3", {}, [t("admin.memberList.title", "會員清單")]),
      el("div", { class: "row-actions" }, [memberListRefreshBtn, memberListEmailBtn]),
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

    subTabMemberList.setAttribute("aria-controls", "admin-member-subpanel-list");
    subTabMemberWallet.setAttribute("aria-controls", "admin-member-subpanel-wallet");

    const membersSubTablist = el("div", { class: "admin-tabs admin-member-subtabs", role: "tablist" });
    membersSubTablist.append(subTabMemberList, subTabMemberWallet);
    const membersSubPanelsWrap = el("div", { class: "admin-member-subpanels" });
    membersSubPanelsWrap.append(panelMemberListSub, panelMemberWalletSub);

    const memberSubTabButtons = [subTabMemberList, subTabMemberWallet] as const;
    const memberSubTabPanels = [panelMemberListSub, panelMemberWalletSub] as const;

    function selectMembersSubTab(index: 0 | 1) {
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

    membersSubTablist.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      ev.preventDefault();
      const cur = memberSubTabButtons.findIndex((b) => b.getAttribute("aria-selected") === "true");
      if (cur < 0) return;
      const delta = ev.key === "ArrowRight" ? 1 : -1;
      const n = memberSubTabButtons.length;
      const next = ((cur + delta) % n + n) % n;
      selectMembersSubTab(next as 0 | 1);
      memberSubTabButtons[next].focus();
    });

    selectMembersSubTab(0);

    const tabBookingsHub = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.bookingsHub", "預約與封存"),
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

    const subBookingsActive = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.bookings", "預約管理"),
    ]);
    subBookingsActive.id = "admin-bookings-subtab-active";
    const subBookingsArchived = el("button", { type: "button", class: "admin-tab", role: "tab" }, [
      t("admin.tab.hidden", "封存的預約"),
    ]);
    subBookingsArchived.id = "admin-bookings-subtab-archived";

    const panelBookingsActiveSub = el("div", {
      class: "admin-tab-panel admin-member-subpanel",
      role: "tabpanel",
      id: "admin-bookings-subpanel-active",
    });
    panelBookingsActiveSub.setAttribute("aria-labelledby", "admin-bookings-subtab-active");
    const panelBookingsArchivedSub = el("div", {
      class: "admin-tab-panel admin-member-subpanel",
      role: "tabpanel",
      id: "admin-bookings-subpanel-archived",
      hidden: true,
    });
    panelBookingsArchivedSub.setAttribute("aria-labelledby", "admin-bookings-subtab-archived");
    panelBookingsArchivedSub.append(hiddenBookingsStatus, hiddenTableHolder, hiddenPager);

    subBookingsActive.setAttribute("aria-controls", "admin-bookings-subpanel-active");
    subBookingsArchived.setAttribute("aria-controls", "admin-bookings-subpanel-archived");
    const bookingsSubTablist = el("div", { class: "admin-tabs admin-member-subtabs", role: "tablist" });
    bookingsSubTablist.append(subBookingsActive, subBookingsArchived);
    const bookingsSubPanelsWrap = el("div", { class: "admin-member-subpanels" });
    bookingsSubPanelsWrap.append(panelBookingsActiveSub, panelBookingsArchivedSub);

    const bookingsSubTabButtons = [subBookingsActive, subBookingsArchived] as const;
    const bookingsSubTabPanels = [panelBookingsActiveSub, panelBookingsArchivedSub] as const;

    function selectBookingsSubTab(index: 0 | 1) {
      bookingsSubTabButtons.forEach((btn, i) => {
        const on = i === index;
        btn.setAttribute("aria-selected", String(on));
        btn.classList.toggle("is-active", on);
        btn.tabIndex = on ? 0 : -1;
      });
      bookingsSubTabPanels.forEach((panel, i) => {
        panel.hidden = i !== index;
        panel.classList.toggle("is-active", i === index);
      });
    }

    subBookingsActive.addEventListener("click", () => selectBookingsSubTab(0));
    subBookingsArchived.addEventListener("click", () => selectBookingsSubTab(1));
    bookingsSubTablist.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      ev.preventDefault();
      const cur = bookingsSubTabButtons.findIndex((b) => b.getAttribute("aria-selected") === "true");
      if (cur < 0) return;
      const delta = ev.key === "ArrowRight" ? 1 : -1;
      const n = bookingsSubTabButtons.length;
      const next = ((cur + delta) % n + n) % n;
      selectBookingsSubTab(next as 0 | 1);
      bookingsSubTabButtons[next].focus();
    });
    selectBookingsSubTab(0);

    const panelBookingsHubEl = el("div", {
      class: "admin-tab-panel",
      role: "tabpanel",
      id: "admin-tab-panel-bookings-hub",
    });
    panelBookingsHubEl.setAttribute("aria-labelledby", "admin-tab-trigger-bookings-hub");
    panelBookingsHubEl.append(bookingsSubTablist, bookingsSubPanelsWrap);

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

    panelBookingsActiveSub.append(adminBookingsCalendarSection, adminStatus, tableHolder);
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

    const HIDDEN_ADMIN_PAGE_SIZE = 5;
    let hiddenAdminPageIndex = 0;
    type AdminHiddenQueueItem = { kind: "deleted" | "invisible"; b: Booking };
    const hiddenAdminQueue: AdminHiddenQueueItem[] = [];

    function appendHiddenDeletedRowAdmin(b: Booking) {
      const cid = typeof b.customerId === "string" ? b.customerId.trim() : "";
      hiddenTable.append(
        el("tr", {}, [
          el("td", { class: "mono" }, adminWhenCellParts(b)),
          el("td", {}, [b.displayName ?? ""]),
          el("td", {}, [bookingMemberYesNo(b)]),
          el("td", {}, [b.note ?? ""]),
          createAdminBookingBriefCell(cid || null, cid ? adminBriefByCustomerId[cid] : undefined, openMemberCustomerProfile),
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
          hiddenBookingsStatus.textContent = t("admin.status.updating", "更新中…");
          hiddenBookingsStatus.className = "status-line";
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
            hiddenBookingsStatus.textContent = t("admin.status.updated", "已更新");
            hiddenBookingsStatus.classList.add("ok");
            if (nextStatus === "done") {
              await refreshWalletStatus({ keepWalletSummaryDuringFetch: true });
            }
          } catch (e) {
            sel.value = adminSelectableBookingStatus(prevStatus);
            hiddenBookingsStatus.textContent = adminBookingStatusUpdateError(e);
            hiddenBookingsStatus.classList.add("error");
          }
        });
      }
      const cancelBtn = el("button", { class: "ghost", type: "button" }, [t("admin.booking.cancel", "取消")]);
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
          await refreshWalletStatus({ keepWalletSummaryDuringFetch: true });
        } catch (e) {
          hiddenBookingsStatus.textContent = e instanceof Error ? e.message : t("admin.status.cancelFail", "取消失敗");
          hiddenBookingsStatus.classList.add("error");
          cancelBtn.removeAttribute("disabled");
        }
      });
      const unhideBtn = el("button", { class: "ghost", type: "button" }, [t("admin.hidden.unhide", "取消封存")]);
      unhideBtn.addEventListener("click", async () => {
        hiddenBookingsStatus.textContent = t("admin.status.processing", "處理中…");
        hiddenBookingsStatus.className = "status-line";
        unhideBtn.setAttribute("disabled", "true");
        try {
          await updateDoc(doc(db, "bookings", b.id), {
            invisible: false,
            updatedAt: serverTimestamp(),
          });
          hiddenBookingsStatus.textContent = t("admin.status.unhidden", "已取消封存並回到預約管理主列表");
          hiddenBookingsStatus.classList.add("ok");
        } catch (e) {
          hiddenBookingsStatus.textContent =
            e instanceof Error ? e.message : t("admin.status.unhideFail", "取消封存失敗（你是否已加入 admins 集合？）");
          hiddenBookingsStatus.classList.add("error");
          unhideBtn.removeAttribute("disabled");
        }
      });
      const actionCell = el("div", { class: "admin-booking-actions" }, [cancelBtn, unhideBtn]);
      const cidHidden = typeof b.customerId === "string" ? b.customerId.trim() : "";
      hiddenTable.append(
        el("tr", {}, [
          el("td", { class: "mono" }, adminWhenCellParts(b)),
          el("td", {}, [b.displayName ?? ""]),
          el("td", {}, [bookingMemberYesNo(b)]),
          el("td", {}, [b.note ?? ""]),
          createAdminBookingBriefCell(
            cidHidden || null,
            cidHidden ? adminBriefByCustomerId[cidHidden] : undefined,
            openMemberCustomerProfile,
          ),
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
            el("td", { class: "hint", colSpan: 7 }, [t("admin.hidden.empty", "目前沒有封存中的預約，也沒有舊版已刪除資料。")]),
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
        adminStatus.textContent = "";
        adminStatus.className = "status-line";
        hiddenBookingsStatus.textContent = "";
        hiddenBookingsStatus.className = "status-line";
        table.innerHTML = "";
        table.append(adminBookingsHeaderRow());
        hiddenTable.innerHTML = "";
        hiddenTable.append(adminBookingsHeaderRow());
        hiddenAdminQueue.length = 0;
        const bookingsForAdminCalendar: Booking[] = [];
        for (const d of snap.docs) {
          const b = { id: d.id, ...d.data() } as Booking;
          if (b.status !== "deleted") {
            bookingsForAdminCalendar.push(b);
          }
          if (b.status === "deleted" || b.invisible === true) {
            hiddenAdminQueue.push(
              b.status === "deleted" ? { kind: "deleted", b } : { kind: "invisible", b },
            );
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
          const cancelBtn = el("button", { class: "ghost", type: "button" }, [t("admin.booking.cancel", "取消")]);
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
          const archiveBtn = el("button", { class: "ghost", type: "button" }, [t("admin.booking.hide", "封存")]);
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
                "確定將此筆預約從後台主列表封存嗎？\n\n（僅限已取消或已完成之預約。不改變預約狀態；會員端仍顯示原狀態。額度與可預約時段仍依預約狀態計算，與主列表邏輯相同。封存後可至「預約與封存」內「封存的預約」子分頁取消封存。）\n\n姓名：{{name}}\n日期：{{date}}\n開始時間：{{start}}",
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
              adminStatus.textContent = t("admin.status.hidden", "已封存（可至「預約與封存」→「封存的預約」查看）");
              adminStatus.classList.add("ok");
            } catch (e) {
              adminStatus.textContent =
                e instanceof Error ? e.message : t("admin.status.hideFail", "封存失敗（你是否已加入 admins 集合？）");
              adminStatus.classList.add("error");
              archiveBtn.removeAttribute("disabled");
            }
          });
          const actionCell = el("div", { class: "admin-booking-actions" }, [cancelBtn, archiveBtn]);
          const cid = typeof b.customerId === "string" ? b.customerId.trim() : "";
          table.append(
            el("tr", {}, [
              el("td", { class: "mono" }, adminWhenCellParts(b)),
              el("td", {}, [b.displayName ?? ""]),
              el("td", {}, [bookingMemberYesNo(b)]),
              el("td", {}, [b.note ?? ""]),
              createAdminBookingBriefCell(cid || null, cid ? adminBriefByCustomerId[cid] : undefined, openMemberCustomerProfile),
              el("td", {}, [statusCell]),
              el("td", {}, [actionCell]),
            ]),
          );
        }
        adminCalendarLastVisible = bookingsForAdminCalendar;
        const allForBriefs = [
          ...bookingsForAdminCalendar,
          ...hiddenAdminQueue.filter((item) => item.kind === "deleted").map((item) => item.b),
        ];
        void refreshAdminBookingBriefsForBookings(allForBriefs);
        paintAdminBookingsCalendar();
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

