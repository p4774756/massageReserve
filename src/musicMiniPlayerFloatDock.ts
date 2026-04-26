/**
 * 舒壓配樂浮層：在專用握把上按住即可拖曳，放開後依中心點黏在視窗左或右下緣（距底會記住）。
 * 預設靠左下，與右下角「聯絡店家」錯開。
 */

const DOCK_KEY = "mr_music_float_side";
const BOTTOM_KEY = "mr_music_float_bottom";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export type MusicMiniPlayerFloatDockHandle = {
  relayout: () => void;
  dispose: () => void;
};

export function attachMusicMiniPlayerFloatDrag(
  floatEl: HTMLElement,
  dragSurface: HTMLElement,
): MusicMiniPlayerFloatDockHandle {
  let dockSide: "left" | "right" = "left";
  let bottomPx = 12;
  let dragging = false;
  let dragPointerId: number | null = null;
  let grabOffX = 0;
  let grabOffY = 0;

  function readPersist(): void {
    try {
      const d = localStorage.getItem(DOCK_KEY);
      if (d === "left" || d === "right") dockSide = d;
      const b = localStorage.getItem(BOTTOM_KEY);
      if (b != null) {
        const n = Math.round(Number(b));
        if (Number.isFinite(n)) bottomPx = n;
      }
    } catch {
      /* ignore */
    }
  }

  function persist(): void {
    try {
      localStorage.setItem(DOCK_KEY, dockSide);
      localStorage.setItem(BOTTOM_KEY, String(bottomPx));
    } catch {
      /* ignore */
    }
  }

  function applyDockedLayout(): void {
    if (floatEl.hidden) return;
    const h = floatEl.offsetHeight || 120;
    bottomPx = clamp(bottomPx, 8, Math.max(8, window.innerHeight - h - 8));
    floatEl.style.position = "fixed";
    floatEl.style.top = "auto";
    floatEl.style.transform = "none";
    floatEl.style.bottom = `${bottomPx}px`;
    floatEl.style.maxWidth = "calc(100vw - 20px)";
    floatEl.classList.toggle("music-mini-player-root--dock-left", dockSide === "left");
    floatEl.classList.toggle("music-mini-player-root--dock-right", dockSide === "right");
    if (dockSide === "left") {
      floatEl.style.left = "max(12px, env(safe-area-inset-left, 0px))";
      floatEl.style.right = "auto";
    } else {
      floatEl.style.right = "max(12px, env(safe-area-inset-right, 0px))";
      floatEl.style.left = "auto";
    }
  }

  function applyFreePosition(left: number, top: number): void {
    const rw = floatEl.offsetWidth || 144;
    const rh = floatEl.offsetHeight || 120;
    floatEl.style.left = `${clamp(left, 4, window.innerWidth - rw - 4)}px`;
    floatEl.style.top = `${clamp(top, 4, window.innerHeight - rh - 4)}px`;
    floatEl.style.right = "auto";
    floatEl.style.bottom = "auto";
  }

  function onDragMove(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    e.preventDefault();
    applyFreePosition(e.clientX - grabOffX, e.clientY - grabOffY);
  }

  function onDragEnd(e: PointerEvent): void {
    if (!dragging || e.pointerId !== dragPointerId) return;
    dragging = false;
    dragPointerId = null;
    try {
      dragSurface.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
    const r = floatEl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    dockSide = cx < window.innerWidth / 2 ? "left" : "right";
    bottomPx = Math.round(window.innerHeight - r.bottom);
    const h = r.height;
    bottomPx = clamp(bottomPx, 8, Math.max(8, window.innerHeight - h - 8));
    persist();
    applyDockedLayout();
  }

  function beginDrag(
    pointerId: number,
    clientX: number,
    clientY: number,
    pointerType: string,
    button: number,
  ): void {
    if (dragging) return;
    if (pointerType === "mouse" && button !== 0) return;
    dragging = true;
    dragPointerId = pointerId;
    const r = floatEl.getBoundingClientRect();
    grabOffX = clientX - r.left;
    grabOffY = clientY - r.top;
    try {
      dragSurface.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener("pointermove", onDragMove, { passive: false });
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragEnd);
  }

  function onDragHandlePointerDown(e: PointerEvent): void {
    if (dragging) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    beginDrag(e.pointerId, e.clientX, e.clientY, e.pointerType, e.button);
  }

  function onResize(): void {
    if (!dragging) applyDockedLayout();
  }

  readPersist();
  applyDockedLayout();
  dragSurface.addEventListener("pointerdown", onDragHandlePointerDown);
  window.addEventListener("resize", onResize);

  function relayout(): void {
    if (floatEl.hidden) return;
    requestAnimationFrame(() => {
      if (floatEl.hidden) return;
      applyDockedLayout();
    });
  }

  function dispose(): void {
    window.removeEventListener("resize", onResize);
    dragSurface.removeEventListener("pointerdown", onDragHandlePointerDown);
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
  }

  return { relayout, dispose };
}
