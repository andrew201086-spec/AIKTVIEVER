import { decodeHalfFloat } from './renderCapabilities';
import { heightToSlice, type VolumeOrientation } from './orientation';
import type { DensityLevels } from './density';

/**
 * Curved planar reformation — the panoramic view.
 *
 * A dental panorama is the volume unrolled along the dental arch: a curve is
 * laid over the arch in the axial plane, a slab of given thickness is taken
 * around it, and the slab is flattened. The horizontal axis of the result is
 * distance along the arch, the vertical axis is the patient's height.
 *
 * Everything here works in voxel index coordinates of the axial grid, which is
 * the acquisition grid for every CBCT this viewer opens.
 */

export interface ArchPoint {
  /** Column index in the axial plane. */
  i: number;
  /** Row index in the axial plane. */
  j: number;
}

export interface VolumeSampler {
  dimensions: [number, number, number];
  spacing: [number, number, number];
  /** Hounsfield value by flat voxel index, already decoded. */
  read: (index: number) => number;
  /**
   * Where the patient is in this grid. Required rather than assumed: a scan
   * stacked the other way indexes identically and would silently mirror every
   * side this viewer names.
   */
  orientation: VolumeOrientation;
  /**
   * What this volume's grey values mean. Thresholds below are written in
   * Hounsfield units and mapped through this, because a CBCT's scale is its
   * own.
   */
  levels: DensityLevels;
}

export type BlendMode = 'average' | 'max';

export interface PanoramaImage {
  /** Hounsfield values, row-major, top row is the superior end of the volume. */
  data: Float32Array;
  width: number;
  height: number;
  /** Millimetres per pixel — equal on both axes. */
  scaleMm: number;
  /** Length of the arch in millimetres. */
  archLengthMm: number;
}

/**
 * Reading a voxel has to survive the half-float storage Cornerstone leaves
 * behind, and it happens tens of millions of times per reconstruction — so the
 * conversion is a 65536-entry table rather than a function call.
 */
export function createValueReader(
  scalarData: ArrayLike<number>,
  halfFloat: boolean
): (index: number) => number {
  if (!halfFloat) return (index: number) => scalarData[index];

  const table = new Float32Array(65536);
  for (let bits = 0; bits < 65536; bits++) table[bits] = decodeHalfFloat(bits);
  return (index: number) => table[scalarData[index] & 0xffff];
}

/** Catmull-Rom through the control points, so the curve passes through each. */
function splinePoint(points: ArchPoint[], t: number): ArchPoint {
  const segments = points.length - 1;
  const scaled = Math.min(t * segments, segments - 1e-6);
  const index = Math.floor(scaled);
  const local = scaled - index;

  const p0 = points[Math.max(index - 1, 0)];
  const p1 = points[index];
  const p2 = points[Math.min(index + 1, points.length - 1)];
  const p3 = points[Math.min(index + 2, points.length - 1)];

  const t2 = local * local;
  const t3 = t2 * local;
  const blend = (a: number, b: number, c: number, d: number) =>
    0.5 * ((2 * b) + (-a + c) * local + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);

  return { i: blend(p0.i, p1.i, p2.i, p3.i), j: blend(p0.j, p1.j, p2.j, p3.j) };
}

export interface CurveSample {
  i: number;
  j: number;
  /** Unit normal in millimetre space, pointing to the buccal side. */
  normalI: number;
  normalJ: number;
}

/**
 * Walks the spline at a fixed step measured in millimetres, so the panorama
 * has no distortion where the arch curves sharply.
 */
