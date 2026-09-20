import {
  renderPanorama,
  type CurveSample,
  type PanoramaImage,
  type VolumeSampler,
} from './panorama';
import { columnsGoLeft, heightToSlice, sliceToHeight } from './orientation';

/**
 * Per-tooth reformations — the pictures a tooth card is made of.
 *
 * Everything hangs off the dental arch already fitted for the panorama: a
 * tooth is a position along that arch plus which jaw it belongs to, and each
 * section is a plane placed relative to the arch at that position. Heights are
 * measured in millimetres from the superior end of the volume, matching the
 * panorama's rows.
 */

export type Jaw = 'upper' | 'lower';

export interface ToothMark {
  id: string;
  /** Distance along the arch from its start, millimetres. */
  arcMm: number;
  jaw: Jaw;
  /** FDI two-digit number, 11–48. */
  fdi: number;
  note: string;
}

export interface SectionImage {
  /** Hounsfield values, row-major. */
  data: Float32Array;
  width: number;
  height: number;
  /** Millimetres per pixel — equal on both axes. */
  scaleMm: number;
}

/* ------------------------------------------------------------ numbering */

/**
 * Average mesiodistal crown widths in millimetres, from the midline outward:
 * central incisor, lateral incisor, canine, two premolars, three molars.
 */
const WIDTHS: Record<Jaw, number[]> = {
  upper: [8.5, 6.5, 7.5, 7, 6.5, 10, 9, 8.5],
  lower: [5.3, 5.7, 7, 7, 7, 11, 10.5, 10],
};

const TOOTH_NAMES = [
  'центральный резец',
  'боковой резец',
  'клык',
  'первый премоляр',
  'второй премоляр',
  'первый моляр',
  'второй моляр',
  'третий моляр',
];

const QUADRANT_NAMES: Record<number, string> = {
  1: 'верхний правый',
  2: 'верхний левый',
  3: 'нижний левый',
  4: 'нижний правый',
};

/**
 * Guesses the FDI number from where the mark sits on the arch.
 *
 * The arch is fitted by walking columns from index zero upward, so the start
 * of the curve is whichever side of the patient the column axis begins on —
 * which is what `startsOnRight` carries, read from the acquisition geometry
 * rather than assumed. Teeth are then counted outward from the arch midpoint
 * by their average widths; the guess is only a starting point, the user
 * corrects it.
 */
export function guessFdi(
  arcMm: number,
  archLengthMm: number,
  jaw: Jaw,
  startsOnRight: boolean
): number {
  const fromMidline = arcMm - archLengthMm / 2;
  const right = startsOnRight ? fromMidline < 0 : fromMidline > 0;
  const quadrant = jaw === 'upper' ? (right ? 1 : 2) : right ? 4 : 3;

  const widths = WIDTHS[jaw];
  let cumulative = 0;
  let tooth = widths.length;
  for (let n = 0; n < widths.length; n++) {
    cumulative += widths[n];
    if (Math.abs(fromMidline) < cumulative) {
      tooth = n + 1;
      break;
    }
  }
  return quadrant * 10 + tooth;
}

export function fdiLabel(fdi: number): string {
  return `${Math.floor(fdi / 10)}.${fdi % 10}`;
}

export function toothName(fdi: number): string {
  const quadrant = Math.floor(fdi / 10);
  const tooth = fdi % 10;
  const name = TOOTH_NAMES[tooth - 1] ?? 'зуб';
  return `${QUADRANT_NAMES[quadrant] ?? ''} ${name}`.trim();
}

export function jawOf(fdi: number): Jaw {
  const quadrant = Math.floor(fdi / 10);
  return quadrant === 1 || quadrant === 2 ? 'upper' : 'lower';
}

/** Every permanent tooth, in the order a dentist reads a chart. */
export const ALL_FDI: number[] = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
  48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
];

/* -------------------------------------------------------------- sampling */

