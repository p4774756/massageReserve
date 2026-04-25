/**
 * 底部懸浮迷你播放器（不折疊）：上一首／播放暫停／下一首、封面、曲名、進度、音量、曲目清單。
 * 位置：左側凸條可立即拖曳；主體區長按約半秒後可拖曳（按鈕與滑桿除外），鬆手後黏在較近的左或右下緣。
 *
 * 預設曲目為 **Kevin MacLeod**（incompetech.com）之放鬆／環境樂，授權 **CC BY 4.0**；
 * 頁面底部已附署名連結。若要改為自備音檔，請放 `public/media/` 並修改 `MUSIC_PLAYLIST`。
 */
export type MusicTrack = {
  title: string;
  src: string;
  artist?: string;
  /** 可選封面圖網址（同網域或允許跨域之圖片） */
  artUrl?: string;
};

const INCOMPETECH_MP3 = "https://incompetech.com/music/royalty-free/mp3-royaltyfree";

/** 放鬆、讀書／工作專注、按摩背景皆宜（皆為鋼琴或偏ambient，節奏平緩） */
export const MUSIC_PLAYLIST: MusicTrack[] = [
  {
    title: "Meditation Impromptu 01",
    artist: "Kevin MacLeod · 鋼琴即興，冥想／按摩背景",
    src: `${INCOMPETECH_MP3}/Meditation%20Impromptu%2001.mp3`,
  },
  {
    title: "Meditation Impromptu 02",
    artist: "Kevin MacLeod · 鋼琴即興，放鬆專注",
    src: `${INCOMPETECH_MP3}/Meditation%20Impromptu%2002.mp3`,
  },
  {
    title: "Meditation Impromptu 03",
    artist: "Kevin MacLeod · 鋼琴即興，長時靜心",
    src: `${INCOMPETECH_MP3}/Meditation%20Impromptu%2003.mp3`,
  },
  {
    title: "Floating Cities",
    artist: "Kevin MacLeod · 環境電子，讀書／工作",
    src: `${INCOMPETECH_MP3}/Floating%20Cities.mp3`,
  },
  {
    title: "Comfortable Mystery 4",
    artist: "Kevin MacLeod · 輕柔氛圍，專注與休息",
    src: `${INCOMPETECH_MP3}/Comfortable%20Mystery%204.mp3`,
  },
  {
    title: "Peaceful Desolation",
    artist: "Kevin MacLeod · 空曠寧靜，小憩／按摩",
    src: `${INCOMPETECH_MP3}/Peaceful%20Desolation.mp3`,
  },
  {
    title: "Drone in D",
    artist: "Kevin MacLeod · 極簡長音，深度放鬆",
    src: `${INCOMPETECH_MP3}/Drone%20in%20D.mp3`,
  },
];

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

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function iconSvg(pathD: string, size: 16 | 22 = 22): string {
  const wh = size;
  return `<svg class="music-mini-player__svg" viewBox="0 0 24 24" width="${wh}" height="${wh}" aria-hidden="true"><path fill="currentColor" d="${pathD}"/></svg>`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export type MusicMiniPlayerUnmount = () => void;

export function mountMusicMiniPlayer(mount: HTMLElement): MusicMiniPlayerUnmount {
  const wrap = el("div", {
    class: "music-mini-player music-mini-player--compact",
    role: "region",
    ariaLabel: "舒壓配樂迷你播放器",
  });

  const DOCK_KEY = "mr_music_dock";
  const BOTTOM_KEY = "mr_music_bottom";
  let dockSide: "left" | "right" = "left";
  let bottomPx = 70;
  let dragging = false;
  let dragPointerId: number | null = null;
  let grabOffX = 0;
  let grabOffY = 0;
  let dragCaptureEl: HTMLElement | null = null;

  const LONG_PRESS_MS = 480;
  const LONG_PRESS_CANCEL_MOVE_PX = 12;
  type LongPressPending = {
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    pointerType: string;
    button: number;
  };
  let longPressPending: LongPressPending | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  function readDockPersist(): void {
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

  function persistDock(): void {
    try {
      localStorage.setItem(DOCK_KEY, dockSide);
      localStorage.setItem(BOTTOM_KEY, String(bottomPx));
    } catch {
      /* ignore */
    }
  }

  function applyDockPosition(): void {
    const h = mount.offsetHeight || 56;
    bottomPx = clamp(bottomPx, 8, Math.max(8, window.innerHeight - h - 8));
    mount.style.position = "fixed";
    mount.style.top = "auto";
    mount.style.transform = "none";
    mount.style.width = "max-content";
    mount.style.maxWidth = "min(232px, calc(100vw - 16px))";
    mount.style.zIndex = "1185";
    mount.style.bottom = `${bottomPx}px`;
    if (dockSide === "left") {
      mount.style.left = `max(8px, env(safe-area-inset-left, 0px))`;
      mount.style.right = "auto";
    } else {
      mount.style.right = `max(8px, env(safe-area-inset-right, 0px))`;
      mount.style.left = "auto";
    }
  }

  function applyFreePosition(left: number, top: number): void {
    const rw = mount.offsetWidth || 228;
    const rh = mount.offsetHeight || 56;
    const L = clamp(left, 4, window.innerWidth - rw - 4);
    const T = clamp(top, 4, window.innerHeight - rh - 4);
    mount.style.position = "fixed";
    mount.style.left = `${L}px`;
    mount.style.top = `${T}px`;
    mount.style.right = "auto";
    mount.style.bottom = "auto";
    mount.style.transform = "none";
    mount.style.width = "max-content";
    mount.style.maxWidth = "min(232px, calc(100vw - 12px))";
    mount.style.zIndex = "1185";
  }

  function onResizeDock(): void {
    const h = mount.offsetHeight || 56;
    bottomPx = clamp(bottomPx, 8, Math.max(8, window.innerHeight - h - 8));
    if (!dragging) applyDockPosition();
  }

  const audio = el("audio", {
    class: "music-mini-player__audio-el",
    preload: "metadata",
  });

  let currentIndex = 0;
  let seekDragging = false;
  let playlistOpen = false;

  const btnPrev = el("button", { type: "button", class: "music-mini-player__icon-btn" }, []);
  btnPrev.setAttribute("aria-label", "上一首");
  btnPrev.innerHTML = iconSvg("M12 18V6l-8 6 8 6z", 16);

  const btnPlay = el("button", { type: "button", class: "music-mini-player__icon-btn music-mini-player__icon-btn--primary" }, []);
  btnPlay.setAttribute("aria-label", "播放");
  btnPlay.innerHTML = iconSvg("M8 5v14l11-7z", 16);

  const btnNext = el("button", { type: "button", class: "music-mini-player__icon-btn" }, []);
  btnNext.setAttribute("aria-label", "下一首");
  btnNext.innerHTML = iconSvg("M12 6v12l8-6-8-6z", 16);

  const artBox = el("div", { class: "music-mini-player__art" }, []);
  const artImg = el("img", {
    class: "music-mini-player__art-img",
    alt: "",
    decoding: "async",
  });
  artImg.hidden = true;
  const artPh = el("div", { class: "music-mini-player__art-ph", ariaHidden: "true" }, ["♪"]);
  artBox.append(artImg, artPh);

  const titleEl = el("div", { class: "music-mini-player__title" }, ["—"]);
  const trackIxEl = el("div", { class: "music-mini-player__track-ix" }, []);
  trackIxEl.hidden = true;
  const artistEl = el("div", { class: "music-mini-player__artist" }, []);

  const seek = el("input", {
    type: "range",
    class: "music-mini-player__seek",
    min: "0",
    max: "0",
    step: "0.25",
    value: "0",
  });
  seek.setAttribute("aria-label", "播放進度");

  const timeEl = el("span", { class: "music-mini-player__time" }, ["0:00 / 0:00"]);

  const btnList = el("button", { type: "button", class: "music-mini-player__icon-btn music-mini-player__icon-btn--sm" }, []);
  btnList.setAttribute("aria-label", "曲目清單");
  btnList.setAttribute("aria-expanded", "false");
  btnList.innerHTML = iconSvg("M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h11v2H4v-2z", 16);

  const volIcon = el("span", { class: "music-mini-player__vol-icon", ariaHidden: "true" }, []);
  volIcon.innerHTML = iconSvg(
    "M3 10v4h4l5 5V5L7 10H3zm13.5 2c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
    16,
  );

  const vol = el("input", {
    type: "range",
    class: "music-mini-player__vol",
    min: "0",
    max: "1",
    step: "0.05",
    value: "0.85",
  });
  vol.setAttribute("aria-label", "音量");

  try {
    const saved = localStorage.getItem("mr_music_vol");
    if (saved != null) {
      const n = Number(saved);
      if (Number.isFinite(n) && n >= 0 && n <= 1) vol.value = String(n);
    }
  } catch {
    /* ignore */
  }

  const playlistPop = el("div", { class: "music-mini-player__playlist-pop", hidden: true }, []);
  const playlistHead = el("div", { class: "music-mini-player__playlist-head" }, ["選擇曲目"]);
  const playlistBody = el("div", { class: "music-mini-player__playlist-body" }, []);
  const attr = el("p", { class: "music-mini-player__attr music-mini-player__attr--in-pop" }, [
    "Kevin MacLeod（",
    el("a", {
      class: "music-mini-player__attr-link",
      href: "https://incompetech.com/music/royalty-free/music.html",
      target: "_blank",
      rel: "noopener noreferrer",
    }, ["incompetech.com"]),
    "）· ",
    el("a", {
      class: "music-mini-player__attr-link",
      href: "https://creativecommons.org/licenses/by/4.0/",
      target: "_blank",
      rel: "noopener noreferrer",
    }, ["CC BY 4.0"]),
    " 署名。",
  ]);
  playlistPop.append(playlistHead, playlistBody, attr);

  function rebuildPlaylistButtons() {
    playlistBody.replaceChildren();
    MUSIC_PLAYLIST.forEach((t, idx) => {
      const row = el("button", { type: "button", class: "music-mini-player__pl-item" }, []);
      row.append(t.title);
      if (t.artist?.trim()) {
        row.append(el("span", { class: "music-mini-player__pl-artist" }, [` · ${t.artist.trim()}`]));
      }
      row.addEventListener("click", () => {
        setPlaylistOpen(false);
        void loadTrack(idx, true);
      });
      playlistBody.append(row);
    });
  }

  function setPlaylistOpen(open: boolean) {
    playlistOpen = open;
    playlistPop.hidden = !open;
    btnList.setAttribute("aria-expanded", String(open));
    wrap.classList.toggle("music-mini-player--playlist-open", open);
  }

  function syncPlayButton(playing: boolean) {
    btnPlay.setAttribute("aria-label", playing ? "暫停" : "播放");
    btnPlay.innerHTML = playing
      ? iconSvg("M6 19h4V5H6v14zm8 0h4V5h-4v14z", 16)
      : iconSvg("M8 5v14l11-7z", 16);
  }

  function syncTrackCounter() {
    const n = MUSIC_PLAYLIST.length;
    if (n === 0) {
      trackIxEl.textContent = "";
      trackIxEl.hidden = true;
      return;
    }
    trackIxEl.hidden = false;
    trackIxEl.textContent = `第 ${currentIndex + 1} 首 · 共 ${n} 首`;
  }

  function applyMeta(track: MusicTrack) {
    titleEl.textContent = track.title;
    const n = MUSIC_PLAYLIST.length;
    const ix = n > 0 ? `第 ${currentIndex + 1}/${n} 首` : "";
    const tipArtist = track.artist?.trim() ? `${track.title} — ${track.artist.trim()}` : track.title;
    titleEl.title = ix ? `${tipArtist}（${ix}）` : tipArtist;
    artistEl.textContent = track.artist?.trim() ? track.artist.trim() : "舒壓配樂";
    artistEl.setAttribute("aria-hidden", "true");
    if (track.artUrl) {
      artImg.src = track.artUrl;
      artImg.hidden = false;
      artPh.hidden = true;
    } else {
      artImg.removeAttribute("src");
      artImg.hidden = true;
      artPh.hidden = false;
    }
  }

  function syncSeekUi() {
    const d = audio.duration;
    if (!seekDragging) {
      if (Number.isFinite(d) && d > 0) {
        seek.max = String(d);
        seek.value = String(audio.currentTime);
      } else {
        seek.max = "0";
        seek.value = "0";
      }
    }
    const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const tot = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    timeEl.textContent = `${formatTime(cur)} / ${formatTime(tot)}`;
  }

  async function loadTrack(index: number, autoplay: boolean) {
    const n = MUSIC_PLAYLIST.length;
    if (n === 0) {
      syncTrackCounter();
      return;
    }
    currentIndex = ((index % n) + n) % n;
    const track = MUSIC_PLAYLIST[currentIndex]!;
    applyMeta(track);
    syncTrackCounter();
    audio.src = track.src;
    audio.load();
    syncSeekUi();
    if (autoplay) {
      try {
        await audio.play();
      } catch {
        syncPlayButton(false);
      }
    } else {
      syncPlayButton(false);
    }
  }

  btnPrev.addEventListener("click", () => {
    void loadTrack(currentIndex - 1, !audio.paused);
  });
  btnNext.addEventListener("click", () => {
    void loadTrack(currentIndex + 1, !audio.paused);
  });
  btnPlay.addEventListener("click", async () => {
    if (!audio.src && MUSIC_PLAYLIST.length > 0) {
      await loadTrack(currentIndex, true);
      return;
    }
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        syncPlayButton(false);
      }
    } else {
      audio.pause();
    }
  });

  seek.addEventListener("pointerdown", () => {
    seekDragging = true;
  });
  seek.addEventListener("pointerup", () => {
    seekDragging = false;
    syncSeekUi();
  });
  seek.addEventListener("input", () => {
    const d = audio.duration;
    if (Number.isFinite(d) && d > 0) {
      audio.currentTime = Number(seek.value);
    }
  });

  vol.addEventListener("input", () => {
    const v = Number(vol.value);
    audio.volume = v;
    try {
      localStorage.setItem("mr_music_vol", String(v));
    } catch {
      /* ignore */
    }
  });

  btnList.addEventListener("click", (e) => {
    e.stopPropagation();
    setPlaylistOpen(!playlistOpen);
  });

  function onDocClick() {
    if (playlistOpen) setPlaylistOpen(false);
  }
  document.addEventListener("click", onDocClick);
  wrap.addEventListener("click", (e) => e.stopPropagation());

  function onPlaylistEscape(ev: KeyboardEvent) {
    if (ev.key !== "Escape" || !playlistOpen) return;
    ev.stopPropagation();
    setPlaylistOpen(false);
  }
  document.addEventListener("keydown", onPlaylistEscape);

  audio.addEventListener("timeupdate", syncSeekUi);
  audio.addEventListener("loadedmetadata", syncSeekUi);
  audio.addEventListener("durationchange", syncSeekUi);
  audio.addEventListener("play", () => syncPlayButton(true));
  audio.addEventListener("pause", () => syncPlayButton(false));
  audio.addEventListener("ended", () => {
    void loadTrack(currentIndex + 1, true);
  });

  const dragHandle = el("div", {
    class: "music-mini-player__drag",
    tabIndex: 0,
    title: "此條可立即拖曳；其餘區域長按約半秒亦可拖曳（放開後黏左／右下緣）。",
  });
  dragHandle.setAttribute("role", "button");
  dragHandle.setAttribute("aria-label", "拖曳播放器位置");

  const rowTop = el("div", { class: "music-mini-player__row music-mini-player__row--top" }, []);
  const left = el("div", { class: "music-mini-player__left" }, [btnPrev, btnPlay, btnNext]);
  const meta = el("div", { class: "music-mini-player__meta" }, [
    artBox,
    el("div", { class: "music-mini-player__text" }, [titleEl, trackIxEl, artistEl]),
  ]);
  const prog = el("div", { class: "music-mini-player__prog" }, [seek, timeEl]);
  const volWrap = el("div", { class: "music-mini-player__vol-wrap" }, [volIcon, vol]);
  rowTop.append(dragHandle, left, btnList);
  const rowMeta = el("div", { class: "music-mini-player__row music-mini-player__row--meta" }, [meta]);
  const rowMid = el("div", { class: "music-mini-player__row music-mini-player__row--mid" }, [prog]);
  const rowBot = el("div", { class: "music-mini-player__row music-mini-player__row--bot" }, [volWrap]);
  const rowsWrap = el("div", { class: "music-mini-player__rows" }, [rowTop, rowMeta, rowMid, rowBot]);
  rowsWrap.title = "長按空白處約半秒可拖曳整個播放器（按鈕、進度與音量除外）；左側凸條可立即拖曳。";

  const shell = el("div", { class: "music-mini-player__shell" }, []);
  shell.append(audio, rowsWrap, playlistPop);
  wrap.append(shell);
  mount.append(wrap);

  function isDragExcludedTarget(t: EventTarget | null): boolean {
    if (!(t instanceof Element)) return true;
    if (dragHandle.contains(t)) return true;
    return Boolean(t.closest("button, input, textarea, select, a, label"));
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
    const cap = dragCaptureEl;
    dragCaptureEl = null;
    try {
      cap?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
    const r = mount.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    dockSide = cx < window.innerWidth / 2 ? "left" : "right";
    bottomPx = Math.round(window.innerHeight - r.bottom);
    const h = r.height;
    bottomPx = clamp(bottomPx, 8, Math.max(8, window.innerHeight - h - 8));
    persistDock();
    applyDockPosition();
  }

  function beginDragWithCoords(
    pointerId: number,
    clientX: number,
    clientY: number,
    pointerType: string,
    button: number,
    captureTarget: HTMLElement,
  ): void {
    if (dragging) return;
    if (pointerType === "mouse" && button !== 0) return;
    dragging = true;
    dragPointerId = pointerId;
    dragCaptureEl = captureTarget;
    const r = mount.getBoundingClientRect();
    grabOffX = clientX - r.left;
    grabOffY = clientY - r.top;
    try {
      captureTarget.setPointerCapture(pointerId);
    } catch {
      /* ignore */
    }
    window.addEventListener("pointermove", onDragMove, { passive: false });
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("pointercancel", onDragEnd);
  }

  function beginDragFromPointer(e: PointerEvent, captureTarget: HTMLElement): void {
    beginDragWithCoords(e.pointerId, e.clientX, e.clientY, e.pointerType, e.button, captureTarget);
  }

  dragHandle.addEventListener("pointerdown", (e) => {
    clearLongPressPending();
    beginDragFromPointer(e, dragHandle);
  });

  rowsWrap.addEventListener("pointerdown", (e) => {
    if (dragging) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (isDragExcludedTarget(e.target)) return;
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
      beginDragWithCoords(p.pointerId, p.lastX, p.lastY, p.pointerType, p.button, rowsWrap);
    }, LONG_PRESS_MS);
  });

  readDockPersist();
  applyDockPosition();
  window.addEventListener("resize", onResizeDock);

  rebuildPlaylistButtons();
  audio.volume = Number(vol.value);
  void loadTrack(0, false);

  return () => {
    clearLongPressPending();
    window.removeEventListener("resize", onResizeDock);
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    window.removeEventListener("pointercancel", onDragEnd);
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onPlaylistEscape);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    mount.replaceChildren();
  };
}
