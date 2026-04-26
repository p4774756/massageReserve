import { collection, doc, getDoc, getDocs, type Firestore } from "firebase/firestore";
import type { ReportChartRegistry } from "./adminReportCharts";
import { intlLocaleTag, t } from "./i18n";

export type ReportBookingRow = {
  dateKey?: string;
  weekStart?: string;
  status?: string;
  bookingMode?: string;
  invisible?: boolean;
};

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

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString(intlLocaleTag());
}

function fmtAvg(n: number): string {
  return n.toLocaleString(intlLocaleTag(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function taipeiTodayDateKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function taipeiWeekdayNumMon1Sun7(dateKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return Number.NaN;
  const inst = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
  const long = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "long" }).format(inst);
  const map: Record<string, number> = {
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
    Sunday: 7,
  };
  return map[long] ?? Number.NaN;
}

function addDaysTaipeiDateKey(dateKey: string, deltaDays: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return dateKey;
  const inst = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00+08:00`);
  inst.setTime(inst.getTime() + deltaDays * 86_400_000);
  return inst.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

function taipeiMondayOfSameWeek(dateKey: string): string {
  const wd = taipeiWeekdayNumMon1Sun7(dateKey);
  if (!Number.isFinite(wd)) return dateKey;
  return addDaysTaipeiDateKey(dateKey, -(wd - 1));
}

function isMainListBooking(b: ReportBookingRow): boolean {
  return b.status !== "deleted" && b.invisible !== true;
}

function countByStatus(bookings: ReportBookingRow[], pred: (b: ReportBookingRow) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bookings) {
    if (!pred(b)) continue;
    const s = typeof b.status === "string" ? b.status : "（未標記）";
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}

function countByMode(bookings: ReportBookingRow[], pred: (b: ReportBookingRow) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bookings) {
    if (!pred(b)) continue;
    const m = typeof b.bookingMode === "string" && b.bookingMode ? b.bookingMode : "（未標記）";
    out[m] = (out[m] ?? 0) + 1;
  }
  return out;
}

function bookingStatusLabel(key: string): string {
  switch (key) {
    case "pending":
      return t("status.pending", "待確認");
    case "confirmed":
      return t("status.confirmed", "已確認");
    case "done":
      return t("status.done", "已完成");
    case "cancelled":
      return t("status.cancelled", "已取消");
    case "deleted":
      return t("status.deleted", "已刪除");
    default:
      return key;
  }
}

function paymentModeLabel(modeKey: string): string {
  return t(`booking.mode.${modeKey}`, modeKey);
}

function statCard(label: string, value: string): HTMLElement {
  return el("div", { class: "admin-report-card" }, [
    el("div", { class: "admin-report-card__label" }, [label]),
    el("div", { class: "admin-report-card__value" }, [value]),
  ]);
}

export function mountAdminReportsPanel(
  db: Firestore,
  getBookings: () => ReportBookingRow[],
): { root: HTMLElement; refresh: () => Promise<void> } {
  const statusLine = el("p", { class: "status-line" }, []);
  const updatedAt = el("span", { class: "admin-reports__updated hint" }, []);
  const grid = el("div", { class: "admin-reports__grid" }, []);
  const donutRow = el("div", { class: "admin-reports__donut-row" });
  const barRow = el("div", { class: "admin-reports__bar-row" });
  const polarWrap = el("div", { class: "admin-reports__polar-wrap" });
  const flashCharts = el("div", { class: "admin-reports__flash" }, [donutRow, barRow, polarWrap]);

  const chartReg: ReportChartRegistry = { charts: [] };

  const refreshBtn = el("button", { type: "button", class: "ghost" }, [
    t("admin.reports.refresh", "重新整理報表"),
  ]);

  const toolbar = el("div", { class: "admin-reports__toolbar row-actions" }, [refreshBtn, updatedAt]);

  const root = el("div", { class: "admin-reports" }, [
    el("p", { class: "hint" }, [
      t(
        "admin.reports.intro",
        "預約數字與「預約管理」分頁相同資料來源（即時快照）；訪次、心得與客服為額外讀取。下方圖表使用 Chart.js（切換至此分頁時才載入圖表程式）。若剛進後台，請待列表載入後再按重新整理。",
      ),
    ]),
    toolbar,
    statusLine,
    grid,
    flashCharts,
  ]);

  async function refresh(): Promise<void> {
    statusLine.textContent = t("admin.reports.loading", "彙整中…");
    statusLine.className = "status-line";
    grid.replaceChildren();

    const chartMod = await import("./adminReportCharts");
    chartMod.destroyReportCharts(chartReg);

    const today = taipeiTodayDateKey();
    const weekStart = taipeiMondayOfSameWeek(today);
    const monthPrefix = today.slice(0, 7);
    const bookings = getBookings();

    const total = bookings.length;
    const mainList = bookings.filter(isMainListBooking);
    const hiddenOrDeleted = total - mainList.length;

    const notDeleted = (b: ReportBookingRow) => b.status !== "deleted";

    const todayBookings = bookings.filter((b) => b.dateKey === today);
    const weekBookings = bookings.filter((b) => b.weekStart === weekStart);
    const monthBookings = bookings.filter((b) => typeof b.dateKey === "string" && b.dateKey.startsWith(monthPrefix));

    refreshBtn.setAttribute("disabled", "true");

    try {
      const [visitorSnap, guestSnap, threadSnap] = await Promise.all([
        getDoc(doc(db, "siteStats", "visitorCounters")),
        getDocs(collection(db, "guestbookPosts")),
        getDocs(collection(db, "supportThreads")),
      ]);

      let dayVisits = "—";
      let weekVisits = "—";
      let totalVisits = "—";
      let dayVisitsN = 0;
      let weekVisitsN = 0;
      let totalVisitsN = 0;
      if (visitorSnap.exists()) {
        const v = visitorSnap.data() as Record<string, unknown>;
        if (typeof v.dayVisits === "number") {
          dayVisitsN = v.dayVisits;
          dayVisits = fmtInt(v.dayVisits);
        }
        if (typeof v.weekVisits === "number") {
          weekVisitsN = v.weekVisits;
          weekVisits = fmtInt(v.weekVisits);
        }
        if (typeof v.totalVisits === "number") {
          totalVisitsN = v.totalVisits;
          totalVisits = fmtInt(v.totalVisits);
        }
      }

      const starCounts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
      let gbCount = 0;
      let gbSum = 0;
      for (const d of guestSnap.docs) {
        const r = d.data() as { rating?: unknown };
        if (typeof r.rating === "number" && Number.isFinite(r.rating)) {
          gbCount += 1;
          gbSum += r.rating;
          const ri = Math.round(r.rating);
          if (ri >= 1 && ri <= 5) starCounts[ri - 1] += 1;
        }
      }
      const gbAvg = gbCount > 0 ? fmtAvg(gbSum / gbCount) : "—";

      let thOpen = 0;
      let thClosed = 0;
      for (const d of threadSnap.docs) {
        const st = (d.data() as { status?: unknown }).status;
        if (st === "closed") thClosed += 1;
        else thOpen += 1;
      }

      grid.append(
        statCard(t("admin.reports.card.totalDocs", "預約文件總數"), fmtInt(total)),
        statCard(t("admin.reports.card.mainList", "主列表筆數"), fmtInt(mainList.length)),
        statCard(t("admin.reports.card.hiddenDeleted", "隱藏／已刪除"), fmtInt(hiddenOrDeleted)),
        statCard(t("admin.reports.card.todayBookings", "今日預約（曆日）"), fmtInt(todayBookings.length)),
        statCard(t("admin.reports.card.weekBookings", "本週預約（週一起算）"), fmtInt(weekBookings.length)),
        statCard(t("admin.reports.card.monthBookings", "本月預約"), fmtInt(monthBookings.length)),
        statCard(t("admin.reports.card.visitsToday", "網站訪次 · 今日"), dayVisits),
        statCard(t("admin.reports.card.visitsWeek", "網站訪次 · 本週"), weekVisits),
        statCard(t("admin.reports.card.visitsTotal", "網站訪次 · 累計"), totalVisits),
        statCard(t("admin.reports.card.guestbookCount", "心得則數"), fmtInt(gbCount)),
        statCard(t("admin.reports.card.guestbookAvg", "心得平均星等"), gbAvg),
        statCard(t("admin.reports.card.supportOpen", "客服對話 · 進行中"), fmtInt(thOpen)),
        statCard(t("admin.reports.card.supportClosed", "客服對話 · 已結束"), fmtInt(thClosed)),
      );

      const statusSorted = Object.entries(countByStatus(bookings, () => true)).sort((a, b) => b[1] - a[1]);
      const modeSorted = Object.entries(countByMode(bookings, notDeleted)).sort((a, b) => b[1] - a[1]);

      const starLabels: [string, string, string, string, string] = [
        t("admin.reports.chart.star1", "1 星"),
        t("admin.reports.chart.star2", "2 星"),
        t("admin.reports.chart.star3", "3 星"),
        t("admin.reports.chart.star4", "4 星"),
        t("admin.reports.chart.star5", "5 星"),
      ];

      await chartMod.renderFlashReportCharts(donutRow, barRow, polarWrap, chartReg, {
        statusLabels: statusSorted.map(([k]) => bookingStatusLabel(k)),
        statusValues: statusSorted.map(([, v]) => v),
        modeLabels: modeSorted.map(([k]) => paymentModeLabel(k)),
        modeValues: modeSorted.map(([, v]) => v),
        supportOpen: thOpen,
        supportClosed: thClosed,
        bookingBarLabels: [
          t("admin.reports.chart.labelToday", "今日"),
          t("admin.reports.chart.labelWeek", "本週"),
          t("admin.reports.chart.labelMonth", "本月"),
        ],
        bookingBarValues: [todayBookings.length, weekBookings.length, monthBookings.length],
        visitsBarLabels: [
          t("admin.reports.chart.labelToday", "今日"),
          t("admin.reports.chart.labelWeek", "本週"),
          t("admin.reports.chart.labelTotal", "累計"),
        ],
        visitsBarValues: [dayVisitsN, weekVisitsN, totalVisitsN],
        starLabels,
        starValues: [...starCounts],
      });

      statusLine.textContent = t("admin.reports.ok", "報表已更新。");
      statusLine.classList.add("ok");
      updatedAt.textContent = t("admin.reports.updatedAt", "更新時間：{{t}}", {
        t: new Date().toLocaleString(intlLocaleTag(), { timeZone: "Asia/Taipei" }),
      });
    } catch (e) {
      statusLine.textContent =
        e instanceof Error ? e.message : t("admin.reports.fail", "報表載入失敗（權限或網路問題）。");
      statusLine.classList.add("error");
    } finally {
      refreshBtn.removeAttribute("disabled");
    }
  }

  refreshBtn.addEventListener("click", () => {
    void refresh();
  });

  return { root, refresh };
}
