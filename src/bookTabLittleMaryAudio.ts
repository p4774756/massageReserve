/**
 * 小瑪莉音效：優先自 HTTP(S) 載入音檔（同源或 CORS），否則以「鋼琴式」多泛音合成（快起音 + 指數衰減）。
 */

/** 全機台主增益（鋼琴多泛音疊加已內建歸一，可略高於舊版單音） */
const MASTER = 0.36;

/** 與 spinTick 遠端取樣搭配：C 大調五聲，以 playbackRate 做相對音程（半音） */
const SPIN_TICK_PENT_SEMIS = [0, 2, 4, 7, 9] as const;
/** 整段音階再乘上此係數（2 = 高八度） */
const SPIN_TICK_EXTRA_OCT = 2;

export type LittleMarySfxRemoteKey =
  | "spinTick"
  | "spinStart"
  | "bet"
  | "noCredit"
  | "clear"
  | "collect"
  | "win"
  | "onceMore"
  | "miss"
  | "error";

export type LittleMarySfxRemoteMap = Partial<Record<LittleMarySfxRemoteKey, string>>;

export type CreateLittleMarySfxOptions = {
  /** 要預先 fetch 並解碼的 URL；缺漏或載入失敗的鍵會回退鋼琴合成 */
  remote?: LittleMarySfxRemoteMap;
};

export type LittleMarySfx = {
  tryUnlock: () => void;
  playBet: () => void;
  playNoCredit: () => void;
  playClear: () => void;
  playCollect: () => void;
  playSpinStart: () => void;
  playSpinTick: (step: number, totalSteps: number) => void;
  playWin: (gain: number) => void;
  playOnceMore: () => void;
  playMiss: () => void;
  playError: () => void;
  dispose: () => void;
};

/** 鋼琴撥弦近似：基音 + 泛音列，高次泛音衰減較快 */
function pianoPluck(freq: number, durationHint: number, peakGain: number, tOffset = 0): void {
  const c = getCtxRef();
  if (!c || freq < 35 || peakGain <= 0) return;
  const t0 = c.currentTime + tOffset;
  const attack = 0.004;
  const partials = [
    { n: 1, w: 0.38, decayMul: 1.0 },
    { n: 2, w: 0.24, decayMul: 0.72 },
    { n: 3, w: 0.18, decayMul: 0.52 },
    { n: 4, w: 0.12, decayMul: 0.38 },
    { n: 5, w: 0.06, decayMul: 0.26 },
    { n: 6, w: 0.02, decayMul: 0.18 },
  ];
  const baseDecay = Math.max(0.11, durationHint * 3.4);
  const stopT = t0 + baseDecay + 0.18;
  for (const { n, w, decayMul } of partials) {
    const osc = c.createOscillator();
    const gn = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * n, t0);
    const d = baseDecay * decayMul;
    const peak = peakGain * w;
    gn.gain.setValueAtTime(0, t0);
    gn.gain.linearRampToValueAtTime(Math.max(1e-4, peak), t0 + attack);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + d);
    osc.connect(gn).connect(c.destination);
    osc.start(t0);
    osc.stop(stopT);
  }
}

let ctx: AudioContext | null = null;

function getCtxRef(): AudioContext | null {
  return ctx;
}

