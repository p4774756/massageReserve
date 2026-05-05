import * as THREE from "three";
import { getLocale } from "./i18n";
import {
  SHARED_SOLAR_PLANET_DEFS,
  bodyMat,
  collectDisposables,
  createSoftStarPointSpriteTexture,
  fillAsteroidBelt,
  fillStarField,
} from "./solarSpectacleShared";

const DPR_CAP = 2;

/** 動畫時間縮放（<1 較慢）：公轉／自轉／銀河殼、太空船、彗星、閒置環景等 */
const SPECTACLE_TIME_SCALE = 0.4;

type BodyId =
  | "sun"
  | "mercury"
  | "venus"
  | "earth"
  | "moon"
  | "mars"
  | "jupiter"
  | "saturn"
  | "uranus"
  | "neptune"
  | "pluto";

const BODY_LABELS: Record<
  BodyId,
  {
    zh: { title: string; blurb: string };
    en: { title: string; blurb: string };
  }
> = {
  sun: {
    zh: {
      title: "太陽",
      blurb:
        "太陽系中心恆星，提供光與熱；光球層為程式化米粒組織示意，外層為多層 additive 光暈（比例皆為示意）。",
    },
    en: {
      title: "Sun",
      blurb:
        "The star at the center of the Solar System. The photosphere uses a procedural granulation-style map with layered additive glow—all illustrative scale.",
    },
  },
  mercury: {
    zh: { title: "水星", blurb: "距太陽最近、無大氣的小型岩質行星。飛近為示意地表貼圖。" },
    en: {
      title: "Mercury",
      blurb: "Smallest major planet, no real atmosphere, closest to the Sun. Fly close for an illustrative surface map.",
    },
  },
  venus: {
    zh: { title: "金星", blurb: "厚雲與高溫高壓，太陽系最熱的行星表面之一。飛近為示意貼圖。" },
    en: {
      title: "Venus",
      blurb: "Thick clouds and a crushing, scorching surface. Fly close for an illustrative texture.",
    },
  },
  earth: {
    zh: {
      title: "地球",
      blurb:
        "已知唯一有穩定液態水與生命的行星。飛近時載入晝面貼圖；外圍藍色大氣光暈帶簡化漂移流動示意（非天氣模型）。",
    },
    en: {
      title: "Earth",
      blurb:
        "The only world we know with stable liquid water and life. Fly close for the day map—blue atmospheric rim with a simple drifting flow pattern (illustrative, not a weather model).",
    },
  },
  moon: {
    zh: { title: "月球", blurb: "地球的天然衛星；示意軌道與比例。飛近為 three.js 範例月球貼圖。" },
    en: {
      title: "Moon",
      blurb: "Earth’s natural satellite—orbits and scale are illustrative. Fly close for the three.js example moon map.",
    },
  },
  mars: {
    zh: { title: "火星", blurb: "氧化鐵呈紅色；有稀薄大氣與季節性極冠。飛近為示意地表貼圖。" },
    en: {
      title: "Mars",
      blurb: "The “Red Planet,” thin air and seasonal polar caps. Fly close for an illustrative surface map.",
    },
  },
  jupiter: {
    zh: { title: "木星", blurb: "氣態巨行星，質量為其他行星總和的好幾倍。飛近為示意雲帶貼圖。" },
    en: {
      title: "Jupiter",
      blurb: "A gas giant heavier than all other planets combined. Fly close for illustrative cloud bands.",
    },
  },
  saturn: {
    zh: { title: "土星", blurb: "以壯觀的冰／岩石環系著稱的氣態巨行星。飛近為示意雲帶貼圖。" },
    en: {
      title: "Saturn",
      blurb: "A gas giant famous for its spectacular ring system. Fly close for illustrative cloud bands.",
    },
  },
  uranus: {
    zh: { title: "天王星", blurb: "冰巨行星，自轉軸極度傾斜。飛近為示意貼圖。" },
    en: {
      title: "Uranus",
      blurb: "An ice giant with an extreme axial tilt. Fly close for an illustrative texture.",
    },
  },
  neptune: {
    zh: { title: "海王星", blurb: "太陽系已知最遠的主要行星，深藍色冰巨行星。飛近為示意貼圖。" },
    en: {
      title: "Neptune",
      blurb: "The farthest major planet—deep blue ice giant. Fly close for an illustrative texture.",
    },
  },
  pluto: {
    zh: { title: "冥王星", blurb: "矮行星，位於古柏帶；軌道較橢且與海王星共振。飛近為示意貼圖。" },
    en: {
      title: "Pluto",
      blurb: "A Kuiper Belt dwarf planet with an eccentric orbit. Fly close for an illustrative texture.",
    },
  },
};

/** 導覽列順序：由內而外 */
const TOUR_BODY_ORDER: BodyId[] = [
  "sun",
  "mercury",
  "venus",
  "earth",
  "moon",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
];

/** 飛到該天體附近時的相機距離（軌道球半徑），依示意比例調整 */
function visitRadiusFor(id: BodyId): number {
  switch (id) {
    case "sun":
      return 1.05;
    case "mercury":
      return 0.19;
    case "venus":
      return 0.24;
    case "earth":
      return 0.24;
    case "moon":
      return 0.082;
    case "mars":
      return 0.22;
    case "jupiter":
      return 0.62;
    case "saturn":
      return 0.52;
    case "uranus":
      return 0.38;
    case "neptune":
      return 0.36;
    case "pluto":
      return 0.13;
    default:
      return 0.35;
  }
}

function bodyLabel(id: BodyId): { title: string; blurb: string } {
  const row = BODY_LABELS[id];
  return getLocale() === "en" ? row.en : row.zh;
}

function tagPickable(mesh: THREE.Mesh, id: BodyId) {
  mesh.userData.bodyId = id;
}

/** `public/solar/` 貼圖（與 Vite BASE_URL 對齊） */
function solarTextureSrc(file: string): string {
  const base = import.meta.env.BASE_URL ?? "/";
  const norm = base.endsWith("/") ? base : `${base}/`;
  return `${norm}solar/${file}`;
}

