import * as THREE from "three";

const DPR_CAP = 2;

/**
 * 全螢幕半透明 WebGL 裝飾：粒子雲、線框幾何、滑鼠視差。
 * - `?webgl=0` 關閉（略過後台開關）
 * - `prefers-reduced-motion: reduce` 不啟動
 * @returns 解除綁定與釋放資源，未建立場景時為 `null`
 */
export function mountAmbientWebgl(): (() => void) | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("webgl") === "0") return null;
  } catch {
    /* ignore */
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;

  const container = document.createElement("div");
  container.id = "ambient-webgl";
  container.setAttribute("aria-hidden", "true");
  document.body.prepend(container);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setPixelRatio(Math.min(DPR_CAP, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
  camera.position.set(0, 0.2, 5.2);

  const mainGroup = new THREE.Group();
  scene.add(mainGroup);

  const particleCount = 2200;
  const positions = new Float32Array(particleCount * 3);
  const basePositions = new Float32Array(particleCount * 3);
  const seeds = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const r = 4 + Math.random() * 5;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    basePositions[i * 3] = x;
    basePositions[i * 3 + 1] = y;
    basePositions[i * 3 + 2] = z;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    seeds[i * 3] = Math.random() * 1000;
    seeds[i * 3 + 1] = Math.random() * 1000;
    seeds[i * 3 + 2] = Math.random() * 1000;
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0xf0a8c8,
    size: 0.045,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(pGeo, pMat);
  mainGroup.add(points);

  const wireMat = new THREE.MeshBasicMaterial({
    color: 0xe06090,
    wireframe: true,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const torus = new THREE.Mesh(new THREE.TorusKnotGeometry(1.15, 0.32, 120, 16), wireMat.clone());
  torus.position.set(-1.1, 0.35, -0.8);
  mainGroup.add(torus);

  const ico = new THREE.Mesh(new THREE.IcosahedronGeometry(1.45, 1), wireMat.clone());
  ico.position.set(1.35, -0.25, -1.2);
  mainGroup.add(ico);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.02, 64, 128), wireMat.clone());
  ring.rotation.x = Math.PI / 2.4;
  ring.position.set(0, -0.6, -1.5);
  mainGroup.add(ring);

  let w = container.clientWidth || window.innerWidth;
  let h = container.clientHeight || window.innerHeight;
  const setSize = () => {
    w = container.clientWidth || window.innerWidth;
    h = container.clientHeight || window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };
  setSize();

  const onResize = () => setSize();
  window.addEventListener("resize", onResize);

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (ev: MouseEvent) => {
    mouse.tx = (ev.clientX / Math.max(1, w)) * 2 - 1;
    mouse.ty = (ev.clientY / Math.max(1, h)) * 2 - 1;
  };
  window.addEventListener("mousemove", onMove, { passive: true });

  let raf = 0;
  const t0 = performance.now();
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const t = (now - t0) * 0.001;
    mouse.x += (mouse.tx - mouse.x) * 0.04;
    mouse.y += (mouse.ty - mouse.y) * 0.04;

    camera.position.x = mouse.x * 0.55;
    camera.position.y = 0.2 + mouse.y * 0.35;
    camera.lookAt(0, 0, 0);

    mainGroup.rotation.y = t * 0.06;
    mainGroup.rotation.x = Math.sin(t * 0.12) * 0.08;
    torus.rotation.x = t * 0.31;
    torus.rotation.y = t * 0.22;
    ico.rotation.y = -t * 0.18;
    ico.rotation.z = t * 0.11;
    ring.rotation.z = t * 0.05;

    const posAttr = pGeo.getAttribute("position") as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < particleCount; i++) {
      const ix = i * 3;
      const sx = seeds[ix];
      const sy = seeds[ix + 1];
      const sz = seeds[ix + 2];
      arr[ix] = basePositions[ix] + Math.sin(t * 0.4 + sx) * 0.12;
      arr[ix + 1] = basePositions[ix + 1] + Math.cos(t * 0.35 + sy) * 0.1;
      arr[ix + 2] = basePositions[ix + 2] + Math.sin(t * 0.28 + sz) * 0.11;
    }
    posAttr.needsUpdate = true;

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  const cleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("mousemove", onMove);
    pGeo.dispose();
    pMat.dispose();
    torus.geometry.dispose();
    (torus.material as THREE.Material).dispose();
    ico.geometry.dispose();
    (ico.material as THREE.Material).dispose();
    ring.geometry.dispose();
    (ring.material as THREE.Material).dispose();
    renderer.dispose();
    container.remove();
  };

  return cleanup;
}