export function buildCentreline(
  points: ArchPoint[],
  spacing: [number, number, number],
  stepMm: number
): CurveSample[] {
  const [sx, sy] = spacing;

  // Dense walk first: arc length has no closed form for a spline.
  const dense: ArchPoint[] = [];
  const denseCount = 2000;
  for (let n = 0; n <= denseCount; n++) dense.push(splinePoint(points, n / denseCount));

  const cumulative: number[] = [0];
  for (let n = 1; n < dense.length; n++) {
    const dx = (dense[n].i - dense[n - 1].i) * sx;
    const dy = (dense[n].j - dense[n - 1].j) * sy;
    cumulative.push(cumulative[n - 1] + Math.hypot(dx, dy));
  }

  const total = cumulative[cumulative.length - 1];
  const samples: CurveSample[] = [];
  let cursor = 0;

  for (let distance = 0; distance <= total; distance += stepMm) {
    while (cursor < cumulative.length - 2 && cumulative[cursor + 1] < distance) cursor++;

    const span = cumulative[cursor + 1] - cumulative[cursor] || 1;
    const fraction = (distance - cumulative[cursor]) / span;
    const a = dense[cursor];
    const b = dense[cursor + 1];

    const i = a.i + (b.i - a.i) * fraction;
    const j = a.j + (b.j - a.j) * fraction;

    // Tangent in millimetres, so anisotropic spacing does not skew the normal.
    const tx = (b.i - a.i) * sx;
    const ty = (b.j - a.j) * sy;
    const length = Math.hypot(tx, ty) || 1;

    samples.push({ i, j, normalI: -ty / length, normalJ: tx / length });
  }

  return samples;
}

/** The fitted arch, sampled — shared by the panorama, the sections and the scan. */
export interface ArchGeometry {
  /** Millimetres between consecutive samples of the curve. */
  stepMm: number;
  curve: CurveSample[];
}

/** Builds the geometry once, so nothing downstream re-derives it. */
export function buildArchGeometry(sampler: VolumeSampler, points: ArchPoint[]): ArchGeometry | null {
  if (points.length < 2) return null;
  const stepMm = Math.min(...sampler.spacing);
  return { stepMm, curve: buildCentreline(points, sampler.spacing, stepMm) };
}

export interface PanoramaOptions {
  thicknessMm: number;
  blend: BlendMode;
  /** Millimetres per pixel; defaults to the finest voxel spacing. */
  scaleMm?: number;
  /** Shifts the whole slab across the arch: + is buccal, − is lingual. */
  offsetMm?: number;
  /**
   * Extra slab thickness over the front of the arch.
   *
   * Incisors are inclined labially and sit on a thin alveolar ridge, so a slab
   * that keeps the molars crisp cuts straight through them. Widening it only
   * where the arch bends keeps both.
   */
  anteriorBoostMm?: number;
  /**
   * How far the arch moves across itself at each height, in millimetres,
   * indexed by output row.
   *
   * The dental arch is not a curve, it is a surface: roots lean lingually in
   * the mandible and buccally in the maxilla, so a curve fitted at the
   * occlusal plane misses the apices by several millimetres. Measuring where
   * the substance actually sits at each height and shifting the slab by that
   * much follows the anatomy without the cost of refitting the whole curve
   * per row.
   */
  heightOffsetsMm?: Float32Array;
}

/**
 * Flattens the slab around the curve into an image.
 *
 * The heavy part is bilinear sampling repeated for every slice, so the
 * in-plane weights are computed once per column and reused down the whole
 * height of the volume.
 */
