import type { ChartConfiguration } from "chart.js";
import { Chart } from "chart.js/auto";
import { intlLocaleTag, t } from "./i18n";

/** 炫彩調色盤（甜甜圈／長條／極區共用） */
const PALETTE = [
  "#6366f1",
  "#8b5cf6",
  "#d946ef",
  "#f43f5e",
  "#fb7185",
  "#fb923c",
  "#fbbf24",
  "#a3e635",
  "#34d399",
  "#22d3ee",
  "#38bdf8",
  "#818cf8",
];

function pickColors(n: number): string[] {
  return Array.from({ length: n }, (_, i) => PALETTE[i % PALETTE.length]!);
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString(intlLocaleTag());
}

function chartFontFamily(): string {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--font").trim();
    return raw.length > 0 ? raw : "system-ui, sans-serif";
  } catch {
    return "system-ui, sans-serif";
  }
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

export type ReportChartRegistry = { charts: Chart[] };

export function destroyReportCharts(reg: ReportChartRegistry): void {
  for (const c of reg.charts) {
    try {
      c.destroy();
    } catch {
      /* ignore */
    }
  }
  reg.charts.length = 0;
}

function chartCard(title: string): { card: HTMLElement; body: HTMLElement } {
  const card = el("div", { class: "admin-report-chart-card" }, [
    el("h5", { class: "admin-report-chart-card__title" }, [title]),
  ]);
  const body = el("div", { class: "admin-report-chart-card__body" });
  card.append(body);
  return { card, body };
}

function pushChart(reg: ReportChartRegistry, chart: Chart): void {
  reg.charts.push(chart);
}

const anim = { duration: 900, easing: "easeOutQuart" as const };

export type FlashChartsInput = {
  statusLabels: string[];
  statusValues: number[];
  modeLabels: string[];
  modeValues: number[];
  supportOpen: number;
  supportClosed: number;
  bookingBarLabels: string[];
  bookingBarValues: number[];
  visitsBarLabels: string[];
  visitsBarValues: number[];
  starLabels: string[];
  starValues: number[];
};