/** 八大行星＋冥王星＋月球貼圖檔名（earth／moon 為 three.js 範例；其餘見 public/solar/ATTRIBUTION.txt） */
const SOLAR_PLANET_SURFACE_FILES: Partial<Record<BodyId, string>> = {
  mercury: "mercurymap.jpg",
  venus: "venusmap.jpg",
  earth: "earth_day_4096.jpg",
  mars: "marsmap.jpg",
  jupiter: "jupitermap.jpg",
  saturn: "saturnmap.jpg",
  uranus: "uranusmap.jpg",
  neptune: "neptunemap.jpg",
  pluto: "plutomap.jpg",
};

function prepPlanetDiffuseTexture(tex: THREE.Texture, renderer: THREE.WebGLRenderer) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
}

function loadSolarPlanetSurface(
  mat: THREE.MeshStandardMaterial,
  file: string,
  renderer: THREE.WebGLRenderer,
): void {
  new THREE.TextureLoader().load(
    solarTextureSrc(file),
    (tex) => {
      prepPlanetDiffuseTexture(tex, renderer);
      mat.map = tex;
      mat.needsUpdate = true;
    },
    undefined,
    () => {
      /* 貼圖載入失敗時保留白底材質 */
    },
  );
}

/** 程式化太陽光球貼圖（米粒／簡化黑子），無外部檔案依賴 */
function createSunPhotosphereTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.colorSpace = THREE.SRGBColorSpace;
    return fallback;
  }

  const cx = size * 0.5;
  const cy = size * 0.5;
  const grd = ctx.createRadialGradient(cx + size * 0.06, cy + size * 0.05, size * 0.04, cx, cy, size * 0.48);
  grd.addColorStop(0, "#fffcee");
  grd.addColorStop(0.28, "#ffeec8");
  grd.addColorStop(0.55, "#ffcc66");
  grd.addColorStop(1, "#e07028");
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const rng = (x: number, y: number, seed: number) => {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 43.758) * 43758.5453123;
    return n - Math.floor(n);
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const gran = (rng(x, y, 1) - 0.5) * 44;
      const granFine = (rng(x * 4, y * 4, 2) - 0.5) * 18;
      const sp = rng(x * 0.08, y * 0.08, 3);
      const sunspot = sp > 0.992 ? -62 : 0;

      d[i] = Math.min(255, Math.max(0, d[i]! + gran * 0.95 + granFine + sunspot));
      d[i + 1] = Math.min(255, Math.max(0, d[i + 1]! + gran * 0.72 + granFine * 0.85 + sunspot * 0.88));
      d[i + 2] = Math.min(255, Math.max(0, d[i + 2]! + gran * 0.38 + sunspot * 1.05));
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

/**
 * 地球薄大氣：view-space Fresnel 邊緣光 + 以模型空間經緯度與 uTime 驅動的漂移紋理（示意環流，非真實散射／預報）。
 */
function createEarthAtmosphereMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(0x62a8ff) },
      intensity: { value: 0.58 },
      rimPower: { value: 2.35 },
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormView;
      varying vec3 vPosView;
      varying vec3 vLocalDir;
      void main() {
        vLocalDir = normalize(position);
        vNormView = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vPosView = mv.xyz;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 glowColor;
      uniform float intensity;
      uniform float rimPower;
      uniform float uTime;
      varying vec3 vNormView;
      varying vec3 vPosView;
      varying vec3 vLocalDir;

      void main() {
        vec3 toEye = normalize(-vPosView);
        float ndotv = clamp(dot(vNormView, toEye), 0.0, 1.0);
        float rim = pow(1.0 - ndotv, rimPower);

        float lon = atan(vLocalDir.z, vLocalDir.x);
        float lat = asin(clamp(vLocalDir.y, -1.0, 1.0));

        float driftEW = lon * 5.5 - uTime * 0.72;
        float bandNS = sin(lat * 10.0 - uTime * 0.38) * 0.5 + 0.5;
        float cells = sin(driftEW + lat * 6.0) * cos(lat * 4.0 - driftEW * 0.65 + uTime * 0.5);
        cells += sin(driftEW * 1.7 + lat * 11.0 + uTime * 0.28) * 0.35;
        float flow = 0.58 + 0.42 * smoothstep(-0.25, 0.55, cells * 0.45 + bandNS * 0.35);

        vec3 rgb = glowColor * rim * intensity * flow;
        float a = rim * intensity * (0.78 + 0.22 * flow);
        gl_FragColor = vec4(rgb, a);
      }
    `,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    fog: false,
  });
}

function buildShip(hull: number, accent: number, scale: number): THREE.Group {
  const g = new THREE.Group();
  const hullM = bodyMat(hull, { roughness: 0.42, metalness: 0.48 });
  const accentM = bodyMat(accent, {
    roughness: 0.35,
    metalness: 0.52,
    emissive: accent,
    emissiveIntensity: 0.28,
  });
  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.036, 0.06), hullM);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.065, 8), hullM);
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(0.102, 0, 0);
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.006, 0.11), hullM);
  wingL.position.set(-0.02, 0, 0.068);
  const wingR = wingL.clone();
  wingR.position.z = -0.068;
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.028, 0.04), hullM);
  tail.position.set(-0.095, 0, 0);
  const port = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.01, 0.024), accentM);
  port.position.set(0.02, 0.02, 0);
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.014, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0x66ccff,
      emissive: 0x4488ff,
      emissiveIntensity: 1.05,
      roughness: 0.4,
      metalness: 0.2,
      transparent: true,
      opacity: 0.92,
    }),
  );
  glow.position.set(-0.11, 0, 0);
  g.add(fuselage, nose, wingL, wingR, tail, port, glow);
  g.scale.setScalar(scale);
  return g;
}

/** 決定性雜湊 → [0,1) */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function galacticBandBasis(galacticNorth: THREE.Vector3): { u: THREE.Vector3; v: THREE.Vector3; n: THREE.Vector3 } {
  const n = galacticNorth.clone().normalize();
  const aux = Math.abs(n.y) < 0.88 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().copy(aux).cross(n).normalize();
  const v = new THREE.Vector3().copy(n).cross(u).normalize();
  return { u, v, n };
}

/**
 * 類地球夜空：天球殼層粒子在組件本地座標為「自觀測者向外的方向×距離」；
 * 每幀將組件置於相機位置，使帶狀幾乎無視差（模擬極遠恆星）。
 * 盤向集中＋多條塵隙＋斑駁＋銀心方向較亮，仍為示意非天文還原。
 */
function buildMilkyWayBandShell(
  count: number,
  shellR: number,
  galacticNorth: THREE.Vector3,
  pointSprite: THREE.Texture,
): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const { u, v, n } = galacticBandBasis(galacticNorth);
  const sagT = 4.38;

  for (let i = 0; i < count; i++) {
    const h0 = hash01(i + 0.11);
    const h1 = hash01(i + 1.23);
    const h2 = hash01(i + 2.71);
    const h3 = hash01(i + 3.52);
    const h4 = hash01(i + 5.01);
    const ix = i * 3;

    if (h0 < 0.075) {
      const th = h1 * Math.PI * 2;
      const ph = Math.acos(2 * h2 - 1);
      const sinP = Math.sin(ph);
      const wx = sinP * Math.cos(th);
      const wy = Math.cos(ph);
      const wz = sinP * Math.sin(th);
      const rr = shellR * (0.92 + h3 * 0.12);
      positions[ix] = wx * rr;
      positions[ix + 1] = wy * rr;
      positions[ix + 2] = wz * rr;
      const dim = (0.12 + h1 * 0.22) * (0.55 + 0.45 * h4);
      colors[ix] = dim * 0.72;
      colors[ix + 1] = dim * 0.78;
      colors[ix + 2] = dim * 0.92;
    } else {
      const t = h1 * Math.PI * 2;
      const bandW = 0.11 + h4 * 0.14;
      const thick = (h2 - 0.5) * bandW;
      const cosT = Math.cos(t);
      const sinT = Math.sin(t);
      let dx = u.x * cosT + v.x * sinT + n.x * thick;
      let dy = u.y * cosT + v.y * sinT + n.y * thick;
      let dz = u.z * cosT + v.z * sinT + n.z * thick;
      const invLen = 1 / Math.hypot(dx, dy, dz);
      dx *= invLen;
      dy *= invLen;
      dz *= invLen;

      const d1 = Math.exp(-(Math.sin(t * 1.9 + 0.35) ** 2) * 7.2);
      const d2 = Math.exp(-(Math.sin(t * 3.15 + 1.9) ** 2) * 4.8);
      const d3 = Math.exp(-(Math.sin(t * 5.1 + 0.7) ** 2) * 3.2);
      let dustDim = 0.38 + 0.62 * (1 - d1 * 0.62) * (1 - d2 * 0.38) * (1 - d3 * 0.22);

      const wrap = Math.atan2(Math.sin(t - sagT), Math.cos(t - sagT));
      const towardCore = Math.exp(-(wrap * wrap) / 0.42);
      const warm = 1 + towardCore * 0.55;
      const coreBright = 1 + towardCore * 0.95 * (0.45 + 0.55 * Math.abs(Math.cos(t * 6.2 + h3 * 4)));

      const mottle =
        0.38 +
        0.62 *
          clamp01(
            0.35 + 0.28 * Math.sin(t * 5.5 + h2 * 11) + 0.22 * Math.sin(t * 2.1 + h4 * 7) + 0.35 * Math.abs(h3 - 0.5),
          );
      dustDim *= mottle;

      const patch = 0.45 + 0.55 * Math.abs(Math.cos(t * 3.4 + h2 * 2.4));
      let cr = (0.42 + 0.38 * patch) * dustDim * warm * coreBright;
      let cg = (0.4 + 0.34 * patch) * dustDim * warm * coreBright;
      let cb = (0.52 + 0.36 * patch) * dustDim * (0.92 + towardCore * 0.12);
      cr = clamp01(cr * 1.05);
      cg = clamp01(cg * 1.02);
      cb = clamp01(cb * 1.08);

      const rJ = shellR * (0.9 + h3 * 0.18);
      positions[ix] = dx * rJ;
      positions[ix + 1] = dy * rJ;
      positions[ix + 2] = dz * rJ;
      colors[ix] = cr;
      colors[ix + 1] = cg;
      colors[ix + 2] = cb;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    map: pointSprite,
    vertexColors: true,
    size: 0.038,
    transparent: true,
    opacity: 0.76,
    depthWrite: false,
    fog: false,
    sizeAttenuation: true,
    blending: THREE.NormalBlending,
  });
  return new THREE.Points(geo, mat);
}

/** 銀河帶內較亮團塊（類星團／雲氣聚區），疊在帶上增加長曝感 */
function buildMilkyWayKnots(
  count: number,
  shellR: number,
  galacticNorth: THREE.Vector3,
  pointSprite: THREE.Texture,
): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const { u, v, n } = galacticBandBasis(galacticNorth);
  const sagT = 4.38;

  for (let i = 0; i < count; i++) {
    const h1 = hash01(i + 1.9);
    const h2 = hash01(i + 2.7);
    const h3 = hash01(i + 4.1);
    const t = h1 * Math.PI * 2;
    const thick = (h2 - 0.5) * 0.07;
    let dx = u.x * Math.cos(t) + v.x * Math.sin(t) + n.x * thick;
    let dy = u.y * Math.cos(t) + v.y * Math.sin(t) + n.y * thick;
    let dz = u.z * Math.cos(t) + v.z * Math.sin(t) + n.z * thick;
    const invLen = 1 / Math.hypot(dx, dy, dz);
    dx *= invLen;
    dy *= invLen;
    dz *= invLen;

    const wrap = Math.atan2(Math.sin(t - sagT), Math.cos(t - sagT));
    const towardCore = Math.exp(-(wrap * wrap) / 0.55);
    if (towardCore < 0.18 && hash01(i + 6.2) > 0.35) {
      dx += (h3 - 0.5) * 0.04;
      dy += (hash01(i + 7) - 0.5) * 0.04;
      dz += (hash01(i + 8) - 0.5) * 0.04;
      const il = 1 / Math.hypot(dx, dy, dz);
      dx *= il;
      dy *= il;
      dz *= il;
    }

    const rJ = shellR * (0.91 + h3 * 0.14);
    const ix = i * 3;
    positions[ix] = dx * rJ;
    positions[ix + 1] = dy * rJ;
    positions[ix + 2] = dz * rJ;
    const b = 0.72 + towardCore * 0.28 + hash01(i + 0.3) * 0.12;
    colors[ix] = clamp01(b * (0.95 + towardCore * 0.05));
    colors[ix + 1] = clamp01(b * (0.82 + towardCore * 0.08));
    colors[ix + 2] = clamp01(b * (0.62 + towardCore * 0.15));
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    map: pointSprite,
    vertexColors: true,
    size: 0.062,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    fog: false,
    sizeAttenuation: true,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geo, mat);
}

/**
 * 預約主面板 three.js 分頁：擬真太陽系＋可拖曳／縮放視角、點星球簡介、程式化太空船與彗星；
 * 背景為類地球夜空：銀河帶天球殼隨相機平移（極遠視差）、盤內塵隙與斑駁示意（非完整天文模型）。
 */
export function mountBookTabThreeSpectacle(host: HTMLElement): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const div = document.createElement("div");
    div.className = "book-tab-three-static book-tab-three-static--solar";
    host.append(div);
    return () => {
      div.remove();
    };
  }

  host.classList.add("book-tab-three-mount--interactive");

  const hudHint =
    getLocale() === "en"
      ? "Use the top bar to fly the camera to each body, or Overview for the wide shot. Drag to orbit · wheel or pinch to zoom · tap a body for a short fact."
      : "頂部導覽列可將鏡頭飛往各天體，「總覽」回到遠景。拖曳環繞 · 滾輪或雙指縮放 · 點天體看簡介。";

  const hud = document.createElement("div");
  hud.className = "book-tab-three-hud";
  hud.hidden = true;
  hud.setAttribute("role", "region");
  hud.setAttribute("aria-label", getLocale() === "en" ? "Planet info" : "天體簡介");
  const hudTitle = document.createElement("strong");
  hudTitle.className = "book-tab-three-hud__title";
  const hudBlurb = document.createElement("p");
  hudBlurb.className = "book-tab-three-hud__blurb";
  const hudClose = document.createElement("button");
  hudClose.type = "button";
  hudClose.className = "book-tab-three-hud__close";
  hudClose.textContent = "×";
  hudClose.setAttribute("aria-label", getLocale() === "en" ? "Close" : "關閉");
  const hudHintEl = document.createElement("p");
  hudHintEl.className = "book-tab-three-hud__hint";
  hudHintEl.textContent = hudHint;
  hud.append(hudClose, hudTitle, hudBlurb, hudHintEl);
  host.append(hud);

  function showHud(id: BodyId) {
    const { title, blurb } = bodyLabel(id);
    hudTitle.textContent = title;
    hudBlurb.textContent = blurb;
    hud.hidden = false;
  }
  function hideHud() {
    hud.hidden = true;
  }
  hudClose.addEventListener("click", (e) => {
    e.stopPropagation();
    hideHud();
  });

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(DPR_CAP, window.devicePixelRatio || 1));
  renderer.setClearColor(0x020511, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.verticalAlign = "top";
  canvas.style.cursor = "grab";
  canvas.style.touchAction = "none";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(0x050810, 0.038);
  scene.fog = fog;

  /** near 過大時，飛近小天體（月球）相機距離可能 ≤ near+半徑，前向表面會被裁切成「中央穿洞」 */
  const camera = new THREE.PerspectiveCamera(46, 1, 0.015, 90);
  const target = new THREE.Vector3(0.08, -0.06, 0);
  /** 軌道球心：預設為太陽系中心，飛行導覽時會移向各天體 */
  const lookAtPoint = new THREE.Vector3().copy(target);

  const starPointSprite = createSoftStarPointSpriteTexture(80);

  const milkyWayShell = new THREE.Group();
  const MW_SHELL_R = 118;
  const galacticNorth = new THREE.Vector3(0.22, 0.89, 0.35).normalize();
  milkyWayShell.add(
    buildMilkyWayBandShell(3800, MW_SHELL_R, galacticNorth, starPointSprite),
    buildMilkyWayKnots(420, MW_SHELL_R, galacticNorth, starPointSprite),
  );
  scene.add(milkyWayShell);

  const root = new THREE.Group();
  root.position.copy(target);
  root.rotation.x = 0.38;
  root.rotation.z = 0.1;
  scene.add(root);

  scene.add(new THREE.AmbientLight(0x223344, 0.22));

  const starCount = 720;
  const starBase = new Float32Array(starCount * 3);
  const starPos = new Float32Array(starCount * 3);
  const starSeed = new Float32Array(starCount * 3);
  fillStarField(starBase, starSeed, starCount, 4.2, 14);
  starPos.set(starBase);
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starColors = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const ix = i * 3;
    const h = hash01(i * 31 + starSeed[ix]! * 0.001);
    const h2 = hash01(i * 17 + starSeed[ix + 1]! * 0.001);
    const h3 = hash01(i * 23 + starSeed[ix + 2]! * 0.001);
    const bright = 0.38 + h2 * 0.62;
    const warm = h3 * 0.22;
    starColors[ix] = (0.88 + warm * 0.35) * bright;
    starColors[ix + 1] = (0.9 + warm * 0.18) * bright;
    starColors[ix + 2] = (1 - h * 0.22) * bright;
  }
  starGeo.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
  const starMat = new THREE.PointsMaterial({
    map: starPointSprite,
    vertexColors: true,
    color: 0xe8f0ff,
    size: 0.038,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    fog: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true,
  });
  const stars = new THREE.Points(starGeo, starMat);
  root.add(stars);

  const sunLight = new THREE.PointLight(0xfff2dd, 7.5, 0, 2);
  sunLight.position.set(0, 0, 0);
  root.add(sunLight);

  const sunTex = createSunPhotosphereTexture(renderer);
  const sunMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: sunTex,
    emissiveMap: sunTex,
    emissive: 0xffeed0,
    emissiveIntensity: 0.62,
    roughness: 0.62,
    metalness: 0,
  });
  const sunCore = new THREE.Mesh(new THREE.SphereGeometry(0.22, 36, 36), sunMat);
  tagPickable(sunCore, "sun");

  const sunCoronaLayers: THREE.Mesh[] = [];
  function addSunCorona(radius: number, segments: number, color: number, opacity: number) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius, segments, segments),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    tagPickable(m, "sun");
    sunCoronaLayers.push(m);
  }
  addSunCorona(0.92, 18, 0xff5522, 0.016);
  addSunCorona(0.74, 20, 0xff7733, 0.024);
  addSunCorona(0.58, 22, 0xff9944, 0.034);
  addSunCorona(0.48, 24, 0xffaa66, 0.048);

  root.add(...sunCoronaLayers, sunCore);

  const beltInnerCount = 380;
  const beltOuterCount = 480;
  const beltInnerBase = new Float32Array(beltInnerCount * 3);
  const beltInnerPos = new Float32Array(beltInnerCount * 3);
  const beltInnerSeed = new Float32Array(beltInnerCount * 3);
  fillAsteroidBelt(beltInnerBase, beltInnerSeed, beltInnerCount, 0.72, 0.92, 0.042);
  beltInnerPos.set(beltInnerBase);
  const beltInnerGeo = new THREE.BufferGeometry();
  beltInnerGeo.setAttribute("position", new THREE.BufferAttribute(beltInnerPos, 3));
  const beltInnerMat = new THREE.PointsMaterial({
    map: starPointSprite,
    color: 0x9a8a78,
    size: 0.018,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    fog: false,
    sizeAttenuation: true,
  });
  root.add(new THREE.Points(beltInnerGeo, beltInnerMat));

  const beltOuterBase = new Float32Array(beltOuterCount * 3);
  const beltOuterPos = new Float32Array(beltOuterCount * 3);
  const beltOuterSeed = new Float32Array(beltOuterCount * 3);
  fillAsteroidBelt(beltOuterBase, beltOuterSeed, beltOuterCount, 1.02, 1.32, 0.05);
  beltOuterPos.set(beltOuterBase);
  const beltOuterGeo = new THREE.BufferGeometry();
  beltOuterGeo.setAttribute("position", new THREE.BufferAttribute(beltOuterPos, 3));
  const beltOuterMat = new THREE.PointsMaterial({
    map: starPointSprite,
    color: 0x8a9098,
    size: 0.016,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    fog: false,
    sizeAttenuation: true,
  });
  root.add(new THREE.Points(beltOuterGeo, beltOuterMat));

  type OrbitBody = { pivot: THREE.Group; speed: number; phase: number; mesh: THREE.Mesh; spin: number };
  const orbitals: OrbitBody[] = [];
  let earthMoonOrbit: { moonPivot: THREE.Group; mesh: THREE.Mesh; speed: number; spin: number } | null = null;

  type PlanetDef = {
    id: BodyId;
    r: number;
    speed: number;
    size: number;
    color: number;
    phase: number;
    roughness?: number;
    metalness?: number;
    rings?: boolean;
    mega?: boolean;
    spin?: number;
  };

  const SOLAR_BODY_IDS: BodyId[] = [
    "mercury",
    "venus",
    "earth",
    "mars",
    "jupiter",
    "saturn",
    "uranus",
    "neptune",
  ];
  const planetDefs: PlanetDef[] = SHARED_SOLAR_PLANET_DEFS.map((row, i) => ({
    id: SOLAR_BODY_IDS[i]!,
    ...row,
  }));

  const orbitSegs = 128;
  for (const def of planetDefs) {
    const orbitPts: THREE.Vector3[] = [];
    for (let i = 0; i <= orbitSegs; i++) {
      const a = (i / orbitSegs) * Math.PI * 2;
      orbitPts.push(new THREE.Vector3(Math.cos(a) * def.r, 0, Math.sin(a) * def.r));
    }
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts);
    const orbitLine = new THREE.Line(
      orbitGeo,
      new THREE.LineBasicMaterial({
        color: 0x3a5068,
        transparent: true,
        opacity: 0.2,
      }),
    );
    root.add(orbitLine);
  }

  const pickables: THREE.Object3D[] = [...sunCoronaLayers, sunCore];

  let earthAtmosphereTimeUniform: { value: number } | null = null;

  for (let i = 0; i < planetDefs.length; i++) {
    const def = planetDefs[i]!;
    const pivot = new THREE.Group();
    const arm = new THREE.Group();
    arm.position.set(def.r, 0, 0);
    pivot.add(arm);
    arm.rotation.z = ((i % 4) - 1.5) * 0.055;

    let body: THREE.Mesh;
    const surfaceFile = SOLAR_PLANET_SURFACE_FILES[def.id];
    if (surfaceFile) {
      const roughness = def.roughness ?? 0.82;
      const metalness = def.metalness ?? 0.05;
      const surfMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness,
        metalness,
      });
      const segs = def.mega || def.rings ? 40 : 48;
      body = new THREE.Mesh(new THREE.SphereGeometry(def.size, segs, segs), surfMat);
      tagPickable(body, def.id);
      loadSolarPlanetSurface(surfMat, surfaceFile, renderer);
      if (def.rings) {
        const innerR = def.size * 1.38;
        const ringA = new THREE.Mesh(
          new THREE.RingGeometry(innerR, def.size * 2.15, 64),
          new THREE.MeshStandardMaterial({
            color: 0xc4b69a,
            transparent: true,
            opacity: 0.6,
            side: THREE.DoubleSide,
            roughness: 0.98,
            metalness: 0,
            depthWrite: false,
          }),
        );
        ringA.rotation.x = Math.PI / 2.08;
        const ringB = new THREE.Mesh(
          new THREE.RingGeometry(def.size * 2.22, def.size * 2.62, 64),
          new THREE.MeshStandardMaterial({
            color: 0xa8b8c8,
            transparent: true,
            opacity: 0.36,
            side: THREE.DoubleSide,
            roughness: 0.98,
            metalness: 0,
            depthWrite: false,
          }),
        );
        ringB.rotation.x = Math.PI / 2.12;
        ringB.rotation.z = 0.08;
        arm.add(body, ringA, ringB);
      } else {
        arm.add(body);
        if (def.id === "earth") {
          const atmRadius = def.size * 1.052;
          const atmMat = createEarthAtmosphereMaterial();
          earthAtmosphereTimeUniform = atmMat.uniforms.uTime as { value: number };
          const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(atmRadius, segs, segs), atmMat);
          atmosphere.renderOrder = 1;
          body.add(atmosphere);

          const moonPivot = new THREE.Group();
          const moonR = def.size * 0.272;
          const moonMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.94,
            metalness: 0.02,
          });
          const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(moonR, 28, 28), moonMat);
          tagPickable(moonMesh, "moon");
          loadSolarPlanetSurface(moonMat, "moon_1024.jpg", renderer);
          moonMesh.position.set(def.size * 2.42, def.size * 0.1, 0);
          moonPivot.add(moonMesh);
          arm.add(moonPivot);
          pickables.push(moonMesh);
          earthMoonOrbit = { moonPivot, mesh: moonMesh, speed: 4.6, spin: 1.55 };
        }
      }
    } else {
      body = new THREE.Mesh(
        new THREE.SphereGeometry(def.size, 16, 16),
        bodyMat(def.color, { roughness: def.roughness ?? 0.9, metalness: def.metalness ?? 0.02 }),
      );
      tagPickable(body, def.id);
      arm.add(body);
    }

    pickables.push(body);
    root.add(pivot);
    orbitals.push({
      pivot,
      speed: def.speed * 1.08,
      phase: def.phase,
      mesh: body,
      spin: def.spin ?? 2,
    });
  }

  const dwarfMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0,
  });
  const dwarf = new THREE.Mesh(new THREE.SphereGeometry(0.024, 28, 28), dwarfMat);
  tagPickable(dwarf, "pluto");
  const plutoFile = SOLAR_PLANET_SURFACE_FILES.pluto;
  if (plutoFile) loadSolarPlanetSurface(dwarfMat, plutoFile, renderer);
  pickables.push(dwarf);
  const dwarfPivot = new THREE.Group();
  dwarfPivot.add(dwarf);
  dwarf.position.set(0.18, 0, 0);
  root.add(dwarfPivot);
  orbitals.push({ pivot: dwarfPivot, speed: 3.25, phase: 2.8, mesh: dwarf, spin: 2.2 });

  const extrasRoot = new THREE.Group();
  root.add(extrasRoot);

  const shipA = buildShip(0x6a7588, 0x8899aa, 1);
  const shipB = buildShip(0x7a6048, 0xc9a070, 0.88);
  const shipC = buildShip(0x556070, 0x7090a8, 1.02);
  extrasRoot.add(shipA, shipB, shipC);

  const comet = new THREE.Group();
  const cometHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.038, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xd8ecff,
      emissive: 0xaaddff,
      emissiveIntensity: 0.5,
      roughness: 0.35,
      metalness: 0.08,
    }),
  );
  comet.add(cometHead);
  const trailLen = 56;
  const trailPos = new Float32Array(trailLen * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  const trailMat = new THREE.PointsMaterial({
    map: starPointSprite,
    color: 0xb8dcff,
    size: 0.03,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const cometTrail = new THREE.Points(trailGeo, trailMat);
  extrasRoot.add(comet, cometTrail);
  const trailHist: THREE.Vector3[] = [];

  const disposables = [
    ...collectDisposables(milkyWayShell),
    ...collectDisposables(root),
    { dispose: () => starPointSprite.dispose() },
    { dispose: () => sunTex.dispose() },
  ];

  const meshByBody = new Map<BodyId, THREE.Object3D>();
  for (const obj of pickables) {
    const bid = (obj as THREE.Mesh).userData.bodyId as BodyId | undefined;
    if (bid) meshByBody.set(bid, obj);
  }

  type FlyTarget = null | "overview" | BodyId;
  let flyTarget: FlyTarget = null;
  const flyDest = new THREE.Vector3();

  const tourBar = document.createElement("div");
  tourBar.className = "book-tab-three-tour";
  tourBar.setAttribute("role", "toolbar");
  tourBar.setAttribute(
    "aria-label",
    getLocale() === "en" ? "Fly camera to a celestial body" : "鏡頭前往天體",
  );
  const tourBtns = new Map<string, HTMLButtonElement>();

  function syncTourAriaPressed() {
    for (const [key, btn] of tourBtns) {
      const on =
        (key === "overview" && flyTarget === "overview") ||
        (key !== "overview" && flyTarget === key);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  const overviewBtn = document.createElement("button");
  overviewBtn.type = "button";
  overviewBtn.className = "book-tab-three-tour__btn book-tab-three-tour__btn--overview";
  overviewBtn.textContent = getLocale() === "en" ? "Overview" : "總覽";
  overviewBtn.dataset.tour = "overview";
  overviewBtn.setAttribute("aria-pressed", "false");
  overviewBtn.title =
    getLocale() === "en" ? "Return to the default wide view of the solar system" : "回到預設遠眺太陽系";
  overviewBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    flyTarget = "overview";
    hideHud();
    syncTourAriaPressed();
  });
  tourBtns.set("overview", overviewBtn);
  tourBar.appendChild(overviewBtn);

  for (const id of TOUR_BODY_ORDER) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "book-tab-three-tour__btn";
    b.textContent = bodyLabel(id).title;
    b.dataset.tour = id;
    b.setAttribute("aria-pressed", "false");
    b.title =
      getLocale() === "en"
        ? `Fly near ${bodyLabel(id).title} (camera tracks the body)`
        : `鏡頭飛近${bodyLabel(id).title}（會跟著天體移動）`;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      flyTarget = id;
      showHud(id);
      syncTourAriaPressed();
    });
    tourBtns.set(id, b);
    tourBar.appendChild(b);
  }
  host.appendChild(tourBar);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const toCam = new THREE.Vector3().subVectors(new THREE.Vector3(0.85, 1.05, 6.2), target);
  let camRadius = Math.max(2.8, Math.min(22, toCam.length()));
  let camPhi = Math.acos(Math.max(-1, Math.min(1, toCam.y / camRadius)));
  let camTheta = Math.atan2(toCam.x, toCam.z);

  function updateCameraFromOrbit() {
    const sinP = Math.sin(camPhi);
    camera.position.x = lookAtPoint.x + camRadius * sinP * Math.sin(camTheta);
    camera.position.y = lookAtPoint.y + camRadius * Math.cos(camPhi);
    camera.position.z = lookAtPoint.z + camRadius * sinP * Math.cos(camTheta);
    camera.lookAt(lookAtPoint);
  }
  updateCameraFromOrbit();
  milkyWayShell.position.copy(camera.position);
  const defaultCamRadius = THREE.MathUtils.clamp(camRadius, 2.6, 24);
  const defaultCamTheta = camTheta;
  const defaultCamPhi = camPhi;

  let dragging = false;
  let lastPx = 0;
  let lastPy = 0;
  let downPx = 0;
  let downPy = 0;
  let pinchStartDist = 0;
  let pinchStartRadius = camRadius;
  const pointers = new Map<number, { x: number; y: number }>();
  let idleOrbitAcc = 0;
  let gestureHadMulti = false;

  function pointerDist(): number {
    const pts = [...pointers.values()];
    if (pts.length < 2) return 0;
    const dx = pts[0]!.x - pts[1]!.x;
    const dy = pts[0]!.y - pts[1]!.y;
    return Math.hypot(dx, dy);
  }

  function onPointerDown(ev: PointerEvent) {
    if (ev.button !== undefined && ev.button > 1) return;
    flyTarget = null;
    syncTourAriaPressed();
    idleOrbitAcc = 0;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size >= 2) gestureHadMulti = true;
    if (pointers.size === 1) {
      dragging = true;
      lastPx = ev.clientX;
      lastPy = ev.clientY;
      downPx = ev.clientX;
      downPy = ev.clientY;
      canvas.setPointerCapture(ev.pointerId);
      canvas.style.cursor = "grabbing";
    } else if (pointers.size === 2) {
      pinchStartDist = pointerDist();
      pinchStartRadius = camRadius;
      dragging = false;
      canvas.style.cursor = "grabbing";
    }
  }

  function onPointerMove(ev: PointerEvent) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2 && pinchStartDist > 8) {
      const d = pointerDist();
      if (d > 2) {
        // 與地圖／相簿一致：雙指張開＝拉近（半徑變小）、捏合＝拉遠
        camRadius = Math.max(2.6, Math.min(24, pinchStartRadius * (pinchStartDist / d)));
        flyTarget = null;
        syncTourAriaPressed();
        idleOrbitAcc = 0;
        updateCameraFromOrbit();
      }
      return;
    }
    if (!dragging || pointers.size > 1) return;
    const dx = ev.clientX - lastPx;
    const dy = ev.clientY - lastPy;
    lastPx = ev.clientX;
    lastPy = ev.clientY;
    camTheta -= dx * 0.0055;
    camPhi -= dy * 0.0045;
    camPhi = Math.max(0.14, Math.min(Math.PI - 0.14, camPhi));
    idleOrbitAcc = 0;
    updateCameraFromOrbit();
  }

  function tryPick(clientX: number, clientY: number) {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    ndc.x = ((clientX - rect.left) / w) * 2 - 1;
    ndc.y = -((clientY - rect.top) / h) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    for (const h of hits) {
      const id = (h.object as THREE.Mesh).userData.bodyId as BodyId | undefined;
      if (id && Object.prototype.hasOwnProperty.call(BODY_LABELS, id)) {
        showHud(id);
        return;
      }
    }
  }

  function onPointerUp(ev: PointerEvent) {
    const had = pointers.has(ev.pointerId);
    const startX = downPx;
    const startY = downPy;
    pointers.delete(ev.pointerId);
    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    if (pointers.size === 0) {
      canvas.style.cursor = "grab";
      dragging = false;
      if (had && !gestureHadMulti && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 10) {
        tryPick(ev.clientX, ev.clientY);
      }
      gestureHadMulti = false;
    } else if (pointers.size === 1) {
      pinchStartDist = 0;
      const p = [...pointers.entries()][0]!;
      lastPx = p[1].x;
      lastPy = p[1].y;
      downPx = p[1].x;
      downPy = p[1].y;
      dragging = true;
    }
  }

  function onWheel(ev: WheelEvent) {
    ev.preventDefault();
    const k = Math.exp(-ev.deltaY * 0.0011);
    camRadius = Math.max(2.6, Math.min(24, camRadius * k));
    flyTarget = null;
    syncTourAriaPressed();
    idleOrbitAcc = 0;
    updateCameraFromOrbit();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  host.addEventListener("wheel", onWheel, { passive: false });

  const clock = new THREE.Clock();
  let raf = 0;
  let visible = false;

  function setSize() {
    const w = Math.max(1, Math.floor(host.clientWidth));
    const h = Math.max(1, Math.floor(host.clientHeight));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  const ro = new ResizeObserver(() => setSize());
  ro.observe(host);
  setSize();

  const io = new IntersectionObserver(
    (entries) => {
      const e = entries[0];
      visible = !!(e && e.isIntersecting && e.intersectionRatio > 0);
    },
    { root: null, threshold: [0, 0.01, 0.1] },
  );
  io.observe(host);

  const twinkle = (base: Float32Array, arr: Float32Array, seeds: Float32Array, count: number, t: number, amp: number) => {
    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      const sx = seeds[ix]!;
      const sy = seeds[ix + 1]!;
      const sz = seeds[ix + 2]!;
      arr[ix] = base[ix]! + Math.sin(t * 0.26 + sx * 0.007) * amp;
      arr[ix + 1] = base[ix + 1]! + Math.cos(t * 0.22 + sy * 0.007) * amp * 0.72;
      arr[ix + 2] = base[ix + 2]! + Math.sin(t * 0.19 + sz * 0.007) * amp;
    }
  };

  const twinkleBelt = (
    base: Float32Array,
    arr: Float32Array,
    seeds: Float32Array,
    count: number,
    t: number,
    amp: number,
  ) => {
    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      const sx = seeds[ix]!;
      const sy = seeds[ix + 1]!;
      const sz = seeds[ix + 2]!;
      arr[ix] = base[ix]! + Math.sin(t * 0.48 + sx * 0.01) * amp;
      arr[ix + 1] = base[ix + 1]! + Math.sin(t * 0.42 + sy * 0.01) * amp * 0.5;
      arr[ix + 2] = base[ix + 2]! + Math.cos(t * 0.46 + sz * 0.01) * amp;
    }
  };

  function placeShip(ship: THREE.Group, t: number, phase: number, lane: number) {
    const u = (t * 0.19 + phase) % 5.4;
    const f = (u / 5.4) * 2 - 1;
    const x = 2.35 * Math.cos(f * Math.PI * 0.48 + lane * 0.85);
    const y = 0.28 * Math.sin(t * 0.44 + phase * 2) + lane * 0.09;
    const z = 1.55 * Math.sin(f * Math.PI * 0.48 + lane * 0.52);
    ship.position.set(x, y, z);
    ship.lookAt(x + 0.45, y * 0.85, z + 0.2);
  }

  function tick() {
    raf = requestAnimationFrame(tick);
    if (!visible) return;

    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.getElapsedTime() * SPECTACLE_TIME_SCALE;

    if (earthAtmosphereTimeUniform) {
      earthAtmosphereTimeUniform.value = t;
    }

    for (const o of orbitals) {
      o.pivot.rotation.y = t * o.speed + o.phase;
      o.mesh.rotation.y = t * o.spin;
    }
    if (earthMoonOrbit) {
      earthMoonOrbit.moonPivot.rotation.y = t * earthMoonOrbit.speed;
      earthMoonOrbit.mesh.rotation.y = t * earthMoonOrbit.spin;
    }

    root.rotation.y = t * 0.004 + 0.28;
    milkyWayShell.position.copy(camera.position);

    if (flyTarget) {
      if (flyTarget === "overview") {
        flyDest.copy(target);
        lookAtPoint.lerp(flyDest, 0.085);
        camRadius = THREE.MathUtils.lerp(camRadius, defaultCamRadius, 0.075);
        camTheta = THREE.MathUtils.lerp(camTheta, defaultCamTheta, 0.06);
        camPhi = THREE.MathUtils.lerp(camPhi, defaultCamPhi, 0.06);
        if (
          lookAtPoint.distanceToSquared(flyDest) < 6e-5 &&
          Math.abs(camRadius - defaultCamRadius) < 0.18 &&
          Math.abs(camTheta - defaultCamTheta) < 0.05 &&
          Math.abs(camPhi - defaultCamPhi) < 0.05
        ) {
          flyTarget = null;
          lookAtPoint.copy(target);
          camRadius = defaultCamRadius;
          camTheta = defaultCamTheta;
          camPhi = defaultCamPhi;
          syncTourAriaPressed();
        }
      } else {
        const m = meshByBody.get(flyTarget);
        if (m) {
          m.getWorldPosition(flyDest);
          lookAtPoint.lerp(flyDest, 0.32);
          camRadius = THREE.MathUtils.lerp(camRadius, visitRadiusFor(flyTarget), 0.14);
        }
      }
      syncTourAriaPressed();
      updateCameraFromOrbit();
    }

    if (pointers.size === 0 && !dragging && !flyTarget) {
      idleOrbitAcc += dt;
      if (idleOrbitAcc > 1.4) {
        camTheta += dt * 0.055 * SPECTACLE_TIME_SCALE;
        updateCameraFromOrbit();
      }
    }

    placeShip(shipA, t, 0.2, 0);
    placeShip(shipB, t, 2.0, 0.32);
    placeShip(shipC, t, 4.2, -0.26);

    const ct = t % 28;
    const ang = ct * 0.58 + 0.4;
    const rr = 2.35 - ct * 0.055;
    const cx = rr * Math.cos(ang);
    const cy = 0.22 + 0.14 * Math.sin(ct * 0.72);
    const cz = rr * Math.sin(ang);
    comet.position.set(cx, cy, cz);
    trailHist.unshift(new THREE.Vector3(cx, cy, cz));
    if (trailHist.length > trailLen) trailHist.length = trailLen;
    const hi = Math.max(0, trailHist.length - 1);
    const tailRef = trailHist[hi]!;
    for (let i = 0; i < trailLen; i++) {
      const p = trailHist[Math.min(i, hi)] ?? tailRef;
      const ix = i * 3;
      trailPos[ix] = p.x;
      trailPos[ix + 1] = p.y;
      trailPos[ix + 2] = p.z;
    }
    (trailGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

    sunCore.rotation.y = t * 0.095;
    const corePulse = 1 + Math.sin(t * 0.85) * 0.035;
    sunCore.scale.setScalar(corePulse);
    const coronaPulse = 1 + Math.sin(t * 0.48) * 0.055;
    sunCoronaLayers.forEach((mesh, j) => {
      mesh.scale.setScalar(coronaPulse * (1 + j * 0.009));
    });

    twinkle(starBase, starPos, starSeed, starCount, t, 0.032);
    (starGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    twinkleBelt(beltInnerBase, beltInnerPos, beltInnerSeed, beltInnerCount, t, 0.012);
    (beltInnerGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    twinkleBelt(beltOuterBase, beltOuterPos, beltOuterSeed, beltOuterCount, t, 0.014);
    (beltOuterGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    host.removeEventListener("wheel", onWheel);
    for (const d of disposables) {
      d.dispose();
    }
    renderer.dispose();
    canvas.remove();
    tourBar.remove();
    hud.remove();
    host.classList.remove("book-tab-three-mount--interactive");
  };
}
