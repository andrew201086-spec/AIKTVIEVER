import * as THREE from 'three';
import type { ToothClass } from '../types';
import {
  RingMeshBuilder,
  angularBump,
  sampleProfile,
  superellipse,
} from './surface';

/**
 * Procedural crown anatomy. Local frame: origin at the centre of the gingival
 * margin, +Y occlusal, +Z buccal, +X mesiodistal. All sizes in millimetres.
 */

export interface CrownShape {
  toothClass: ToothClass;
  width: number;
  depth: number;
  height: number;
}

interface ClassProfile {
  topWidth: number;
  topDepth: number;
  /** Cusp height as a fraction of crown height. */
  cusp: number;
  /** Central fossa depth (negative lift) or crest lift, as a fraction of cusp. */
  centreLift: number;
  rim: (angle: number) => number;
}

const CLASS_PROFILES: Record<ToothClass, ClassProfile> = {
  molar: {
    topWidth: 0.86,
    topDepth: 0.86,
    cusp: 0.24,
    centreLift: -0.5,
    rim: (a) =>
      Math.min(
        1,
        angularBump(a, 0.72, 0.42) +
          angularBump(a, -0.72, 0.42) +
          0.92 * angularBump(a, Math.PI - 0.72, 0.42) +
          0.92 * angularBump(a, -(Math.PI - 0.72), 0.42),
      ),
  },
  premolar: {
    topWidth: 0.84,
    topDepth: 0.84,
    cusp: 0.28,
    centreLift: -0.42,
    rim: (a) =>
      Math.min(1, angularBump(a, 0, 0.6) + 0.78 * angularBump(a, Math.PI, 0.6)),
  },
  canine: {
    topWidth: 0.64,
    topDepth: 0.72,
    cusp: 0.28,
    centreLift: 1,
    rim: (a) => 0.28 * Math.pow(Math.abs(Math.sin(a)), 0.9),
  },
  incisor: {
    topWidth: 0.9,
    topDepth: 0.56,
    cusp: 0.13,
    centreLift: 0.97,
    rim: (a) => 0.9 * Math.pow(Math.abs(Math.sin(a)), 0.5),
  },
};

const RADIAL = 56;
const VERTICAL = 22;
const CAP_RINGS = 7;

/** Cervical constriction, height of contour, occlusal taper. */
const widthProfile = (topScale: number): [number, number][] => [
  [0, 0.8],
  [0.12, 0.95],
  [0.32, 1],
  [0.66, 0.95],
  [1, topScale],
];

const depthProfile = (topScale: number): [number, number][] => [
  [0, 0.78],
  [0.12, 0.94],
  [0.3, 1],
  [0.66, 0.93],
  [1, topScale],
];

interface CrownSurface {
  /** v in [0,1] from gingival margin to occlusal rim; angle from +Z buccal. */
  point: (v: number, angle: number) => THREE.Vector3;
  rimHeight: (angle: number) => number;
  centreHeight: number;
  shape: CrownShape;
  profile: ClassProfile;
}

export const crownSurface = (shape: CrownShape): CrownSurface => {
  const profile = CLASS_PROFILES[shape.toothClass];
  const wp = widthProfile(profile.topWidth);
  const dp = depthProfile(profile.topDepth);
  const cuspHeight = profile.cusp * shape.height;
  const bodyHeight = shape.height - cuspHeight;

  const point = (v: number, angle: number) => {
    const a = (shape.width / 2) * sampleProfile(wp, v);
    const b = (shape.depth / 2) * sampleProfile(dp, v);
    const { x, z } = superellipse(angle, a, b);
    return new THREE.Vector3(x, bodyHeight * v, z);
  };

  return {
    point,
    rimHeight: (angle) => bodyHeight + cuspHeight * profile.rim(angle),
    centreHeight: bodyHeight + cuspHeight * profile.centreLift,
    shape,
    profile,
  };
};

const ringAt = (
  surface: CrownSurface,
  v: number,
  segments = RADIAL,
): THREE.Vector3[] =>
  Array.from({ length: segments }, (_, i) =>
    surface.point(v, (i / segments) * Math.PI * 2 - Math.PI),
  );

/**
 * @param baseDome  Depth of the ovate bulge under the gingival margin; 0 gives
 *                  the flat base used by a crown seated on a preparation.
 */
