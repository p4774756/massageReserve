/**
 * 輪盤演出用網路音效（Google Actions Sound Library，HTTPS + CORS）
 * @see https://developers.google.com/assistant/tools/sound-library
 *
 * 庫內沒有單一命名為「jackpot」的檔案；最接近「中大獎」的是觀眾歡呼（crowds）＋鑔片／遊戲秀鼓點（cartoon）疊加。
 */

/** 拉霸金幣雨：bundled WAV（Mixkit，見 public/media/sfx/ATTRIBUTION.txt），同網域 decode、離線可用 */
const SLOT_COIN_BASE = `${import.meta.env.BASE_URL}media/sfx/`;
export const SLOT_COIN_SFX_URLS = {
  /** 短金屬／街機金幣感，模擬單枚落地 */
  coinMetalThunk: `${SLOT_COIN_BASE}slot-coin-land.wav`,
  /** 多枚碰撞叮響 */
  coinRingHit: `${SLOT_COIN_BASE}slot-coin-clink.wav`,
  /** 硬幣摩擦散落底噪（截短播放） */
  coinsShuffleBed: `${SLOT_COIN_BASE}slot-coin-shuffle.wav`,
} as const;

export type PrefetchedSlotCoinSfx = {
  coinMetalThunk: AudioBuffer | null;
  coinRingHit: AudioBuffer | null;
  coinsShuffleBed: AudioBuffer | null;
};

export const WHEEL_SFX_URLS = {
  /** 旋轉過程滴答 */
  spinTick: "https://actions.google.com/sounds/v1/alarms/beep_short.ogg",
  /** 中獎開場號角感 */
  winHorn: "https://actions.google.com/sounds/v1/cartoon/clown_horn.ogg",
  /** 中獎「咚」 */
  winBoing: "https://actions.google.com/sounds/v1/cartoon/cartoon_boing.ogg",
  /** 中獎滑音哨（疊加張力） */
  winSlide: "https://actions.google.com/sounds/v1/cartoon/slide_whistle.ogg",
  /** 節奏牛鈴 */
  winCowbell: "https://actions.google.com/sounds/v1/cartoon/cartoon_cowbell.ogg",
  /** 碎拍木板（熱鬧感） */
  winFlicks: "https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg",
  /** 觀眾歡呼（運動場式，大獎感） */
  winTeamCheer: "https://actions.google.com/sounds/v1/crowds/team_cheer.ogg",
  /** 歡呼層（女性群眾慶祝） */
  winCrowdCelebration: "https://actions.google.com/sounds/v1/crowds/female_crowd_celebration.ogg",
  /** 鑔片撞擊（揭曉瞬間） */
  winCymbalCrash: "https://actions.google.com/sounds/v1/cartoon/crash_layer_cymbals.ogg",
  /** 魔法叮噹（亮點） */
  winMagicChime: "https://actions.google.com/sounds/v1/cartoon/magic_chime.ogg",
  /** 遊戲秀鼓點／收尾 */
  winPunchlineDrum: "https://actions.google.com/sounds/v1/cartoon/punchline_drum.ogg",
} as const;

export type PrefetchedWheelSfx = {
  spinTick: AudioBuffer | null;
  winHorn: AudioBuffer | null;
  winBoing: AudioBuffer | null;
  winSlide: AudioBuffer | null;
  winCowbell: AudioBuffer | null;
  winFlicks: AudioBuffer | null;
  winTeamCheer: AudioBuffer | null;
  winCrowdCelebration: AudioBuffer | null;
  winCymbalCrash: AudioBuffer | null;
  winMagicChime: AudioBuffer | null;
  winPunchlineDrum: AudioBuffer | null;
};

export async function fetchAudioBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(url, { mode: "cors", cache: "force-cache" });
    if (!res.ok) return null;
    const raw = await res.arrayBuffer();
    return await ctx.decodeAudioData(raw.slice(0));
  } catch {
    return null;
  }
}

