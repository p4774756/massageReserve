/** 抽輪盤全螢幕演出：沿觸發區上下割裂、露出後方輪盤 + 聲光 */

export type SpinWheelSpectacleResult = {
  prize: { id?: string; name: string; type: string; value: number };
  drawChances: number;
  walletBalance: number;
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

const SLICE_FILL = [
  "#e84d6a",
  "#f4a43c",
  "#f7e05a",
  "#6bcf7a",
  "#4ecde0",
  "#7b8cf7",
  "#c56cf0",
  "#f06292",
  "#ffb74d",
  "#90caf9",
  "#b39ddb",
  "#e57373",
];

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
    path.setAttribute("fill", SLICE_FILL[i % SLICE_FILL.length]);
    path.setAttribute("stroke", "rgb(255 255 255 / 0.5)");
    path.setAttribute("stroke-width", "0.012");
    path.setAttribute("data-prize-id", p.id);
    svg.appendChild(path);

    const mid = (a0 + a1) / 2;
    const labelR = (rOut + rIn) / 2;
    const [tx, ty] = polarToXY(labelR, mid);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(tx));
    text.setAttribute("y", String(ty));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("fill", "#1a1428");
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

function playRevealFanfare(ctx: AudioContext) {
  const base = ctx.currentTime + 0.04;
  const freqs = [392, 523.25, 659.25, 783.99];
  freqs.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    const t = base + i * 0.065;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.065, t + 0.035);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.5);
  });
}

function startSpinDrone(ctx: AudioContext): () => void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = "sawtooth";
  o.frequency.value = 48;
  f.type = "lowpass";
  f.frequency.value = 380;
  g.gain.value = 0.014;
  o.connect(f);
  f.connect(g);
  g.connect(ctx.destination);
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

    let settled = false;
    const tearDown = () => {
      if (settled) return;
      settled = true;
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

    const audioCtx = getAudioContext();
    if (audioCtx?.state === "suspended") {
      void audioCtx.resume();
    }

    void (async () => {
      const labelsPromise =
        options?.fetchPrizeLabels != null
          ? options.fetchPrizeLabels().catch(() => null)
          : Promise.resolve(null);

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

      await Promise.all([sleep(980), labelsPromise]);
      const prizeList = await labelsPromise;
      if (prizeList && prizeList.length > 0) {
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
          tearDown();
          reject(e);
        };
        primaryBtn.onclick = dismiss;
        primaryBtn.focus();
        return;
      }

      hub.classList.remove("is-pulse");
      const apiMs = performance.now() - tApi;
      await sleep(Math.max(0, 2000 - apiMs));

      let stopDrone: (() => void) | null = null;
      if (audioCtx) {
        try {
          stopDrone = startSpinDrone(audioCtx);
        } catch {
          stopDrone = null;
        }
      }
      wheel.classList.add("is-rim-glow");

      const spins = 5 + Math.floor(Math.random() * 3);
      const jitter = Math.random() * 360;
      const finalDeg = spins * 360 + jitter;
      wheel.style.transition = "transform 3.15s cubic-bezier(0.1, 0.85, 0.15, 1)";
      wheel.style.transform = `rotate(${finalDeg}deg)`;
      await sleep(3200);

      const wonId = data.prize.id;
      if (wonId) {
        wheel.querySelectorAll("path.is-winner-slice").forEach((el) => el.classList.remove("is-winner-slice"));
        const hit = wheel.querySelector(`path[data-prize-id="${wonId}"]`);
        hit?.classList.add("is-winner-slice");
      }

      wheel.classList.remove("is-rim-glow");
      stopDrone?.();
      overlay.classList.add("is-win-burst");

      if (audioCtx) {
        try {
          playRevealFanfare(audioCtx);
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
        data.prize.type === "credit"
          ? `已入帳 ${data.prize.value} 元儲值金`
          : data.prize.type === "chance"
            ? `可抽次數已更新（目前 ${data.drawChances} 次）`
            : "祝你有美好的一天";

      primaryBtn.disabled = false;
      dismiss = () => {
        tearDown();
        resolve(data);
      };
      primaryBtn.onclick = dismiss;
      primaryBtn.focus();
    })();
  });
}