export const buildCrownGeometry = (
  shape: CrownShape,
  baseDome = 0,
): THREE.BufferGeometry => {
  const surface = crownSurface(shape);
  const builder = new RingMeshBuilder();

  // Gingival cap, built from the centre outwards so windings face down.
  const baseRings: number[][] = [];
  for (let k = 0; k <= CAP_RINGS; k++) {
    const rho = k / CAP_RINGS;
    if (k === 0) {
      baseRings.push(builder.addRing([new THREE.Vector3(0, -baseDome, 0)]));
      continue;
    }
    const ring = ringAt(surface, 0).map((p) => {
      const y = -baseDome * (1 - rho * rho);
      return new THREE.Vector3(p.x * rho, y, p.z * rho);
    });
    baseRings.push(builder.addRing(ring));
    // Inner ring first so the gingival cap faces away from the crown.
    builder.stitch(baseRings[k - 1], baseRings[k]);
  }

  // Axial walls.
  let previous = baseRings[CAP_RINGS];
  for (let k = 1; k <= VERTICAL; k++) {
    const v = k / VERTICAL;
    const ring = builder.addRing(ringAt(surface, v));
    builder.stitch(previous, ring);
    previous = ring;
  }

  // Occlusal table with cusps.
  for (let k = 1; k <= CAP_RINGS; k++) {
    const rho = 1 - k / CAP_RINGS;
    const lift = Math.pow(rho, 2.2);
    if (k === CAP_RINGS) {
      const apex = builder.addRing([
        new THREE.Vector3(0, surface.centreHeight, 0),
      ]);
      builder.stitch(previous, apex);
      break;
    }
    const ring = ringAt(surface, 1).map((p, i) => {
      const angle = (i / RADIAL) * Math.PI * 2 - Math.PI;
      const y =
        surface.centreHeight + (surface.rimHeight(angle) - surface.centreHeight) * lift;
      return new THREE.Vector3(p.x * rho, y, p.z * rho);
    });
    const ids = builder.addRing(ring);
    builder.stitch(previous, ids);
    previous = ids;
  }

  // Raise the walls so they meet the undulating rim instead of a flat edge.
  const geometry = builder.build();
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const bodyTop = surface.point(1, 0).y;
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    if (y < bodyTop - 1e-6 || y > bodyTop + 1e-6) continue;
    const angle = Math.atan2(position.getX(i), position.getZ(i));
    position.setY(i, surface.rimHeight(angle) - (surface.rimHeight(angle) - bodyTop) * 0.35);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

/** Ovate pontic: a crown whose gingival end bulges into the ridge. */
export const buildPonticGeometry = (shape: CrownShape): THREE.BufferGeometry =>
  buildCrownGeometry(shape, Math.min(2, shape.height * 0.2));

const shellNormal = (
  surface: CrownSurface,
  v: number,
  angle: number,
): THREE.Vector3 => {
  const eps = 1e-3;
  const p = surface.point(v, angle);
  const dv = surface.point(Math.min(1, v + eps), angle).sub(p);
  const da = surface.point(v, angle + eps).sub(p);
  const n = da.cross(dv).normalize();
  // Point away from the tooth axis.
  const radial = new THREE.Vector3(p.x, 0, p.z).normalize();
  if (n.dot(radial) < 0) n.negate();
  return n;
};

/**
 * Labial veneer: the buccal band of the crown surface, given a real thickness
 * so it reads as a shell rather than a decal.
 */
export const buildVeneerGeometry = (
  shape: CrownShape,
  thickness = 0.7,
): THREE.BufferGeometry => {
  const surface = crownSurface(shape);
  const COLS = 40;
  const ROWS = 22;
  const spread = 1.85; // ±106°, wrapping onto the proximal surfaces
  const vMin = 0.04;
  const vMax = 1;

  const outer: THREE.Vector3[][] = [];
  const inner: THREE.Vector3[][] = [];
  for (let i = 0; i <= ROWS; i++) {
    const v = vMin + ((vMax - vMin) * i) / ROWS;
    const outerRow: THREE.Vector3[] = [];
    const innerRow: THREE.Vector3[] = [];
    for (let j = 0; j <= COLS; j++) {
      const angle = -spread + (2 * spread * j) / COLS;
      const base = surface.point(v, angle);
      const n = shellNormal(surface, v, angle);
      // Taper the shell to a feather edge at the cervical margin.
      const t = thickness * (0.35 + 0.65 * Math.min(1, i / 3));
      innerRow.push(base.clone());
      outerRow.push(base.clone().addScaledVector(n, t));
    }
    outer.push(outerRow);
    inner.push(innerRow);
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const push = (p: THREE.Vector3) => {
    const id = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    return id;
  };
  const outerIds = outer.map((row) => row.map(push));
  const innerIds = inner.map((row) => row.map(push));

  for (let i = 0; i < ROWS; i++) {
    for (let j = 0; j < COLS; j++) {
      indices.push(outerIds[i][j], outerIds[i + 1][j + 1], outerIds[i + 1][j]);
      indices.push(outerIds[i][j], outerIds[i][j + 1], outerIds[i + 1][j + 1]);
      indices.push(innerIds[i][j], innerIds[i + 1][j], innerIds[i + 1][j + 1]);
      indices.push(innerIds[i][j], innerIds[i + 1][j + 1], innerIds[i][j + 1]);
    }
  }
  // Rim around the four borders.
  for (let j = 0; j < COLS; j++) {
    indices.push(outerIds[0][j], outerIds[0][j + 1], innerIds[0][j + 1]);
    indices.push(outerIds[0][j], innerIds[0][j + 1], innerIds[0][j]);
    indices.push(outerIds[ROWS][j + 1], outerIds[ROWS][j], innerIds[ROWS][j]);
    indices.push(outerIds[ROWS][j + 1], innerIds[ROWS][j], innerIds[ROWS][j + 1]);
  }
  for (let i = 0; i < ROWS; i++) {
    indices.push(outerIds[i][0], innerIds[i][0], innerIds[i + 1][0]);
    indices.push(outerIds[i][0], innerIds[i + 1][0], outerIds[i + 1][0]);
    indices.push(innerIds[i][COLS], outerIds[i][COLS], outerIds[i + 1][COLS]);
    indices.push(innerIds[i][COLS], outerIds[i + 1][COLS], innerIds[i + 1][COLS]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

/** Occlusal inlay: the cusp cap of a crown, used for onlay/inlay previews. */
export const buildInlayGeometry = (shape: CrownShape): THREE.BufferGeometry => {
  const reduced: CrownShape = { ...shape, height: shape.height * 0.42 };
  const geometry = buildCrownGeometry(reduced, 0);
  geometry.translate(0, shape.height - reduced.height, 0);
  return geometry;
};
