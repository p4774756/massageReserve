import { getConsumptionRankPublicCall } from "./firebase";
import { errorMessage } from "./errorUtil";
import { el } from "./domUtil";
import { localeApiParam, t } from "./i18n";
import { dateKeyLabelTaipei } from "./taipeiDates";

export type ConsumptionRankPeriod = "week" | "month";

export type ConsumptionRankRow = {
  displayName: string;
  bookingCount: number;
  cashNtd: number;
  sessions: number;
};

export type ConsumptionRankPanel = {
  root: HTMLElement;
  load: () => Promise<void>;
};

export function createConsumptionRankPanel(): ConsumptionRankPanel {
  let currentPeriod: ConsumptionRankPeriod = "week";
  let loading = false;

  const status = el("div", { class: "status-line consumption-rank__status" });
  const periodBar = el("div", { class: "consumption-rank__period", role: "tablist" });
  const tableWrap = el("div", { class: "table-wrap consumption-rank__table-wrap" });
  const table = el("table", { class: "consumption-rank__table" });
  tableWrap.append(table);

  const root = el("section", { class: "consumption-rank" }, [
    el("h2", { class: "consumption-rank__heading" }, [t("consumptionRank.heading", "消費排行")]),
    el("p", { class: "hint consumption-rank__lead" }, [
      t(
        "consumptionRank.lead",
        "依有效預約統計現金消費與扣次；不含已取消／已刪除。名稱略為遮罩。每月消費冠軍於次月 1 日贈送 1 次按摩。",
      ),
    ]),
    periodBar,
    status,
    tableWrap,
  ]);

  function paintPeriodButtons() {
    periodBar.replaceChildren();
    for (const period of ["week", "month"] as const) {
      const btn = el(
        "button",
        {
          type: "button",
          class: "ghost consumption-rank__period-btn",
          role: "tab",
        },
        [
          period === "week"
            ? t("consumptionRank.periodWeek", "本週")
            : t("consumptionRank.periodMonth", "本月"),
        ],
      );
      btn.setAttribute("aria-selected", String(period === currentPeriod));
      btn.addEventListener("click", () => {
        if (currentPeriod === period) return;
        currentPeriod = period;
        paintPeriodButtons();
        void load();
      });
      periodBar.append(btn);
    }
  }

  function paintTable(rows: ConsumptionRankRow[]) {
    table.replaceChildren();
    if (rows.length === 0) {
      tableWrap.hidden = true;
      return;
    }
    tableWrap.hidden = false;
    table.append(
      el("tr", {}, [
        el("th", { class: "consumption-rank__col-rank" }, [t("consumptionRank.colRank", "#")]),
        el("th", {}, [t("consumptionRank.colMember", "會員")]),
        el("th", {}, [t("consumptionRank.colCash", "現金（元）")]),
        el("th", {}, [t("consumptionRank.colSessions", "扣次")]),
        el("th", {}, [t("consumptionRank.colCount", "預約")]),
      ]),
    );
    rows.forEach((row, index) => {
      table.append(
        el("tr", {}, [
          el("td", { class: "mono consumption-rank__col-rank" }, [String(index + 1)]),
          el("td", {}, [row.displayName]),
          el("td", { class: "mono" }, [row.cashNtd > 0 ? String(row.cashNtd) : "—"]),
          el("td", { class: "mono" }, [row.sessions > 0 ? String(row.sessions) : "—"]),
          el("td", { class: "mono" }, [String(row.bookingCount)]),
        ]),
      );
    });
  }

  async function load() {
    if (loading) return;
    loading = true;
    status.textContent = t("consumptionRank.loading", "載入中…");
    status.className = "status-line consumption-rank__status";
    try {
      const fn = getConsumptionRankPublicCall();
      const res = await fn({ period: currentPeriod, ...localeApiParam() });
      const data = res.data as {
        dateFrom?: string;
        dateTo?: string;
        rows?: ConsumptionRankRow[];
        truncated?: boolean;
      };
      const rows = Array.isArray(data.rows) ? data.rows : [];
      paintTable(rows);
      const range =
        data.dateFrom && data.dateTo
          ? t("consumptionRank.range", "{{from}} ～ {{to}}", {
              from: dateKeyLabelTaipei(data.dateFrom),
              to: dateKeyLabelTaipei(data.dateTo),
            })
          : "";
      const parts: string[] = [];
      if (range) parts.push(range);
      if (rows.length === 0) {
        parts.push(t("consumptionRank.empty", "尚無排行資料。"));
      } else if (data.truncated) {
        parts.push(t("consumptionRank.truncated", "資料量較大，排行可能不完整。"));
      }
      status.textContent = parts.join(" · ");
      if (rows.length > 0) status.classList.add("ok");
    } catch (e) {
      paintTable([]);
      status.textContent = errorMessage(e);
      status.classList.add("error");
    } finally {
      loading = false;
    }
  }

  paintPeriodButtons();

  return { root, load };
}
