/**
 * 輪盤演出用網路音效（Google Actions Sound Library，HTTPS + CORS）
 * @see https://developers.google.com/assistant/tools/sound-library
 *
 * 庫內沒有單一命名為「jackpot」的檔案；最接近「中大獎」的是觀眾歡呼（crowds）＋鑔片／遊戲秀鼓點（cartoon）疊加。
 */

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

export function playBufferAt(
  ctx: AudioContext,
  buffer: AudioBuffer,
  when: number,
  gain: number,
  destination: AudioNode,
  playbackRate = 1,
): void {
  const src = ctx.createBufferSource();
  const g = ctx.createGain();
  src.buffer = buffer;
  src.playbackRate.value = playbackRate;
  g.gain.value = gain;
  src.connect(g);
  g.connect(destination);
  src.start(when);
}

export type WheelSpinEasing = { p1x: number; p1y: number; p2x: number; p2y: number };

/** 與輪盤 `transition-timing-function: cubic-bezier(...)` 一致（時間 → 角位移比例） */
export const WHEEL_SPIN_TRANSITION_EASING: WheelSpinEasing = {
  p1x: 0.08,
  p1y: 0.82,
  p2x: 0.12,
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

/** 旋轉完成度 p∈[0,1] → 正規化時間 u（用於對齊「經過第 k 格邊界」的瞬間） */
function timeFractionForSpinProgress(p: number, easing: WheelSpinEasing = WHEEL_SPIN_TRANSITION_EASING): number {
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
    const u = timeFractionForSpinProgress(p, easing);
    const when = t0 + u * durS;
    if (buffer) {
      playBufferAt(ctx, buffer, when, tickGain, destination);
    } else {
      scheduleProceduralSpinTickAt(ctx, destination, when, procGain);
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
