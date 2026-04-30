/**
 * 輪盤演出用 Three.js：厚楔形扇區、Standard 燈光、UnrealBloom、與既有 CSS 旋轉角（順時針度數）對齊。
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const DPR_CAP = 2;

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

export type WheelPrizeLabelLite = { id: string; name: string; weight: number };

export type MountWheelSpectacleThreeOpts = {
  prizes: WheelPrizeLabelLite[] | null;
  reduceMotion: boolean;
  /** 無獎項時與 `wheelSpectacle` 裝飾輪一致 */
  decorativeSlices: number;
};

function shortWheelLabel(name: string, nSlices: number): string {
  const max = nSlices > 8 ? 5 : nSlices > 6 ? 6 : 8;
  const s = name.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** 與 SVG 輪盤一致：數學極角 a（度）→ Three XY（Y 軸向上、頂端為 -90°） */
function wheelXY(r: number, aDeg: number): THREE.Vector2 {
  const t = THREE.MathUtils.degToRad(aDeg);
  return new THREE.Vector2(r * Math.cos(t), -r * Math.sin(t));
}

/** CSS cubic-bezier(0.08, 0.82, 0.12, 1) 的 y(t) */
function createBezierEase(p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;
  const sampleCurveX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleCurveY = (t: number) => ((ay * t + by) * t + cy) * t;
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let t2 = t;
    for (let i = 0; i < 10; i++) {
      const x = sampleCurveX(t2) - t;
      if (Math.abs(x) < 1e-5) break;
      const dx = (3 * ax * t2 + 2 * bx) * t2 + cx;
      if (Math.abs(dx) < 1e-6) break;
      t2 -= x / dx;
      t2 = Math.max(0, Math.min(1, t2));
    }
    return sampleCurveY(t2);
  };
}

const spinEase = createBezierEase(0.08, 0.82, 0.12, 1);

function parseHexColor(hex: string): number {
  const h = hex.replace("#", "");
  return parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
}