export function createLittleMarySfx(options?: CreateLittleMarySfxOptions): LittleMarySfx {
  const remote = options?.remote ?? {};
  const buffers: Partial<Record<LittleMarySfxRemoteKey, AudioBuffer>> = {};
  let loadPromise: Promise<void> | null = null;

  function getCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (ctx) return ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
    return ctx;
  }

  async function loadRemoteBuffers(): Promise<void> {
    const c = getCtx();
    if (!c) return;
    const jobs = (Object.entries(remote) as [LittleMarySfxRemoteKey, string][])
      .filter(([, url]) => typeof url === "string" && url.length > 0)
      .map(async ([key, url]) => {
        if (buffers[key]) return;
        try {
          const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" });
          if (!res.ok) return;
          const ab = await res.arrayBuffer();
          const buf = await c.decodeAudioData(ab.slice(0));
          buffers[key] = buf;
        } catch {
          /* 略過：改鋼琴合成 */
        }
      });
    await Promise.all(jobs);
  }

  function tryUnlock(): void {
    const c = getCtx();
    if (c?.state === "suspended") {
      void c.resume().catch(() => {});
    }
    if (!loadPromise) {
      loadPromise = loadRemoteBuffers();
    }
  }

  function playSample(
    key: LittleMarySfxRemoteKey,
    gain: number,
    playbackRate: number,
    durationCap: number,
  ): boolean {
    const c = getCtx();
    const buf = buffers[key];
    if (!c || !buf) return false;
    const t0 = c.currentTime;
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = buf;
    src.playbackRate.value = playbackRate;
    const playDur = Math.min(durationCap, buf.duration / Math.max(0.001, playbackRate));
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.002);
    g.gain.linearRampToValueAtTime(0.0001, t0 + playDur);
    src.connect(g).connect(c.destination);
    src.start(t0);
    src.stop(t0 + playDur + 0.03);
    return true;
  }

  return {
    tryUnlock,

    playBet() {
      tryUnlock();
      if (playSample("bet", MASTER * 0.95, 1, 0.35)) return;
      pianoPluck(880, 0.1, MASTER * 0.92);
      pianoPluck(1318, 0.09, MASTER * 0.82, 0.05);
    },

    playNoCredit() {
      tryUnlock();
      if (playSample("noCredit", MASTER * 0.9, 1, 0.45)) return;
      pianoPluck(185, 0.22, MASTER * 0.78);
      pianoPluck(147, 0.24, MASTER * 0.62, 0.11);
    },

    playClear() {
      tryUnlock();
      if (playSample("clear", MASTER * 0.82, 1, 0.35)) return;
      pianoPluck(523.25, 0.12, MASTER * 0.72);
      pianoPluck(392, 0.14, MASTER * 0.65, 0.075);
    },

    playCollect() {
      tryUnlock();
      if (playSample("collect", MASTER * 0.9, 1, 0.55)) return;
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        pianoPluck(f, 0.13, MASTER * (0.72 + i * 0.05), i * 0.075);
      });
      pianoPluck(1318.5, 0.16, MASTER * 0.55, notes.length * 0.075 + 0.04);
    },

    playSpinStart() {
      tryUnlock();
      if (playSample("spinStart", MASTER * 0.88, 1, 0.34)) return;
      pianoPluck(523.25, 0.14, MASTER * 0.95);
      pianoPluck(659.25, 0.12, MASTER * 0.88, 0.055);
      pianoPluck(783.99, 0.12, MASTER * 0.82, 0.11);
      pianoPluck(1046.5, 0.15, MASTER * 0.78, 0.165);
    },

    playSpinTick(step: number, totalSteps: number) {
      tryUnlock();
      const total = Math.max(1, totalSteps);
      const s = Math.max(1, Math.trunc(step));
      const p = Math.min(1, s / total);
      const peak = MASTER * (0.14 + (1 - p) * 0.55);
      const slow = p > 0.85;
      const tail = p > 0.93;
      const semi = SPIN_TICK_PENT_SEMIS[(s - 1) % SPIN_TICK_PENT_SEMIS.length]!;
      const semiUse = tail ? semi + 12 : semi;
      const rate = Math.pow(2, semiUse / 12) * SPIN_TICK_EXTRA_OCT;
      const durCap = tail ? 0.038 : slow ? 0.026 : 0.018;
      if (playSample("spinTick", peak, rate, durCap)) return;

      const hzBase = 523.25;
      const hz = hzBase * rate;
      const body = tail ? 0.22 : slow ? 0.17 : 0.13;
      pianoPluck(hz, body, peak);
    },

    playWin(gainAmt: number) {
      tryUnlock();
      if (playSample("win", MASTER * 0.88, 1, 1.25)) return;
      const big = gainAmt >= 80;
      const seq = big
        ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568]
        : [659.25, 783.99, 987.77, 1174.66];
      const step = big ? 0.075 : 0.095;
      seq.forEach((f, i) => {
        pianoPluck(f, 0.16, MASTER * (0.62 + i * 0.06), i * step);
      });
      pianoPluck(2093, 0.22, MASTER * 0.42, seq.length * step + 0.02);
    },

    playOnceMore() {
      tryUnlock();
      if (playSample("onceMore", MASTER * 0.88, 1, 0.55)) return;
      pianoPluck(783.99, 0.12, MASTER * 0.78);
      pianoPluck(987.77, 0.12, MASTER * 0.72, 0.085);
      pianoPluck(1318.5, 0.14, MASTER * 0.8, 0.175);
      pianoPluck(1568, 0.18, MASTER * 0.58, 0.27);
    },

    playMiss() {
      tryUnlock();
      if (playSample("miss", MASTER * 0.85, 1, 0.45)) return;
      pianoPluck(311.13, 0.14, MASTER * 0.68);
      pianoPluck(233.08, 0.2, MASTER * 0.58, 0.1);
    },

    playError() {
      tryUnlock();
      if (playSample("error", MASTER * 0.82, 1, 0.35)) return;
      pianoPluck(174.61, 0.14, MASTER * 0.62);
      pianoPluck(164.81, 0.17, MASTER * 0.55, 0.08);
    },

    dispose() {
      void ctx?.close().catch(() => {});
      ctx = null;
      for (const k of Object.keys(buffers) as LittleMarySfxRemoteKey[]) {
        delete buffers[k];
      }
      loadPromise = null;
    },
  };
}
