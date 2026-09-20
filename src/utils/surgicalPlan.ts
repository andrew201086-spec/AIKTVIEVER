/**
 * Planning an implant, and the canal it must not touch.
 *
 * Everything here lives in patient coordinates, not voxel indices: an implant
 * is a physical object at a place in the jaw, and the distances that matter —
 * to the mandibular canal, to the next root, to the outside of the bone — are
 * millimetres in the patient, not steps in a grid. Voxels come into it only
 * where a picture has to be sampled.
 *
 * None of this decides anything. It measures, and the surgeon reads the
 * measurement.
 */

export type Vec3 = [number, number, number];

export interface CanalPath {
  id: string;
  side: 'right' | 'left';
  /** Traced points, in the order they were placed. */
  points: Vec3[];
}

export interface Implant {
  id: string;
  /** Tooth position this is planned for, when known. */
  fdi?: number;
  /** Centre of the platform — the end that meets the crown. */
  platform: Vec3;
  /** Centre of the apex — the deep end. */
  apex: Vec3;
  diameterMm: number;
  note: string;
}

/** Sizes a clinic actually stocks; the list is a starting point, not a rule. */
export const IMPLANT_SIZES: Array<{ diameter: number; length: number }> = [
  { diameter: 3.3, length: 8 },
  { diameter: 3.3, length: 10 },
  { diameter: 3.3, length: 12 },
  { diameter: 3.75, length: 8 },
  { diameter: 3.75, length: 10 },
  { diameter: 3.75, length: 11.5 },
  { diameter: 3.75, length: 13 },
  { diameter: 4.1, length: 8 },
  { diameter: 4.1, length: 10 },
  { diameter: 4.1, length: 12 },
  { diameter: 4.8, length: 8 },
  { diameter: 4.8, length: 10 },
  { diameter: 5.0, length: 11.5 },
];

