import * as THREE from "three";

/** 預約分頁太陽系與輪盤前奏共用的幾何／材質工具（單一維護點） */

export function fillStarField(base: Float32Array, seeds: Float32Array, count: number, rMin: number, rMax: number) {
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

export function fillAsteroidBelt(
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

export function bodyMat(
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

export function collectDisposables(root: THREE.Object3D): { dispose(): void }[] {
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

/** 與預約分頁 `bookTabThreeSpectacle` 相同軌道參數，前奏場景視覺一致 */
export type SharedSolarPlanetDef = {
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

export const SHARED_SOLAR_PLANET_DEFS: SharedSolarPlanetDef[] = [
  { r: 0.28, speed: 2.05, size: 0.034, color: 0x8c7853, phase: 0.2, roughness: 0.95, spin: 2.8 },
  { r: 0.4, speed: 1.45, size: 0.046, color: 0xc9b87a, phase: 1.1, roughness: 0.82, spin: -1.2 },
  { r: 0.54, speed: 1.12, size: 0.048, color: 0x5a7d9a, phase: 2.3, roughness: 0.75, metalness: 0.12, spin: 3.5 },
  { r: 0.7, speed: 0.82, size: 0.04, color: 0xb85c3c, phase: 0.6, roughness: 0.92, spin: 2.1 },
  { r: 0.9, speed: 0.62, size: 0.11, color: 0xc9a068, phase: 3.2, mega: true, roughness: 0.88, spin: 4.2 },
  { r: 1.14, speed: 0.48, size: 0.092, color: 0xd4c4a8, phase: 4.4, rings: true, roughness: 0.9, spin: 3.1 },
  { r: 1.4, speed: 0.34, size: 0.072, color: 0x7eb8c4, phase: 1.7, roughness: 0.55, metalness: 0.18, spin: 2.4 },
  { r: 1.68, speed: 0.26, size: 0.064, color: 0x3d5a9e, phase: 5.0, roughness: 0.48, metalness: 0.22, spin: 2.6 },
];
