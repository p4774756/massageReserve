/**
 * 手遊風向量圖示（內嵌 SVG），供老虎機轉輪與裝飾使用。
 * 漸層 id 會加上 uid 後綴，避免同一頁多份 SVG 衝突。
 */

export type SlotIconId = "energy" | "shuriken" | "coin" | "wheel" | "drink" | "sparkle";

const STROKE = "#1a120c";
const SW = 2.8;

function wrapSvg(inner: string, viewBox: string, w: number, h: number, extraClass = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}" aria-hidden="true" class="lucky-slot-svg${extraClass ? ` ${extraClass}` : ""}">${inner}</svg>`;
}

function iconEnergy(uid: string): string {
  const g = `eG-${uid}`;
  return wrapSvg(
    `
  <defs>
    <radialGradient id="${g}" cx="35%" cy="35%" r="65%">
      <stop offset="0%" stop-color="#b8f0ff"/>
      <stop offset="45%" stop-color="#2a9cff"/>
      <stop offset="100%" stop-color="#0a3d8a"/>
    </radialGradient>
    <filter id="eGlow-${uid}"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <circle cx="32" cy="32" r="22" fill="none" stroke="${STROKE}" stroke-width="${SW}"/>
  <circle cx="32" cy="32" r="18" fill="url(#${g})" stroke="${STROKE}" stroke-width="${SW}" filter="url(#eGlow-${uid})"/>
  <ellipse cx="26" cy="24" rx="8" ry="5" fill="rgb(255 255 255 / 0.45)" transform="rotate(-35 26 24)"/>
  <path d="M32 14 L36 22 L44 20 L38 28 L44 36 L34 34 L32 44 L28 34 L18 36 L24 28 L18 20 L26 22 Z" fill="rgb(200 240 255 / 0.5)" stroke="${STROKE}" stroke-width="1.6"/>
`,
    "0 0 64 64",
    64,
    64,
  );
}

function iconShuriken(uid: string): string {
  const s = `sG-${uid}`;
  return wrapSvg(
    `
  <defs><linearGradient id="${s}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#9a9a9a"/><stop offset="50%" stop-color="#d8d8d8"/><stop offset="100%" stop-color="#6a6a6a"/></linearGradient></defs>
  <g stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round">
    <path fill="url(#${s})" d="M32 8 L38 26 L56 26 L42 36 L48 54 L32 44 L16 54 L22 36 L8 26 L26 26 Z"/>
    <circle cx="32" cy="32" r="7" fill="#4a4a4a"/>
  </g>
`,
    "0 0 64 64",
    64,
    64,
  );
}

function iconCoin(uid: string): string {
  const c = `cG-${uid}`;
  return wrapSvg(
    `
  <defs>
    <linearGradient id="${c}" x1="30%" y1="0%" x2="70%" y2="100%"><stop offset="0%" stop-color="#ffe566"/><stop offset="45%" stop-color="#ffb020"/><stop offset="100%" stop-color="#c97800"/></linearGradient>
  </defs>
  <ellipse cx="32" cy="32" rx="24" ry="22" fill="url(#${c})" stroke="${STROKE}" stroke-width="${SW}"/>
  <ellipse cx="28" cy="26" rx="10" ry="7" fill="rgb(255 255 255 / 0.35)"/>
  <text x="32" y="40" text-anchor="middle" font-size="22" font-weight="800" fill="#5a3a00" stroke="${STROKE}" stroke-width="1.2" font-family="system-ui,sans-serif">$</text>
`,
    "0 0 64 64",
    64,
    64,
  );
}

