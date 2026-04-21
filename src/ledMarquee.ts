/** 頂部公告區：Canvas 點陣 LED 橫向捲動（取樣自離屏文字點陣） */

export type LedMarqueeHandle = {
  setText: (text: string) => void;
  destroy: () => void;
};

type LedMarqueeOptions = {
  /** 點與點中心距離（CSS px） */
  pitch?: number;
  /** 垂直點數 */
  rows?: number;
  /** 捲動速度（px/s，畫布座標） */
  speed?: number;
  /** 亮度門檻 0–255 */
  threshold?: number;
};

function luminanceAt(data: ImageData, xi: number, yi: number): number {
  if (xi < 0 || yi < 0 || xi >= data.width || yi >= data.height) return 0;
  const i = (yi * data.width + xi) * 4;
  const r = data.data[i];
  const g = data.data[i + 1];
  const b = data.data[i + 2];
  const a = data.data[i + 3] / 255;
  return ((r + g + b) / 3) * a;
}

/** 以 3×3 鄰域取最大亮度，補齊抗鋸齒造成的斷筆、較適合中文與符號 */
function luminanceNeighborhoodMax(data: ImageData, x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let max = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const v = luminanceAt(data, cx + dx, cy + dy);
      if (v > max) max = v;
    }
  }
  return max;
}

export function createLedMarquee(
  container: HTMLElement,
  options: LedMarqueeOptions = {},
): LedMarqueeHandle {
  const pitch = options.pitch ?? 6;
  /** 預設 28 行：約為原 14 行之 2 倍高度，筆畫較易辨識 */
  const rows = options.rows ?? 28;
  const speed = options.speed ?? 30;
  const threshold = options.threshold ?? 108;

  const canvas = document.createElement("canvas");
  canvas.className = "led-marquee-canvas";
  canvas.setAttribute("role", "img");
  container.append(canvas);

  /** 區塊被 hidden / 不在版面內時暫停捲動以省電 */
  let intersecting = true;
  const ioRoot = container.parentElement;
  const io =
    ioRoot &&
    new IntersectionObserver(
      (entries) => {
        intersecting = entries[0]?.isIntersecting ?? false;
      },
      { threshold: 0 },
    );
  if (io && ioRoot) io.observe(ioRoot);

  let destroyed = false;
  let raf = 0;
  let scroll = 0;
  let lastT = 0;
  let bitmap: ImageData | null = null;
  let bitmapW = 0;
  let cycleLen = 1;

  function rebuildBitmap(text: string) {
    if (!text) {
      bitmap = null;
      bitmapW = 0;
      cycleLen = 1;
      return;
    }
    const oc = document.createElement("canvas");
    const octx = oc.getContext("2d", { willReadFrequently: true });
    if (!octx) return;

    const h = rows * pitch;
    const fontPx = Math.max(14, h * 0.74);
    octx.font = `700 ${fontPx}px "Noto Sans TC", "DM Sans", system-ui, sans-serif`;
    const metrics = octx.measureText(text);
    const tw = Math.min(12000, Math.ceil(metrics.width + pitch * 6));
    oc.width = tw;
    oc.height = h;
    octx.font = `700 ${fontPx}px "Noto Sans TC", "DM Sans", system-ui, sans-serif`;
    octx.fillStyle = "#030807";
    octx.fillRect(0, 0, oc.width, oc.height);
    octx.fillStyle = "#ffffff";
    octx.textBaseline = "middle";
    octx.fillText(text, pitch * 2, h / 2 + 0.5);
    bitmap = octx.getImageData(0, 0, oc.width, oc.height);
    bitmapW = oc.width;
    cycleLen = bitmapW + pitch * 10;
    scroll = scroll % cycleLen;
  }

  function paint(t: number) {
    if (destroyed) return;
    if (!lastT) lastT = t;
    const dt = Math.min((t - lastT) / 1000, 0.08);
    lastT = t;

    const rect = container.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = rows * pitch + 12;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      raf = requestAnimationFrame(paint);
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#070f0e";
    ctx.fillRect(0, 0, cssW, cssH);

    if (intersecting && bitmap && bitmapW > 0) {
      scroll += speed * dt;
      while (scroll >= cycleLen) scroll -= cycleLen;
    }

    const dotR = pitch * 0.38;
    const padY = (cssH - rows * pitch) / 2;
    const cols = Math.ceil(cssW / pitch);

    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const cx = i * pitch + pitch / 2;
        const cy = padY + j * pitch + pitch / 2;
        const sx = scroll + cx;
        const sy = j * pitch + pitch / 2;

        ctx.fillStyle = "rgb(22, 34, 32)";
        ctx.beginPath();
        ctx.arc(cx, cy, dotR * 1.08, 0, Math.PI * 2);
        ctx.fill();

        if (!bitmap) continue;
        const lum = luminanceNeighborhoodMax(bitmap, sx, sy);
        if (lum <= threshold) continue;

        const hue = ((i * 13 + j * 5 + scroll * 0.65) % 360 + 360) % 360;
        ctx.save();
        ctx.shadowColor = `hsl(${hue} 88% 48%)`;
        ctx.shadowBlur = 3.5;
        ctx.fillStyle = `hsl(${hue} 82% 58%)`;
        ctx.beginPath();
        ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    raf = requestAnimationFrame(paint);
  }

  raf = requestAnimationFrame(paint);

  return {
    setText(text: string) {
      canvas.setAttribute("aria-label", text.trim().slice(0, 200) || "公告跑馬燈");
      rebuildBitmap(text);
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      io?.disconnect();
      canvas.remove();
    },
  };
}
