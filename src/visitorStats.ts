import { recordSiteVisitCall } from "./firebase";
import { intlLocaleTag, localeApiParam, t } from "./i18n";

type VisitorStatsPayload = {
  yourVisitNumberToday: number;
  dayVisits: number;
  weekVisits: number;
  totalVisits: number;
};

const VISIT_SESSION_KEY = "mr_siteVisitSession";

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

function isVisitorStatsPayload(data: {
  yourVisitNumberToday?: unknown;
  dayVisits?: unknown;
  weekVisits?: unknown;
  totalVisits?: unknown;
}): data is VisitorStatsPayload {
  return (
    typeof data.yourVisitNumberToday === "number" &&
    typeof data.dayVisits === "number" &&
    typeof data.weekVisits === "number" &&
    typeof data.totalVisits === "number"
  );
}

export function createVisitorStatsLine(initiallyVisible: boolean): {
  element: HTMLParagraphElement;
  setVisible: (visible: boolean) => void;
} {
  const line = el("p", {
    class: "visitor-stats visitor-stats--wretch",
    role: "status",
    ariaLive: "polite",
    title: t(
      "visitor.title",
      "每個瀏覽器分頁連線期間計一次；重新整理不會重複累加。以台北時區換日與換週（週一至週日）。",
    ),
  }, [t("visitor.loading", "訪次統計載入中…")]);

  let loaded = false;
  line.hidden = !initiallyVisible;

  function formatVisitCount(n: number): string {
    return n.toLocaleString(intlLocaleTag());
  }

  function applyPayload(data: VisitorStatsPayload) {
    const rail = (side: "l" | "r") =>
      el("span", { class: `visitor-stats__rail visitor-stats__rail--${side}`, ariaHidden: "true" }, [
        side === "l" ? "♡ " : " ♡",
      ]);
    const num = (v: number) => el("span", { class: "visitor-stats__num" }, [formatVisitCount(v)]);
    line.replaceChildren(
      rail("l"),
      el("span", { class: "visitor-stats__main" }, [
        t("visitor.line.today", "今日 "),
        num(data.dayVisits),
        t("visitor.line.visits", " 人次 · 本週 "),
        num(data.weekVisits),
        t("visitor.line.total", " · 累計 "),
        num(data.totalVisits),
        " · ",
        el("strong", { class: "visitor-stats__em" }, [
          t("visitor.line.youPrefix", "您是今日第 "),
          formatVisitCount(data.yourVisitNumberToday),
          t("visitor.line.youSuffix", " 位訪客"),
        ]),
      ]),
      rail("r"),
    );
  }

  function trySessionPayload(): boolean {
    try {
      const raw = sessionStorage.getItem(VISIT_SESSION_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw) as {
        yourVisitNumberToday?: unknown;
        dayVisits?: unknown;
        weekVisits?: unknown;
        totalVisits?: unknown;
      };
      if (!isVisitorStatsPayload(data)) return false;
      applyPayload(data);
      return true;
    } catch {
      return false;
    }
  }

  function loadIfNeeded() {
    if (loaded || line.hidden) return;
    loaded = true;
    if (trySessionPayload()) return;
    void (async () => {
      try {
        const fn = recordSiteVisitCall();
        const res = await fn({ ...localeApiParam() });
        const data = res.data as {
          yourVisitNumberToday?: unknown;
          dayVisits?: unknown;
          weekVisits?: unknown;
          totalVisits?: unknown;
        };
        if (!isVisitorStatsPayload(data)) {
          line.textContent = t("visitor.badFormat", "訪次統計格式異常。");
          return;
        }
        sessionStorage.setItem(VISIT_SESSION_KEY, JSON.stringify(data));
        applyPayload(data);
      } catch {
        line.textContent = t(
          "visitor.cfFail",
          "訪次統計暫時無法載入（請確認已部署 Cloud Functions：recordSiteVisit）。",
        );
      }
    })();
  }

  loadIfNeeded();

  return {
    element: line,
    setVisible(visible: boolean) {
      line.hidden = !visible;
      loadIfNeeded();
    },
  };
}
