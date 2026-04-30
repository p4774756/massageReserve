import * as THREE from "three";
import { getLocale } from "./i18n";

const DPR_CAP = 2;

type BodyId =
  | "sun"
  | "mercury"
  | "venus"
  | "earth"
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
    zh: { title: "太陽", blurb: "太陽系中心恆星，提供光與熱；畫面為示意比例。" },
    en: { title: "Sun", blurb: "The star at the center of the Solar System—sizes here are illustrative." },
  },
  mercury: {
    zh: { title: "水星", blurb: "距太陽最近、無大氣的小型岩質行星。" },
    en: { title: "Mercury", blurb: "Smallest major planet, no real atmosphere, closest to the Sun." },
  },
  venus: {
    zh: { title: "金星", blurb: "厚雲與高溫高壓，太陽系最熱的行星表面之一。" },
    en: { title: "Venus", blurb: "Thick clouds and a crushing, scorching surface." },
  },
  earth: {
    zh: { title: "地球", blurb: "已知唯一有穩定液態水與生命的行星。" },
    en: { title: "Earth", blurb: "The only world we know with stable liquid water and life." },
  },
  mars: {
    zh: { title: "火星", blurb: "氧化鐵呈紅色；有稀薄大氣與季節性極冠。" },
    en: { title: "Mars", blurb: "The “Red Planet,” thin air and seasonal polar caps." },
  },
  jupiter: {
    zh: { title: "木星", blurb: "氣態巨行星，質量為其他行星總和的好幾倍。" },
    en: { title: "Jupiter", blurb: "A gas giant heavier than all other planets combined." },
  },
  saturn: {
    zh: { title: "土星", blurb: "以壯觀的冰／岩石環系著稱的氣態巨行星。" },
    en: { title: "Saturn", blurb: "A gas giant famous for its spectacular ring system." },
  },
  uranus: {
    zh: { title: "天王星", blurb: "冰巨行星，自轉軸極度傾斜。" },
    en: { title: "Uranus", blurb: "An ice giant with an extreme axial tilt." },
  },
  neptune: {
    zh: { title: "海王星", blurb: "太陽系已知最遠的主要行星，深藍色冰巨行星。" },
    en: { title: "Neptune", blurb: "The farthest major planet—deep blue ice giant." },
  },
  pluto: {
    zh: { title: "冥王星", blurb: "矮行星，位於古柏帶；軌道較橢且與海王星共振。" },
    en: { title: "Pluto", blurb: "A Kuiper Belt dwarf planet with an eccentric orbit." },
  },
};

function bodyLabel(id: BodyId): { title: string; blurb: string } {
  const row = BODY_LABELS[id];
  return getLocale() === "en" ? row.en : row.zh;
}

function fillStarField(base: Float32Array, seeds: Float32Array, count: number, rMin: number, rMax: number) {
  for (let i = 0; i < count; i++) {
    const ix = i * 3;
    seeds[ix] = Math.random() * 1000;
    seeds[ix + 1] = Math.random() * 1000;
    seeds[ix + 2] = Math.random() * 1000;
    const u = Math.random();
    const v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const r = rMin + Math.random() * (rMax - rMin);
    const sinP = Math.sin(phi);
    base[ix] = r * sinP * Math.cos(theta);
    base[ix + 1] = r * Math.cos(phi);
    base[ix + 2] = r * sinP * Math.sin(theta);
  }
}

function fillAsteroidBelt(
  base: Float32Array,
  seeds: Float32Array,
  count: number,
  rMin: number,
  rMax: number,
  ySpread: number,
) {
  for (let i = 0; i < count; i++) {
    const ix = i * 3;
    seeds[ix] = Math.random() * 1000;
    seeds[ix + 1] = Math.random() * 1000;
    seeds[ix + 2] = Math.random() * 1000;
    const theta = Math.random() * Math.PI * 2;
    const r = rMin + Math.random() * (rMax - rMin);
    base[ix] = r * Math.cos(theta);
    base[ix + 1] = (Math.random() - 0.5) * 2 * ySpread;
    base[ix + 2] = r * Math.sin(theta);
  }
}

function bodyMat(
  color: number,
  opts?: { roughness?: number; metalness?: number; emissive?: number; emissiveIntensity?: number },
) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts?.roughness ?? 0.9,
    metalness: opts?.metalness ?? 0.04,
    emissive: opts?.emissive ?? 0x000000,
    emissiveIntensity: opts?.emissiveIntensity ?? 0,
  });
}

function collectDisposables(root: THREE.Object3D): { dispose(): void }[] {
  const out: { dispose(): void }[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Points || obj instanceof THREE.Line) {
      out.push(obj.geometry);
      const mat = obj.material;
      if (Array.isArray(mat)) {
        for (const m of mat) {
          if (m) out.push(m as THREE.Material);
        }
      } else if (mat) {
        out.push(mat as THREE.Material);
      }
    }
  });
  return out;
}