export async function prefetchSlotCoinSfx(ctx: AudioContext): Promise<PrefetchedSlotCoinSfx> {
  const [coinMetalThunk, coinRingHit, coinsShuffleBed] = await Promise.all([
    fetchAudioBuffer(ctx, SLOT_COIN_SFX_URLS.coinMetalThunk),
    fetchAudioBuffer(ctx, SLOT_COIN_SFX_URLS.coinRingHit),
    fetchAudioBuffer(ctx, SLOT_COIN_SFX_URLS.coinsShuffleBed),
  ]);
  return { coinMetalThunk, coinRingHit, coinsShuffleBed };
}

export async function prefetchWheelSfx(ctx: AudioContext): Promise<PrefetchedWheelSfx> {
  const [
    spinTick,
    winHorn,
    winBoing,
    winSlide,
    winCowbell,
    winFlicks,
    winTeamCheer,
    winCrowdCelebration,
    winCymbalCrash,
    winMagicChime,
    winPunchlineDrum,
  ] = await Promise.all([
    fetchAudioBuffer(ctx, WHEEL_SFX_URLS.spinTick),
    fetchAudioBuffer(ctx, WHEEL_SFX_URLS.winHorn),
    fetchAudioBuffer(ctx, WHEEL_SFX_URLS.winBoing),
    fetchAudioBuffer(ctx, WHEEL_SFX_URLS.winSlide),
    fetchAudioBuffer(ctx, WHEEL_SFX_URLS.winCowbell),
    fetchAudioBuffer(ctx, WHEEL_SFX_URLS.winFlicks),
    fetchAudioBuffer(ctx, WHEEL_SFX_URLS.winTeamCheer),
    fetchAudioBuffer(ctx, WHEEL_SFX_URLS.winCrowdCelebration),
    fetchAudioBuffer(ctx, WHEEL_SFX_URLS.winCymbalCrash),
    fetchAudioBuffer(ctx, WHEEL_SFX_URLS.winMagicChime),
    fetchAudioBuffer(ctx, WHEEL_SFX_URLS.winPunchlineDrum),
  ]);
  return {
    spinTick,
    winHorn,
    winBoing,
    winSlide,
    winCowbell,
    winFlicks,
    winTeamCheer,
    winCrowdCelebration,
    winCymbalCrash,
    winMagicChime,
    winPunchlineDrum,
  };
}

/**
 * @param durationSec 若指定，只播放前段（秒），用於截斷較長的歡呼／號角等結尾音。
 */
export function playBufferAt(
  ctx: AudioContext,
  buffer: AudioBuffer,
  when: number,
  gain: number,
  destination: AudioNode,
  playbackRate = 1,
  durationSec?: number,
): void {
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buffer;
  src.playbackRate.value = playbackRate;
  g.gain.value = gain;
  src.connect(g);
  g.connect(destination);
  const rate = Math.abs(playbackRate) || 1;
  const maxDur = buffer.duration / rate;
  if (durationSec != null && durationSec > 0 && durationSec < maxDur) {
    src.start(when, 0, durationSec);
  } else {
    src.start(when);
  }
}

/** 取樣載入失敗時的短金屬叮聲（不經壓縮器時也足夠辨識） */
function scheduleProceduralCoinClink(ctx: AudioContext, destination: AudioNode, when: number, gain: number): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "triangle";
  const f0 = 380 + ((when * 137.5) % 1) * 420;
  o.frequency.setValueAtTime(f0, when);
  o.frequency.exponentialRampToValueAtTime(190, when + 0.058);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), when + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
  o.connect(g);
  g.connect(destination);
  o.start(when);
  o.stop(when + 0.1);
}

/**
 * 中獎金幣雨：底層摩擦聲 + 多發短碰撞（時間錯開）。
 * 應接到 **destination**（例如直連 AudioContext.destination 的 Gain），勿與中獎號角共用經 DynamicsCompressor 的 bus，
 * 否則鑔片等大瞬間會把金幣聲壓到幾乎聽不見。
 */
