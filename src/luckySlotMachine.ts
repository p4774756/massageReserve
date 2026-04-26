import {
  slotBulbSvg,
  slotLeverSvg,
  type SlotIconId,
  slotPrizeIconSvg,
  slotReelAdBadgeSvg,
  slotTvSvg,
} from "./luckySlotIcons";
import { showRewardedAdWeb } from "./rewardedAdWeb";

type TFn = (key: string, zh: string) => string;

export type SlotPrize = { id: string; label: string; iconId: SlotIconId };

/** 示範用獎項帶（與實際優惠無關）— 圖示為手遊風 SVG */
export const LUCKY_SLOT_DEMO_STRIP: SlotPrize[] = [
  { id: "energy", label: "能量", iconId: "energy" },
  { id: "shuriken", label: "手裡劍", iconId: "shuriken" },
  { id: "c88", label: "×88", iconId: "coin" },
  { id: "wheel", label: "輪盤+1", iconId: "wheel" },
  { id: "drink", label: "飲料", iconId: "drink" },
  { id: "luck", label: "幸運星", iconId: "sparkle" },
];

/** 須與 `.lucky-slot-cell` / `.lucky-slot-reel-window` 高度一致 */
const CELL_PX = 88;
const STRIP_REPEAT = 28;

function h<K extends keyof HTMLElementTagNameMap>(
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

function buildStripCells(strip: SlotPrize[]): HTMLElement[] {
  const cells: HTMLElement[] = [];
  for (let r = 0; r < STRIP_REPEAT; r++) {
    strip.forEach((p, pi) => {
      const uid = `r${r}i${pi}${p.id}`;
      const iconWrap = h("span", { class: "lucky-slot-cell__icon" });
      iconWrap.innerHTML = slotPrizeIconSvg(p.iconId, uid);
      const label = h("span", { class: "lucky-slot-cell__label" }, [p.label]);
      const cellClass =
        p.iconId === "coin" ? "lucky-slot-cell lucky-slot-cell--coin" : "lucky-slot-cell";
      const cell = h("div", { class: cellClass }, [iconWrap, label]);
      cells.push(cell);
    });
  }
  return cells;
}

function pickFinalIndex(len: number): number {
  return Math.floor(Math.random() * len);
}

export function mountLuckySlotMachine(container: HTMLElement, t: TFn): void {
  const stripLen = LUCKY_SLOT_DEMO_STRIP.length;
  const totalCells = STRIP_REPEAT * stripLen;

  const status = h("p", { class: "lucky-slot-status status-line", role: "status" });
  const bulb = h("div", { class: "lucky-slot-machine__bulb" });
  bulb.innerHTML = slotBulbSvg();
  bulb.setAttribute("aria-hidden", "true");

  const marqueeLed = h("div", { class: "lucky-slot-machine__marquee" }, [
    t("luckySlot.marqueeLed", "LET'S GO!!!"),
  ]);
  const marqueeSub = h("div", { class: "lucky-slot-machine__marquee-sub" }, [
    t("luckySlot.marqueeSub", "試玩轉轉 · 獎項示意"),
  ]);
  const marqueeCol = h("div", { class: "lucky-slot-machine__marquee-col" });
  marqueeCol.append(marqueeLed, marqueeSub);

  const dot = () => h("span", { class: "lucky-slot-machine__marquee-dot" });
  const marqueeLightsL = h("div", { class: "lucky-slot-machine__marquee-lights lucky-slot-machine__marquee-lights--l" }, [
    dot(),
    dot(),
    dot(),
  ]);
  const marqueeLightsR = h("div", { class: "lucky-slot-machine__marquee-lights lucky-slot-machine__marquee-lights--r" }, [
    dot(),
    dot(),
    dot(),
  ]);
  const marqueeBezel = h("div", { class: "lucky-slot-machine__marquee-bezel" }, [
    marqueeLightsL,
    marqueeCol,
    marqueeLightsR,
  ]);

  const reelsWrap = h("div", { class: "lucky-slot-reels" });
  const strips: HTMLElement[] = [];

  /** 仿廣告五軸：淺棕／白槽位交錯（0,1,3 暖底；2,4 亮白） */
  const reelPaperClass = (idx: number) =>
    [0, 1, 3].includes(idx)
      ? "lucky-slot-reel-column lucky-slot-reel-column--paper-warm"
      : "lucky-slot-reel-column lucky-slot-reel-column--paper-bright";

  Array.from({ length: 5 }, (_, reelIdx) => {
    const col = h("div", { class: reelPaperClass(reelIdx) });
    const win = h("div", { class: "lucky-slot-reel-window" });
    const strip = h("div", { class: "lucky-slot-reel-strip" });
    strip.append(...buildStripCells(LUCKY_SLOT_DEMO_STRIP));
    win.append(strip);
    col.append(win);
    if (reelIdx === 0 || reelIdx === 4) {
      const badge = h("div", { class: "lucky-slot-reel-ad-badge" });
      badge.innerHTML = slotReelAdBadgeSvg(`col${reelIdx}`);
      badge.setAttribute("title", t("luckySlot.reelAdHint", "可接獎勵廣告之格（示意）"));
      col.append(badge);
    }
    reelsWrap.append(col);
    strips.push(strip);
  });

  const leverBtn = h("button", { type: "button", class: "lucky-slot-lever" });
  leverBtn.setAttribute("aria-label", t("luckySlot.leverAria", "拉桿開始轉動"));
  const leverWrap = h("span", { class: "lucky-slot-lever__svg-wrap" });
  leverWrap.innerHTML = slotLeverSvg();
  leverBtn.append(leverWrap);

  const spinBtn = h("button", { type: "button", class: "lucky-slot-btn lucky-slot-btn--spin" }, [
    t("luckySlot.spin", "拉把開轉"),
  ]);
  const claimBtn = h("button", { type: "button", class: "lucky-slot-btn lucky-slot-btn--claim", disabled: true }, [
    t("luckySlot.claim", "宣稱"),
  ]);
  const claimAdBtn = h("button", { type: "button", class: "lucky-slot-btn lucky-slot-btn--ad" }, [
    t("luckySlot.claimWithAd", "要求全部"),
  ]);
  const playIco = h("span", { class: "lucky-slot-btn__play-ico" }, ["▶"]);
  playIco.setAttribute("aria-hidden", "true");
  claimAdBtn.append(playIco);

  const hint = h("p", { class: "hint lucky-slot-hint" }, [
    t(
      "luckySlot.hint",
      "獎項為前端亂數示範。真實獎勵廣告需接 Google Ad Manager／IMA 等；若注入 window.__MR_rewardedShow() 則此鍵會改播您的實作。",
    ),
  ]);

  const stage = h("div", { class: "lucky-slot-machine__stage" }, [
    reelsWrap,
    h("div", { class: "lucky-slot-machine__lever-rail" }, [leverBtn]),
  ]);

  const decorDots = h("div", { class: "lucky-slot-machine__nobs" }, [
    h("span", { class: "lucky-slot-machine__nob lucky-slot-machine__nob--g" }),
    h("span", { class: "lucky-slot-machine__nob lucky-slot-machine__nob--r" }),
    h("span", { class: "lucky-slot-machine__nob lucky-slot-machine__nob--b" }),
  ]);

  const pipes = h("div", { class: "lucky-slot-machine__pipes" });
  decorDots.setAttribute("aria-hidden", "true");
  pipes.setAttribute("aria-hidden", "true");

  const consoleRow = h("div", { class: "lucky-slot-machine__console" }, [spinBtn, claimBtn]);

  const tvDeco = h("div", { class: "lucky-slot-machine__tv" });
  tvDeco.innerHTML = slotTvSvg();
  tvDeco.setAttribute("aria-hidden", "true");
  const adRow = h("div", { class: "lucky-slot-machine__ad-row" });
  adRow.append(tvDeco, claimAdBtn);

  /** 僅底部按鈕區做透視前傾；上半機台保持正面平直 */
  const deck3d = h("div", { class: "lucky-slot-machine__deck-3d" }, [consoleRow, adRow]);

  const siren = h("div", { class: "lucky-slot-machine__siren" });
  siren.setAttribute("aria-hidden", "true");
  const chromeTop = h("div", { class: "lucky-slot-machine__chrome-top" }, [siren, marqueeBezel, bulb]);

  const machine = h("div", { class: "lucky-slot-machine" }, [
    chromeTop,
    stage,
    decorDots,
    pipes,
    deck3d,
  ]);

  container.append(machine, status, hint);

  let spinning = false;
  let lastIndices: [number, number, number, number, number] | null = null;

  function setStripY(stripEl: HTMLElement, cellIndex: number, withTransition: boolean, durationMs: number) {
    stripEl.style.transition = withTransition ? `transform ${durationMs}ms cubic-bezier(0.12, 0.72, 0.12, 1)` : "none";
    stripEl.style.transform = `translateY(-${cellIndex * CELL_PX}px)`;
  }

  function randomStartIndex(): number {
    return Math.floor(Math.random() * Math.min(8 * stripLen, totalCells - 10 * stripLen));
  }

  function initPositions() {
    strips.forEach((strip) => {
      setStripY(strip, randomStartIndex(), false, 0);
    });
  }
  initPositions();

  function doSpin() {
    if (spinning) return;
    spinning = true;
    lastIndices = null;
    claimBtn.disabled = true;
    status.textContent = t("luckySlot.spinning", "轉動中…");
    spinBtn.disabled = true;
    leverBtn.disabled = true;
    leverBtn.classList.add("lucky-slot-lever--pull");

    const targets: [number, number, number, number, number] = [
      pickFinalIndex(stripLen),
      pickFinalIndex(stripLen),
      pickFinalIndex(stripLen),
      pickFinalIndex(stripLen),
      pickFinalIndex(stripLen),
    ];
    lastIndices = targets;

    const baseSpins = [9, 11, 13, 15, 17];
    const durs = [2000, 2400, 2800, 3200, 3600];

    strips.forEach((strip, reelIdx) => {
      const fi = targets[reelIdx];
      const startIdx = randomStartIndex();
      setStripY(strip, startIdx, false, 0);
      const endCell = baseSpins[reelIdx] * stripLen + fi;
      strip.getBoundingClientRect();
      requestAnimationFrame(() => {
        setStripY(strip, endCell, true, durs[reelIdx]);
      });
    });

    const maxDur = Math.max(...durs);
    window.setTimeout(() => {
      spinning = false;
      spinBtn.disabled = false;
      leverBtn.disabled = false;
      leverBtn.classList.remove("lucky-slot-lever--pull");
      claimBtn.disabled = false;
      status.textContent = t("luckySlot.stopped", "已停輪。可領取或選擇看廣告領全部（示範）。");
    }, maxDur + 80);
  }

  /** 滑鼠／觸控以 pointerdown 先觸發，避免被上層攔截或僅收到延遲 click；鍵盤啟動仍靠 click */
  function bindPrimarySpin(el: HTMLElement) {
    el.addEventListener("pointerdown", (ev: PointerEvent) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      doSpin();
    });
    el.addEventListener("click", doSpin);
  }
  bindPrimarySpin(spinBtn);
  bindPrimarySpin(leverBtn);

  claimBtn.addEventListener("click", () => {
    if (!lastIndices || spinning) return;
    const parts = lastIndices.map((i) => {
      const p = LUCKY_SLOT_DEMO_STRIP[i];
      return `${p.label}`;
    });
    status.textContent = t("luckySlot.claimed", "已領取（示範）：") + parts.join(" · ");
  });

  claimAdBtn.addEventListener("click", async () => {
    if (!lastIndices || spinning) {
      status.textContent = t("luckySlot.needSpinFirst", "請先轉一次再領取。");
      return;
    }
    claimAdBtn.disabled = true;
    const ok = await showRewardedAdWeb({
      title: t("luckySlot.adTitle", "獎勵內容（示範）"),
      body: t("luckySlot.adBody", "真實環境會在此播放影片廣告。若已設定 window.__MR_rewardedShow，將改為您的 SDK。"),
      completeLabel: t("luckySlot.adComplete", "模擬觀看完畢"),
      cancelLabel: t("luckySlot.adCancel", "取消"),
    });
    claimAdBtn.disabled = false;
    if (!ok) {
      status.textContent = t("luckySlot.adCancelled", "已取消，未發放。");
      return;
    }
    const parts = lastIndices.map((i) => {
      const p = LUCKY_SLOT_DEMO_STRIP[i];
      return `${p.label}`;
    });
    status.textContent = t("luckySlot.claimedAd", "看廣告後已領取全部（示範）：") + parts.join(" · ");
  });
}
