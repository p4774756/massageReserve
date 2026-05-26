import type { Firestore } from "firebase/firestore";
import { doc, onSnapshot, type Timestamp } from "firebase/firestore";
import { el } from "./domUtil";
import { t } from "./i18n";
import { taipeiTodayDateKey } from "./taipeiDates";

export const PUBLIC_NOTICE_DOC_ID = "publicNotice";

const DISMISS_STORAGE_KEY = "mr_publicNoticeDismiss";
const TEXT_MAX_LEN = 400;

export type PublicNoticeParsed = {
  text: string;
  dismissKey: string;
  expiresOn?: string;
};

function normalizeExpiresOn(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  return s;
}

function dismissKeyFromDoc(data: Record<string, unknown>): string {
  const updatedAt = data.updatedAt as Timestamp | undefined;
  const ms = updatedAt?.toMillis?.();
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) return String(ms);
  const text = typeof data.text === "string" ? data.text.trim() : "";
  return `t:${text}`;
}

/** 解析 `siteSettings/publicNotice`；無有效正文或已過期則回傳 null */
export function parsePublicNotice(raw: Record<string, unknown> | undefined): PublicNoticeParsed | null {
  if (!raw) return null;
  const text = typeof raw.text === "string" ? raw.text.trim().slice(0, TEXT_MAX_LEN) : "";
  if (!text) return null;
  const expiresOn = normalizeExpiresOn(raw.expiresOn);
  if (expiresOn && taipeiTodayDateKey() > expiresOn) return null;
  return { text, dismissKey: dismissKeyFromDoc(raw), expiresOn };
}

export function isPublicNoticeDismissed(dismissKey: string): boolean {
  if (!dismissKey) return false;
  try {
    const raw = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { key?: unknown };
    return parsed.key === dismissKey;
  } catch {
    return false;
  }
}

export function dismissPublicNotice(dismissKey: string): void {
  if (!dismissKey) return;
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify({ key: dismissKey }));
  } catch {
    /* quota / private mode */
  }
}

export function publicNoticeDocRef(db: Firestore) {
  return doc(db, "siteSettings", PUBLIC_NOTICE_DOC_ID);
}

export function createSitePublicNoticeBanner(
  db: Firestore,
  opts: { onVisibilityChange?: (visible: boolean) => void } = {},
): { element: HTMLElement; stop: () => void } {
  const wrap = el("div", {
    class: "site-public-notice",
    role: "region",
    hidden: true,
    ariaLabel: t("notice.regionAria", "站內公告"),
  });
  const label = el("span", { class: "site-public-notice__label" }, [t("notice.label", "公告")]);
  const body = el("p", { class: "site-public-notice__body" });
  const dismissBtn = el("button", {
    type: "button",
    class: "site-public-notice__dismiss ghost",
    ariaLabel: t("notice.dismissAria", "關閉此則公告"),
  }, [t("notice.dismiss", "關閉")]);
  wrap.append(label, body, dismissBtn);

  let activeDismissKey = "";

  function setVisible(visible: boolean) {
    wrap.hidden = !visible;
    wrap.classList.toggle("site-public-notice--on", visible);
    opts.onVisibilityChange?.(visible);
  }

  function apply(raw: Record<string, unknown> | undefined) {
    const parsed = parsePublicNotice(raw);
    if (!parsed || isPublicNoticeDismissed(parsed.dismissKey)) {
      activeDismissKey = "";
      setVisible(false);
      return;
    }
    activeDismissKey = parsed.dismissKey;
    body.textContent = parsed.text;
    setVisible(true);
  }

  dismissBtn.addEventListener("click", () => {
    if (!activeDismissKey) return;
    dismissPublicNotice(activeDismissKey);
    setVisible(false);
  });

  const unsub = onSnapshot(
    publicNoticeDocRef(db),
    (snap) => apply(snap.data() as Record<string, unknown> | undefined),
    () => setVisible(false),
  );

  return {
    element: wrap,
    stop: () => unsub(),
  };
}