export function playSlotCoinRain(
  ctx: AudioContext,
  destination: AudioNode,
  sfx: PrefetchedSlotCoinSfx,
  opts?: { reduceMotion?: boolean },
): void {
  if (opts?.reduceMotion) return;
  const t0 = ctx.currentTime + 0.06;
  const { coinMetalThunk, coinRingHit, coinsShuffleBed } = sfx;

  if (coinsShuffleBed) {
    try {
      playBufferAt(ctx, coinsShuffleBed, t0, 0.44, destination, 1, 1.45);
    } catch {
      /* ignore */
    }
  }

  let seed = (performance.now() * 1000) >>> 0;
  const rng = (): number => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let x = seed;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };

  const n = 22;
  for (let i = 0; i < n; i++) {
    const useRing = Boolean(coinRingHit && rng() > 0.66);
    const buf = useRing ? coinRingHit : coinMetalThunk ?? coinRingHit;
    const when = t0 + 0.04 + i * 0.074 + rng() * 0.056;
    const gain = useRing ? 0.12 + rng() * 0.07 : 0.15 + rng() * 0.09;
    const rate = useRing ? 1.06 + rng() * 0.2 : 0.84 + rng() * 0.3;

    if (buf) {
      try {
        playBufferAt(ctx, buf, when, gain, destination, rate, useRing ? 0.22 : 0.19);
      } catch {
        scheduleProceduralCoinClink(ctx, destination, when, gain * 0.85);
      }
    } else {
      try {
        scheduleProceduralCoinClink(ctx, destination, when, gain * 0.95);
      } catch {
        /* ignore */
      }
    }
  }
}

export type WheelSpinEasing = { p1x: number; p1y: number; p2x: number; p2y: number };

/** 與輪盤 `transition-timing-function: cubic-bezier(...)` 一致（時間 → 角位移比例） */
export const WHEEL_SPIN_TRANSITION_EASING: WheelSpinEasing = {
  p1x: 0.08,
  p1y: 0.82,
  p2x: 0.12,
  p2y: 1,
};

/** 與拉霸捲軸 `slotSpectacle` 的 `transition: transform … cubic-bezier(0.18, 0.82, 0.32, 1)` 一致 */
export const SLOT_REEL_TRANSITION_EASING: WheelSpinEasing = {
  p1x: 0.18,
  p1y: 0.82,
  p2x: 0.32,
  p2y: 1,
};

function cubicBezierAt(
  s: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): { x: number; y: number } {
  const o = 1 - s;
  const x = 3 * o * o * s * p1x + 3 * o * s * s * p2x + s * s * s;
  const y = 3 * o * o * s * p1y + 3 * o * s * s * p2y + s * s * s;
  return { x, y };
}

/** 正規化時間 u∈[0,1] → 旋轉完成度（與 CSS 相同曲線） */
function easedSpinProgressAtTime(u: number, easing: WheelSpinEasing = WHEEL_SPIN_TRANSITION_EASING): number {
  const { p1x, p1y, p2x, p2y } = easing;
  const clamped = Math.min(1, Math.max(0, u));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) * 0.5;
    const { x } = cubicBezierAt(mid, p1x, p1y, p2x, p2y);
    if (x < clamped) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) * 0.5;
  return cubicBezierAt(s, p1x, p1y, p2x, p2y).y;
}

/** 過渡累積進度 p∈[0,1] → 線性時間比例 u∈[0,1]（與 CSS transition-timing-function 同步） */
export function timeUForTransitionProgress(p: number, easing: WheelSpinEasing): number {
  const clamped = Math.min(1, Math.max(0, p));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) * 0.5;
    const py = easedSpinProgressAtTime(mid, easing);
    if (py < clamped) lo = mid;
    else hi = mid;
  }
  return (lo + hi) * 0.5;
}

/**
 * 依「每跨過一格（扇區邊界）」在對應時間點排程 tick，與 CSS transform 動畫同步。
 * 回傳 cancel 為 no-op（節點已排進 AudioContext）；關閉 context 時會一併停止。
 */