function tagPickable(mesh: THREE.Mesh, id: BodyId) {
  mesh.userData.bodyId = id;
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

/**
 * 預約主面板 three.js 分頁：擬真太陽系＋可拖曳／縮放視角、點星球簡介、程式化太空船與彗星。
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
      ? "Drag to rotate · wheel or two-finger pinch to zoom · tap a body for a short fact"
      : "拖曳旋轉視角 · 滾輪或雙指縮放 · 點太陽或行星看簡介";

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
  renderer.setClearColor(0x03060c, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
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

  const camera = new THREE.PerspectiveCamera(46, 1, 0.06, 90);
  const target = new THREE.Vector3(0.08, -0.06, 0);

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
  const starMat = new THREE.PointsMaterial({
    color: 0xd0e0f4,
    size: 0.034,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true,
  });
  const stars = new THREE.Points(starGeo, starMat);
  root.add(stars);

  const sunLight = new THREE.PointLight(0xfff2dd, 14, 0, 2);
  sunLight.position.set(0, 0, 0);
  root.add(sunLight);

  const sunCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 28, 28),
    new THREE.MeshStandardMaterial({
      color: 0xfff8e8,
      emissive: 0xffeecc,
      emissiveIntensity: 1.28,
      roughness: 0.55,
      metalness: 0,
    }),
  );
  tagPickable(sunCore, "sun");
  const corona = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 20, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffaa66,
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  tagPickable(corona, "sun");
  root.add(corona, sunCore);

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
    color: 0x9a8a78,
    size: 0.016,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
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
    color: 0x8a9098,
    size: 0.014,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    sizeAttenuation: true,
  });
  root.add(new THREE.Points(beltOuterGeo, beltOuterMat));

  type OrbitBody = { pivot: THREE.Group; speed: number; phase: number; mesh: THREE.Mesh; spin: number };
  const orbitals: OrbitBody[] = [];

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

  const planetDefs: PlanetDef[] = [
    { id: "mercury", r: 0.28, speed: 2.05, size: 0.034, color: 0x8c7853, phase: 0.2, roughness: 0.95, spin: 2.8 },
    { id: "venus", r: 0.4, speed: 1.45, size: 0.046, color: 0xc9b87a, phase: 1.1, roughness: 0.82, spin: -1.2 },
    { id: "earth", r: 0.54, speed: 1.12, size: 0.048, color: 0x5a7d9a, phase: 2.3, roughness: 0.75, metalness: 0.12, spin: 3.5 },
    { id: "mars", r: 0.7, speed: 0.82, size: 0.04, color: 0xb85c3c, phase: 0.6, roughness: 0.92, spin: 2.1 },
    { id: "jupiter", r: 0.9, speed: 0.62, size: 0.11, color: 0xc9a068, phase: 3.2, mega: true, roughness: 0.88, spin: 4.2 },
    { id: "saturn", r: 1.14, speed: 0.48, size: 0.092, color: 0xd4c4a8, phase: 4.4, rings: true, roughness: 0.9, spin: 3.1 },
    { id: "uranus", r: 1.4, speed: 0.34, size: 0.072, color: 0x7eb8c4, phase: 1.7, roughness: 0.55, metalness: 0.18, spin: 2.4 },
    { id: "neptune", r: 1.68, speed: 0.26, size: 0.064, color: 0x3d5a9e, phase: 5.0, roughness: 0.48, metalness: 0.22, spin: 2.6 },
  ];

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

  const pickables: THREE.Object3D[] = [sunCore, corona];

  for (let i = 0; i < planetDefs.length; i++) {
    const def = planetDefs[i]!;
    const pivot = new THREE.Group();
    const arm = new THREE.Group();
    arm.position.set(def.r, 0, 0);
    pivot.add(arm);
    arm.rotation.z = ((i % 4) - 1.5) * 0.055;

    let body: THREE.Mesh;
    if (def.mega) {
      body = new THREE.Mesh(
        new THREE.SphereGeometry(def.size, 22, 22),
        bodyMat(def.color, { roughness: def.roughness ?? 0.88, metalness: def.metalness ?? 0.02 }),
      );
      tagPickable(body, def.id);
      arm.add(body);
    } else if (def.rings) {
      body = new THREE.Mesh(
        new THREE.SphereGeometry(def.size, 20, 20),
        bodyMat(def.color, { roughness: def.roughness ?? 0.9, metalness: def.metalness ?? 0.02 }),
      );
      tagPickable(body, def.id);
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

  const dwarf = new THREE.Mesh(
    new THREE.SphereGeometry(0.024, 10, 10),
    bodyMat(0x6a5a52, { roughness: 1, metalness: 0 }),
  );
  tagPickable(dwarf, "pluto");
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
    color: 0xb8dcff,
    size: 0.026,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const cometTrail = new THREE.Points(trailGeo, trailMat);
  extrasRoot.add(comet, cometTrail);
  const trailHist: THREE.Vector3[] = [];

  const disposables = collectDisposables(root);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const toCam = new THREE.Vector3().subVectors(new THREE.Vector3(0.85, 1.05, 6.2), target);
  let camRadius = Math.max(2.8, Math.min(22, toCam.length()));
  let camPhi = Math.acos(Math.max(-1, Math.min(1, toCam.y / camRadius)));
  let camTheta = Math.atan2(toCam.x, toCam.z);

  function updateCameraFromOrbit() {
    const sinP = Math.sin(camPhi);
    camera.position.x = target.x + camRadius * sinP * Math.sin(camTheta);
    camera.position.y = target.y + camRadius * Math.cos(camPhi);
    camera.position.z = target.z + camRadius * sinP * Math.cos(camTheta);
    camera.lookAt(target);
  }
  updateCameraFromOrbit();

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
        camRadius = Math.max(2.6, Math.min(24, pinchStartRadius * (d / pinchStartDist)));
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
    const t = clock.getElapsedTime();

    for (const o of orbitals) {
      o.pivot.rotation.y = t * o.speed + o.phase;
      o.mesh.rotation.y = t * o.spin;
    }

    root.rotation.y = t * 0.004 + 0.28;

    if (pointers.size === 0 && !dragging) {
      idleOrbitAcc += dt;
      if (idleOrbitAcc > 1.4) {
        camTheta += dt * 0.055;
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

    sunCore.scale.setScalar(1 + Math.sin(t * 0.85) * 0.035);
    corona.scale.setScalar(1 + Math.sin(t * 0.48) * 0.06);

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
    hud.remove();
    host.classList.remove("book-tab-three-mount--interactive");
  };
}
