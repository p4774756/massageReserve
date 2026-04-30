/** 抽輪盤全螢幕演出：沿觸發區上下割裂、露出後方輪盤 + 聲光 */

import {
  prefetchWheelSfx,
  playBufferAt,
  scheduleSpinTicksAtSliceCrossings,
  type PrefetchedWheelSfx,
} from "./wheelSpectacleSfx";
import { mountWheelSpectacleThree, type WheelSpectacleThreeHandle } from "./wheelSpectacleWebgl";
import { WHEEL_SLICE_FILLS, wheelSliceLabelInk } from "./wheelSlicePalette";

export type SpinWheelSpectacleResult = {
  prize: { id?: string; name: string; type: string; value: number };
  drawChances: number;
  walletBalance: number;
  wheelPoints?: number;
  sessionCredits?: number;
};

/** 與後端 `listActiveWheelPrizes` 對齊，用於畫出真實獎項扇形 */
export type WheelPrizeLabel = { id: string; name: string; weight: number };

export type RunWheelSpectacleOptions = {
  /** 割裂線對齊此元素垂直中心（例如按鈕列），輪盤彷彿從畫面後方現身 */
  splitAnchor?: HTMLElement | null;
  /** 取得啟用獎項（含 weight）；成功則輪盤格顯示實際名稱，失敗則維持裝飾色輪 */
  fetchPrizeLabels?: () => Promise<WheelPrizeLabel[]>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 上下幕板推開／闔上（與 `.wheel-spectacle-shard` transition 同步） */
const CURTAIN_MOVE_MS = 1900;
const CURTAIN_OPEN_WAIT_MS = CURTAIN_MOVE_MS + 180;
const CURTAIN_CLOSE_WAIT_MS = CURTAIN_MOVE_MS + 320;

/** 與 CSS transition 秒數、`scheduleSpinTicksAtSliceCrossings` 一致 */
const SPIN_TRANSITION_MS = 7200;
/** 略長於 transition，讓最後一格聲音與減速尾段對齊 */
const SPIN_WAIT_MS = SPIN_TRANSITION_MS + 250;
/** 無獎項 SVG 時，與 `conic-gradient` 色塊數對齊（每塊約 32°） */
const DECORATIVE_WHEEL_SLICES = 11;

function polarToXY(r: number, angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  return [r * Math.cos(rad), r * Math.sin(rad)];
}

function donutWedgePath(rOut: number, rIn: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x1, y1] = polarToXY(rOut, a0);
  const [x2, y2] = polarToXY(rOut, a1);
  const [x3, y3] = polarToXY(rIn, a1);
  const [x4, y4] = polarToXY(rIn, a0);
  return `M ${x1} ${y1} A ${rOut} ${rOut} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 ${large} 0 ${x4} ${y4} Z`;
}