function iconWheel(uid: string): string {
  const w0 = `w0-${uid}`;
  const w1 = `w1-${uid}`;
  const w2 = `w2-${uid}`;
  const w3 = `w3-${uid}`;
  return wrapSvg(
    `
  <defs>
    <linearGradient id="${w0}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ff6b6b"/><stop offset="100%" stop-color="#c92a2a"/></linearGradient>
    <linearGradient id="${w1}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#69db7c"/><stop offset="100%" stop-color="#2b8a3e"/></linearGradient>
    <linearGradient id="${w2}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#74c0fc"/><stop offset="100%" stop-color="#1864ab"/></linearGradient>
    <linearGradient id="${w3}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ffd43b"/><stop offset="100%" stop-color="#f08c00"/></linearGradient>
  </defs>
  <circle cx="32" cy="32" r="24" fill="#333" stroke="${STROKE}" stroke-width="${SW}"/>
  <path d="M32 32 L32 10 A22 22 0 0 1 52 32 Z" fill="url(#${w0})" stroke="${STROKE}" stroke-width="1.5"/>
  <path d="M32 32 L52 32 A22 22 0 0 1 32 54 Z" fill="url(#${w1})" stroke="${STROKE}" stroke-width="1.5"/>
  <path d="M32 32 L32 54 A22 22 0 0 1 12 32 Z" fill="url(#${w2})" stroke="${STROKE}" stroke-width="1.5"/>
  <path d="M32 32 L12 32 A22 22 0 0 1 32 10 Z" fill="url(#${w3})" stroke="${STROKE}" stroke-width="1.5"/>
  <circle cx="32" cy="32" r="8" fill="#eee" stroke="${STROKE}" stroke-width="2"/>
`,
    "0 0 64 64",
    64,
    64,
  );
}

function iconDrink(uid: string): string {
  const d = `dG-${uid}`;
  return wrapSvg(
    `
  <defs><linearGradient id="${d}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#8ce99a"/><stop offset="100%" stop-color="#2f9e44"/></linearGradient></defs>
  <path d="M20 18 L44 18 L40 52 Q32 58 24 52 Z" fill="url(#${d})" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
  <path d="M22 18 L24 12 L40 12 L42 18" fill="none" stroke="${STROKE}" stroke-width="${SW}" stroke-linecap="round"/>
  <path d="M28 26 L36 26 M30 32 L34 32" stroke="${STROKE}" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
  <ellipse cx="32" cy="22" rx="10" ry="4" fill="rgb(255 255 255 / 0.35)"/>
`,
    "0 0 64 64",
    64,
    64,
  );
}

function iconSparkle(uid: string): string {
  const p = `pG-${uid}`;
  return wrapSvg(
    `
  <defs><linearGradient id="${p}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#fff3bf"/><stop offset="50%" stop-color="#ffd43b"/><stop offset="100%" stop-color="#f59f00"/></linearGradient></defs>
  <path d="M32 6 L38 24 L56 24 L42 34 L48 56 L32 46 L16 56 L22 34 L8 24 L26 24 Z" fill="url(#${p})" stroke="${STROKE}" stroke-width="${SW}" stroke-linejoin="round"/>
  <circle cx="32" cy="32" r="6" fill="#fff8dc" stroke="${STROKE}" stroke-width="1.5"/>
`,
    "0 0 64 64",
    64,
    64,
  );
}

export function slotPrizeIconSvg(id: SlotIconId, uid: string): string {
  const u = uid.replace(/[^a-zA-Z0-9_-]/g, "x");
  switch (id) {
    case "energy":
      return iconEnergy(u);
    case "shuriken":
      return iconShuriken(u);
    case "coin":
      return iconCoin(u);
    case "wheel":
      return iconWheel(u);
    case "drink":
      return iconDrink(u);
    case "sparkle":
    default:
      return iconSparkle(u);
  }
}

export function slotBulbSvg(): string {
  const b = "bulb-static";
  return wrapSvg(
    `
  <defs><radialGradient id="bG-${b}" cx="35%" cy="30%" r="70%"><stop offset="0%" stop-color="#fff9c4"/><stop offset="40%" stop-color="#ffe066"/><stop offset="100%" stop-color="#f9a825"/></radialGradient></defs>
  <path d="M24 44 Q32 52 40 44 L38 36 Q32 40 26 36 Z" fill="#8d6e63" stroke="${STROKE}" stroke-width="2"/>
  <circle cx="32" cy="26" r="16" fill="url(#bG-${b})" stroke="${STROKE}" stroke-width="${SW}"/>
  <ellipse cx="26" cy="20" rx="6" ry="4" fill="rgb(255 255 255 / 0.55)"/>
`,
    "0 0 64 64",
    52,
    52,
  );
}

