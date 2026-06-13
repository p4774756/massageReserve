import { doc, onSnapshot } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { el } from "./domUtil";
import { t } from "./i18n";
import { taipeiTodayDateKey } from "./taipeiDates";

export const MONTHLY_CHAMPION_CELEBRATION_DOC_ID = "monthlyChampionCelebration";

type CelebrationView = {
  monthLabel: string;
  displayName: string;
};

function parseCelebration(data: Record<string, unknown> | undefined, todayKey: string): CelebrationView | null {
  if (!data) return null;
  const monthKey = typeof data.monthKey === "string" ? data.monthKey.trim() : "";
  const displayName = typeof data.displayName === "string" ? data.displayName.trim() : "";
  const showUntil = typeof data.showUntil === "string" ? data.showUntil.trim() : "";
  if (!monthKey || !displayName || !showUntil || todayKey > showUntil) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  const monthLabel = m ? `${m[1]}年${Number(m[2])}月` : monthKey;
  return { monthLabel, displayName };
}

export function createMonthlyChampionBanner(db: Firestore): {
  root: HTMLElement;
  stop: () => void;
} {
  const root = el("div", { class: "monthly-champion-banner", role: "status", hidden: true });
  const title = el("p", { class: "monthly-champion-banner__title" });
  const body = el("p", { class: "monthly-champion-banner__body hint" });
  root.append(title, body);

  function paint(view: CelebrationView | null) {
    if (!view) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    title.textContent = t("monthlyChampion.bannerTitle", "🎉 {{month}}消費冠軍", { month: view.monthLabel });
    body.textContent = t(
      "monthlyChampion.bannerBody",
      "恭喜 {{name}}！已贈送 1 次按摩，本月歡迎預約體驗。",
      { name: view.displayName },
    );
  }

  paint(null);

  const ref = doc(db, "siteSettings", MONTHLY_CHAMPION_CELEBRATION_DOC_ID);
  const unsub = onSnapshot(
    ref,
    (snap) => {
      paint(parseCelebration(snap.data() as Record<string, unknown> | undefined, taipeiTodayDateKey()));
    },
    () => {
      paint(null);
    },
  );

  return { root, stop: unsub };
}