/* ---------------------------------------------------------------- vectors */

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalise(a: Vec3): Vec3 {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/* --------------------------------------------------------------- implants */

export function implantLengthMm(implant: Implant): number {
  return length(subtract(implant.apex, implant.platform));
}

export function implantAxis(implant: Implant): Vec3 {
  return normalise(subtract(implant.apex, implant.platform));
}

/**
 * Moves the apex so the implant has the given length, keeping the platform
 * and the direction. Picking a size from the list must not also re-aim it.
 */
export function withLength(implant: Implant, lengthMm: number): Implant {
  const axis = implantAxis(implant);
  return { ...implant, apex: add(implant.platform, scale(axis, lengthMm)) };
}

/* ----------------------------------------------------------------- canals */

/** Catmull-Rom through the traced points, so the canal reads as a curve. */
export function canalCurve(points: Vec3[], samplesPerSegment = 12): Vec3[] {
  if (points.length < 2) return [...points];
  const out: Vec3[] = [];

  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(index - 1, 0)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(index + 2, points.length - 1)];

    for (let step = 0; step < samplesPerSegment; step++) {
      const t = step / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const point = [0, 0, 0] as Vec3;
      for (let axis = 0; axis < 3; axis++) {
        point[axis] =
          0.5 *
          (2 * p1[axis] +
            (-p0[axis] + p2[axis]) * t +
            (2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2 +
            (-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3);
      }
      out.push(point);
    }
  }

  out.push(points[points.length - 1]);
  return out;
}

/* -------------------------------------------------------------- distances */

/** Shortest distance from a point to a segment, and where along it that is. */
function pointToSegment(point: Vec3, a: Vec3, b: Vec3): { distance: number; at: Vec3 } {
  const ab = subtract(b, a);
  const lengthSquared = dot(ab, ab);
  const t = lengthSquared > 0 ? Math.max(0, Math.min(1, dot(subtract(point, a), ab) / lengthSquared)) : 0;
  const at = add(a, scale(ab, t));
  return { distance: length(subtract(point, at)), at };
}

/** Shortest distance between two segments, sampled — exact enough at 0.1 mm. */
function segmentToSegment(
  a1: Vec3,
  a2: Vec3,
  b1: Vec3,
  b2: Vec3
): { distance: number; onA: Vec3; onB: Vec3 } {
  let best = { distance: Infinity, onA: a1, onB: b1 };
  const steps = 24;
  for (let n = 0; n <= steps; n++) {
    const point = add(a1, scale(subtract(a2, a1), n / steps));
    const near = pointToSegment(point, b1, b2);
    if (near.distance < best.distance) {
      best = { distance: near.distance, onA: point, onB: near.at };
    }
  }
  return best;
}

export interface CanalClearance {
  /** Millimetres from the implant's surface to the centre of the canal. */
  mm: number;
  side: CanalPath['side'];
  /** The two points the measurement runs between, for drawing it. */
  onImplant: Vec3;
  onCanal: Vec3;
}

/**
 * How close the implant comes to a traced canal.
 *
 * Measured from the implant's *surface*, not its axis: the surgeon's margin
 * is to the outside of the fixture. The canal is treated as a line, so its own
 * width — usually 2–3 mm — still has to be allowed for on top.
 */
export function clearanceToCanals(implant: Implant, canals: CanalPath[]): CanalClearance | null {
  let best: CanalClearance | null = null;
  const radius = implant.diameterMm / 2;

  for (const canal of canals) {
    const curve = canalCurve(canal.points);
    for (let index = 0; index < curve.length - 1; index++) {
      const near = segmentToSegment(implant.platform, implant.apex, curve[index], curve[index + 1]);
      const mm = near.distance - radius;
      if (!best || mm < best.mm) {
        best = { mm, side: canal.side, onImplant: near.onA, onCanal: near.onB };
      }
    }
  }

  return best;
}

/** Distance from the implant surface to another implant's surface. */
export function clearanceToImplants(implant: Implant, others: Implant[]): number | null {
  let best: number | null = null;
  for (const other of others) {
    if (other.id === implant.id) continue;
    const near = segmentToSegment(implant.platform, implant.apex, other.platform, other.apex);
    const mm = near.distance - implant.diameterMm / 2 - other.diameterMm / 2;
    if (best === null || mm < best) best = mm;
  }
  return best;
}

/* ------------------------------------------------------------ projections */

/** Signed distance of a point from a viewing plane, in millimetres. */
export function distanceFromPlane(point: Vec3, planePoint: Vec3, planeNormal: Vec3): number {
  return dot(subtract(point, planePoint), planeNormal);
}

/**
 * How far a plane is from a segment — zero while it cuts through it.
 *
 * Testing only the two ends is what an implant drawn over a slice must not
 * do: a fixture standing across the plane has both ends far from it and the
 * plane straight through its middle, and would be drawn as though it were
 * somewhere else entirely.
 */
export function distanceFromPlaneToSegment(
  from: Vec3,
  to: Vec3,
  planePoint: Vec3,
  planeNormal: Vec3
): number {
  const a = distanceFromPlane(from, planePoint, planeNormal);
  const b = distanceFromPlane(to, planePoint, planeNormal);
  // Opposite signs mean the plane passes between the ends.
  if (a === 0 || b === 0 || a * b < 0) return 0;
  return Math.min(Math.abs(a), Math.abs(b));
}

/**
 * How wide a millimetre is on this viewport's canvas.
 *
 * Taken by projecting two points a known distance apart rather than read off
 * the camera, so it stays right through zooming and any projection the
 * viewport applies.
 */
export function pixelsPerMm(
  worldToCanvas: (world: Vec3) => [number, number] | undefined,
  origin: Vec3,
  alongPlane: Vec3
): number {
  const a = worldToCanvas(origin);
  const b = worldToCanvas(add(origin, scale(normalise(alongPlane), 10)));
  if (!a || !b) return 0;
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / 10;
}

/** «4.1 × 10 мм» */
export function describeImplant(implant: Implant): string {
  return `${implant.diameterMm.toFixed(1)} × ${implantLengthMm(implant).toFixed(1)} мм`;
}