export function slotTvSvg(): string {
  const t = "tv-static";
  return wrapSvg(
    `
  <defs>
    <linearGradient id="tvB-${t}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#5c7cfa"/><stop offset="100%" stop-color="#364fc7"/></linearGradient>
    <linearGradient id="tvS-${t}" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ff6b6b"/><stop offset="33%" stop-color="#ffd43b"/><stop offset="66%" stop-color="#69db7c"/><stop offset="100%" stop-color="#74c0fc"/></linearGradient>
    <filter id="tg-${t}"><feGaussianBlur stdDeviation="1.2" result="x"/><feMerge><feMergeNode in="x"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect x="10" y="14" width="44" height="38" rx="6" fill="url(#tvB-${t})" stroke="${STROKE}" stroke-width="${SW}"/>
  <rect x="16" y="20" width="32" height="24" rx="2" fill="#222" stroke="${STROKE}" stroke-width="1.5"/>
  <rect x="18" y="22" width="28" height="20" fill="url(#tvS-${t})" opacity="0.9"/>
  <path d="M28 54 L32 62 L36 54" fill="#333" stroke="${STROKE}" stroke-width="1.5" stroke-linejoin="round"/>
  <circle cx="50" cy="52" r="5" fill="rgb(255 230 120 / 0.95)" stroke="${STROKE}" stroke-width="1.2" filter="url(#tg-${t})"/>
`,
    "0 0 64 64",
    48,
    48,
  );
}

export function slotLeverSvg(): string {
  return wrapSvg(
    `
  <defs>
    <linearGradient id="lM-static" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#9e9e9e"/><stop offset="40%" stop-color="#f5f5f5"/><stop offset="100%" stop-color="#757575"/></linearGradient>
    <radialGradient id="lK-static" cx="35%" cy="30%" r="70%"><stop offset="0%" stop-color="#ff8a8a"/><stop offset="55%" stop-color="#e03131"/><stop offset="100%" stop-color="#7f1d1d"/></radialGradient>
  </defs>
  <g class="lucky-slot-lever__draw">
    <rect x="28" y="28" width="8" height="36" rx="3" fill="url(#lM-static)" stroke="${STROKE}" stroke-width="2" transform="rotate(-14 32 46)"/>
    <circle cx="44" cy="18" r="14" fill="url(#lK-static)" stroke="${STROKE}" stroke-width="2.5"/>
    <ellipse cx="40" cy="14" rx="5" ry="3" fill="rgb(255 255 255 / 0.45)"/>
  </g>
`,
    "0 0 64 88",
    52,
    72,
    "lucky-slot-svg--lever",
  );
}

/** 轉輪下方小「播」角標（仿獎勵影片廣告藍鈕） */
export function slotReelAdBadgeSvg(uid: string): string {
  const u = uid.replace(/[^a-zA-Z0-9_-]/g, "x");
  return wrapSvg(
    `
  <defs>
    <linearGradient id="adBadgeBg-${u}" x1="30%" y1="0%" x2="70%" y2="100%">
      <stop offset="0%" stop-color="#5cadff"/>
      <stop offset="100%" stop-color="#1a6fd4"/>
    </linearGradient>
  </defs>
  <circle cx="16" cy="16" r="14" fill="url(#adBadgeBg-${u})" stroke="${STROKE}" stroke-width="2"/>
  <polygon points="12,10 12,22 22,16" fill="white"/>
`,
    "0 0 32 32",
    22,
    22,
    "lucky-slot-svg--badge",
  );
}