/** Trilinear read at a fractional voxel position; air outside the volume. */
export function createTrilinear(sampler: VolumeSampler): (x: number, y: number, z: number) => number {
  const [nx, ny, nz] = sampler.dimensions;
  const stride = nx * ny;
  const read = sampler.read;

  return (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x > nx - 1 || y > ny - 1 || z > nz - 1) return -1000;

    const x0 = Math.max(0, Math.min(Math.floor(x), nx - 2));
    const y0 = Math.max(0, Math.min(Math.floor(y), ny - 2));
    const z0 = Math.max(0, Math.min(Math.floor(z), nz - 2));
    const fx = x - x0;
    const fy = y - y0;
    const fz = z - z0;

    const base = z0 * stride + y0 * nx + x0;
    const c00 = read(base) * (1 - fx) + read(base + 1) * fx;
    const c10 = read(base + nx) * (1 - fx) + read(base + nx + 1) * fx;
    const c01 = read(base + stride) * (1 - fx) + read(base + stride + 1) * fx;
    const c11 = read(base + stride + nx) * (1 - fx) + read(base + stride + nx + 1) * fx;

    const c0 = c00 * (1 - fy) + c10 * fy;
    const c1 = c01 * (1 - fy) + c11 * fy;
    return c0 * (1 - fz) + c1 * fz;
  };
}

/**
 * Which way is out of the mouth at a point on the arch.
 *
 * The curve's normal has a fixed handedness, and which side of the arch it
 * lands on depends on the direction the curve was drawn in. Comparing it with
 * the direction away from the arch's centroid — which sits inside the U, on the
 * palate — settles it for any orientation.
 */
export function buccalSign(curve: CurveSample[], column: number, spacing: [number, number, number]): 1 | -1 {
  const [sx, sy] = spacing;
  let ci = 0;
  let cj = 0;
  for (const sample of curve) {
    ci += sample.i;
    cj += sample.j;
  }
  ci /= curve.length;
  cj /= curve.length;

  const at = curve[Math.max(0, Math.min(Math.round(column), curve.length - 1))];
  const dot = at.normalI * (at.i - ci) * sx + at.normalJ * (at.j - cj) * sy;
  return dot >= 0 ? 1 : -1;
}

/** Which end of the fitted arch belongs to the patient's right side. */
export function archStartsOnRight(sampler: VolumeSampler): boolean {
  return columnsGoLeft(sampler.orientation);
}

/** Height of the occlusal plane, millimetres from the superior end. */
export function occlusalHeightMm(sampler: VolumeSampler, archSlice: number): number {
  const [, , nz] = sampler.dimensions;
  return sliceToHeight(archSlice, nz, sampler.spacing[2], sampler.orientation);
}

/**
 * Height band a tooth card shows: from just past the occlusal plane down to
 * beyond the apices of the jaw in question.
 */
export function jawBandMm(
  sampler: VolumeSampler,
  archSlice: number,
  jaw: Jaw,
  rootDepthMm = 34,
  overlapMm = 6
): { fromMm: number; toMm: number } {
  const [, , nz] = sampler.dimensions;
  const occlusal = occlusalHeightMm(sampler, archSlice);
  const total = (nz - 1) * sampler.spacing[2];
  const from = jaw === 'upper' ? occlusal - rootDepthMm : occlusal - overlapMm;
  const to = jaw === 'upper' ? occlusal + overlapMm : occlusal + rootDepthMm;
  return { fromMm: Math.max(0, from), toMm: Math.min(total, to) };
}

export interface CrossSectionOptions {
  /** Extent across the arch, millimetres; buccal is on the right. */
  widthMm: number;
  fromMm: number;
  toMm: number;
  /** Averaged slab along the arch, millimetres. */
  slabMm: number;
  scaleMm: number;
}

/**
 * A slice perpendicular to the arch — the bucco-lingual view of one tooth.
 *
 * Horizontal axis runs across the arch with the buccal side on the right,
 * vertical axis is patient height. A thin slab along the arch is averaged so
 * a root a fraction of a millimetre off the plane does not vanish.
 */
export function renderCrossSection(
  sampler: VolumeSampler,
  curve: CurveSample[],
  column: number,
  options: CrossSectionOptions
): SectionImage {
  const [sx, sy, sz] = sampler.spacing;
  const [, , nz] = sampler.dimensions;
  const { widthMm, fromMm, toMm, slabMm, scaleMm } = options;
  const at = curve[Math.max(0, Math.min(Math.round(column), curve.length - 1))];
  const sign = buccalSign(curve, column, sampler.spacing);
  const sample = createTrilinear(sampler);

  const width = Math.max(1, Math.round(widthMm / scaleMm));
  const height = Math.max(1, Math.round((toMm - fromMm) / scaleMm));
  const data = new Float32Array(width * height);

  // Tangent is the normal turned a quarter, in millimetre space.
  const tangentI = at.normalJ;
  const tangentJ = -at.normalI;
  const slabCount = Math.max(1, Math.round(slabMm / 0.4) + 1);

  for (let row = 0; row < height; row++) {
    const zMm = fromMm + row * scaleMm;
    const z = heightToSlice(zMm, nz, sz, sampler.orientation);
    for (let col = 0; col < width; col++) {
      const u = (col - (width - 1) / 2) * scaleMm * sign;
      let sum = 0;
      for (let s = 0; s < slabCount; s++) {
        const v = slabCount === 1 ? 0 : -slabMm / 2 + (s * slabMm) / (slabCount - 1);
        const x = at.i + (at.normalI * u + tangentI * v) / sx;
        const y = at.j + (at.normalJ * u + tangentJ * v) / sy;
        sum += sample(x, y, z);
      }
      data[row * width + col] = sum / slabCount;
    }
  }

  return { data, width, height, scaleMm };
}

