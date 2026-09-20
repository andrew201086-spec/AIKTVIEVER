/**
 * Which way is the patient facing.
 *
 * Everything that names a side — «правый верхний моляр», an R/L marker on a
 * slice, which end of the dental arch is quadrant 1 — has to come from the
 * acquisition geometry, never from voxel indices. A scan exported with the
 * head turned, or with the slice normal pointing the other way, indexes
 * identically and means the opposite. In dentistry that is the difference
 * between reporting tooth 1.6 and tooth 2.6.
 *
 * DICOM patient space is LPS: +x towards the patient's Left, +y Posterior,
 * +z Superior. Cornerstone's world coordinates are the same space, so both
 * the volume's direction matrix and a viewport camera can be read with the
 * helpers here.
 */

export type Vec3 = [number, number, number];

/** Single letters as they are printed on the edge of a slice. */
export type PatientAxis = 'R' | 'L' | 'A' | 'P' | 'S' | 'I';

export const AXIS_NAMES: Record<PatientAxis, string> = {
  R: 'правая сторона',
  L: 'левая сторона',
  A: 'вперёд',
  P: 'назад',
  S: 'вверх',
  I: 'вниз',
};

/** Patient-space direction of each voxel axis of the volume. */
export interface VolumeOrientation {
  /** Direction of increasing column index. */
  i: Vec3;
  /** Direction of increasing row index. */
  j: Vec3;
  /** Direction of increasing slice index. */
  k: Vec3;
}

/** A head-first supine axial acquisition — what most CBCT exports are. */
export const STANDARD_AXIAL: VolumeOrientation = {
  i: [1, 0, 0],
  j: [0, 1, 0],
  k: [0, 0, 1],
};

const CANDIDATES: Array<{ axis: PatientAxis; vector: Vec3 }> = [
  { axis: 'L', vector: [1, 0, 0] },
  { axis: 'R', vector: [-1, 0, 0] },
  { axis: 'P', vector: [0, 1, 0] },
  { axis: 'A', vector: [0, -1, 0] },
  { axis: 'S', vector: [0, 0, 1] },
  { axis: 'I', vector: [0, 0, -1] },
];

export const OPPOSITE: Record<PatientAxis, PatientAxis> = {
  R: 'L',
  L: 'R',
  A: 'P',
  P: 'A',
  S: 'I',
  I: 'S',
};

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalise(v: ArrayLike<number>): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * Reads the orientation out of a volume's direction matrix, which is laid out
 * as the three axis directions in order: column, row, slice.
 */
export function orientationFromDirection(direction: ArrayLike<number>): VolumeOrientation {
  if (!direction || direction.length < 9) return STANDARD_AXIAL;
  return {
    i: normalise([direction[0], direction[1], direction[2]]),
    j: normalise([direction[3], direction[4], direction[5]]),
    k: normalise([direction[6], direction[7], direction[8]]),
  };
}

/** The letter for whichever patient direction a vector points along most. */
export function axisLabel(v: ArrayLike<number>): PatientAxis {
  let best: PatientAxis = 'L';
  let bestDot = -Infinity;
  for (const candidate of CANDIDATES) {
    const value = dot(v, candidate.vector);
    if (value > bestDot) {
      bestDot = value;
      best = candidate.axis;
    }
  }
  return best;
}

/** Does moving along the column axis go towards the patient's left? */
export function columnsGoLeft(orientation: VolumeOrientation): boolean {
  return orientation.i[0] >= 0;
}

/** Does moving to a higher slice index go towards the top of the head? */
export function slicesGoSuperior(orientation: VolumeOrientation): boolean {
  return orientation.k[2] >= 0;
}

/**
 * How far the slice plane is tilted away from a true axial one, in degrees.
 *
 * A few degrees is ordinary — patients do not lie perfectly straight. Past
 * about fifteen the anatomical shortcuts this viewer takes (the arch is a
 * curve on one axial slice, roots run straight up or down from it) stop
 * describing the scan, and the user is told so.
 */
export function tiltFromAxial(orientation: VolumeOrientation): number {
  const alignment = Math.min(1, Math.abs(orientation.k[2]));
  return (Math.acos(alignment) * 180) / Math.PI;
}

/** Plain-language summary for the warning bar. */
export function describeOrientation(orientation: VolumeOrientation): string {
  const tilt = tiltFromAxial(orientation);
  const slices = slicesGoSuperior(orientation) ? 'снизу вверх' : 'сверху вниз';
  const columns = columnsGoLeft(orientation) ? 'слева направо' : 'справа налево';
  return `срезы идут ${slices}, столбцы — ${columns}, наклон к аксиальной плоскости ${tilt.toFixed(0)}°`;
}

/* ------------------------------------------------------- volume geometry */

/**
 * Height above the bottom of the picture is not the slice index.
 *
 * Every reformation in this viewer measures height as millimetres down from
 * the superior end of the volume, so that «выше» always means «towards the
 * top of the head» whichever way the slices were stacked.
 */
export function heightToSlice(
  heightMm: number,
  sliceCount: number,
  sliceSpacing: number,
  orientation: VolumeOrientation
): number {
  const index = heightMm / sliceSpacing;
  return slicesGoSuperior(orientation) ? sliceCount - 1 - index : index;
}

/** The inverse: how far below the top of the volume a slice sits. */
export function sliceToHeight(
  slice: number,
  sliceCount: number,
  sliceSpacing: number,
  orientation: VolumeOrientation
): number {
  return slicesGoSuperior(orientation)
    ? (sliceCount - 1 - slice) * sliceSpacing
    : slice * sliceSpacing;
}

/* ------------------------------------------------------ viewport markers */

export interface EdgeLabels {
  top: PatientAxis;
  bottom: PatientAxis;
  left: PatientAxis;
  right: PatientAxis;
}

interface ProbeableViewport {
  getCanvas?: () => HTMLCanvasElement;
  canvasToWorld?: (canvas: [number, number]) => number[];
}

/**
 * Works out what to print on each edge of a slice by asking the viewport
 * itself where two points on screen land in the patient.
 *
 * Measuring beats deriving it from the camera vectors: it needs no assumption
 * about the renderer's handedness, and it follows the view when the crosshair
 * tool rotates the plane.
 */
export function edgeLabelsFor(viewport: ProbeableViewport | null | undefined): EdgeLabels | null {
  try {
    const canvas = viewport?.getCanvas?.();
    if (!canvas || !viewport?.canvasToWorld) return null;

    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (!width || !height) return null;

    const left = viewport.canvasToWorld([1, height / 2]);
    const right = viewport.canvasToWorld([width - 1, height / 2]);
    const top = viewport.canvasToWorld([width / 2, 1]);
    const bottom = viewport.canvasToWorld([width / 2, height - 1]);
    if (!left || !right || !top || !bottom) return null;

    const across: Vec3 = [right[0] - left[0], right[1] - left[1], right[2] - left[2]];
    const down: Vec3 = [bottom[0] - top[0], bottom[1] - top[1], bottom[2] - top[2]];
    if (!Number.isFinite(across[0]) || !Number.isFinite(down[0])) return null;
    if (Math.hypot(...across) < 1e-6 || Math.hypot(...down) < 1e-6) return null;

    const rightLabel = axisLabel(across);
    const bottomLabel = axisLabel(down);

    return {
      right: rightLabel,
      left: OPPOSITE[rightLabel],
      bottom: bottomLabel,
      top: OPPOSITE[bottomLabel],
    };
  } catch {
    return null;
  }
}