export function renderPanorama(
  sampler: VolumeSampler,
  curve: CurveSample[],
  options: PanoramaOptions
): PanoramaImage {
  const [nx, ny, nz] = sampler.dimensions;
  const [sx, sy, sz] = sampler.spacing;

  // Sample at the finest spacing the volume actually has. Tying the output to
  // the slice spacing threw away in-plane detail on anisotropic scans, and
  // that detail is exactly what makes enamel edges and lamina dura readable.
  const scaleMm = options.scaleMm ?? Math.min(sx, sy, sz);

  const width = curve.length;
  const heightMm = (nz - 1) * sz;
  const height = Math.max(1, Math.round(heightMm / scaleMm) + 1);

  // One sample every ~0.4 mm across the slab: fine enough not to alias a
  // 1 mm slab, coarse enough that the count does not dominate the cost.
  const offsetStepMm = 0.4;
  const baseThickness = Math.max(options.thicknessMm, 0.1);
  const boost = Math.max(options.anteriorBoostMm ?? 0, 0);
  const shift = options.offsetMm ?? 0;
  const offsetCount = Math.max(1, Math.round((baseThickness + boost) / offsetStepMm) + 1);

  // The front of the arch is its middle by arc length: the fit runs from one
  // molar region to the other. Kept narrow so widening the incisor region does
  // not reach the premolars.
  const centre = (width - 1) / 2;
  const spread = Math.max(width * 0.12, 1);
  const thicknessAt = (column: number) =>
    baseThickness + boost * Math.exp(-(((column - centre) / spread) ** 2));

  const total = width * offsetCount;
  const baseOffset = new Int32Array(total);
  const weight00 = new Float32Array(total);
  const weight10 = new Float32Array(total);
  const weight01 = new Float32Array(total);
  const weight11 = new Float32Array(total);
  const valid = new Uint8Array(total);

  for (let column = 0; column < width; column++) {
    const { i, j, normalI, normalJ } = curve[column];
    const halfThickness = thicknessAt(column) / 2;

    for (let s = 0; s < offsetCount; s++) {
      const offsetMm =
        shift +
        (offsetCount === 1
          ? 0
          : -halfThickness + (s * (halfThickness * 2)) / (offsetCount - 1));
      // A millimetre along the normal is a different number of voxels per axis.
      const x = i + (normalI * offsetMm) / sx;
      const y = j + (normalJ * offsetMm) / sy;

      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const slot = column * offsetCount + s;

      if (x0 < 0 || y0 < 0 || x0 >= nx - 1 || y0 >= ny - 1) continue;

      const fx = x - x0;
      const fy = y - y0;
      baseOffset[slot] = y0 * nx + x0;
      weight00[slot] = (1 - fx) * (1 - fy);
      weight10[slot] = fx * (1 - fy);
      weight01[slot] = (1 - fx) * fy;
      weight11[slot] = fx * fy;
      valid[slot] = 1;
    }
  }

  // Weight across the slab, not a flat average.
  //
  // A box average makes every extra millimetre of thickness wash the picture
  // out equally. Falling off from the centre behaves like the focal trough of
  // a panoramic machine instead: what the curve runs through stays sharp,
  // while an inclined incisor a few millimetres off still shows up, faintly.
  const slabWeight = new Float32Array(offsetCount);
  for (let s = 0; s < offsetCount; s++) {
    const u = offsetCount === 1 ? 0 : -1 + (2 * s) / (offsetCount - 1);
    slabWeight[s] = Math.exp(-((u / 0.65) ** 2));
  }

  const data = new Float32Array(width * height);
  const read = sampler.read;
  const sliceStride = nx * ny;
  const useMax = options.blend === 'max';
  const heightOffsets = options.heightOffsetsMm;

  for (let row = 0; row < height; row++) {
    // Superior end of the volume belongs at the top of the picture, whichever
    // way round the slices were stacked.
    const sliceFloat = heightToSlice(row * scaleMm, nz, sz, sampler.orientation);
    let k0 = Math.floor(sliceFloat);
    let fz = sliceFloat - k0;
    if (k0 < 0) { k0 = 0; fz = 0; }
    if (k0 >= nz - 1) { k0 = nz - 1; fz = 0; }

    const base0 = k0 * sliceStride;
    const base1 = base0 + sliceStride;
    const interpolateZ = fz > 1e-3;
    const rowBase = row * width;
    // Millimetres this row's arch sits across from the fitted one.
    const rowShift = heightOffsets ? heightOffsets[Math.min(row, heightOffsets.length - 1)] : 0;
    const shifted = Math.abs(rowShift) > 1e-3;

    for (let column = 0; column < width; column++) {
      let accumulator = useMax ? -Infinity : 0;
      let weightSum = 0;
      let counted = 0;

      // A shifted row cannot reuse the precomputed weights, so its samples
      // are placed from scratch — only for rows that actually move.
      const curveAt = shifted ? curve[column] : null;

      for (let s = 0; s < offsetCount; s++) {
        const slot = column * offsetCount + s;
        if (!valid[slot] && !shifted) continue;

        let at: number;
        let w00: number;
        let w10: number;
        let w01: number;
        let w11: number;

        if (shifted && curveAt) {
          const halfThickness = thicknessAt(column) / 2;
          const offsetMm =
            shift +
            rowShift +
            (offsetCount === 1 ? 0 : -halfThickness + (s * (halfThickness * 2)) / (offsetCount - 1));
          const x = curveAt.i + (curveAt.normalI * offsetMm) / sx;
          const y = curveAt.j + (curveAt.normalJ * offsetMm) / sy;
          const x0 = Math.floor(x);
          const y0 = Math.floor(y);
          if (x0 < 0 || y0 < 0 || x0 >= nx - 1 || y0 >= ny - 1) continue;
          const fx = x - x0;
          const fy = y - y0;
          at = base0 + y0 * nx + x0;
          w00 = (1 - fx) * (1 - fy);
          w10 = fx * (1 - fy);
          w01 = (1 - fx) * fy;
          w11 = fx * fy;
        } else {
          at = base0 + baseOffset[slot];
          w00 = weight00[slot];
          w10 = weight10[slot];
          w01 = weight01[slot];
          w11 = weight11[slot];
        }

        let value =
          w00 * read(at) + w10 * read(at + 1) + w01 * read(at + nx) + w11 * read(at + nx + 1);

        if (interpolateZ) {
          const above = at - base0 + base1;
          const upper =
            w00 * read(above) +
            w10 * read(above + 1) +
            w01 * read(above + nx) +
            w11 * read(above + nx + 1);
          value = value * (1 - fz) + upper * fz;
        }

        if (useMax) {
          if (value > accumulator) accumulator = value;
        } else {
          accumulator += value * slabWeight[s];
          weightSum += slabWeight[s];
        }
        counted++;
      }

      data[rowBase + column] =
        counted === 0 ? -1000 : useMax ? accumulator : accumulator / (weightSum || 1);
    }
  }

  return {
    data,
    width,
    height,
    scaleMm,
    archLengthMm: (width - 1) * scaleMm,
  };
}

