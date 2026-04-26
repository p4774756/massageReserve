import { t } from "./i18n";

/**
 * 舒壓配樂浮動播放器：進度條、時間、曲名與序號、播放控制、曲目清單、音量。
 * 頂列左為拖曳握把、右為摺疊／展開（`mr_music_collapsed`）；摺疊時隱藏主面板，仍可拖移。
 * 由 `main.ts` 掛在 `#app` 內之固定浮層根節點（版面見 `style.css` 之 `--float`）。
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

export type MusicMiniPlayerMountOptions = {
  /** 摺疊／展開後呼叫，讓浮層依新高度重新貼邊 */
  onBoundsChange?: () => void;
};

export type MusicMiniPlayerMountHandle = {
  dispose: () => void;
  /** 長按此區塊可拖曳整個浮層（與客服浮窗相同機制） */
  floatDragTarget: HTMLElement;
};

const MUSIC_COLLAPSED_KEY = "mr_music_collapsed";

export function mountMusicMiniPlayer(
  mount: HTMLElement,
  opts?: MusicMiniPlayerMountOptions,
): MusicMiniPlayerMountHandle {
  const wrap = el("div", {
    class: "music-mini-player music-mini-player--bar music-mini-player--float",
    role: "region",
    ariaLabel: t(
      "music.player.region",
      "舒壓配樂浮動播放器；頂端橫條可拖移位置。",
    ),
  });

  const audio = el("audio", {
    class: "music-mini-player__audio-el",
    preload: "metadata",
  });

  let currentIndex = 0;
  let seekDragging = false;
  let playlistOpen = false;
  let shellCollapsed = false;
  try {
    shellCollapsed = localStorage.getItem(MUSIC_COLLAPSED_KEY) === "1";
  } catch {
    /* ignore */
  }

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
    draggable: false,
  });
  artImg.hidden = true;
  const artPh = el("div", { class: "music-mini-player__art-ph", ariaHidden: "true" }, ["♪"]);
  artBox.append(artImg, artPh);

  const titleWrap = el("div", { class: "music-mini-player__title-wrap", role: "group" });
  const titleTrack = el("div", { class: "music-mini-player__title-track" });
  titleTrack.setAttribute("aria-hidden", "true");
  const titleSegA = el("span", { class: "music-mini-player__title-seg" }, ["—"]);
  const titleSegB = el("span", { class: "music-mini-player__title-seg" }, []);
  titleTrack.append(titleSegA, titleSegB);
  titleWrap.append(titleTrack);

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

  const timeCurEl = el("span", { class: "music-bar__time music-bar__time--cur" }, ["0:00"]);
  const timeRemEl = el("span", { class: "music-bar__time music-bar__time--rem" }, ["-0:00"]);

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

  function updateTitleMarquee() {
    requestAnimationFrame(() => {
      const t = titleSegA.textContent ?? "";
      titleSegB.textContent = "";
      titleWrap.classList.remove("music-mini-player__title-wrap--scroll");
      titleTrack.style.removeProperty("animation");
      void titleWrap.offsetWidth;
      const w = titleWrap.clientWidth;
      if (!t.trim() || w < 12) {
        return;
      }
      const singleW = titleSegA.scrollWidth;
      if (singleW <= w + 2) {
        return;
      }
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      titleSegB.textContent = t;
      void titleWrap.offsetWidth;
      const dur = Math.min(32, Math.max(8, singleW / 18));
      titleTrack.style.setProperty("--marquee-sec", `${dur}s`);
      titleWrap.classList.add("music-mini-player__title-wrap--scroll");
    });
  }

  function onTitleMarqueeResize() {
    updateTitleMarquee();
  }
  window.addEventListener("resize", onTitleMarqueeResize);

  function applyMeta(track: MusicTrack) {
    titleSegA.textContent = track.title;
    titleSegB.textContent = "";
    const n = MUSIC_PLAYLIST.length;
    const ix = n > 0 ? `第 ${currentIndex + 1}/${n} 首` : "";
    const tipArtist = track.artist?.trim() ? `${track.title} — ${track.artist.trim()}` : track.title;
    const fullLabel = ix ? `${tipArtist}（${ix}）` : tipArtist;
    titleWrap.title = fullLabel;
    titleWrap.setAttribute("aria-label", fullLabel);
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
    updateTitleMarquee();
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
    timeCurEl.textContent = formatTime(cur);
    if (tot > 0) {
      timeRemEl.textContent = `-${formatTime(Math.max(0, tot - cur))}`;
    } else {
      timeRemEl.textContent = "-0:00";
    }
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

  const seekWrap = el("div", { class: "music-bar__seek-wrap" }, [seek]);
  const timesRow = el("div", { class: "music-bar__times" }, [timeCurEl, timeRemEl]);
  const metaText = el("div", { class: "music-mini-player__text" }, [titleWrap, trackIxEl, artistEl]);
  const meta = el("div", { class: "music-bar__meta" }, [artBox, metaText]);
  const ctrl = el("div", { class: "music-bar__ctrl" }, [btnPrev, btnPlay, btnNext, btnList]);
  const volWrap = el("div", { class: "music-bar__vol" }, [volIcon, vol]);
  const mainRow = el("div", { class: "music-bar__main" }, [meta, ctrl, volWrap]);
  const barInner = el("div", { class: "music-bar__inner" }, [seekWrap, timesRow, mainRow]);

  const dragHandle = el("button", { type: "button", class: "music-float__drag-handle" }, []);
  dragHandle.setAttribute(
    "aria-label",
    t("music.float.dragHandle", "拖移播放器：按住頂端左側握把拖曳"),
  );
  dragHandle.title = t(
    "music.float.dragHandleHint",
    "按住並拖曳可改變位置；放開後貼在螢幕左或右下角。",
  );
  dragHandle.append(
    el("span", { class: "music-float__drag-handle__grip", ariaHidden: "true" }, []),
  );

  const btnCollapse = el("button", { type: "button", class: "music-float__collapse-toggle" }, []);
  btnCollapse.setAttribute("aria-controls", "music-mini-player-shell-panel");

  const topBar = el("div", { class: "music-float__top-bar" }, [dragHandle, btnCollapse]);

  const shell = el("div", { class: "music-mini-player__shell", id: "music-mini-player-shell-panel" }, []);
  shell.append(audio, barInner, playlistPop);
  wrap.append(topBar, shell);
  mount.append(wrap);

  function applyShellCollapseUi() {
    shell.hidden = shellCollapsed;
    wrap.classList.toggle("music-mini-player--collapsed", shellCollapsed);
    btnCollapse.setAttribute("aria-expanded", String(!shellCollapsed));
    btnCollapse.setAttribute(
      "aria-label",
      shellCollapsed
        ? t("music.float.expand", "展開播放器")
        : t("music.float.collapse", "摺疊播放器"),
    );
    btnCollapse.title = shellCollapsed
      ? t("music.float.expandHint", "顯示曲目、進度與音量")
      : t("music.float.collapseHint", "隱藏主面板，僅保留頂列（仍可拖移）");
    btnCollapse.innerHTML = shellCollapsed
      ? iconSvg("M7 10l5 5 5-5z", 16)
      : iconSvg("M7 14l5-5 5 5z", 16);
    wrap.setAttribute(
      "aria-label",
      shellCollapsed
        ? t(
            "music.player.regionCollapsed",
            "舒壓配樂浮動播放器（已摺疊）；左側可拖移位置，右側可展開。",
          )
        : t("music.player.region", "舒壓配樂浮動播放器；頂端橫條可拖移位置。"),
    );
  }

  function setShellCollapsed(next: boolean) {
    if (next) setPlaylistOpen(false);
    shellCollapsed = next;
    try {
      localStorage.setItem(MUSIC_COLLAPSED_KEY, shellCollapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
    applyShellCollapseUi();
    opts?.onBoundsChange?.();
    if (!shellCollapsed) {
      requestAnimationFrame(() => updateTitleMarquee());
    }
  }

  btnCollapse.addEventListener("click", (e) => {
    e.stopPropagation();
    setShellCollapsed(!shellCollapsed);
  });

  applyShellCollapseUi();

  rebuildPlaylistButtons();
  audio.volume = Number(vol.value);
  void loadTrack(0, false);

  function dispose(): void {
    window.removeEventListener("resize", onTitleMarqueeResize);
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onPlaylistEscape);
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    mount.replaceChildren();
  }

  return { dispose, floatDragTarget: dragHandle };
}
