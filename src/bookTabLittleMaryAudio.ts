/**
 * 小瑪莉：Web Audio 合成音效（無外部音檔、需使用者操作後解鎖）。
 */

const MASTER = 0.11;

export type LittleMarySfx = {
  tryUnlock: () => void;
  playBet: () => void;
  playNoCredit: () => void;
  playClear: () => void;
  playCollect: () => void;
  playSpinStart: () => void;
  playSpinTick: (progress01: number) => void;
  playWin: (gain: number) => void;
  playOnceMore: () => void;
  playMiss: () => void;
  playError: () => void;
  dispose: () => void;
};

export function createLittleMarySfx(): LittleMarySfx {
  let ctx: AudioContext | null = null;

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

  function tryUnlock(): void {
    const c = getCtx();
    if (c?.state === "suspended") {
      void c.resume().catch(() => {});
    }
  }

  /** 單音 beep */
  function beep(
    freq: number,
    dur: number,
    type: OscillatorType = "square",
    vol = MASTER,
    tOffset = 0,
  ): void {
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime + tOffset;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.004);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** 滑音 */
  function slide(
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType = "square",
    vol = MASTER * 1.2,
  ): void {
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.04);
  }

  /** 短雜訊「喀」 */
  function click(vol = MASTER * 0.45): void {
    const c = getCtx();
    if (!c) return;
    const t0 = c.currentTime;
    const len = 0.022;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = c.createBufferSource();
    const g = c.createGain();
    src.buffer = buf;
    g.gain.setValueAtTime(vol, t0);
    g.gain.linearRampToValueAtTime(0.0001, t0 + len);
    src.connect(g).connect(c.destination);
    src.start(t0);
    src.stop(t0 + len + 0.01);
  }

  return {
    tryUnlock,

    playBet() {
      tryUnlock();
      beep(880, 0.04, "square", MASTER * 0.9);
      beep(1320, 0.035, "square", MASTER * 0.55, 0.045);
    },

    playNoCredit() {
      tryUnlock();
      beep(180, 0.12, "triangle", MASTER * 0.7);
      beep(140, 0.14, "triangle", MASTER * 0.5, 0.1);
    },

    playClear() {
      tryUnlock();
      beep(523, 0.06, "square", MASTER * 0.5);
      beep(392, 0.08, "square", MASTER * 0.45, 0.07);
    },

    playCollect() {
      tryUnlock();
      const notes = [523, 659, 784, 1046];
      notes.forEach((f, i) => {
        beep(f, 0.07, "square", MASTER * 0.65, i * 0.08);
      });
      beep(1318, 0.12, "triangle", MASTER * 0.35, notes.length * 0.08 + 0.05);
    },

    playSpinStart() {
      tryUnlock();
      slide(220, 880, 0.18, "sawtooth", MASTER * 0.35);
      beep(440, 0.08, "square", MASTER * 0.4, 0.16);
    },

    playSpinTick(progress01: number) {
      tryUnlock();
      const p = Math.min(1, Math.max(0, progress01));
      const freq = 360 + (1 - p) * 480;
      const vol = MASTER * (0.07 + (1 - p) * 0.38);
      if (p > 0.93) {
        click(vol * 2.4);
        return;
      }
      beep(freq, p > 0.85 ? 0.018 : 0.011, "square", vol);
    },

    playWin(gain: number) {
      tryUnlock();
      const big = gain >= 80;
      const seq = big ? [523, 659, 784, 1046, 1318, 1568] : [659, 784, 988, 1174];
      const step = big ? 0.07 : 0.09;
      seq.forEach((f, i) => {
        beep(f, 0.09, "square", MASTER * (0.55 + i * 0.06), i * step);
      });
      beep(2093, 0.2, "triangle", MASTER * 0.25, seq.length * step + 0.02);
    },

    playOnceMore() {
      tryUnlock();
      beep(784, 0.08, "square", MASTER * 0.6);
      beep(988, 0.08, "square", MASTER * 0.55, 0.09);
      beep(1318, 0.1, "square", MASTER * 0.65, 0.18);
      beep(1568, 0.14, "triangle", MASTER * 0.4, 0.28);
    },

    playMiss() {
      tryUnlock();
      beep(330, 0.1, "triangle", MASTER * 0.5);
      beep(247, 0.16, "triangle", MASTER * 0.45, 0.1);
    },

    playError() {
      tryUnlock();
      beep(200, 0.08, "sawtooth", MASTER * 0.4);
      beep(180, 0.1, "sawtooth", MASTER * 0.35, 0.08);
    },

    dispose() {
      void ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