/**
 * Unsharp mask.
 *
 * A slab reformation is inherently softer than a panoramic film, which is
 * edge-enhanced in the machine itself. Subtracting a blurred copy restores the
 * bite on enamel margins, the lamina dura and the periodontal ligament space —
 * the detail this picture is read for.
 */
export function sharpenImage(image: PanoramaImage, amount: number): PanoramaImage {
  if (amount <= 0) return image;

  const { width, height, data } = image;
  const blurred = new Float32Array(width * height);

  // Separable 1-4-6-4-1 blur, wide enough that the enhancement reaches
  // structures a few tenths of a millimetre across.
  const kernel = [1, 4, 6, 4, 1];
  const kernelSum = 16;
  const horizontal = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) {
        const xk = Math.min(Math.max(x + k, 0), width - 1);
        sum += data[row + xk] * kernel[k + 2];
      }
      horizontal[row + x] = sum / kernelSum;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -2; k <= 2; k++) {
        const yk = Math.min(Math.max(y + k, 0), height - 1);
        sum += horizontal[yk * width + x] * kernel[k + 2];
      }
      blurred[y * width + x] = sum / kernelSum;
    }
  }

  const sharpened = new Float32Array(width * height);
  for (let n = 0; n < data.length; n++) {
    sharpened[n] = data[n] + amount * (data[n] - blurred[n]);
  }

  return { ...image, data: sharpened };
}

/** Density that only teeth and cortical plate reach. */
export const TEETH_HU = 1200;
/** Density of trabecular bone and above. */
export const BONE_HU = 500;

function countAbove(sampler: VolumeSampler, sliceIndex: number, threshold: number, step: number): number {
  const [nx, ny] = sampler.dimensions;
  const base = sliceIndex * nx * ny;
  let count = 0;
  for (let y = 0; y < ny; y += step) {
    const rowBase = base + y * nx;
    for (let x = 0; x < nx; x += step) {
      if (sampler.read(rowBase + x) > threshold) count++;
    }
  }
  return count;
}

/**
 * Picks the axial slice to fit the arch on: the one carrying the most tooth
 * substance, which is the occlusal plane. Fitting on a slice lower in the
 * mandible drags the curve lingual of the incisors, and they fall out of the
 * slab — bone is a poor proxy for where the teeth actually stand.
 */
