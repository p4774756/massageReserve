/**
 * 吃角子老虎全螢幕演出：單軸垂直捲軸；使用者拉桿／按鈕後才呼叫 spinFn；結果由後端決定。
 */

import { t } from "./i18n";
import {
  computeSplitY,
  getSpectacleAudioContext,
  playCrackBang,
  playWinStinger,
  startSpinDrone,
} from "./spectacleFanfare";
import { prefetchWheelSfx, playBufferAt, type PrefetchedWheelSfx } from "./wheelSpectacleSfx";
import type { RunWheelSpectacleOptions, SpinWheelSpectacleResult, WheelPrizeLabel } from "./wheelSpectacle";

export type RunSlotSpectacleOptions = RunWheelSpectacleOptions;

const CURTAIN_MOVE_MS = 1900;
const CURTAIN_OPEN_WAIT_MS = CURTAIN_MOVE_MS + 180;
const CURTAIN_CLOSE_WAIT_MS = CURTAIN_MOVE_MS + 320;

const CELL_PX = 52;
const VISIBLE_ROWS = 3;
const CENTER_ROW = 1;

/** 街機捲軸符色：金、紅、綠 BAR、藍、焰橘等（呼應經典老虎機） */
const ACCENT_COLORS = [
  "#f0c940",
  "#e03131",
  "#2f9e44",
  "#fcc419",
  "#1c7ed6",
  "#fd7e14",
  "#9775fa",
  "#ffd43b",
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shufflePeriod(prizes: WheelPrizeLabel[], seed: number): WheelPrizeLabel[] {
  const rng = mulberry32(seed >>> 0);
  const out = prizes.map((p) => ({ id: p.id, name: p.name, weight: p.weight }));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function buildReelStrip(
  prizes: WheelPrizeLabel[],
  winId: string,
  winSeed: number,
): { strip: WheelPrizeLabel[]; stopIndex: number } {
  const period = shufflePeriod(prizes, winSeed + 401);
  const repeats = 28;
  const strip: WheelPrizeLabel[] = [];
  for (let r = 0; r < repeats; r++) strip.push(...period);
  const plen = period.length;
  const minIdx = plen * 9 + CENTER_ROW;
  const candidates: number[] = [];
  for (let i = minIdx; i < strip.length - 2; i++) {
    if (strip[i]?.id === winId) candidates.push(i);
  }
  const stopIndex =
    candidates.length > 0 ? candidates[candidates.length - 1]! : Math.min(minIdx + plen, strip.length - 2);
  return { strip, stopIndex };
}

function seedFromWinId(winId: string): number {
  let h = 2166136261;
  for (let i = 0; i < winId.length; i++) {
    h ^= winId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function normalizePrizeList(
  list: WheelPrizeLabel[] | null,
  win?: { id?: string; name: string } | null,
): WheelPrizeLabel[] {
  const base =
    list && list.length > 0
      ? list.map((p) => ({ id: p.id, name: p.name, weight: p.weight }))
      : [];
  if (win?.id && !base.some((p) => p.id === win.id)) {
    base.push({ id: win.id, name: win.name, weight: 1 });
  }
  if (base.length === 0) {
    return [
      { id: "s7", name: "777", weight: 1 },
      { id: "sB", name: "BAR", weight: 1 },
      { id: "sC", name: "🍒", weight: 1 },
      { id: "sL", name: "🍋", weight: 1 },
      { id: "s★", name: "★", weight: 1 },
    ];
  }
  return base;
}

function accentIndexForId(prizes: WheelPrizeLabel[], id: string): number {
  const i = prizes.findIndex((p) => p.id === id);
  return i >= 0 ? i : 0;
}

function prizeCellIcon(p: WheelPrizeLabel): string {
  const n = p.name;
  const id = p.id.toLowerCase();
  if (id.includes("chance") || /再抽|extra|spin|again/i.test(n)) return "🎁";
  if (id.includes("thanks") || /謝|thanks/i.test(n)) return "💜";
  if (/點|pts|point|wallet|credit|\+/i.test(n) || id.includes("pts")) return "🪙";
  return "⭐";
}

function fillStripEl(stripEl: HTMLElement, strip: WheelPrizeLabel[], prizes: WheelPrizeLabel[]) {
  stripEl.replaceChildren();
  for (const p of strip) {
    const cell = document.createElement("div");
    cell.className = "slot-spectacle-cell";
    const ix = accentIndexForId(prizes, p.id) % ACCENT_COLORS.length;
    cell.style.setProperty("--slot-accent", ACCENT_COLORS[ix]!);
    const raw = p.name.trim();
    const shown = raw.length > 10 ? `${raw.slice(0, 9)}…` : raw;
    cell.title = p.name;
    const ico = document.createElement("span");
    ico.className = "slot-spectacle-cell-ico";
    ico.setAttribute("aria-hidden", "true");
    ico.textContent = prizeCellIcon(p);
    const txt = document.createElement("span");
    txt.className = "slot-spectacle-cell-txt";
    txt.textContent = shown;
    cell.append(ico, txt);
    stripEl.append(cell);
  }
}

function renderHubFlanked(el: HTMLElement, text: string) {
  el.replaceChildren();
  const a = document.createElement("span");
  a.className = "slot-spectacle-hub-star";
  a.textContent = "✦";
  const b = document.createElement("span");
  b.className = "slot-spectacle-hub-core";
  b.textContent = text;
  const c = document.createElement("span");
  c.className = "slot-spectacle-hub-star";
  c.textContent = "✦";
  el.append(a, document.createTextNode(" "), b, document.createTextNode(" "), c);
}

/** 頂部皇冠（內嵌 SVG，與設計稿跑馬燈搭配） */
const SLOT_CROWN_SVG = `<svg class="slot-spectacle-crown-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" aria-hidden="true">
  <defs>
    <linearGradient id="slotCrownG" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fffef0"/>
      <stop offset="35%" stop-color="#ffd700"/>
      <stop offset="100%" stop-color="#b8860b"/>
    </linearGradient>
  </defs>
  <path fill="url(#slotCrownG)" stroke="#6a5010" stroke-width="1.2" stroke-linejoin="round"
    d="M50 4 L62 18 L78 6 L74 26 L94 22 L80 34 L50 30 L20 34 L6 22 L26 26 L22 6 L38 18 Z"/>
  <circle cx="50" cy="8" r="4" fill="#fff8dc" stroke="#c9a010" stroke-width="1"/>
  <path fill="#ffd700" stroke="#a67c00" stroke-width="0.6" d="M22 14l1.8 4 4-2.2-1 4.5 4.8 0.6-4.8 1.8 1 4.5-4-2.2-4 2.2 1-4.5-4.8-1.8 4.8-0.6-1-4.5z" transform="translate(0,-2) scale(0.85)"/>
  <path fill="#ffd700" stroke="#a67c00" stroke-width="0.6" d="M22 14l1.8 4 4-2.2-1 4.5 4.8 0.6-4.8 1.8 1 4.5-4-2.2-4 2.2 1-4.5-4.8-1.8 4.8-0.6-1-4.5z" transform="translate(28,-2) scale(0.85)"/>
  <path fill="#ffd700" stroke="#a67c00" stroke-width="0.6" d="M22 14l1.8 4 4-2.2-1 4.5 4.8 0.6-4.8 1.8 1 4.5-4-2.2-4 2.2 1-4.5-4.8-1.8 4.8-0.6-1-4.5z" transform="translate(56,-2) scale(0.85)"/>
</svg>`;

function buildIdleStrip(prizes: WheelPrizeLabel[]): { strip: WheelPrizeLabel[]; offsetY: number } {
  const period = shufflePeriod(prizes, 7721);
  const strip: WheelPrizeLabel[] = [];
  for (let r = 0; r < 5; r++) strip.push(...period);
  const plen = period.length;
  const centerIdx = plen * 2 + CENTER_ROW;
  const offsetY = -(centerIdx - CENTER_ROW) * CELL_PX;
  return { strip, offsetY };
}

/**
 * 開啟演出層；使用者按拉桿／開始後才執行 spinFn，成功時播放捲軸後 resolve。
 */
export function runSlotSpectacle(
  spinFn: () => Promise<SpinWheelSpectacleResult>,
  options?: RunSlotSpectacleOptions,
): Promise<SpinWheelSpectacleResult> {
  return new Promise((resolve, reject) => {
    const splitY = computeSplitY(options?.splitAnchor ?? null);

    const overlay = document.createElement("div");
    overlay.className = "wheel-spectacle-overlay slot-spectacle-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "slot-spectacle-title");

    const deepSpace = document.createElement("div");
    deepSpace.className = "wheel-spectacle-deep";
    deepSpace.setAttribute("aria-hidden", "true");

    const sparks = document.createElement("div");
    sparks.className = "wheel-spectacle-sparks";
    sparks.setAttribute("aria-hidden", "true");

    const stageMount = document.createElement("div");
    stageMount.className = "wheel-spectacle-stage-mount";

    const stage = document.createElement("div");
    stage.className = "wheel-spectacle-stage slot-spectacle-stage";

    const stageHead = document.createElement("div");
    stageHead.className = "slot-spectacle-stage-head";

    const idleCloseBtn = document.createElement("button");
    idleCloseBtn.type = "button";
    idleCloseBtn.className = "slot-spectacle-close-round";
    idleCloseBtn.setAttribute("aria-label", t("slot.idleClose", "關閉"));
    idleCloseBtn.innerHTML = '<span class="slot-spectacle-close-x" aria-hidden="true">×</span>';

    const marquee = document.createElement("div");
    marquee.className = "slot-spectacle-marquee";
    const crownWrap = document.createElement("div");
    crownWrap.className = "slot-spectacle-crown-wrap";
    crownWrap.innerHTML = SLOT_CROWN_SVG;
    const title = document.createElement("h2");
    title.id = "slot-spectacle-title";
    title.className = "wheel-spectacle-title slot-spectacle-title";
    title.textContent = t("slot.spectacleTitle", "幸運拉霸");
    marquee.append(crownWrap, title);

    const tagline = document.createElement("p");
    tagline.className = "slot-spectacle-tagline";
    tagline.textContent = t("slot.tagline", "✦ 試試你的手氣，贏取豐富獎勵！ ✦");

    stageHead.append(idleCloseBtn, marquee, tagline);

    const hub = document.createElement("div");
    hub.className = "wheel-spectacle-hub slot-spectacle-hub";
    renderHubFlanked(hub, t("slot.hubPreparing", "準備中…"));

    const machine = document.createElement("div");
    machine.className = "slot-spectacle-machine";

    const machineRow = document.createElement("div");
    machineRow.className = "slot-spectacle-machine-row";

    const machineMain = document.createElement("div");
    machineMain.className = "slot-spectacle-machine-main";

    const mainInner = document.createElement("div");
    mainInner.className = "slot-spectacle-machine-main-inner";

    const sideDecor = document.createElement("div");
    sideDecor.className = "slot-spectacle-side-decor";
    sideDecor.setAttribute("aria-hidden", "true");
    const hinge = document.createElement("span");
    hinge.className = "slot-spectacle-hinge";
    const playTri = document.createElement("span");
    playTri.className = "slot-spectacle-play-tri";
    playTri.textContent = "▶";
    sideDecor.append(hinge, playTri);

    const reelStack = document.createElement("div");
    reelStack.className = "slot-spectacle-reel-stack";

    const payline = document.createElement("div");
    payline.className = "slot-spectacle-payline";
    payline.setAttribute("aria-hidden", "true");

    const reelsRow = document.createElement("div");
    reelsRow.className = "slot-spectacle-reels slot-spectacle-reels--solo";

    reelStack.append(payline, reelsRow);
    mainInner.append(sideDecor, reelStack);
    machineMain.append(mainInner);

    const lever = document.createElement("button");
    lever.type = "button";
    lever.className = "slot-spectacle-lever";
    lever.setAttribute("aria-label", t("slot.leverAria", "由右上往左下拉桿開始開獎"));
    const leverSwing = document.createElement("span");
    leverSwing.className = "slot-spectacle-lever-swing";
    const leverKnob = document.createElement("span");
    leverKnob.className = "slot-spectacle-lever-knob";
    const leverArm = document.createElement("span");
    leverArm.className = "slot-spectacle-lever-arm";
    const pullHint = document.createElement("span");
    pullHint.className = "slot-spectacle-pull-hint";
    pullHint.setAttribute("aria-hidden", "true");
    pullHint.innerHTML = `<svg class="slot-spectacle-pull-hint-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 56" width="40" height="46"><path fill="none" stroke="#ff8c00" stroke-width="3" stroke-linecap="round" d="M8 8 Q28 8 32 28 T36 48"/><path fill="#ff8c00" d="M34 46l8 4-6 6z"/></svg>`;
    leverSwing.append(leverKnob, leverArm, pullHint);
    lever.append(leverSwing);

    machineRow.append(machineMain, lever);
    machine.append(machineRow);

    const resultLine = document.createElement("div");
    resultLine.className = "wheel-spectacle-result";
    resultLine.hidden = true;

    const subLine = document.createElement("p");
    subLine.className = "wheel-spectacle-sub";
    subLine.hidden = true;

    const actions = document.createElement("div");
    actions.className = "wheel-spectacle-actions";
    const primaryBtn = document.createElement("button");
    primaryBtn.type = "button";
    primaryBtn.className = "primary wheel-spectacle-primary";
    primaryBtn.textContent = t("slot.take", "收下");
    primaryBtn.disabled = true;
    actions.append(primaryBtn);

    const idleCta = document.createElement("div");
    idleCta.className = "slot-spectacle-idle-cta";
    const pullBtn = document.createElement("button");
    pullBtn.type = "button";
    pullBtn.className = "slot-spectacle-pull-btn";
    pullBtn.textContent = t("slot.pullLeverCta", "拉下拉桿");
    const footEnc = document.createElement("p");
    footEnc.className = "slot-spectacle-foot-encourage";
    footEnc.textContent = t("slot.footEncourage", "✦ 好運就在下一次！ ✦");
    idleCta.append(pullBtn, footEnc);

    stage.classList.add("is-slot-idle");
    stage.append(stageHead, hub, machine, idleCta, resultLine, subLine, actions);
    stageMount.append(stage);

    const shardTop = document.createElement("div");
    shardTop.className = "wheel-spectacle-shard wheel-spectacle-shard--top";
    shardTop.style.height = `${splitY}px`;

    const shardBot = document.createElement("div");
    shardBot.className = "wheel-spectacle-shard wheel-spectacle-shard--bottom";
    shardBot.style.top = `${splitY}px`;

    const seamFlash = document.createElement("div");
    seamFlash.className = "wheel-spectacle-seam-flash";
    seamFlash.style.top = `${splitY - 3}px`;

    const confetti = document.createElement("div");
    confetti.className = "slot-spectacle-confetti";
    confetti.setAttribute("aria-hidden", "true");

    overlay.append(deepSpace, confetti, sparks, stageMount, shardTop, shardBot, seamFlash);
    document.body.append(overlay);
    document.body.classList.add("wheel-spectacle-lock");

    const audioCtx = getSpectacleAudioContext();
    if (audioCtx?.state === "suspended") {
      void audioCtx.resume();
    }

    let settled = false;
    const tearDown = () => {
      if (settled) return;
      settled = true;
      if (audioCtx && audioCtx.state !== "closed") {
        try {
          void audioCtx.close();
        } catch {
          try {
            void audioCtx.suspend();
          } catch {
            /* ignore */
          }
        }
      }
      document.body.classList.remove("wheel-spectacle-lock");
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };

    let dismiss: () => void = () => {};
    let phase: "idle" | "busy" | "done" = "idle";
    let curtainCloseMs = CURTAIN_CLOSE_WAIT_MS;

    const closeCurtainsThen = (after: () => void) => {
      primaryBtn.disabled = true;
      overlay.classList.remove("is-cracked", "is-seam-pop", "is-win-burst");
      overlay.classList.add("is-closing");
      window.setTimeout(() => {
        tearDown();
        after();
      }, curtainCloseMs);
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      if (phase === "idle") {
        closeCurtainsThen(() => reject(new DOMException(t("slot.aborted", "已取消"), "AbortError")));
        return;
      }
      if (phase === "done" && !primaryBtn.disabled) dismiss();
    };
    document.addEventListener("keydown", onKey);

    void (async () => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const openWaitMs = reduceMotion ? 420 : CURTAIN_OPEN_WAIT_MS;
      curtainCloseMs = reduceMotion ? 360 : CURTAIN_CLOSE_WAIT_MS;

      let reelBus: AudioNode | null = null;
      if (audioCtx) {
        const g = audioCtx.createGain();
        g.gain.value = 0.88;
        const c = ctxCompressor(audioCtx);
        g.connect(c);
        c.connect(audioCtx.destination);
        reelBus = g;
      }

      const labelsPromise =
        options?.fetchPrizeLabels != null
          ? options.fetchPrizeLabels().catch(() => null)
          : Promise.resolve(null);
      const sfxPromise = audioCtx
        ? prefetchWheelSfx(audioCtx)
        : Promise.resolve<PrefetchedWheelSfx>({
            spinTick: null,
            winHorn: null,
            winBoing: null,
            winSlide: null,
            winCowbell: null,
            winFlicks: null,
            winTeamCheer: null,
            winCrowdCelebration: null,
            winCymbalCrash: null,
            winMagicChime: null,
            winPunchlineDrum: null,
          });

      requestAnimationFrame(() => {
        overlay.classList.add("is-open");
        if (audioCtx) {
          try {
            playCrackBang(audioCtx);
          } catch {
            /* ignore */
          }
        }
      });

      const [, prizeListRaw, sfx] = await Promise.all([sleep(openWaitMs), labelsPromise, sfxPromise]);

      overlay.classList.add("is-cracked");
      overlay.classList.add("is-seam-pop");
      await sleep(120);

      const idlePrizes = normalizePrizeList(prizeListRaw, null);
      const { strip: idleStrip, offsetY: idleOffsetY } = buildIdleStrip(idlePrizes);

      reelsRow.replaceChildren();
      const reelFrame = document.createElement("div");
      reelFrame.className = "slot-spectacle-reel-frame";
      const reelWindow = document.createElement("div");
      reelWindow.className = "slot-spectacle-reel-window slot-spectacle-reel-window--solo";
      const stripEl = document.createElement("div");
      stripEl.className = "slot-spectacle-strip";
      fillStripEl(stripEl, idleStrip, idlePrizes);
      stripEl.style.transform = `translate3d(0, ${idleOffsetY}px, 0)`;
      stripEl.style.transition = "none";
      reelWindow.append(stripEl);
      reelFrame.append(reelWindow);
      reelsRow.append(reelFrame);

      renderHubFlanked(hub, t("slot.hubPull", "由右上往左下拉桿開始開獎"));
      phase = "idle";

      idleCloseBtn.onclick = () => {
        closeCurtainsThen(() => reject(new DOMException(t("slot.aborted", "已取消"), "AbortError")));
      };

      const runAfterPull = async () => {
        if (phase !== "idle") return;
        phase = "busy";
        stage.classList.remove("is-slot-idle");
        resultLine.hidden = true;
        resultLine.classList.remove("is-error");
        resultLine.textContent = "";
        idleCloseBtn.onclick = () => {
          closeCurtainsThen(() => reject(new DOMException(t("slot.aborted", "已取消"), "AbortError")));
        };
        lever.classList.add("is-pulled");
        window.setTimeout(() => lever.classList.remove("is-pulled"), 420);
        lever.setAttribute("disabled", "true");
        pullBtn.setAttribute("disabled", "true");
        idleCloseBtn.setAttribute("disabled", "true");

        renderHubFlanked(hub, t("slot.hubSpinning", "連線開獎中…"));
        hub.classList.add("is-pulse");

        let data: SpinWheelSpectacleResult;
        try {
          data = await spinFn();
        } catch (e) {
          hub.classList.remove("is-pulse");
          renderHubFlanked(hub, t("slot.hubOops", "哎呀"));
          lever.removeAttribute("disabled");
          idleCloseBtn.removeAttribute("disabled");
          phase = "idle";
          resultLine.hidden = false;
          resultLine.classList.add("is-error");
          resultLine.textContent =
            e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
              ? (e as { message: string }).message
              : t("slot.spinFailGeneric", "開獎失敗，請稍後再試。");
          primaryBtn.textContent = t("slot.close", "關閉");
          primaryBtn.disabled = false;
          dismiss = () => {
            closeCurtainsThen(() => reject(e));
          };
          primaryBtn.onclick = dismiss;
          idleCloseBtn.onclick = () => {
            closeCurtainsThen(() => reject(e));
          };
          primaryBtn.focus();
          return;
        }

        hub.classList.remove("is-pulse");

        const winId = data.prize.id ?? "";
        const workingPrizes = normalizePrizeList(prizeListRaw, data.prize);
        const effectiveWinId = winId || workingPrizes[0]?.id || "s7";
        const winSeed = seedFromWinId(effectiveWinId);

        const { strip, stopIndex } = buildReelStrip(workingPrizes, effectiveWinId, winSeed);
        const rngExtra = mulberry32(winSeed + 4242);
        const extraScroll = Math.round(1500 + rngExtra() * 520);
        const endY = -(stopIndex - CENTER_ROW) * CELL_PX;
        const startY = endY + extraScroll;
        const durationMs = reduceMotion ? 0 : 2800;

        fillStripEl(stripEl, strip, workingPrizes);
        stripEl.style.transition = "none";
        stripEl.style.transform = `translate3d(0, ${startY}px, 0)`;

        let stopDrone: (() => void) | null = null;
        if (audioCtx && reelBus && !reduceMotion) {
          try {
            stopDrone = startSpinDrone(audioCtx, reelBus, 0.0055);
          } catch {
            stopDrone = null;
          }
        }

        await new Promise<void>((res) => {
          if (reduceMotion || durationMs <= 0) {
            stripEl.style.transition = "none";
            stripEl.style.transform = `translate3d(0, ${endY}px, 0)`;
            res();
            return;
          }
          const onEnd = (ev: TransitionEvent) => {
            if (ev.propertyName !== "transform") return;
            stripEl.removeEventListener("transitionend", onEnd);
            if (audioCtx && reelBus && sfx.spinTick) {
              try {
                playBufferAt(audioCtx, sfx.spinTick, audioCtx.currentTime + 0.01, 0.2, reelBus, 1, 0.14);
              } catch {
                /* ignore */
              }
            }
            res();
          };
          stripEl.addEventListener("transitionend", onEnd);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              stripEl.style.transition = `transform ${durationMs}ms cubic-bezier(0.18, 0.82, 0.32, 1)`;
              stripEl.style.transform = `translate3d(0, ${endY}px, 0)`;
            });
          });
        });

        stopDrone?.();

        overlay.classList.add("is-win-burst");
        machine.classList.add("is-win");

        if (audioCtx && reelBus) {
          try {
            playWinStinger(audioCtx, sfx, reelBus);
          } catch {
            /* ignore */
          }
        }

        hub.replaceChildren();
        hub.textContent = data.prize.name;
        resultLine.hidden = false;
        resultLine.classList.remove("is-error");
        resultLine.textContent = t("slot.revealCongrats", "恭喜獲得");
        subLine.hidden = false;
        subLine.textContent =
          data.prize.type === "points"
            ? t("slot.subPoints", "已獲得 {{pts}} 點（目前共 {{total}} 點）", {
                pts: data.prize.value,
                total: data.wheelPoints ?? "—",
              })
            : data.prize.type === "chance"
              ? t("slot.subChance", "可抽次數已更新（目前 {{n}} 次）", { n: data.drawChances })
              : t("slot.subOther", "祝你有美好的一天");

        phase = "done";
        primaryBtn.disabled = false;
        dismiss = () => {
          closeCurtainsThen(() => resolve(data));
        };
        primaryBtn.onclick = dismiss;
        primaryBtn.focus();
      };

      const tryPull = () => void runAfterPull();
      lever.onclick = tryPull;
      pullBtn.onclick = tryPull;
    })();
  });
}

function ctxCompressor(ctx: AudioContext): DynamicsCompressorNode {
  const c = ctx.createDynamicsCompressor();
  c.threshold.value = -18;
  c.knee.value = 8;
  c.ratio.value = 2.8;
  c.attack.value = 0.003;
  c.release.value = 0.2;
  return c;
}
