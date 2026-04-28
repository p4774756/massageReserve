import * as echarts from "echarts";
import "echarts-gl";
import { intlLocaleTag, t } from "./i18n";

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

const resizeByChart = new WeakMap<echarts.ECharts, ResizeObserver>();

function bindResize(chart: echarts.ECharts, host: HTMLElement): void {
  const ro = new ResizeObserver(() => {
    try {
      chart.resize();
    } catch {
      /* disposed */
    }
  });
  ro.observe(host);
  resizeByChart.set(chart, ro);
}

function disposeChart(chart: echarts.ECharts): void {
  resizeByChart.get(chart)?.disconnect();
  resizeByChart.delete(chart);
  chart.dispose();
}

export type ReportChartRegistry = { charts: echarts.ECharts[] };

export function destroyReportCharts(reg: ReportChartRegistry): void {
  for (const c of reg.charts) {
    try {
      disposeChart(c);
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

function pushChart(reg: ReportChartRegistry, chart: echarts.ECharts, resizeHost: HTMLElement): void {
  bindResize(chart, resizeHost);
  reg.charts.push(chart);
}

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
};

export async function renderFlashReportCharts(
  donutRow: HTMLElement,
  barRow: HTMLElement,
  reg: ReportChartRegistry,
  data: FlashChartsInput,
): Promise<void> {
  donutRow.replaceChildren();
  barRow.replaceChildren();

  const font = chartFontFamily();

  function addPie(parent: HTMLElement, title: string, labels: string[], values: number[], emptyHint: string) {
    const { card, body } = chartCard(title);
    parent.append(card);
    const sum = values.reduce((a, b) => a + b, 0);
    if (sum === 0 || labels.length === 0) {
      body.append(el("p", { class: "hint admin-report-chart-card__empty" }, [emptyHint]));
      return;
    }
    const host = el("div", { class: "admin-report-chart-card__echarts" });
    body.append(host);
    const chart = echarts.init(host, undefined, { renderer: "canvas" });
    chart.setOption({
      textStyle: { fontFamily: font },
      animationDuration: 800,
      animationEasing: "cubicOut",
      color: pickColors(labels.length),
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const x = p as { name?: string; value?: number; percent?: number };
          const v = Number(x.value);
          const pct = typeof x.percent === "number" ? x.percent.toFixed(1) : "0";
          return `${x.name ?? ""}<br/>${fmtInt(v)}（${pct}%）`;
        },
      },
      legend: {
        bottom: 4,
        type: "scroll",
        textStyle: { fontFamily: font, fontSize: 11, color: "#444" },
      },
      series: [
        {
          type: "pie",
          radius: ["40%", "66%"],
          center: ["50%", "44%"],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: "rgba(255,255,255,0.92)",
            borderWidth: 2,
          },
          label: { fontFamily: font, fontSize: 11, formatter: "{b}\n{d}%" },
          data: labels.map((name, i) => ({ name, value: values[i] })),
        },
      ],
    });
    pushChart(reg, chart, body);
  }

  addPie(
    donutRow,
    t("admin.reports.chart.donutStatus", "預約狀態"),
    data.statusLabels,
    data.statusValues,
    t("admin.reports.empty", "無資料"),
  );
  addPie(
    donutRow,
    t("admin.reports.chart.donutMode", "付款方式"),
    data.modeLabels,
    data.modeValues,
    t("admin.reports.empty", "無資料"),
  );
  addPie(
    donutRow,
    t("admin.reports.chart.donutSupport", "客服對話"),
    [t("admin.reports.chart.legendOpen", "進行中"), t("admin.reports.chart.legendClosed", "已結束")],
    [data.supportOpen, data.supportClosed],
    t("admin.reports.chart.supportEmpty", "尚無對話紀錄"),
  );

  function addBar3D(parent: HTMLElement, title: string, labels: string[], values: number[]) {
    const { card, body } = chartCard(title);
    parent.append(card);
    const host = el("div", { class: "admin-report-chart-card__echarts admin-report-chart-card__echarts--gl" });
    body.append(host);
    const chart = echarts.init(host, undefined, { renderer: "canvas" });
    const zMax = Math.max(...values, 1);
    const barData = values.map((v, i) => [i, 0, v] as [number, number, number]);
    chart.setOption({
      textStyle: { fontFamily: font },
      animationDuration: 900,
      animationEasing: "cubicOut",
      tooltip: {
        formatter: (p: unknown) => {
          const x = p as { value?: [number, number, number] };
          const v = x.value?.[2];
          const i = x.value?.[0];
          const name = typeof i === "number" ? labels[i] : "";
          return `${name}: ${fmtInt(Number(v))}`;
        },
      },
      xAxis3D: {
        type: "category",
        data: labels,
        name: "",
        axisLabel: { fontFamily: font, fontSize: 11, color: "#444", interval: 0 },
      },
      yAxis3D: { type: "category", data: [""], show: false },
      zAxis3D: { type: "value", max: zMax * 1.15 },
      grid3D: {
        boxWidth: Math.min(220, 40 + labels.length * 56),
        boxDepth: 28,
        environment: "#f8f8fa",
        viewControl: {
          projection: "perspective",
          alpha: 26,
          beta: 38,
          distance: 168,
          rotateSensitivity: 1.1,
          zoomSensitivity: 1,
          panSensitivity: 0,
        },
        light: {
          main: { intensity: 1.15, shadow: true },
          ambient: { intensity: 0.42 },
        },
      },
      series: [
        {
          type: "bar3D",
          data: barData.map((tuple, i) => ({
            value: tuple,
            itemStyle: { color: pickColors(values.length)[i] },
          })),
          shading: "lambert",
          label: {
            show: true,
            formatter: (p: unknown) => {
              const v = (p as { value?: [number, number, number] }).value?.[2];
              return v != null ? fmtInt(Number(v)) : "";
            },
            fontFamily: font,
            fontSize: 11,
          },
        },
      ],
    });
    pushChart(reg, chart, body);
  }

  addBar3D(
    barRow,
    t("admin.reports.chart.bookingVolumeTitle", "預約量（今日／本週／本月）"),
    data.bookingBarLabels,
    data.bookingBarValues,
  );
  addBar3D(
    barRow,
    t("admin.reports.chart.visitsTitle", "網站訪次（今日／本週／累計）"),
    data.visitsBarLabels,
    data.visitsBarValues,
  );
}
