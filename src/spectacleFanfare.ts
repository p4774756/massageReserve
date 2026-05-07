/**
 * 輪盤／拉霸全螢幕演出共用：開場爆裂音、旋轉底噪、中獎號角（取樣 + 合成）
 */

import { playBufferAt, type PrefetchedWheelSfx } from "./wheelSpectacleSfx";

export function computeSplitY(anchor: HTMLElement | null | undefined): number {
  const margin = window.innerHeight * 0.1;
  if (anchor && document.contains(anchor)) {
    const r = anchor.getBoundingClientRect();
    const y = r.top + r.height * 0.5;
    return Math.min(Math.max(y, margin), window.innerHeight - margin);
  }
  return Math.min(Math.max(window.innerHeight * 0.4, margin), window.innerHeight - margin);
}

export function getSpectacleAudioContext(): AudioContext | null {
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

export function playCrackBang(ctx: AudioContext) {
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
  const base = ctx.currentTime + 0.02;
  const bus = ctx.createGain();
  bus.gain.value = 0.9 * gainScale;
  bus.connect(destination);

  const tone = (
    t0: number,
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
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.016);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  };

  const sparkle = (t0: number, freq: number, peak: number) => {
    tone(t0, freq, 0.09, peak, "sine", 4200);
  };

  tone(base, 55, 0.3, 0.12, "sine");
  tone(base + 0.02, 65.41, 0.26, 0.1, "sine");
  tone(base + 0.03, 98, 0.2, 0.065, "triangle", 240);

  const arp = [523.25, 659.25, 783.99, 987.77, 1174.66];
  arp.forEach((f, i) => {
    tone(base + 0.055 + i * 0.036, f, 0.16, 0.072, "triangle", 2800);
  });

  const chordT = base + 0.28;
  const chord = [
    [261.63, 0.055],
    [329.63, 0.06],
    [392, 0.065],
    [523.25, 0.072],
    [659.25, 0.062],
    [783.99, 0.054],
  ] as const;
  for (const [f, v] of chord) {
    tone(chordT, f, 0.48, v, "triangle", 5200);
    tone(chordT + 0.004, f * 1.006, 0.42, v * 0.34, "sine", 6200);
  }

  sparkle(chordT + 0.08, 2093, 0.078);
  sparkle(chordT + 0.12, 2637, 0.072);
  sparkle(chordT + 0.17, 3136, 0.065);

  const echoT = chordT + 0.44;
  for (const [f, v] of chord) {
    tone(echoT, f * 0.5, 0.38, v * 0.28, "sine", 900);
    tone(echoT + 0.006, f, 0.34, v * 0.2, "triangle", 3400);
  }
  sparkle(echoT + 0.12, 2793, 0.048);

  const tail = echoT + 0.32;
  const tailArp = [783.99, 987.77, 1174.66];
  tailArp.forEach((f, i) => {
    tone(tail + i * 0.045, f, 0.26, 0.04, "triangle", 4000);
  });
}

export function playRevealFanfareCombined(
  ctx: AudioContext,
  sfx: PrefetchedWheelSfx,
  destination: AudioNode,
) {
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

  const cheerSec = 10;
  const crowdSec = 10;

  if (sfx.winCymbalCrash) {
    playBufferAt(ctx, sfx.winCymbalCrash, t0, 0.45, destination, 1, 0.32);
  }
  if (sfx.winMagicChime) {
    playBufferAt(ctx, sfx.winMagicChime, t0 + 0.02, 0.34, destination, 1.02, 0.22);
  }
  if (sfx.winTeamCheer) {
    playBufferAt(ctx, sfx.winTeamCheer, t0 + 0.03, 0.28, destination, 1, cheerSec);
  } else if (sfx.winCrowdCelebration) {
    playBufferAt(ctx, sfx.winCrowdCelebration, t0 + 0.04, 0.24, destination, 1.02, crowdSec);
  }

  if (sfx.winHorn) {
    playBufferAt(ctx, sfx.winHorn, t0 + 0.06, 0.36, destination, 1.04, 0.28);
  }
  if (sfx.winSlide) {
    playBufferAt(ctx, sfx.winSlide, t0 + 0.09, 0.3, destination, 1.06, 0.32);
  }
  if (sfx.winBoing) {
    playBufferAt(ctx, sfx.winBoing, t0 + 0.11, 0.34, destination, 1, 0.28);
  }
  if (sfx.winCowbell) {
    playBufferAt(ctx, sfx.winCowbell, t0 + 0.14, 0.28, destination, 1.04, 0.22);
  }
  if (sfx.winFlicks) {
    playBufferAt(ctx, sfx.winFlicks, t0 + 0.16, 0.28, destination, 1.03, 0.24);
  }
  if (sfx.winPunchlineDrum) {
    playBufferAt(ctx, sfx.winPunchlineDrum, t0 + 0.18, 0.32, destination, 1, 0.36);
  }

  if (sfx.winMagicChime) {
    playBufferAt(ctx, sfx.winMagicChime, t0 + 8.35, 0.22, destination, 1.12, 0.16);
  }

  playRevealFanfareSynth(ctx, destination, anyWinSample ? 0.38 : 0.85);
}

/**
 * 短中獎聲：鑔片／叮噹等短取樣疊加，不含群眾歡呼與長合成號角（拉霸結尾用）。
 */
export function playWinStinger(ctx: AudioContext, sfx: PrefetchedWheelSfx, destination: AudioNode): void {
  const t0 = ctx.currentTime + 0.02;
  let layered = false;
  if (sfx.winCymbalCrash) {
    playBufferAt(ctx, sfx.winCymbalCrash, t0, 0.48, destination, 1, 0.32);
    layered = true;
  }
  if (sfx.winMagicChime) {
    playBufferAt(ctx, sfx.winMagicChime, t0 + (layered ? 0.05 : 0), 0.4, destination, 1.02, 0.22);
    layered = true;
  }
  if (layered) return;
  if (sfx.winHorn) {
    playBufferAt(ctx, sfx.winHorn, t0, 0.44, destination, 1.04, 0.28);
    return;
  }
  if (sfx.winBoing) {
    playBufferAt(ctx, sfx.winBoing, t0, 0.38, destination, 1, 0.28);
    return;
  }
  if (sfx.winPunchlineDrum) {
    playBufferAt(ctx, sfx.winPunchlineDrum, t0, 0.36, destination, 1, 0.35);
  }
}

export function startSpinDrone(ctx: AudioContext, destination: AudioNode, gain = 0.014): () => void {
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
