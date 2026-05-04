/**
 * 輪盤全螢幕前奏：與預約分頁相同參數的太陽系場景，鏡頭持續拉近後淡出。
 * 與 `solarSpectacleShared` 共用軌道／星點邏輯，避免與分頁 canvas 搶同一 WebGL context。
 */

import * as THREE from "three";
import {
  SHARED_SOLAR_PLANET_DEFS,
  bodyMat,
  collectDisposables,
  createSoftStarPointSpriteTexture,
  fillAsteroidBelt,
  fillStarField,
} from "./solarSpectacleShared";

const DPR_CAP = 2;

function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

type OrbitBody = { pivot: THREE.Group; speed: number; phase: number; mesh: THREE.Mesh; spin: number };

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export type WheelSpectacleSolarIntroHandle = {
  /** 播放拉近動畫（含結尾曝光漸強，模擬衝向光源） */
  run(totalMs: number): Promise<void>;
  /** 淡出並釋放 WebGL（run 完成後務必呼叫） */
  fadeAndDispose(fadeMs?: number): Promise<void>;
  /** overlay 緊急關閉時略過淡出，立即釋放 WebGL */
  disposeWithoutFade(): void;
};

export function mountWheelSpectacleSolarIntro(host: HTMLElement): WheelSpectacleSolarIntroHandle | null {
  if (typeof window === "undefined") return null;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(DPR_CAP, window.devicePixelRatio || 1));
  renderer.setClearColor(0x03060c, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;vertical-align:top;touch-action:none;";
  host.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#03060c;";
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050810, 0.038);

  const camera = new THREE.PerspectiveCamera(46, 1, 0.06, 90);
  const target = new THREE.Vector3(0.08, -0.06, 0);

  const root = new THREE.Group();
  root.position.copy(target);
  root.rotation.x = 0.38;
  root.rotation.z = 0.1;
  scene.add(root);

  scene.add(new THREE.AmbientLight(0x223344, 0.22));

  const starPointSprite = createSoftStarPointSpriteTexture(80);

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

  const orbitals: OrbitBody[] = [];
  const orbitSegs = 128;
  for (const def of SHARED_SOLAR_PLANET_DEFS) {
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

  for (let i = 0; i < SHARED_SOLAR_PLANET_DEFS.length; i++) {
    const def = SHARED_SOLAR_PLANET_DEFS[i]!;
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
      arm.add(body);
    } else if (def.rings) {
      body = new THREE.Mesh(
        new THREE.SphereGeometry(def.size, 20, 20),
        bodyMat(def.color, { roughness: def.roughness ?? 0.9, metalness: def.metalness ?? 0.02 }),
      );
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
      arm.add(body);
    }

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
  const dwarfPivot = new THREE.Group();
  dwarfPivot.add(dwarf);
  dwarf.position.set(0.18, 0, 0);
  root.add(dwarfPivot);
  orbitals.push({ pivot: dwarfPivot, speed: 3.25, phase: 2.8, mesh: dwarf, spin: 2.2 });

  const disposableResources = [...collectDisposables(root), { dispose: () => starPointSprite.dispose() }];

  const toCam = new THREE.Vector3().subVectors(new THREE.Vector3(0.85, 1.05, 6.2), target);
  const camRadiusStart = Math.max(2.8, Math.min(22, toCam.length()));
  const camRadiusEnd = 0.26;
  let camRadius = camRadiusStart;
  let camPhi = Math.acos(Math.max(-1, Math.min(1, toCam.y / camRadiusStart)));
  let camTheta = Math.atan2(toCam.x, toCam.z);
  const camThetaStart = camTheta;
  const camPhiStart = camPhi;

  function updateCameraFromOrbit() {
    const sinP = Math.sin(camPhi);
    camera.position.x = target.x + camRadius * sinP * Math.sin(camTheta);
    camera.position.y = target.y + camRadius * Math.cos(camPhi);
    camera.position.z = target.z + camRadius * sinP * Math.cos(camTheta);
    camera.lookAt(target);
  }
  updateCameraFromOrbit();

  const clock = new THREE.Clock();
  let raf = 0;
  let disposed = false;
  const ro = new ResizeObserver(() => {
    const w = Math.max(1, Math.floor(host.clientWidth));
    const h = Math.max(1, Math.floor(host.clientHeight));
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  });
  ro.observe(host);
  const w0 = Math.max(1, Math.floor(host.clientWidth));
  const h0 = Math.max(1, Math.floor(host.clientHeight));
  camera.aspect = w0 / h0;
  camera.updateProjectionMatrix();
  renderer.setSize(w0, h0, false);

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

  function tickZoom(zoomU: number) {
    const u = easeInOutCubic(zoomU);
    camRadius = camRadiusStart + (camRadiusEnd - camRadiusStart) * u;
    camTheta = camThetaStart + Math.sin(u * Math.PI) * 0.55;
    camPhi = camPhiStart + (0.52 - camPhiStart) * u * 0.35;
    camPhi = Math.max(0.14, Math.min(Math.PI - 0.14, camPhi));
    const bloomU = Math.max(0, (zoomU - 0.82) / 0.18);
    renderer.toneMappingExposure = 0.95 + bloomU * 0.85;
    if (bloomU > 0.5) {
      sunLight.intensity = 14 + bloomU * 22;
    }
    updateCameraFromOrbit();
  }

  function renderFrame(t: number, zoomU: number) {
    const dt = Math.min(0.05, clock.getDelta());
    void dt;
    for (const o of orbitals) {
      o.pivot.rotation.y = t * o.speed + o.phase;
      o.mesh.rotation.y = t * o.spin;
    }
    root.rotation.y = t * 0.004 + 0.28;
    tickZoom(zoomU);
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

  function innerDispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    for (const d of disposableResources) {
      d.dispose();
    }
    renderer.dispose();
    canvas.remove();
  }

  return {
    run(totalMs: number): Promise<void> {
      const duration = Math.max(400, totalMs);
      const t0 = performance.now();
      clock.start();
      return new Promise((resolve) => {
        function frame() {
          if (disposed) {
            resolve();
            return;
          }
          const elapsed = performance.now() - t0;
          const zoomU = Math.min(1, elapsed / duration);
          renderFrame(clock.getElapsedTime(), zoomU);
          if (zoomU >= 1) {
            resolve();
            return;
          }
          raf = requestAnimationFrame(frame);
        }
        raf = requestAnimationFrame(frame);
      });
    },

    fadeAndDispose(fadeMs = 420): Promise<void> {
      host.style.transition = `opacity ${fadeMs}ms ease-out`;
      host.style.opacity = "0";
      return new Promise((resolve) => {
        window.setTimeout(() => {
          innerDispose();
          host.remove();
          resolve();
        }, fadeMs + 40);
      });
    },

    disposeWithoutFade(): void {
      innerDispose();
      host.remove();
    },
  };
}