function shortWheelLabel(name: string, nSlices: number): string {
  const max = nSlices > 8 ? 5 : nSlices > 6 ? 6 : 8;
  const s = name.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** 累積旋轉角 θ∈(0,finalDeg] 每跨過一個扇區邊界的角度（含整圈 360°） */
function computeSliceBoundaryCrossingAnglesDeg(
  finalDeg: number,
  prizeList: WheelPrizeLabel[] | null,
): number[] {
  const boundariesOneRev: number[] = [];
  if (prizeList && prizeList.length > 0) {
    const totalW = prizeList.reduce((s, p) => s + Math.max(0, p.weight), 0) || 1;
    let cum = 0;
    for (let i = 0; i < prizeList.length - 1; i++) {
      cum += (Math.max(0, prizeList[i].weight) / totalW) * 360;
      boundariesOneRev.push(cum);
    }
  } else {
    const n = DECORATIVE_WHEEL_SLICES;
    const step = 360 / n;
    for (let i = 1; i < n; i++) {
      boundariesOneRev.push(i * step);
    }
  }

  const perLap = [...boundariesOneRev, 360]
    .filter((x) => x > 0 && x <= 360)
    .sort((a, b) => a - b);
  const dedup: number[] = [];
  for (const x of perLap) {
    if (!dedup.length || Math.abs(dedup[dedup.length - 1] - x) > 1e-4) dedup.push(x);
  }

  const out: number[] = [];
  const maxM = Math.ceil(finalDeg / 360) + 2;
  for (let m = 0; m <= maxM; m++) {
    for (const b of dedup) {
      const th = m * 360 + b;
      if (th > 1e-4 && th <= finalDeg + 1e-4) out.push(th);
    }
  }
  out.sort((a, b) => a - b);
  const slim: number[] = [];
  for (const th of out) {
    if (!slim.length || th - slim[slim.length - 1] > 1e-3) slim.push(th);
  }
  return slim;
}

/**
 * 與 `mountPrizeWheelSvg` 相同的角度約定（極角為數學角：0° 為右、逆時針為正；-90° 為輪盤頂端，與指標對齊）。
 * 回傳中獎扇形中心角度（度），找不到則 null。
 */
function winnerSliceCenterDeg(prizes: WheelPrizeLabel[], wonId: string): number | null {
  const idx = prizes.findIndex((p) => p.id === wonId);
  if (idx < 0) return null;
  const totalW = prizes.reduce((s, p) => s + Math.max(0, p.weight), 0) || 1;
  let angle = -90;
  for (let i = 0; i < prizes.length; i++) {
    const sweep = (Math.max(0, prizes[i].weight) / totalW) * 360;
    const a0 = angle;
    const a1 = angle + sweep;
    if (i === idx) {
      return (a0 + a1) / 2;
    }
    angle = a1;
  }
  return null;
}

function mountPrizeWheelSvg(wheelEl: HTMLElement, prizes: WheelPrizeLabel[]) {
  wheelEl.replaceChildren();
  wheelEl.classList.add("has-prize-labels");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "-1 -1 2 2");
  svg.setAttribute("class", "wheel-spectacle-wheel-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "輪盤獎項");

  const totalW = prizes.reduce((s, p) => s + Math.max(0, p.weight), 0) || 1;
  const rOut = 0.93;
  const rIn = 0.38;
  const fontSize = prizes.length > 8 ? "0.074" : prizes.length > 5 ? "0.086" : "0.1";

  let angle = -90;
  for (let i = 0; i < prizes.length; i++) {
    const p = prizes[i];
    const sweep = (Math.max(0, p.weight) / totalW) * 360;
    const a0 = angle;
    const a1 = angle + sweep;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", donutWedgePath(rOut, rIn, a0, a1));
    const fill = WHEEL_SLICE_FILLS[i % WHEEL_SLICE_FILLS.length]!;
    path.setAttribute("fill", fill);
    path.setAttribute("stroke", "rgb(255 252 248 / 0.55)");
    path.setAttribute("stroke-width", "0.01");
    path.setAttribute("data-prize-id", p.id);
    svg.appendChild(path);

    const mid = (a0 + a1) / 2;
    const labelR = (rOut + rIn) / 2;
    const [tx, ty] = polarToXY(labelR, mid);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("class", "wheel-spectacle-slice-label");
    text.setAttribute("x", String(tx));
    text.setAttribute("y", String(ty));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("fill", wheelSliceLabelInk(fill));
    text.setAttribute("font-size", fontSize);
    text.setAttribute("font-weight", "700");
    text.setAttribute("transform", `rotate(${mid + 90} ${tx} ${ty})`);
    text.textContent = shortWheelLabel(p.name, prizes.length);
    svg.appendChild(text);

    angle = a1;
  }

  wheelEl.appendChild(svg);
}

function computeSplitY(anchor: HTMLElement | null | undefined): number {
  const margin = window.innerHeight * 0.1;
  if (anchor && document.contains(anchor)) {
    const r = anchor.getBoundingClientRect();
    const y = r.top + r.height * 0.5;
    return Math.min(Math.max(y, margin), window.innerHeight - margin);
  }
  return Math.min(Math.max(window.innerHeight * 0.4, margin), window.innerHeight - margin);
}

function getAudioContext(): AudioContext | null {
  try {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    return new AC();
  } catch {
    return null;
  }
}

function playCrackBang(ctx: AudioContext) {
  const t = ctx.currentTime;
  const o1 = ctx.createOscillator();
  const g1 = ctx.createGain();
  o1.type = "square";
  o1.frequency.setValueAtTime(95, t);
  o1.frequency.exponentialRampToValueAtTime(32, t + 0.14);
  g1.gain.setValueAtTime(0.0001, t);
  g1.gain.exponentialRampToValueAtTime(0.065, t + 0.018);
  g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o1.connect(g1);
  g1.connect(ctx.destination);
  o1.start(t);
  o1.stop(t + 0.24);

  const o2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  o2.type = "sine";
  o2.frequency.setValueAtTime(330, t);
  o2.frequency.exponentialRampToValueAtTime(990, t + 0.1);
  g2.gain.setValueAtTime(0, t);
  g2.gain.linearRampToValueAtTime(0.04, t + 0.025);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o2.connect(g2);
  g2.connect(ctx.destination);
  o2.start(t);
  o2.stop(t + 0.25);
}

function playRevealFanfareSynth(ctx: AudioContext, destination: AudioNode, gainScale: number) {
  const base = ctx.currentTime + 0.04;
  const bus = ctx.createGain();
  bus.gain.value = 0.92 * gainScale;
  bus.connect(destination);

  const tone = (
    t: number,
    freq: number,
    dur: number,
    peak: number,
    wave: OscillatorType,
    filterHz?: number,
  ) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = wave;
    o.frequency.value = freq;
    let src: AudioNode = o;
    if (filterHz != null) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = filterHz;
      f.Q.value = 0.9;
      o.connect(f);
      src = f;
    }
    src.connect(g);
    g.connect(bus);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.018);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.06);
  };

  const sparkle = (t: number, freq: number, peak: number) => {
    tone(t, freq, 0.11, peak, "sine", 4200);
  };

  // 低音「咚」+ 底鼓感
  tone(base, 55, 0.38, 0.13, "sine");
  tone(base, 65.41, 0.34, 0.12, "sine");
  tone(base + 0.02, 98, 0.24, 0.07, "triangle", 240);
  tone(base + 0.03, 130, 0.18, 0.045, "square", 420);

  // 快速上行琶音（遊戲秀感）
  const arp = [523.25, 659.25, 783.99, 987.77, 1174.66, 1318.51];
  arp.forEach((f, i) => {
    tone(base + 0.055 + i * 0.04, f, 0.22, 0.078, "triangle", 2800);
  });

  // 高八度再跑一遍（更亮）
  arp.forEach((f, i) => {
    tone(base + 0.05 + i * 0.032, f * 2, 0.14, 0.038, "sine", 6200);
  });

  // 主和弦齊奏（加八度堆疊）
  const chordT = base + 0.32;
  const chord = [
    [261.63, 0.058],
    [329.63, 0.064],
    [392, 0.07],
    [523.25, 0.076],
    [659.25, 0.064],
    [783.99, 0.056],
    [1046.5, 0.05],
  ] as const;
  for (const [f, v] of chord) {
    tone(chordT, f, 0.68, v, "triangle", 5200);
    tone(chordT + 0.004, f * 1.008, 0.62, v * 0.38, "sine", 6200);
    tone(chordT + 0.008, f * 0.5, 0.55, v * 0.28, "square", 900);
  }

  // 高音「叮叮叮」
  sparkle(chordT + 0.07, 2093, 0.085);
  sparkle(chordT + 0.1, 2637, 0.08);
  sparkle(chordT + 0.14, 3136, 0.075);
  sparkle(chordT + 0.19, 3520, 0.07);
  sparkle(chordT + 0.24, 4186, 0.055);

  // 延遲回聲和弦（較小聲）
  const echoT = base + 0.5;
  for (const [f, v] of chord) {
    tone(echoT, f * 0.5, 0.5, v * 0.36, "sine", 900);
    tone(echoT, f, 0.44, v * 0.26, "triangle", 3400);
  }
  sparkle(echoT + 0.11, 2093, 0.05);
  sparkle(echoT + 0.18, 2793, 0.045);

  // 尾韻再一輪弱琶音
  const tail = echoT + 0.28;
  const tailArp = [659.25, 783.99, 987.77, 1174.66];
  tailArp.forEach((f, i) => {
    tone(tail + i * 0.05, f, 0.35, 0.042, "triangle", 4000);
  });
}