function makeLabelTexture(
  text: string,
  bgHex: string,
  w: number,
  h: number,
): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  g.clearRect(0, 0, w, h);
  g.fillStyle = `${bgHex}00`;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#1a1428";
  g.font = `800 ${Math.floor(h * 0.34)}px system-ui, -apple-system, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w * 0.5, h * 0.52);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function wedgeShape(a0Deg: number, a1Deg: number, rOut: number, rIn: number, arcSegs: number): THREE.Shape {
  const shape = new THREE.Shape();
  const segs = Math.max(4, arcSegs);
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const a = a0Deg + (a1Deg - a0Deg) * u;
    const p = wheelXY(rOut, a);
    if (i === 0) shape.moveTo(p.x, p.y);
    else shape.lineTo(p.x, p.y);
  }
  for (let i = segs; i >= 0; i--) {
    const u = i / segs;
    const a = a0Deg + (a1Deg - a0Deg) * u;
    const p = wheelXY(rIn, a);
    shape.lineTo(p.x, p.y);
  }
  shape.closePath();
  return shape;
}

export type WheelSpectacleThreeHandle = {
  /** CSS 順時針度數，與舊版 `transform: rotate(deg)` 一致 */
  spinTo(finalDegClockwise: number, durationMs: number): Promise<void>;
  setWinnerByPrizeId(id: string | null): void;
  setRimGlow(on: boolean): void;
  /** 中獎瞬間加強 bloom */
  winBloomPulse(): void;
  dispose(): void;
};

export function mountWheelSpectacleThree(
  host: HTMLElement,
  opts: MountWheelSpectacleThreeOpts,
): WheelSpectacleThreeHandle | null {
  if (typeof window === "undefined") return null;

  const sliceMeshes: { id: string; mat: THREE.MeshStandardMaterial; labelMat?: THREE.MeshStandardMaterial }[] = [];

  try {
    host.replaceChildren();
    host.classList.add("wheel-spectacle-wheel-disk--webgl");

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(DPR_CAP, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = opts.reduceMotion ? 0.92 : 1.02;
    renderer.shadowMap.enabled = !opts.reduceMotion;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;border-radius:50%";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(42, 1, 0.08, 20);
    camera.position.set(0, 0.08, 3.45);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x6a5c9a, opts.reduceMotion ? 0.42 : 0.28));

    const keyLight = new THREE.DirectionalLight(0xfff5e6, opts.reduceMotion ? 1.05 : 1.35);
    keyLight.position.set(1.1, 2.2, 2.4);
    keyLight.castShadow = !opts.reduceMotion;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);

    const fillLight = new THREE.PointLight(0xaaccff, opts.reduceMotion ? 0.35 : 0.62, 8, 2);
    fillLight.position.set(-1.85, -0.6, 1.2);
    scene.add(fillLight);

    const rimLight = new THREE.SpotLight(0xffd080, opts.reduceMotion ? 0.55 : 1.15, 9, 0.65, 0.35, 1);
    rimLight.position.set(0.15, 2.85, 2.1);
    rimLight.target.position.set(0, 0, 0);
    scene.add(rimLight);
    scene.add(rimLight.target);

    const backRim = new THREE.PointLight(0xc070ff, opts.reduceMotion ? 0.22 : 0.48, 5, 2);
    backRim.position.set(0, -0.35, -0.85);
    scene.add(backRim);

    const wheelGroup = new THREE.Group();
    scene.add(wheelGroup);

    const rOut = 0.93;
    const rIn = 0.38;
    const rLabel = (rOut + rIn) * 0.5;
    const extrudeDepth = opts.reduceMotion ? 0.045 : 0.072;
    const arcSegs = opts.reduceMotion ? 10 : 18;

    type SliceDef = { id: string; name: string; a0: number; a1: number; colorHex: string };
    const slices: SliceDef[] = [];

    if (opts.prizes && opts.prizes.length > 0) {
      const totalW = opts.prizes.reduce((s, p) => s + Math.max(0, p.weight), 0) || 1;
      let angle = -90;
      for (let i = 0; i < opts.prizes.length; i++) {
        const p = opts.prizes[i]!;
        const sweep = (Math.max(0, p.weight) / totalW) * 360;
        const a0 = angle;
        const a1 = angle + sweep;
        slices.push({
          id: p.id,
          name: p.name,
          a0,
          a1,
          colorHex: SLICE_FILL[i % SLICE_FILL.length]!,
        });
        angle = a1;
      }
    } else {
      const n = Math.max(3, opts.decorativeSlices);
      const step = 360 / n;
      let angle = -90;
      for (let i = 0; i < n; i++) {
        const a0 = angle;
        const a1 = angle + step;
        slices.push({
          id: `dec-${i}`,
          name: "",
          a0,
          a1,
          colorHex: SLICE_FILL[i % SLICE_FILL.length]!,
        });
        angle = a1;
      }
    }

    for (let i = 0; i < slices.length; i++) {
      const s = slices[i]!;
      const shape = wedgeShape(s.a0, s.a1, rOut, rIn, arcSegs);
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: extrudeDepth,
        bevelEnabled: !opts.reduceMotion,
        bevelThickness: 0.014,
        bevelSize: 0.012,
        bevelSegments: 2,
        curveSegments: arcSegs,
      });
      geo.translate(0, 0, -extrudeDepth * 0.5);

      const col = parseHexColor(s.colorHex);
      const mat = new THREE.MeshStandardMaterial({
        color: col,
        roughness: opts.reduceMotion ? 0.72 : 0.48,
        metalness: opts.reduceMotion ? 0.06 : 0.18,
        emissive: 0x000000,
        emissiveIntensity: 0,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !opts.reduceMotion;
      mesh.receiveShadow = !opts.reduceMotion;
      mesh.userData.prizeId = s.id;
      wheelGroup.add(mesh);
      sliceMeshes.push({ id: s.id, mat });

      if (s.name) {
        const mid = (s.a0 + s.a1) / 2;
        const p = wheelXY(rLabel, mid);
        const labelTex = makeLabelTexture(
          shortWheelLabel(s.name, slices.length),
          s.colorHex,
          512,
          256,
        );
        const lw = 0.52;
        const lh = 0.26;
        const labelGeo = new THREE.PlaneGeometry(lw, lh);
        const labelMat = new THREE.MeshStandardMaterial({
          map: labelTex,
          transparent: true,
          roughness: 0.9,
          metalness: 0,
          depthWrite: false,
        });
        const labelMesh = new THREE.Mesh(labelGeo, labelMat);
        labelMesh.position.set(p.x, p.y, extrudeDepth * 0.5 + 0.032);
        const ang = Math.atan2(p.y, p.x) + Math.PI / 2;
        labelMesh.rotation.z = ang;
        wheelGroup.add(labelMesh);
        sliceMeshes[sliceMeshes.length - 1]!.labelMat = labelMat;
      }
    }

    const hubPlate = new THREE.Mesh(
      new THREE.CircleGeometry(rIn * 0.98, 48),
      new THREE.MeshStandardMaterial({
        color: 0x1a1028,
        roughness: 0.85,
        metalness: 0.12,
        emissive: 0x2a1a44,
        emissiveIntensity: 0.25,
      }),
    );
    hubPlate.position.z = extrudeDepth * 0.5 + 0.018;
    wheelGroup.add(hubPlate);

    const outerRim = new THREE.Mesh(
      new THREE.TorusGeometry(rOut + 0.028, 0.038, 14, 64),
      new THREE.MeshStandardMaterial({
        color: 0xffe8a8,
        emissive: 0xffcc66,
        emissiveIntensity: opts.reduceMotion ? 0.12 : 0.22,
        roughness: 0.35,
        metalness: 0.55,
      }),
    );
    outerRim.position.z = extrudeDepth * 0.5 + 0.01;
    wheelGroup.add(outerRim);

    let w = Math.max(1, host.clientWidth || 1);
    let h = Math.max(1, host.clientHeight || 1);

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      opts.reduceMotion ? 0.12 : 0.28,
      opts.reduceMotion ? 0.55 : 0.42,
      opts.reduceMotion ? 0.92 : 0.86,
    );
    for (let i = 0; i < bloomPass.bloomTintColors.length; i++) {
      bloomPass.bloomTintColors[i]!.set(1, 0.94 + i * 0.02, 0.99);
    }
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(bloomPass);
    composer.addPass(outputPass);

    const setSize = () => {
      w = Math.max(1, host.clientWidth || 1);
      h = Math.max(1, host.clientHeight || 1);
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

    let rimGlowOn = false;
    let winBloom = 0;
    let spinAnimToken = 0;
    let currentRotZ = 0;

    const tick = () => {
      const t = performance.now() * 0.001;
      if (rimGlowOn) {
        rimLight.intensity = (opts.reduceMotion ? 0.55 : 1.15) + Math.sin(t * 9) * (opts.reduceMotion ? 0.08 : 0.28);
        (outerRim.material as THREE.MeshStandardMaterial).emissiveIntensity =
          (opts.reduceMotion ? 0.12 : 0.22) + Math.sin(t * 8) * (opts.reduceMotion ? 0.06 : 0.35);
      } else {
        rimLight.intensity = opts.reduceMotion ? 0.55 : 1.15;
        (outerRim.material as THREE.MeshStandardMaterial).emissiveIntensity = opts.reduceMotion ? 0.12 : 0.22;
      }
      winBloom *= 0.9;
      bloomPass.strength = (opts.reduceMotion ? 0.12 : 0.28) + winBloom;
      wheelGroup.rotation.z = currentRotZ;
      composer.render();
    };

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      tick();
    };
    raf = requestAnimationFrame(loop);

    const disposeMaterial = (m: THREE.Material) => {
      if ("map" in m && m.map) m.map.dispose();
      m.dispose();
    };

    const dispose = () => {
      spinAnimToken++;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      resizeObs.disconnect();
      outputPass.dispose();
      bloomPass.dispose();
      composer.dispose();
      wheelGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
          const mat = obj.material;
          if (Array.isArray(mat)) mat.forEach((x) => disposeMaterial(x));
          else if (mat) disposeMaterial(mat);
        }
      });
      renderer.dispose();
      host.classList.remove("wheel-spectacle-wheel-disk--webgl");
      host.replaceChildren();
    };

    return {
      spinTo(finalDegClockwise: number, durationMs: number): Promise<void> {
        const token = ++spinAnimToken;
        const startZ = currentRotZ;
        const targetZ = -THREE.MathUtils.degToRad(finalDegClockwise);
        const delta = targetZ - startZ;
        const t0 = performance.now();

        return new Promise((resolve) => {
          const step = (now: number) => {
            if (token !== spinAnimToken) {
              resolve();
              return;
            }
            const u = Math.min(1, (now - t0) / durationMs);
            const e = spinEase(u);
            currentRotZ = startZ + delta * e;
            if (u < 1) {
              requestAnimationFrame(step);
            } else {
              currentRotZ = targetZ;
              resolve();
            }
          };
          requestAnimationFrame(step);
        });
      },
      setWinnerByPrizeId(id: string | null) {
        for (const row of sliceMeshes) {
          row.mat.emissive.set(0x000000);
          row.mat.emissiveIntensity = 0;
        }
        if (!id) return;
        const row = sliceMeshes.find((r) => r.id === id);
        if (!row) return;
        row.mat.emissive.set(0xffe8aa);
        row.mat.emissiveIntensity = opts.reduceMotion ? 0.55 : 0.95;
      },
      setRimGlow(on: boolean) {
        rimGlowOn = on;
      },
      winBloomPulse() {
        winBloom = opts.reduceMotion ? 0.22 : 0.55;
      },
      dispose,
    };
  } catch {
    try {
      host.classList.remove("wheel-spectacle-wheel-disk--webgl");
      host.replaceChildren();
    } catch {
      /* ignore */
    }
    return null;
  }
}