export async function renderFlashReportCharts(
  donutRow: HTMLElement,
  barRow: HTMLElement,
  polarWrap: HTMLElement,
  reg: ReportChartRegistry,
  data: FlashChartsInput,
): Promise<void> {
  donutRow.replaceChildren();
  barRow.replaceChildren();
  polarWrap.replaceChildren();

  function addDoughnut(parent: HTMLElement, title: string, labels: string[], values: number[], emptyHint: string) {
    const { card, body } = chartCard(title);
    parent.append(card);
    const sum = values.reduce((a, b) => a + b, 0);
    if (sum === 0 || labels.length === 0) {
      body.append(el("p", { class: "hint admin-report-chart-card__empty" }, [emptyHint]));
      return;
    }
    const canvas = el("canvas", { class: "admin-report-chart-card__canvas" });
    body.append(canvas);

    const cfg: ChartConfiguration<"doughnut", number[], string> = {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: pickColors(labels.length),
            borderColor: "rgba(255,255,255,0.94)",
            borderWidth: 2,
            /** 略外推扇形，懸停再浮起，增加層次（非真 3D，Chart.js 甜甜圈無內建立體） */
            offset: 5,
            hoverOffset: 20,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "56%",
        animation: anim,
        font: { family: chartFontFamily() },
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              padding: 12,
              usePointStyle: true,
              pointStyle: "circle",
              font: { size: 11, family: chartFontFamily() },
              color: "#444",
            },
          },
          tooltip: {
            callbacks: {
              label: (item) => {
                const v = Number(item.raw);
                const arr = item.dataset.data as number[];
                const total = arr.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
                const label = item.label ? `${item.label}: ` : "";
                return `${label}${fmtInt(v)} (${pct}%)`;
              },
            },
          },
        },
      },
    };
    pushChart(reg, new Chart(canvas, cfg));
  }

  addDoughnut(
    donutRow,
    t("admin.reports.chart.donutStatus", "預約狀態"),
    data.statusLabels,
    data.statusValues,
    t("admin.reports.empty", "無資料"),
  );
  addDoughnut(
    donutRow,
    t("admin.reports.chart.donutMode", "付款方式"),
    data.modeLabels,
    data.modeValues,
    t("admin.reports.empty", "無資料"),
  );
  addDoughnut(
    donutRow,
    t("admin.reports.chart.donutSupport", "客服對話"),
    [t("admin.reports.chart.legendOpen", "進行中"), t("admin.reports.chart.legendClosed", "已結束")],
    [data.supportOpen, data.supportClosed],
    t("admin.reports.chart.supportEmpty", "尚無對話紀錄"),
  );

  function addBarCard(parent: HTMLElement, title: string, labels: string[], values: number[]) {
    const { card, body } = chartCard(title);
    parent.append(card);
    const canvas = el("canvas", { class: "admin-report-chart-card__canvas" });
    body.append(canvas);
    const colors = pickColors(values.length);
    const cfg: ChartConfiguration<"bar", number[], string> = {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: title,
            data: values,
            backgroundColor: colors.map((c) => `${c}d0`),
            borderColor: colors.map((c) => `${c}ff`),
            borderWidth: { top: 2, right: 2, bottom: 0, left: 2 },
            borderRadius: { topLeft: 12, topRight: 12, bottomLeft: 4, bottomRight: 4 },
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: anim,
        font: { family: chartFontFamily() },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (item) => `${item.label ?? ""}: ${fmtInt(Number(item.raw))}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { family: chartFontFamily(), size: 11 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(0,0,0,0.06)" },
            ticks: { font: { family: chartFontFamily(), size: 11 } },
          },
        },
      },
    };
    pushChart(reg, new Chart(canvas, cfg));
  }

  addBarCard(
    barRow,
    t("admin.reports.chart.bookingVolumeTitle", "預約量（今日／本週／本月）"),
    data.bookingBarLabels,
    data.bookingBarValues,
  );
  addBarCard(
    barRow,
    t("admin.reports.chart.visitsTitle", "網站訪次（今日／本週／累計）"),
    data.visitsBarLabels,
    data.visitsBarValues,
  );

  const polarCard = chartCard(t("admin.reports.chart.polarStars", "心得星等 · 極區圖"));
  polarWrap.append(polarCard.card);
  const starSum = data.starValues.reduce((a, b) => a + b, 0);
  if (starSum === 0) {
    polarCard.body.append(
      el("p", { class: "hint admin-report-chart-card__empty" }, [t("admin.reports.chart.starsEmpty", "尚無心得或無星等資料")]),
    );
    return;
  }
  const pCanvas = el("canvas", { class: "admin-report-chart-card__canvas admin-report-chart-card__canvas--polar" });
  polarCard.body.append(pCanvas);
  const starColors = ["#94a3b8", "#64748b", "#f59e0b", "#f97316", "#ea580c"];
  const polarCfg: ChartConfiguration<"polarArea", number[], string> = {
    type: "polarArea",
    data: {
      labels: data.starLabels,
      datasets: [
        {
          data: data.starValues,
          backgroundColor: data.starLabels.map((_, i) => `${starColors[i] ?? PALETTE[i]}b0`),
          borderColor: data.starLabels.map((_, i) => starColors[i] ?? PALETTE[i]),
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: anim,
      font: { family: chartFontFamily() },
      scales: {
        r: {
          beginAtZero: true,
          grid: { color: "rgba(0,0,0,0.07)" },
          angleLines: { color: "rgba(0,0,0,0.06)" },
          pointLabels: {
            font: { size: 12, weight: 600, family: chartFontFamily() },
            color: "#333",
          },
          ticks: {
            backdropColor: "transparent",
            font: { size: 10, family: chartFontFamily() },
          },
        },
      },
      plugins: {
        legend: {
          position: "right",
          labels: {
            padding: 10,
            usePointStyle: true,
            font: { size: 11, family: chartFontFamily() },
            color: "#444",
          },
        },
        tooltip: {
          callbacks: {
            label: (item) => {
              const v = Number(item.raw);
              const pct = starSum > 0 ? ((v / starSum) * 100).toFixed(1) : "0";
              return `${item.label ?? ""}: ${fmtInt(v)} (${pct}%)`;
            },
          },
        },
      },
    },
  };
  pushChart(reg, new Chart(pCanvas, polarCfg));
}