function playRevealFanfareCombined(ctx: AudioContext, sfx: PrefetchedWheelSfx, destination: AudioNode) {
  const t0 = ctx.currentTime + 0.02;
  const anyWinSample = Boolean(
    sfx.winHorn ||
      sfx.winBoing ||
      sfx.winSlide ||
      sfx.winCowbell ||
      sfx.winFlicks ||
      sfx.winTeamCheer ||
      sfx.winCrowdCelebration ||
      sfx.winCymbalCrash ||
      sfx.winMagicChime ||
      sfx.winPunchlineDrum,
  );

  if (sfx.winCymbalCrash) {
    playBufferAt(ctx, sfx.winCymbalCrash, t0, 0.55, destination);
    playBufferAt(ctx, sfx.winCymbalCrash, t0 + 1.02, 0.26, destination, 0.9);
  }
  if (sfx.winMagicChime) {
    playBufferAt(ctx, sfx.winMagicChime, t0 + 0.04, 0.44, destination, 1.02);
    playBufferAt(ctx, sfx.winMagicChime, t0 + 0.55, 0.24, destination, 1.14);
  }
  if (sfx.winTeamCheer) {
    playBufferAt(ctx, sfx.winTeamCheer, t0 + 0.05, 0.46, destination);
  }
  if (sfx.winCrowdCelebration) {
    playBufferAt(ctx, sfx.winCrowdCelebration, t0 + 0.2, 0.38, destination, 1.02);
  }

  if (sfx.winHorn) {
    playBufferAt(ctx, sfx.winHorn, t0 + 0.08, 0.55, destination);
    playBufferAt(ctx, sfx.winHorn, t0 + 0.86, 0.22, destination, 1.16);
  }
  if (sfx.winSlide) {
    playBufferAt(ctx, sfx.winSlide, t0 + 0.1, 0.48, destination, 1.06);
  }
  if (sfx.winBoing) {
    playBufferAt(ctx, sfx.winBoing, t0 + 0.14, 0.5, destination);
    playBufferAt(ctx, sfx.winBoing, t0 + 0.48, 0.38, destination, 0.76);
  }
  if (sfx.winCowbell) {
    playBufferAt(ctx, sfx.winCowbell, t0 + 0.22, 0.4, destination);
    playBufferAt(ctx, sfx.winCowbell, t0 + 0.38, 0.34, destination, 1.14);
  }
  if (sfx.winFlicks) {
    playBufferAt(ctx, sfx.winFlicks, t0 + 0.28, 0.38, destination, 1.04);
  }
  if (sfx.winPunchlineDrum) {
    playBufferAt(ctx, sfx.winPunchlineDrum, t0 + 0.58, 0.46, destination);
    playBufferAt(ctx, sfx.winPunchlineDrum, t0 + 1.32, 0.2, destination, 0.88);
  }

  playRevealFanfareSynth(ctx, destination, anyWinSample ? 0.45 : 1);
}