export function findArchSlice(sampler: VolumeSampler): number {
  const [nx, , nz] = sampler.dimensions;
  const sliceStep = Math.max(1, Math.round(nz / 60));
  const pixelStep = Math.max(1, Math.round(nx / 120));

  for (const hu of [TEETH_HU, BONE_HU]) {
    const threshold = sampler.levels.fromHu(hu);
    let best = -1;
    let bestCount = 0;
    for (let k = 0; k < nz; k += sliceStep) {
      const count = countAbove(sampler, k, threshold, pixelStep);
      if (count > bestCount) {
        bestCount = count;
        best = k;
      }
    }
    // A handful of voxels is noise, not an occlusal plane.
    if (best >= 0 && bestCount > 40) return best;
  }

  return Math.floor(nz / 2);
}

/**
 * Proposes an arch by following the teeth across one axial slice.
 *
 * For every column the centre of the tooth substance is taken, weighted by
 * density so enamel pulls harder than trabecular bone. The resulting track is
 * smoothed and sampled into control points, which follows a real arch —
 * including how it flattens at the front — better than the parabola it falls
 * back to when there is too little to measure.
 */
export function autoFitArch(sampler: VolumeSampler, sliceIndex: number, pointCount = 7): ArchPoint[] {
  const [nx, ny, nz] = sampler.dimensions;
  const read = sampler.read;
  const base = Math.min(Math.max(sliceIndex, 0), nz - 1) * nx * ny;
  const step = Math.max(1, Math.round(nx / 200));

  const measure = (threshold: number) => {
    const found: Array<{ i: number; j: number }> = [];
    for (let x = 0; x < nx; x += step) {
      let weighted = 0;
      let weight = 0;
      for (let y = 0; y < ny; y++) {
        const value = read(base + y * nx + x);
        if (value > threshold) {
          const w = value - threshold;
          weighted += y * w;
          weight += w;
        }
      }
      if (weight > 0) found.push({ i: x, j: weighted / weight });
    }
    return found;
  };

  let columns = measure(sampler.levels.fromHu(TEETH_HU));
  if (columns.length < 8) columns = measure(sampler.levels.fromHu(BONE_HU));
  if (columns.length < 8) return defaultArch(nx, ny);

  columns = longestRun(columns, step * 3);
  if (columns.length < 8) return defaultArch(nx, ny);

  // Smooth away the jump between neighbouring teeth without losing the shape
  // of the arch itself.
  const window = Math.max(2, Math.round(columns.length * 0.12));
  const smooth = columns.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let k = -window; k <= window; k++) {
      const at = index + k;
      if (at < 0 || at >= columns.length) continue;
      sum += columns[at].j;
      count++;
    }
    return { i: columns[index].i, j: sum / count };
  });

  const points: ArchPoint[] = [];
  for (let n = 0; n < pointCount; n++) {
    const at = Math.round(((smooth.length - 1) * n) / (pointCount - 1));
    points.push({ i: smooth[at].i, j: Math.min(Math.max(smooth[at].j, 0), ny - 1) });
  }
  return points;
}

/** Drops outlying clusters — metal artefacts and the cervical spine. */
function longestRun(
  columns: Array<{ i: number; j: number }>,
  maxGap: number
): Array<{ i: number; j: number }> {
  let bestStart = 0;
  let bestLength = 0;
  let start = 0;

  for (let index = 1; index <= columns.length; index++) {
    const broken = index === columns.length || columns[index].i - columns[index - 1].i > maxGap;
    if (!broken) continue;
    if (index - start > bestLength) {
      bestLength = index - start;
      bestStart = start;
    }
    start = index;
  }

  return columns.slice(bestStart, bestStart + bestLength);
}

/** A plausible arch when the fit has nothing to work with. */
function defaultArch(nx: number, ny: number): ArchPoint[] {
  const points: ArchPoint[] = [];
  const width = nx * 0.62;
  for (let n = 0; n < 5; n++) {
    const u = -1 + (2 * n) / 4;
    points.push({
      i: nx / 2 + (u * width) / 2,
      j: ny / 2 + (0.34 * u * u - 0.2) * ny,
    });
  }
  return points;
}

