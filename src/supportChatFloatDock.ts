/**
 * 「聯絡店家」浮層：長按主按鈕約半秒後可拖曳整塊，放開後依中心點黏在視窗左或右下緣（距底距離會記住）。
 */

const DOCK_KEY = "mr_support_float_side";
const BOTTOM_KEY = "mr_support_float_bottom";
const LONG_PRESS_MS = 480;
const LONG_PRESS_CANCEL_MOVE_PX = 12;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

type LongPressPending = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  pointerType: string;
  button: number;
};

export type SupportChatFloatDockHandle = {
  /** 顯示／視窗大小變化後重算靠邊位置（例如從後台切回預約頁） */
  relayout: () => void;
  dispose: () => void;
};

export function attachSupportChatFloatDrag(floatEl: HTMLElement, fab: HTMLButtonElement): SupportChatFloatDockHandle {
  let dockSide: "left" | "right" = "right";
  let bottomPx = 12;
  let dragging = false;
  let dragPointerId: number | null = null;
  let grabOffX = 0;
  let grabOffY = 0;
  let longPressPending: LongPressPending | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

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
    const h = floatEl.offsetHeight || 72;
    bottomPx = clamp(bottomPx, 8, Math.max(8, window.innerHeight - h - 8));
    floatEl.style.position = "fixed";
    floatEl.style.top = "auto";
    floatEl.style.transform = "none";
    floatEl.style.bottom = `${bottomPx}px`;
    floatEl.style.maxWidth = "calc(100vw - 20px)";
    floatEl.classList.toggle("support-chat-float--dock-left", dockSide === "left");
    floatEl.classList.toggle("support-chat-float--dock-right", dockSide === "right");
    if (dockSide === "left") {
      floatEl.style.left = "max(12px, env(safe-area-inset-left, 0px))";
      floatEl.style.right = "auto";
    } else {
      floatEl.style.right = "max(12px, env(safe-area-inset-right, 0px))";
      floatEl.style.left = "auto";
    }
  }

  function applyFreePosition(left: number, top: number): void {
    const rw = floatEl.offsetWidth || 200;
    const rh = floatEl.offsetHeight || 72;
    floatEl.style.left = `${clamp(left, 4, window.innerWidth - rw - 4)}px`;
    floatEl.style.top = `${clamp(top, 4, window.innerHeight - rh - 4)}px`;
    floatEl.style.right = "auto";
    floatEl.style.bottom = "auto";
  }

  function clearLongPressPending(): void {
    if (longPressTimer != null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (!longPressPending) return;
    window.removeEventListener("pointermove", onWindowMoveDuringLongPress);
    window.removeEventListener("pointerup", onWindowUpDuringLongPress);
    window.removeEventListener("pointercancel", onWindowUpDuringLongPress);
    longPressPending = null;
  }

  function onWindowMoveDuringLongPress(e: PointerEvent): void {
    if (!longPressPending || e.pointerId !== longPressPending.pointerId) return;
    longPressPending.lastX = e.clientX;
    longPressPending.lastY = e.clientY;
    const dx = e.clientX - longPressPending.startX;
    const dy = e.clientY - longPressPending.startY;
    if (dx * dx + dy * dy > LONG_PRESS_CANCEL_MOVE_PX * LONG_PRESS_CANCEL_MOVE_PX) {
      clearLongPressPending();
    }
  }

  function onWindowUpDuringLongPress(e: PointerEvent): void {
    if (!longPressPending || e.pointerId !== longPressPending.pointerId) return;
    clearLongPressPending();
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
      fab.releasePointerCapture(e.pointerId);
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
    const swallowNextFabClick = (ev: MouseEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
    };
    fab.addEventListener("click", swallowNextFabClick, { capture: true, once: true });
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
      fab.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener("pointermove", onDragMove, { passive: false });
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragEnd);
  }

  function onFabPointerDown(e: PointerEvent): void {
    if (dragging) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    clearLongPressPending();
    longPressPending = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      pointerType: e.pointerType,
      button: e.button,
    };
    window.addEventListener("pointermove", onWindowMoveDuringLongPress);
    window.addEventListener("pointerup", onWindowUpDuringLongPress);
    window.addEventListener("pointercancel", onWindowUpDuringLongPress);
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      if (!longPressPending) return;
      const p = longPressPending;
      window.removeEventListener("pointermove", onWindowMoveDuringLongPress);
      window.removeEventListener("pointerup", onWindowUpDuringLongPress);
      window.removeEventListener("pointercancel", onWindowUpDuringLongPress);
      longPressPending = null;
      beginDrag(p.pointerId, p.lastX, p.lastY, p.pointerType, p.button);
    }, LONG_PRESS_MS);
  }

  function onResize(): void {
    if (!dragging) applyDockedLayout();
  }

  fab.title = "短按：開啟／收合；長按約半秒：可拖曳位置，放開後靠左或靠右下緣。";

  readPersist();
  applyDockedLayout();
  fab.addEventListener("pointerdown", onFabPointerDown);
  window.addEventListener("resize", onResize);

  function relayout(): void {
    if (floatEl.hidden) return;
    requestAnimationFrame(() => {
      if (floatEl.hidden) return;
      applyDockedLayout();
    });
  }

  function dispose(): void {
    clearLongPressPending();
    window.removeEventListener("resize", onResize);
    fab.removeEventListener("pointerdown", onFabPointerDown);
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
  }

  return { relayout, dispose };
}