function startSpinDrone(ctx: AudioContext, destination: AudioNode, gain = 0.014): () => void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = "sawtooth";
  o.frequency.value = 48;
  f.type = "lowpass";
  f.frequency.value = 380;
  g.gain.value = gain;
  o.connect(f);
  f.connect(g);
  g.connect(destination);
  o.start();
  return () => {
    try {
      o.stop();
      o.disconnect();
      f.disconnect();
      g.disconnect();
    } catch {
      /* already stopped */
    }
  };
}

/**
 * 開啟演出層並執行 spinFn；成功時播放輪盤後 resolve；失敗則在層內顯示錯誤並 reject。
 */
export function runWheelSpectacle(
  spinFn: () => Promise<SpinWheelSpectacleResult>,
  options?: RunWheelSpectacleOptions,
): Promise<SpinWheelSpectacleResult> {
  return new Promise((resolve, reject) => {
    const splitY = computeSplitY(options?.splitAnchor ?? null);

    const overlay = document.createElement("div");
    overlay.className = "wheel-spectacle-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "wheel-spectacle-title");

    const deepSpace = document.createElement("div");
    deepSpace.className = "wheel-spectacle-deep";
    deepSpace.setAttribute("aria-hidden", "true");

    const sparks = document.createElement("div");
    sparks.className = "wheel-spectacle-sparks";
    sparks.setAttribute("aria-hidden", "true");

    const stageMount = document.createElement("div");
    stageMount.className = "wheel-spectacle-stage-mount";

    const stage = document.createElement("div");
    stage.className = "wheel-spectacle-stage";

    const title = document.createElement("h2");
    title.id = "wheel-spectacle-title";
    title.className = "wheel-spectacle-title";
    title.textContent = "幸運輪盤";

    const pointer = document.createElement("div");
    pointer.className = "wheel-spectacle-pointer";
    pointer.setAttribute("aria-hidden", "true");

    const wheelWrap = document.createElement("div");
    wheelWrap.className = "wheel-spectacle-wheel-wrap";

    const wheel = document.createElement("div");
    wheel.className = "wheel-spectacle-wheel-disk";
    wheel.setAttribute("aria-hidden", "true");

    const hub = document.createElement("div");
    hub.className = "wheel-spectacle-hub";
    hub.textContent = "準備中…";

    wheelWrap.append(wheel, hub);

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
    primaryBtn.textContent = "收下";
    primaryBtn.disabled = true;
    actions.append(primaryBtn);

    stage.append(title, pointer, wheelWrap, resultLine, subLine, actions);
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

    overlay.append(deepSpace, sparks, stageMount, shardTop, shardBot, seamFlash);
    document.body.append(overlay);
    document.body.classList.add("wheel-spectacle-lock");

    const audioCtx = getAudioContext();
    if (audioCtx?.state === "suspended") {
      void audioCtx.resume();
    }

    let threeHandle: WheelSpectacleThreeHandle | null = null;

    let settled = false;
    const tearDown = () => {
      if (settled) return;
      settled = true;
      threeHandle?.dispose();
      threeHandle = null;
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

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || primaryBtn.disabled) return;
      ev.preventDefault();
      dismiss();
    };
    document.addEventListener("keydown", onKey);

    void (async () => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const openWaitMs = reduceMotion ? 420 : CURTAIN_OPEN_WAIT_MS;
      const closeWaitMs = reduceMotion ? 360 : CURTAIN_CLOSE_WAIT_MS;

      /** 幕板慢慢闔上後再卸除（領取／關閉） */
      const closeCurtainsThen = (after: () => void) => {
        primaryBtn.disabled = true;
        overlay.classList.remove("is-cracked", "is-seam-pop", "is-win-burst");
        overlay.classList.add("is-closing");
        window.setTimeout(() => {
          tearDown();
          after();
        }, closeWaitMs);
      };

      let reelBus: AudioNode | null = null;
      if (audioCtx) {
        const g = audioCtx.createGain();
        g.gain.value = 0.88;
        const c = audioCtx.createDynamicsCompressor();
        c.threshold.value = -18;
        c.knee.value = 8;
        c.ratio.value = 2.8;
        c.attack.value = 0.003;
        c.release.value = 0.2;
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

      const [, prizeList, sfx] = await Promise.all([sleep(openWaitMs), labelsPromise, sfxPromise]);
      threeHandle =
        mountWheelSpectacleThree(wheel, {
          prizes: prizeList && prizeList.length > 0 ? prizeList : null,
          reduceMotion,
          decorativeSlices: DECORATIVE_WHEEL_SLICES,
        }) ?? null;
      if (!threeHandle && prizeList && prizeList.length > 0) {
        mountPrizeWheelSvg(wheel, prizeList);
      }

      overlay.classList.add("is-cracked");
      overlay.classList.add("is-seam-pop");
      await sleep(120);

      const tApi = performance.now();
      hub.textContent = "連線抽獎中…";
      hub.classList.add("is-pulse");

      let data: SpinWheelSpectacleResult;
      try {
        data = await spinFn();
      } catch (e) {
        hub.classList.remove("is-pulse");
        hub.textContent = "哎呀";
        resultLine.hidden = false;
        resultLine.classList.add("is-error");
        resultLine.textContent =
          e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
            ? (e as { message: string }).message
            : "抽獎失敗，請稍後再試。";
        primaryBtn.textContent = "關閉";
        primaryBtn.disabled = false;
        dismiss = () => {
          closeCurtainsThen(() => reject(e));
        };
        primaryBtn.onclick = dismiss;
        primaryBtn.focus();
        return;
      }

      hub.classList.remove("is-pulse");
      const apiMs = performance.now() - tApi;
      await sleep(Math.max(0, 2000 - apiMs));

      let stopTicks: (() => void) | null = null;
      let stopDrone: (() => void) | null = null;

      const spins = 7 + Math.floor(Math.random() * 4);
      /** 指標在輪盤正上方，對應極角 -90°（與 SVG 扇形起算一致） */
      const POINTER_DEG = -90;
      let finalDeg: number;
      if (data.prize.id && prizeList && prizeList.length > 0) {
        const midW = winnerSliceCenterDeg(prizeList, data.prize.id);
        if (midW != null) {
          /**
           * CSS 對輪盤 `rotate(finalDeg)` 為順時針；輪上原在極角 midW 的點，在父層視為 midW - finalDeg（逆時針角）。
           * 欲使該點落在指標處 (-90°)：midW - finalDeg ≡ POINTER_DEG → finalDeg ≡ midW - POINTER_DEG。
           */
          const align = (midW - POINTER_DEG + 360 * 10) % 360;
          const sliceW =
            (Math.max(0, prizeList.find((p) => p.id === data.prize.id)?.weight ?? 0) /
              (prizeList.reduce((s, p) => s + Math.max(0, p.weight), 0) || 1)) *
            360;
          const wobble = (Math.random() - 0.5) * Math.min(28, sliceW * 0.35);
          finalDeg = spins * 360 + align + wobble;
        } else {
          finalDeg = spins * 360 + Math.random() * 360;
        }
      } else {
        finalDeg = spins * 360 + Math.random() * 360;
      }
      const crossingAngles = computeSliceBoundaryCrossingAnglesDeg(finalDeg, prizeList);

      wheel.classList.add("is-rim-glow");
      threeHandle?.setRimGlow(true);
      const spinPromise = threeHandle
        ? threeHandle.spinTo(finalDeg, SPIN_TRANSITION_MS)
        : null;
      if (!threeHandle) {
        wheel.style.transition = `transform ${SPIN_TRANSITION_MS / 1000}s cubic-bezier(0.08, 0.82, 0.12, 1)`;
        wheel.style.transform = `rotate(${finalDeg}deg)`;
      }

      if (audioCtx && reelBus) {
        const bus = reelBus;
        try {
          stopTicks = scheduleSpinTicksAtSliceCrossings(audioCtx, sfx.spinTick, bus, {
            crossingAnglesDeg: crossingAngles,
            finalDeg,
            durationMs: SPIN_TRANSITION_MS,
          });
          stopDrone = startSpinDrone(audioCtx, bus, 0.006);
        } catch {
          stopTicks = null;
          stopDrone = null;
        }
      }

      if (spinPromise) {
        await spinPromise;
        await sleep(Math.max(0, SPIN_WAIT_MS - SPIN_TRANSITION_MS));
      } else {
        await sleep(SPIN_WAIT_MS);
      }

      const wonId = data.prize.id;
      if (wonId) {
        if (threeHandle) {
          threeHandle.setWinnerByPrizeId(wonId);
        } else {
          wheel.querySelectorAll("path.is-winner-slice").forEach((el) => el.classList.remove("is-winner-slice"));
          const hit = wheel.querySelector(`path[data-prize-id="${wonId}"]`);
          hit?.classList.add("is-winner-slice");
        }
      }

      wheel.classList.remove("is-rim-glow");
      threeHandle?.setRimGlow(false);
      stopTicks?.();
      stopDrone?.();
      overlay.classList.add("is-win-burst");
      threeHandle?.winBloomPulse();

      if (audioCtx && reelBus) {
        try {
          playRevealFanfareCombined(audioCtx, sfx, reelBus);
        } catch {
          /* ignore */
        }
      }

      hub.textContent = data.prize.name;
      resultLine.hidden = false;
      resultLine.classList.remove("is-error");
      resultLine.textContent = "恭喜獲得";
      subLine.hidden = false;
      subLine.textContent =
        data.prize.type === "points"
          ? `已獲得 ${data.prize.value} 點（目前共 ${data.wheelPoints ?? "—"} 點）`
          : data.prize.type === "chance"
            ? `可抽次數已更新（目前 ${data.drawChances} 次）`
            : "祝你有美好的一天";

      primaryBtn.disabled = false;
      dismiss = () => {
        closeCurtainsThen(() => resolve(data));
      };
      primaryBtn.onclick = dismiss;
      primaryBtn.focus();
    })();
  });
}