export function scheduleSpinTicksAtSliceCrossings(
  ctx: AudioContext,
  buffer: AudioBuffer | null,
  destination: AudioNode,
  opts: {
    crossingAnglesDeg: number[];
    finalDeg: number;
    durationMs: number;
    easing?: WheelSpinEasing;
    tickGain?: number;
    proceduralGain?: number;
  },
): () => void {
  const { crossingAnglesDeg, finalDeg, durationMs } = opts;
  const easing = opts.easing ?? WHEEL_SPIN_TRANSITION_EASING;
  const tickGain = opts.tickGain ?? 0.26;
  const procGain = opts.proceduralGain ?? 0.1;
  const t0 = ctx.currentTime;
  const durS = durationMs / 1000;

  for (const theta of crossingAnglesDeg) {
    if (theta <= 0 || theta > finalDeg + 1e-4) continue;
    const p = Math.min(1, theta / finalDeg);
    const u = timeUForTransitionProgress(p, easing);
    const when = t0 + u * durS;
    if (buffer) {
      playBufferAt(ctx, buffer, when, tickGain, destination);
    } else {
      scheduleProceduralSpinTickAt(ctx, destination, when, procGain);
    }
  }

  return () => {};
}

/**
 * 拉霸垂直捲軸：每滑過一格高度排程 tick（與 `transform` 過渡 easing 對齊）。
 * 使用 `WHEEL_SFX_URLS.spinTick`（Google Actions Sound Library）或程序化喀聲。
 */
export function scheduleSlotReelCellTicks(
  ctx: AudioContext,
  buffer: AudioBuffer | null,
  destination: AudioNode,
  opts: {
    durationMs: number;
    totalScrollPx: number;
    cellPx: number;
    easing?: WheelSpinEasing;
    tickGain?: number;
    proceduralGain?: number;
    landingGain?: number;
  },
): () => void {
  const { durationMs, totalScrollPx, cellPx } = opts;
  const easing = opts.easing ?? SLOT_REEL_TRANSITION_EASING;
  const tickGain = opts.tickGain ?? 0.13;
  const procGain = opts.proceduralGain ?? 0.085;
  const landingGain = opts.landingGain ?? 0.17;
  if (totalScrollPx <= 0 || durationMs <= 0 || cellPx <= 0) return () => {};

  const t0 = ctx.currentTime;
  const durS = durationMs / 1000;
  const n = Math.floor(totalScrollPx / cellPx);

  for (let k = 1; k <= n; k++) {
    const p = Math.min(1, (k * cellPx) / totalScrollPx);
    const u = timeUForTransitionProgress(p, easing);
    const when = t0 + u * durS;
    const rate = 1 + ((k * 7) % 5) * 0.025;
    if (buffer) {
      playBufferAt(ctx, buffer, when, tickGain, destination, rate, 0.085);
    } else {
      scheduleProceduralSpinTickAt(ctx, destination, when, procGain);
    }
  }

  const lastP = n > 0 ? Math.min(1, (n * cellPx) / totalScrollPx) : 0;
  if (lastP < 0.97) {
    const whenLand = t0 + Math.max(0, durS - 0.028);
    if (buffer) {
      playBufferAt(ctx, buffer, whenLand, landingGain, destination, 0.88, 0.11);
    } else {
      scheduleProceduralSpinTickAt(ctx, destination, whenLand, procGain * 1.2);
    }
  }

  return () => {};
}

function scheduleProceduralSpinTickAt(
  ctx: AudioContext,
  destination: AudioNode,
  when: number,
  gain: number,
): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "square";
  o.frequency.setValueAtTime(420, when);
  o.frequency.exponentialRampToValueAtTime(120, when + 0.04);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g);
  g.connect(destination);
  o.start(when);
  o.stop(when + 0.07);
}

/** 無網路音效時的短「喀」聲（立即播放） */
export function playProceduralSpinTick(ctx: AudioContext, destination: AudioNode, gain = 0.09): void {
  scheduleProceduralSpinTickAt(ctx, destination, ctx.currentTime, gain);
}
