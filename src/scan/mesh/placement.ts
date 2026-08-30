import * as THREE from 'three';
import type { JawKind, RestorationType, Transform } from '../types';
import { getScan } from './registry';

/**
 * Works out where a restoration should sit on the arch: on top of an existing
 * crown, or bridging the gap up to the occlusal plane at an edentulous site.
 */

const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true;

export const occlusalAxis = (jaw: JawKind): THREE.Vector3 =>
  new THREE.Vector3(0, jaw === 'lower' ? 1 : -1, 0);

/** Height of the scan surface at (x, z), measured along the occlusal axis. */
export const surfaceHeight = (
  scanId: string,
  x: number,
  z: number,
  jaw: JawKind,
): number | null => {
  const record = getScan(scanId);
  if (!record) return null;
  const up = occlusalAxis(jaw);
  const origin = new THREE.Vector3(x, 0, z).addScaledVector(up, 60);
  raycaster.set(origin, up.clone().negate());
  raycaster.far = 200;
  const hits = raycaster.intersectObject(record.pickMesh, false);
  return hits.length > 0 ? hits[0].point.y : null;
};

const occlusalReferenceCache = new Map<string, number>();

/** Median occlusal height across the arch — the plane crowns should reach. */
export const occlusalReference = (scanId: string, jaw: JawKind): number | null => {
  const cached = occlusalReferenceCache.get(scanId);
  if (cached !== undefined) return cached;
  const record = getScan(scanId);
  if (!record?.arch) return null;
  const heights: number[] = [];
  record.arch.slots.forEach((slot) => {
    const y = surfaceHeight(scanId, slot.position.x, slot.position.z, jaw);
    if (y !== null) heights.push(y);
  });
  if (heights.length === 0) return null;
  heights.sort((a, b) => a - b);
  const value = heights[Math.floor(heights.length / 2)];
  occlusalReferenceCache.set(scanId, value);
  return value;
};

export const invalidatePlacementCache = (scanId?: string) => {
  if (scanId) occlusalReferenceCache.delete(scanId);
  else occlusalReferenceCache.clear();
};

const basisTransform = (
  position: THREE.Vector3,
  up: THREE.Vector3,
  outward: THREE.Vector3,
): Transform => {
  const y = up.clone().normalize();
  const z = outward.clone().projectOnPlane(y).normalize();
  if (z.lengthSq() < 1e-6) z.set(0, 0, 1);
  const x = new THREE.Vector3().crossVectors(y, z).normalize();
  const matrix = new THREE.Matrix4().makeBasis(x, y, z);
  const euler = new THREE.Euler().setFromRotationMatrix(matrix);
  return {
    position: [position.x, position.y, position.z],
    rotation: [euler.x, euler.y, euler.z],
    scale: [1, 1, 1],
  };
};

export interface PlacementResult {
  transform: Transform;
  /** Height the restoration should be built at, in millimetres. */
  height: number;
  /** True when the site has no tooth left to cover. */
  edentulous: boolean;
}

export const placeOnTooth = (
  scanId: string,
  jaw: JawKind,
  tooth: number,
  type: RestorationType,
  nominalHeight: number,
): PlacementResult | null => {
  const record = getScan(scanId);
  const slot = record?.arch?.slots.get(tooth);
  if (!record || !slot) return null;

  const up = occlusalAxis(jaw);
  const sign = jaw === 'lower' ? 1 : -1;
  const hit = surfaceHeight(scanId, slot.position.x, slot.position.z, jaw);
  const reference = occlusalReference(scanId, jaw);
  const surfaceY = hit ?? slot.position.y;
  const planeY = reference ?? surfaceY;

  // Distance from the site surface up to the occlusal plane.
  const gap = (planeY - surfaceY) * sign;
  const edentulous = gap > 2;

  let baseY: number;
  let height = nominalHeight;
  if (type === 'implant') {
    baseY = surfaceY;
  } else if (edentulous) {
    baseY = surfaceY;
    height = Math.max(nominalHeight * 0.6, gap + 0.5);
  } else {
    baseY = surfaceY - sign * nominalHeight;
  }

  const position = new THREE.Vector3(slot.position.x, baseY, slot.position.z);
  return {
    transform: basisTransform(position, up, slot.outward),
    height,
    edentulous,
  };
};

/** Placement from a click on the scan surface, using the arch for orientation. */
export const placeAtPoint = (
  scanId: string,
  jaw: JawKind,
  point: THREE.Vector3,
  tooth: number,
  type: RestorationType,
  nominalHeight: number,
): PlacementResult => {
  const record = getScan(scanId);
  const slot = record?.arch?.slots.get(tooth);
  const up = occlusalAxis(jaw);
  const sign = jaw === 'lower' ? 1 : -1;
  const outward =
    slot?.outward.clone() ??
    new THREE.Vector3(point.x, 0, point.z).normalize();

  const baseY = type === 'implant' ? point.y : point.y - sign * nominalHeight;
  const position = new THREE.Vector3(point.x, baseY, point.z);
  return {
    transform: basisTransform(position, up, outward),
    height: nominalHeight,
    edentulous: false,
  };
};

/** Nearest arch slot to an arbitrary point — used to name a clicked site. */
export const nearestTooth = (
  scanId: string,
  point: THREE.Vector3,
): number | null => {
  const record = getScan(scanId);
  if (!record?.arch) return null;
  let best: number | null = null;
  let bestDistance = Infinity;
  record.arch.slots.forEach((slot, tooth) => {
    const dx = slot.position.x - point.x;
    const dz = slot.position.z - point.z;
    const d = dx * dx + dz * dz;
    if (d < bestDistance) {
      bestDistance = d;
      best = tooth;
    }
  });
  return best;
};