export interface AxialCropOptions {
  /** Square side, millimetres. */
  sizeMm: number;
  /** Height of the plane, millimetres from the superior end. */
  heightMm: number;
  scaleMm: number;
}

/** An axial square around the arch point, in the acquisition's own orientation. */
export function renderAxialCrop(
  sampler: VolumeSampler,
  curve: CurveSample[],
  column: number,
  options: AxialCropOptions
): SectionImage {
  const [sx, sy, sz] = sampler.spacing;
  const [, , nz] = sampler.dimensions;
  const { sizeMm, heightMm, scaleMm } = options;
  const at = curve[Math.max(0, Math.min(Math.round(column), curve.length - 1))];
  const sample = createTrilinear(sampler);

  const size = Math.max(1, Math.round(sizeMm / scaleMm));
  const data = new Float32Array(size * size);
  const z = heightToSlice(heightMm, nz, sz, sampler.orientation);

  for (let row = 0; row < size; row++) {
    const y = at.j + ((row - (size - 1) / 2) * scaleMm) / sy;
    for (let col = 0; col < size; col++) {
      const x = at.i + ((col - (size - 1) / 2) * scaleMm) / sx;
      data[row * size + col] = sample(x, y, z);
    }
  }

  return { data, width: size, height: size, scaleMm };
}

export interface TangentialOptions {
  /** Extent along the arch, millimetres. */
  widthMm: number;
  fromMm: number;
  toMm: number;
  /** Averaged slab across the arch, millimetres. */
  slabMm: number;
}

/**
 * A thin slab along the arch through the tooth — the mesio-distal view.
 * It is a short, thin panorama, so it is built as one and cropped.
 */
export function renderTangential(
  sampler: VolumeSampler,
  curve: CurveSample[],
  column: number,
  stepMm: number,
  options: TangentialOptions
): SectionImage {
  const half = Math.round(options.widthMm / 2 / stepMm);
  const centre = Math.max(0, Math.min(Math.round(column), curve.length - 1));
  const from = Math.max(0, centre - half);
  const to = Math.min(curve.length, centre + half + 1);
  const part = curve.slice(from, to);
  if (part.length < 2) {
    return { data: new Float32Array(1).fill(-1000), width: 1, height: 1, scaleMm: stepMm };
  }

  const full = renderPanorama(sampler, part, {
    thicknessMm: options.slabMm,
    blend: 'average',
    scaleMm: stepMm,
  });
  return cropRows(full, options.fromMm, options.toMm);
}

/** Cuts a height band out of a panorama-like image. */
export function cropRows(image: SectionImage | PanoramaImage, fromMm: number, toMm: number): SectionImage {
  const rowFrom = Math.max(0, Math.round(fromMm / image.scaleMm));
  const rowTo = Math.min(image.height, Math.round(toMm / image.scaleMm));
  const height = Math.max(1, rowTo - rowFrom);
  const data = image.data.slice(rowFrom * image.width, (rowFrom + height) * image.width);
  return { data, width: image.width, height, scaleMm: image.scaleMm };
}

/** Cuts a window out of a panorama around an arch position. */
export function cropPanorama(
  image: PanoramaImage,
  arcMm: number,
  widthMm: number,
  fromMm: number,
  toMm: number
): SectionImage {
  const band = cropRows(image, fromMm, toMm);
  const centre = Math.round(arcMm / image.scaleMm);
  const half = Math.round(widthMm / 2 / image.scaleMm);
  const colFrom = Math.max(0, centre - half);
  const colTo = Math.min(image.width, centre + half + 1);
  const width = Math.max(1, colTo - colFrom);

  const data = new Float32Array(width * band.height);
  for (let row = 0; row < band.height; row++) {
    data.set(band.data.subarray(row * band.width + colFrom, row * band.width + colFrom + width), row * width);
  }
  return { data, width, height: band.height, scaleMm: image.scaleMm };
}
