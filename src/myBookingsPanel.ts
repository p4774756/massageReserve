import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { cancelBookingCall, getDb } from "./firebase";
import { bookingStartMs, bookingStatusLabel, formatWhen, isMyBookingUpcomingTab } from "./bookingDisplay";
import type { Booking } from "./bookingTypes";
import { myBookingReasonBlock } from "./bookingSummary";
import { el } from "./domUtil";
import { localeApiParam, t } from "./i18n";
import { showConfirmModal } from "./modals";

export type MyBookingsPanelOptions = {
  /** 會員成功取消預約後（例如重新整理錢包／次數） */
  afterCancelSuccess: () => void | Promise<void>;
};

export type MyBookingsPanel = {
  root: HTMLElement;
  stopMyBookingsListener: () => void;
  ensureMyBookingsListener: (customerUid: string) => void;
};

export function createMyBookingsPanel(options: MyBookingsPanelOptions): MyBookingsPanel {
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

  myBookingsSection.append(myBookingsTabList, myBookingsHint, myBookingsPanelUpcoming, myBookingsPanelEnded);

  function appendMyBookingRow(list: HTMLElement, b: Booking) {
    const canCancel = b.status === "pending" || b.status === "confirmed";
    const row = el("div", { class: "my-booking-row" }, []);
    const mainCol = el("div", { class: "my-booking-main" }, []);
    const whenWrap = el("div", { class: "my-booking-when-block" }, [
      el("div", { class: "mono my-booking-when" }, [formatWhen(b)]),
    ]);
    if (b.holidayOutcall === true) {
      whenWrap.append(
        el("div", { class: "my-booking-kind-tag" }, [t("booking.kind.holidayOutcallShort", "假日外約")]),
      );
    }
    mainCol.append(
      whenWrap,
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
          await options.afterCancelSuccess();
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

        if (upcoming.length > 0) {
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

  return {
    root: myBookingsSection,
    stopMyBookingsListener,
    ensureMyBookingsListener,
  };
}
