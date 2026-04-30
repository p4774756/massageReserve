import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const DPR_CAP = 2;

export type MountAmbientWebglOptions = {
  /** 通常為 `#app` 內、CSS `position:fixed` 的 `.app-ambient-webgl-host` */
  host: HTMLElement;
  shellForTint?: HTMLElement | null;
};

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

/** 小行星帶：環狀帶內隨機點，非粗圓環幾何 */
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

/**
 * 偏寫實的太陽系裝飾：點光源、Standard 行星、土星薄環（Ring）、小行星帶為點雲。
 * 原創剪影：小型太空船、彗星拖尾；掠過小行星帶時微粒＋短暫光暈（無第三方 IP 造型）。
 * 宿主為 `position: fixed` 視窗底層。互動：指標／觸控視差、滾輪略推場景；passive。
 */
export function mountAmbientWebgl(opts: MountAmbientWebglOptions): (() => void) | null {
  const { host, shellForTint } = opts;
  if (typeof window === "undefined") return null;
  if (!(host instanceof HTMLElement) || !host.isConnected) return null;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("webgl") === "0") return null;
  } catch {
    /* ignore */
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;

  shellForTint?.classList.add("shell--ambient-webgl");

  const container = document.createElement("div");
  container.className = "ambient-webgl";
  container.setAttribute("aria-hidden", "true");
  host.append(container);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(DPR_CAP, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.98;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(0x04060a, 0.016);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.06, 90);
  camera.position.set(1.25, 1.42, 7.35);

  const root = new THREE.Group();
  root.position.set(0.62, -0.18, 0.15);
  root.rotation.z = 0.11;
  scene.add(root);

  scene.add(new THREE.AmbientLight(0x334466, 0.28));

  const starCount = 900;
  const starBase = new Float32Array(starCount * 3);
  const starPos = new Float32Array(starCount * 3);
  const starSeed = new Float32Array(starCount * 3);
  fillStarField(starBase, starSeed, starCount, 3.6, 12);
  starPos.set(starBase);
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xd8e4f2,
    size: 0.032,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    blending: THREE.NormalBlending,
    sizeAttenuation: true,
  });
  root.add(new THREE.Points(starGeo, starMat));

  const sunLight = new THREE.PointLight(0xfff2dd, 11, 0, 2);
  sunLight.position.set(0, 0, 0);
  root.add(sunLight);

  const sunCore = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 28, 28),
    new THREE.MeshStandardMaterial({
      color: 0xfff8e8,
      emissive: 0xffeecc,
      emissiveIntensity: 1.35,
      roughness: 0.55,
      metalness: 0,
    }),
  );
  const corona = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 20, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffaa66,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  root.add(corona, sunCore);

  const beltInnerCount = 420;
  const beltOuterCount = 520;
  const beltInnerBase = new Float32Array(beltInnerCount * 3);
  const beltInnerPos = new Float32Array(beltInnerCount * 3);
  const beltInnerSeed = new Float32Array(beltInnerCount * 3);
  fillAsteroidBelt(beltInnerBase, beltInnerSeed, beltInnerCount, 0.72, 0.92, 0.045);
  beltInnerPos.set(beltInnerBase);
  const beltInnerGeo = new THREE.BufferGeometry();
  beltInnerGeo.setAttribute("position", new THREE.BufferAttribute(beltInnerPos, 3));
  const beltInnerMat = new THREE.PointsMaterial({
    color: 0x9a8a78,
    size: 0.018,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    sizeAttenuation: true,
  });
  root.add(new THREE.Points(beltInnerGeo, beltInnerMat));

  const beltOuterBase = new Float32Array(beltOuterCount * 3);
  const beltOuterPos = new Float32Array(beltOuterCount * 3);
  const beltOuterSeed = new Float32Array(beltOuterCount * 3);
  fillAsteroidBelt(beltOuterBase, beltOuterSeed, beltOuterCount, 1.02, 1.32, 0.055);
  beltOuterPos.set(beltOuterBase);
  const beltOuterGeo = new THREE.BufferGeometry();
  beltOuterGeo.setAttribute("position", new THREE.BufferAttribute(beltOuterPos, 3));
  const beltOuterMat = new THREE.PointsMaterial({
    color: 0x8a9098,
    size: 0.016,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    sizeAttenuation: true,
  });
  root.add(new THREE.Points(beltOuterGeo, beltOuterMat));

  type OrbitBody = { pivot: THREE.Group; speed: number; phase: number };
  const orbitals: OrbitBody[] = [];

  type PlanetDef = {
    r: number;
    speed: number;
    size: number;
    color: number;
    phase: number;
    roughness?: number;
    metalness?: number;
    rings?: boolean;
    mega?: boolean;
  };

  const planetDefs: PlanetDef[] = [
    { r: 0.28, speed: 2.05, size: 0.034, color: 0x8c7853, phase: 0.2, roughness: 0.95 },
    { r: 0.4, speed: 1.45, size: 0.046, color: 0xc9b87a, phase: 1.1, roughness: 0.82 },
    { r: 0.54, speed: 1.12, size: 0.048, color: 0x5a7d9a, phase: 2.3, roughness: 0.75, metalness: 0.12 },
    { r: 0.7, speed: 0.82, size: 0.04, color: 0xb85c3c, phase: 0.6, roughness: 0.92 },
    { r: 0.9, speed: 0.62, size: 0.11, color: 0xc9a068, phase: 3.2, mega: true, roughness: 0.88 },
    { r: 1.14, speed: 0.48, size: 0.092, color: 0xd4c4a8, phase: 4.4, rings: true, roughness: 0.9 },
    { r: 1.4, speed: 0.34, size: 0.072, color: 0x7eb8c4, phase: 1.7, roughness: 0.55, metalness: 0.18 },
    { r: 1.68, speed: 0.26, size: 0.064, color: 0x3d5a9e, phase: 5.0, roughness: 0.48, metalness: 0.22 },
  ];

  for (let i = 0; i < planetDefs.length; i++) {
    const def = planetDefs[i]!;
    const pivot = new THREE.Group();
    const arm = new THREE.Group();
    arm.position.set(def.r, 0, 0);
    pivot.add(arm);
    arm.rotation.z = ((i % 4) - 1.5) * 0.06;

    if (def.mega) {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(def.size, 22, 22),
        bodyMat(def.color, { roughness: def.roughness ?? 0.88, metalness: def.metalness ?? 0.02 }),
      );
      arm.add(body);
    } else if (def.rings) {
      const body = new THREE.Mesh(
        new THREE.SphereGeometry(def.size, 20, 20),
        bodyMat(def.color, { roughness: def.roughness ?? 0.9, metalness: def.metalness ?? 0.02 }),
      );
      const innerR = def.size * 1.38;
      const ringA = new THREE.Mesh(
        new THREE.RingGeometry(innerR, def.size * 2.15, 64),
        new THREE.MeshStandardMaterial({
          color: 0xc4b69a,
          transparent: true,
          opacity: 0.62,
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
          opacity: 0.38,
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
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(def.size, 16, 16),
        bodyMat(def.color, { roughness: def.roughness ?? 0.9, metalness: def.metalness ?? 0.02 }),
      );
      arm.add(mesh);
    }

    root.add(pivot);
    orbitals.push({ pivot, speed: def.speed * 1.12, phase: def.phase });
  }

  const rogue = new THREE.Mesh(
    new THREE.SphereGeometry(0.026, 10, 10),
    bodyMat(0x6a5a52, { roughness: 1, metalness: 0 }),
  );
  const roguePivot = new THREE.Group();
  roguePivot.add(rogue);
  rogue.position.set(0.18, 0, 0);
  root.add(roguePivot);
  orbitals.push({ pivot: roguePivot, speed: 3.4, phase: 2.8 });

  /** —— 原創剪影太空船、彗星與撞擊微粒（皆為程式化幾何）—— */
  const extrasRoot = new THREE.Group();
  root.add(extrasRoot);

  function buildSpaceship(hull: number, accent: number, scale: number): THREE.Group {
    const g = new THREE.Group();
    const hullM = bodyMat(hull, { roughness: 0.42, metalness: 0.5 });
    const accentM = bodyMat(accent, { roughness: 0.35, metalness: 0.55, emissive: accent, emissiveIntensity: 0.35 });
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
        emissiveIntensity: 1.1,
        roughness: 0.4,
        metalness: 0.2,
        transparent: true,
        opacity: 0.9,
      }),
    );
    glow.position.set(-0.11, 0, 0);
    g.add(fuselage, nose, wingL, wingR, tail, port, glow);
    g.scale.setScalar(scale);
    return g;
  }

  const shipA = buildSpaceship(0x6a7588, 0x8899aa, 1);
  const shipB = buildSpaceship(0x7a6048, 0xc9a070, 0.88);
  const shipC = buildSpaceship(0x556070, 0x7090a8, 1.05);
  extrasRoot.add(shipA, shipB, shipC);

  const comet = new THREE.Group();
  const cometHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.042, 12, 12),
    new THREE.MeshStandardMaterial({
      color: 0xd8ecff,
      emissive: 0xaaddff,
      emissiveIntensity: 0.55,
      roughness: 0.35,
      metalness: 0.08,
    }),
  );
  const trailLen = 72;
  const trailPos = new Float32Array(trailLen * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
  const trailMat = new THREE.PointsMaterial({
    color: 0xb8dcff,
    size: 0.028,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const cometTrail = new THREE.Points(trailGeo, trailMat);
  comet.add(cometHead);
  /* 拖尾用世界座標，與 comet 同層，避免跟著 group 變換重算 */
  extrasRoot.add(comet, cometTrail);

  const trailHist: THREE.Vector3[] = [];

  const debrisN = 52;
  const debrisPos = new Float32Array(debrisN * 3);
  const debrisVel = new Float32Array(debrisN * 3);
  const debrisLife = new Float32Array(debrisN);
  const debrisGeo = new THREE.BufferGeometry();
  debrisGeo.setAttribute("position", new THREE.BufferAttribute(debrisPos, 3));
  const debrisMat = new THREE.PointsMaterial({
    color: 0xffccaa,
    size: 0.022,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const debris = new THREE.Points(debrisGeo, debrisMat);
  extrasRoot.add(debris);

  let impactBloomBoost = 0;
  let lastImpactT = -999;

  function spawnDebrisBurst(at: THREE.Vector3) {
    for (let i = 0; i < debrisN; i++) {
      const ix = i * 3;
      const rx = (Math.random() - 0.5) * 2;
      const ry = (Math.random() - 0.5) * 2;
      const rz = (Math.random() - 0.5) * 2;
      const len = Math.max(0.08, Math.hypot(rx, ry, rz));
      debrisVel[ix] = (rx / len) * (0.35 + Math.random() * 0.45);
      debrisVel[ix + 1] = (ry / len) * (0.28 + Math.random() * 0.4);
      debrisVel[ix + 2] = (rz / len) * (0.35 + Math.random() * 0.45);
      debrisPos[ix] = at.x + (Math.random() - 0.5) * 0.06;
      debrisPos[ix + 1] = at.y + (Math.random() - 0.5) * 0.06;
      debrisPos[ix + 2] = at.z + (Math.random() - 0.5) * 0.06;
      debrisLife[i] = 1;
    }
  }

  function updateSpectacle(t: number, dt: number) {
    const placeShip = (ship: THREE.Group, phase: number, lane: number) => {
      const u = (t * 0.21 + phase) % 5.2;
      const f = (u / 5.2) * 2 - 1;
      const x = 2.45 * Math.cos(f * Math.PI * 0.5 + lane * 0.9);
      const y = 0.32 * Math.sin(t * 0.48 + phase * 2) + lane * 0.1;
      const z = 1.65 * Math.sin(f * Math.PI * 0.5 + lane * 0.55);
      ship.position.set(x, y, z);
      ship.lookAt(x + 0.55, y * 0.85, z + 0.22);
    };
    placeShip(shipA, 0.2, 0);
    placeShip(shipB, 2.1, 0.35);
    placeShip(shipC, 4.4, -0.28);

    const cycle = 36;
    const ct = t % cycle;
    const ang = ct * 0.62 + 0.45;
    const r = 2.55 - ct * 0.072;
    const cx = r * Math.cos(ang);
    const cy = 0.26 + 0.16 * Math.sin(ct * 0.75);
    const cz = r * Math.sin(ang);
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

    const beltHit = r > 0.74 && r < 1.12 && Math.abs(cy) < 0.22;
    if (beltHit && t - lastImpactT > 5) {
      lastImpactT = t;
      impactBloomBoost = Math.min(1, impactBloomBoost + 0.42);
      spawnDebrisBurst(new THREE.Vector3(cx, cy, cz));
    }

    let maxLife = 0;
    for (let i = 0; i < debrisN; i++) {
      const ix = i * 3;
      if (debrisLife[i] <= 0) continue;
      debrisLife[i] -= dt * 0.95;
      if (debrisLife[i] <= 0) {
        debrisLife[i] = 0;
        continue;
      }
      maxLife = Math.max(maxLife, debrisLife[i]);
      debrisPos[ix] += debrisVel[ix] * dt;
      debrisPos[ix + 1] += debrisVel[ix + 1] * dt;
      debrisPos[ix + 2] += debrisVel[ix + 2] * dt;
      debrisVel[ix + 1] -= dt * 0.14;
    }
    (debrisGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    debrisMat.opacity = maxLife > 0 ? Math.min(0.9, 0.2 + maxLife * 0.65) : 0;

    impactBloomBoost *= 0.9;
    return impactBloomBoost;
  }

  const disposables: { dispose(): void }[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
      disposables.push(obj.geometry);
      const mat = obj.material;
      if (Array.isArray(mat)) {
        for (const m of mat) {
          if (m) disposables.push(m);
        }
      } else if (mat) {
        disposables.push(mat as THREE.Material);
      }
    }
  });

  let w = container.clientWidth || 1;
  let h = container.clientHeight || 1;

  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.42, 0.88);
  for (let i = 0; i < bloomPass.bloomTintColors.length; i++) {
    bloomPass.bloomTintColors[i].set(1, 0.92 + i * 0.02, 0.98);
  }
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);

  const setSize = () => {
    w = Math.max(1, container.clientWidth || host.clientWidth || 1);
    h = Math.max(1, container.clientHeight || host.clientHeight || 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloomPass.resolution.set(w, h);
  };
  setSize();

  const onResize = () => setSize();
  window.addEventListener("resize", onResize);

  const resizeObs = new ResizeObserver(() => setSize());
  resizeObs.observe(host);

  const aim = { x: 0.22, y: -0.12, tx: 0.22, ty: -0.12 };
  let motionEnergy = 0;
  let tapBloom = 0;
  let wheelImpulse = 0;

  let lastPx = 0;
  let lastPy = 0;
  let lastPt = performance.now();
  let pointerInitialized = false;

  const setAimFromClient = (clientX: number, clientY: number) => {
    const rect = host.getBoundingClientRect();
    const rw = Math.max(1, rect.width);
    const rh = Math.max(1, rect.height);
    aim.tx = ((clientX - rect.left) / rw) * 2 - 1;
    aim.ty = ((clientY - rect.top) / rh) * 2 - 1;
  };

  const onPointerMove = (ev: PointerEvent) => {
    const now = performance.now();
    if (!pointerInitialized) {
      lastPx = ev.clientX;
      lastPy = ev.clientY;
      lastPt = now;
      pointerInitialized = true;
    }
    const dt = Math.max(10, now - lastPt);
    const dx = (ev.clientX - lastPx) / dt;
    const dy = (ev.clientY - lastPy) / dt;
    const speed = Math.hypot(dx, dy);
    motionEnergy = Math.min(1, motionEnergy * 0.82 + Math.min(speed * 0.052, 0.42));
    lastPx = ev.clientX;
    lastPy = ev.clientY;
    lastPt = now;

    setAimFromClient(ev.clientX, ev.clientY);
  };

  const onPointerDown = (ev: PointerEvent) => {
    setAimFromClient(ev.clientX, ev.clientY);
    tapBloom = Math.min(1, tapBloom + (ev.pointerType === "touch" ? 0.18 : 0.1));
  };

  const onWheel = (ev: WheelEvent) => {
    const d = Math.abs(ev.deltaY);
    wheelImpulse = Math.min(1.4, wheelImpulse + Math.min(0.35, d * 0.0018));
  };

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("wheel", onWheel, { passive: true });

  const twinkle = (base: Float32Array, arr: Float32Array, seeds: Float32Array, count: number, t: number, amp: number) => {
    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      const sx = seeds[ix];
      const sy = seeds[ix + 1];
      const sz = seeds[ix + 2];
      arr[ix] = base[ix] + Math.sin(t * 0.28 + sx * 0.007) * amp;
      arr[ix + 1] = base[ix + 1] + Math.cos(t * 0.24 + sy * 0.007) * amp * 0.72;
      arr[ix + 2] = base[ix + 2] + Math.sin(t * 0.2 + sz * 0.007) * amp;
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
      const sx = seeds[ix];
      const sy = seeds[ix + 1];
      const sz = seeds[ix + 2];
      arr[ix] = base[ix] + Math.sin(t * 0.5 + sx * 0.01) * amp;
      arr[ix + 1] = base[ix + 1] + Math.sin(t * 0.44 + sy * 0.01) * amp * 0.5;
      arr[ix + 2] = base[ix + 2] + Math.cos(t * 0.48 + sz * 0.01) * amp;
    }
  };

  let raf = 0;
  const t0 = performance.now();
  let prevFrame = performance.now();
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const dt = Math.min(0.09, (now - prevFrame) / 1000);
    prevFrame = now;
    const t = (now - t0) * 0.001;
    const spectacleBloom = updateSpectacle(t, dt);
    const parallaxBoost = 1 + motionEnergy * 0.45;
    aim.x += (aim.tx - aim.x) * 0.038;
    aim.y += (aim.ty - aim.y) * 0.038;

    motionEnergy *= 0.965;
    tapBloom *= 0.9;
    wheelImpulse *= 0.88;

    camera.position.x = 1.25 + aim.x * 0.48 * parallaxBoost;
    camera.position.y = 1.38 + aim.y * 0.32 * parallaxBoost;
    camera.position.z = 7.35 + aim.y * 0.12 + wheelImpulse * 0.05;
    camera.lookAt(-0.42 + aim.x * 0.07, 0.06 + aim.y * 0.04, 0.22);

    root.rotation.y = t * 0.026 + 0.35 + aim.x * 0.04;
    root.rotation.x = 0.31 + Math.sin(t * 0.06) * 0.08 + aim.y * 0.032;
    root.rotation.z = 0.11 + Math.sin(t * 0.048) * 0.055 + wheelImpulse * 0.02;

    const pulse = tapBloom * 0.1 + motionEnergy * 0.04;
    sunCore.scale.setScalar(1 + Math.sin(t * 0.9) * 0.04 + pulse);
    corona.scale.setScalar(1 + Math.sin(t * 0.5) * 0.08 + tapBloom * 0.06);

    for (const o of orbitals) {
      o.pivot.rotation.y = t * o.speed + o.phase;
    }

    bloomPass.strength =
      0.18 + Math.sin(t * 0.4) * 0.06 + tapBloom * 0.14 + wheelImpulse * 0.06 + spectacleBloom * 0.34;
    renderer.toneMappingExposure = 0.92 + Math.sin(t * 0.18) * 0.08 + tapBloom * 0.05;
    fog.density = 0.014 + Math.sin(t * 0.3) * 0.004;
    starMat.color.setHSL(((0.58 + t * 0.008) % 1 + 1) % 1, 0.12, 0.88);

    const starAmp = 0.038 + motionEnergy * 0.032 + wheelImpulse * 0.015;
    twinkle(starBase, starPos, starSeed, starCount, t, starAmp);
    (starGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

    const beltAmp = 0.012 + motionEnergy * 0.018;
    twinkleBelt(beltInnerBase, beltInnerPos, beltInnerSeed, beltInnerCount, t, beltAmp);
    (beltInnerGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    twinkleBelt(beltOuterBase, beltOuterPos, beltOuterSeed, beltOuterCount, t, beltAmp * 0.9);
    (beltOuterGeo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;

    composer.render();
  };
  raf = requestAnimationFrame(tick);

  const cleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("wheel", onWheel);
    resizeObs.disconnect();
    shellForTint?.classList.remove("shell--ambient-webgl");
    outputPass.dispose();
    bloomPass.dispose();
    composer.dispose();
    const seen = new Set<object>();
    for (const d of disposables) {
      if (seen.has(d)) continue;
      seen.add(d);
      d.dispose();
    }
    renderer.dispose();
    container.remove();
  };

  return cleanup;
}