/** Paints Hounsfield values into an RGBA image through a window. */
export function toImageData(
  image: { data: Float32Array; width: number; height: number },
  windowCenter: number,
  windowWidth: number
): ImageData {
  const lower = windowCenter - windowWidth / 2;
  const range = windowWidth || 1;
  const pixels = new Uint8ClampedArray(image.width * image.height * 4);

  for (let n = 0; n < image.data.length; n++) {
    let level = ((image.data[n] - lower) / range) * 255;
    level = level < 0 ? 0 : level > 255 ? 255 : level;
    const at = n * 4;
    pixels[at] = level;
    pixels[at + 1] = level;
    pixels[at + 2] = level;
    pixels[at + 3] = 255;
  }

  return new ImageData(pixels, image.width, image.height);
}

/**
 * Where the arch actually sits at each height.
 *
 * The fitted curve describes the occlusal plane. Above and below it the
 * substance drifts across the curve — lingually for mandibular roots,
 * buccally for maxillary ones — by up to several millimetres, which is enough
 * to put an apex outside the slab. This measures that drift: at each height,
 * the centre of mass of tooth and bone along the normal, averaged over the
 * arch, relative to the curve.
 *
 * The result is one shift per output row, ready for `heightOffsetsMm`.
 */
export function archOffsetProfile(
  sampler: VolumeSampler,
  curve: CurveSample[],
  scaleMm: number,
  searchMm = 9
): Float32Array {
  const [nx, ny, nz] = sampler.dimensions;
  const [sx, sy, sz] = sampler.spacing;
  const read = sampler.read;
  const sliceStride = nx * ny;

  const rows = Math.max(1, Math.round(((nz - 1) * sz) / scaleMm) + 1);
  const raw = new Float32Array(rows);

  const bone = sampler.levels.fromHu(BONE_HU);
  // Every few columns is enough for an average, and keeps this to a fraction
  // of a second on a full study.
  const columnStep = Math.max(1, Math.round(curve.length / 60));
  const offsetStep = 0.5;

  for (let row = 0; row < rows; row++) {
    const sliceFloat = heightToSlice(row * scaleMm, nz, sz, sampler.orientation);
    const slice = Math.round(sliceFloat);
    if (slice < 0 || slice >= nz) continue;
    const base = slice * sliceStride;

    let weighted = 0;
    let weight = 0;

    for (let column = 0; column < curve.length; column += columnStep) {
      const point = curve[column];
      for (let offset = -searchMm; offset <= searchMm; offset += offsetStep) {
        const x = Math.round(point.i + (point.normalI * offset) / sx);
        const y = Math.round(point.j + (point.normalJ * offset) / sy);
        if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
        const value = read(base + y * nx + x);
        if (value <= bone) continue;
        const above = value - bone;
        weighted += offset * above;
        weight += above;
      }
    }

    raw[row] = weight > 0 ? weighted / weight : NaN;
  }

  // Rows with nothing in them (above the head, below the chin) inherit the
  // nearest measured shift, and the whole profile is smoothed: the arch bends
  // gradually, and a jump between neighbouring rows would tear the picture.
  let lastKnown = 0;
  for (let row = 0; row < rows; row++) {
    if (Number.isNaN(raw[row])) raw[row] = lastKnown;
    else lastKnown = raw[row];
  }

  const smoothed = new Float32Array(rows);
  const radius = Math.max(1, Math.round(3 / scaleMm));
  for (let row = 0; row < rows; row++) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      const at = row + k;
      if (at < 0 || at >= rows) continue;
      sum += raw[at];
      count++;
    }
    smoothed[row] = sum / count;
  }

  return smoothed;
}

/** Column of the centreline nearest a point in the axial plane. */
export function nearestColumn(
  curve: CurveSample[],
  i: number,
  j: number,
  spacing: [number, number, number]
): number {
  const [sx, sy] = spacing;
  let best = 0;
  let bestDistance = Infinity;
  for (let column = 0; column < curve.length; column++) {
    const dx = (curve[column].i - i) * sx;
    const dy = (curve[column].j - j) * sy;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = column;
    }
  }
  return best;
}
