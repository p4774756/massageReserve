/** 預約頁頂部跑馬燈：文字橫向捲動（速度與後台／Firestore `speed` 欄位一致，單位：CSS 像素／秒） */

export const LED_SPEED_MIN = 8;
/** 後台拉霸上限；數值為 CSS 像素／秒 */
export const LED_SPEED_MAX = 200;
export const LED_SPEED_DEFAULT = 30;

/** 兩段重複文案之間的間距（px），與 CSS `gap` 一致 */
const SEGMENT_GAP_PX = 48;

/** 後台／Firestore `speed` 欄位（px/s）合法範圍 */
export function clampLedSpeed(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return LED_SPEED_DEFAULT;
  return Math.min(LED_SPEED_MAX, Math.max(LED_SPEED_MIN, Math.round(value)));
}

export type LedMarqueeHandle = {
  setText: (text: string) => void;
  setSpeed: (pxPerSec: number) => void;
  destroy: () => void;
};

type LedMarqueeOptions = {
  speed?: number;
};

export function createLedMarquee(
  container: HTMLElement,
  options: LedMarqueeOptions = {},
): LedMarqueeHandle {
  let scrollSpeed = clampLedSpeed(options.speed ?? LED_SPEED_DEFAULT);

  const viewport = document.createElement("div");
  viewport.className = "text-marquee-viewport";
  const track = document.createElement("div");
  track.className = "text-marquee-track";
  const seg1 = document.createElement("span");
  const seg2 = document.createElement("span");
  seg1.className = "text-marquee-segment";
  seg2.className = "text-marquee-segment";
  seg2.setAttribute("aria-hidden", "true");
  track.append(seg1, seg2);
  viewport.append(track);
  container.append(viewport);

  let anim: Animation | null = null;
  let intersecting = true;
  let destroyed = false;
  let rafRebuild = 0;

  const ioRoot = container.parentElement;
  const io =
    ioRoot &&
    new IntersectionObserver(
      (entries) => {
        intersecting = entries[0]?.isIntersecting ?? false;
        if (anim) {
          if (intersecting) void anim.play();
          else anim.pause();
        }
      },
      { threshold: 0 },
    );
  if (io && ioRoot) io.observe(ioRoot);

  const ro =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (!destroyed) scheduleRebuild();
        })
      : null;
  ro?.observe(viewport);

  function scheduleRebuild() {
    cancelAnimationFrame(rafRebuild);
    rafRebuild = requestAnimationFrame(() => {
      rafRebuild = 0;
      rebuildAnimation();
    });
  }

  function rebuildAnimation() {
    anim?.cancel();
    anim = null;
    track.style.transform = "";

    const raw = (seg1.textContent ?? "").trim();
    viewport.setAttribute("aria-label", raw.slice(0, 200) || "公告跑馬燈");
    if (!raw || scrollSpeed < 1) return;

    void track.offsetWidth;
    const w = seg1.offsetWidth;
    const dist = w + SEGMENT_GAP_PX;
    if (dist < 4) return;

    const durationMs = (dist / scrollSpeed) * 1000;
    anim = track.animate(
      [{ transform: "translateX(0)" }, { transform: `translateX(-${dist}px)` }],
      { duration: durationMs, iterations: Number.POSITIVE_INFINITY, easing: "linear" },
    );
    if (!intersecting) anim.pause();
  }

  return {
    setText(text: string) {
      const clean = text.trim();
      seg1.textContent = clean;
      seg2.textContent = clean;
      scheduleRebuild();
    },
    setSpeed(pxPerSec: number) {
      scrollSpeed = clampLedSpeed(pxPerSec);
      scheduleRebuild();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafRebuild);
      anim?.cancel();
      io?.disconnect();
      ro?.disconnect();
      viewport.remove();
    },
  };
}
