/**
 * What the grey values in this particular volume actually mean.
 *
 * A CBCT unit is not a calibrated CT scanner. Its grey values drift between
 * machines, between fields of view and even across one image, and a unit that
 * writes RescaleType «HU» into the header is making a claim, not a
 * measurement. Fixed thresholds — «bone is 500, enamel is 1200» — therefore
 * read one scan correctly and the next one not at all: a window preset comes
 * out black, an automatic arch fit finds nothing, a lucency scan fires on
 * everything.
 *
 * So every threshold in this viewer is expressed in Hounsfield units and then
 * mapped into the volume's own scale through two landmarks measured from the
 * data itself: the air around the patient, which is −1000 HU by definition,
 * and soft tissue, which is close enough to water at 0 HU. Two points fix an
 * affine scale, and that is exactly what a grey-value scale is.
 */

export interface DensityLevels {
  /** Grey value of air in this volume. */
  air: number;
  /** Grey value of soft tissue in this volume. */
  soft: number;
  /** Grey values per Hounsfield unit. */
  perHu: number;
  /** Hounsfield value into this volume's grey scale. */
  fromHu: (hu: number) => number;
  /** This volume's grey scale back to Hounsfield, for display. */
  toHu: (value: number) => number;
  /**
   * Whether the numbers may honestly be printed as HU: the file has to claim
   * Hounsfield units *and* the measured landmarks have to agree.
   */
  calibrated: boolean;
  /** What to print after a density: «HU» or «усл. ед.». */
  unit: string;
  /** Why calibration was or was not accepted — shown in the study details. */
  note: string;
}

interface VolumeLike {
  dimensions: [number, number, number];
  read: (index: number) => number;
}

/** Roughly this many voxels are inspected, wherever the volume's size lands. */
const TARGET_SAMPLES = 250_000;
const BIN_COUNT = 512;

/** Air and soft tissue must be at least this far apart to be believable. */
const MIN_SEPARATION_HU_EQUIVALENT = 200;

/**
 * Picks a stride that visits the whole volume rather than one corner of it —
 * a prime-ish step so the samples do not land on the same column every slice.
 */
function sampleValues(volume: VolumeLike): Float64Array {
  const [nx, ny, nz] = volume.dimensions;
  const total = nx * ny * nz;
  const stride = Math.max(1, Math.floor(total / TARGET_SAMPLES) | 1);

  const count = Math.floor(total / stride);
  const values = new Float64Array(count);
  let at = 0;
  for (let index = 0; index < total && at < count; index += stride) {
    const value = volume.read(index);
    values[at++] = Number.isFinite(value) ? value : 0;
  }
  return at === count ? values : values.subarray(0, at);
}

interface Peak {
  value: number;
  weight: number;
}

/** Local maxima of a smoothed histogram, strongest first. */
function findPeaks(values: Float64Array, low: number, high: number): Peak[] {
  const span = high - low || 1;
  const bins = new Float64Array(BIN_COUNT);

  for (let n = 0; n < values.length; n++) {
    let bin = Math.floor(((values[n] - low) / span) * BIN_COUNT);
    if (bin < 0) bin = 0;
    if (bin >= BIN_COUNT) bin = BIN_COUNT - 1;
    bins[bin]++;
  }

  // Smooth, or every quantisation step of the scanner becomes a "peak".
  //
  // The divisor is the whole window even where it hangs off the end of the
  // histogram. Averaging over however many bins happen to be in range instead
  // inflates the edges, and the air peak of a CBCT sits *on* the bottom edge:
  // it made the first bin look like a slope rather than a summit, and the
  // largest peak in the volume went undetected.
  const smooth = new Float64Array(BIN_COUNT);
  const radius = 4;
  const window = radius * 2 + 1;
  for (let bin = 0; bin < BIN_COUNT; bin++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) {
      const at = bin + k;
      if (at < 0 || at >= BIN_COUNT) continue;
      sum += bins[at];
    }
    smooth[bin] = sum / window;
  }

  /** Centre of mass of the raw counts around a bin — the landmark itself. */
  const refine = (bin: number): number => {
    let weighted = 0;
    let total = 0;
    for (let k = -radius; k <= radius; k++) {
      const at = bin + k;
      if (at < 0 || at >= BIN_COUNT) continue;
      weighted += (at + 0.5) * bins[at];
      total += bins[at];
    }
    const centre = total > 0 ? weighted / total : bin + 0.5;
    return low + (centre / BIN_COUNT) * span;
  };

  const peaks: Peak[] = [];
  for (let bin = 0; bin < BIN_COUNT; bin++) {
    if (smooth[bin] <= 0) continue;
    const before = bin > 0 ? smooth[bin - 1] : -Infinity;
    const after = bin < BIN_COUNT - 1 ? smooth[bin + 1] : -Infinity;
    // The first and last bins count as summits too — see above.
    if (smooth[bin] >= before && smooth[bin] > after) {
      peaks.push({ value: refine(bin), weight: smooth[bin] });
    }
  }

  return peaks.sort((a, b) => b.weight - a.weight);
}

function percentile(sorted: Float64Array, fraction: number): number {
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[at];
}

/**
 * Measures the two landmarks and builds the mapping.
 *
 * `declaresHu` comes from the DICOM header (modality CT with RescaleType HU).
 * It is never trusted on its own — it only decides whether a volume whose
 * measured landmarks already sit at −1000 and 0 may print «HU».
 */
export function measureDensityLevels(volume: VolumeLike, declaresHu: boolean): DensityLevels {
  const values = sampleValues(volume);
  const sorted = Float64Array.from(values).sort();

  const low = percentile(sorted, 0.001);
  const high = percentile(sorted, 0.999);
  const peaks = findPeaks(values, low, high);

  // Air is the lowest strong peak — in a CBCT it is also the largest, since
  // the reconstruction cylinder is mostly air around the head.
  const strong = peaks.slice(0, 6).sort((a, b) => a.value - b.value);
  const airPeak = strong[0];

  // Soft tissue is the next strong peak above it. Bone and enamel peaks are
  // far smaller by voxel count, so «next strongest above air» finds tissue.
  const aboveAir = peaks
    .filter((peak) => airPeak && peak.value > airPeak.value + (high - low) * 0.05)
    .sort((a, b) => b.weight - a.weight);
  const softPeak = aboveAir[0];

  const fallback = (note: string): DensityLevels => build(-1000, 0, declaresHu, declaresHu ? 'HU' : 'усл. ед.', note);

  if (!airPeak || !softPeak) {
    return fallback('Гистограмма без выраженных пиков — шкала принята как есть.');
  }

  const air = airPeak.value;
  const soft = softPeak.value;
  const perHu = (soft - air) / 1000;

  if (!(perHu > 0) || soft - air < MIN_SEPARATION_HU_EQUIVALENT * 0.2) {
    return fallback('Воздух и мягкие ткани неразличимы — шкала принята как есть.');
  }

  // A genuinely calibrated CT lands within a hundred units of the definition.
  const looksHounsfield = Math.abs(air + 1000) < 120 && Math.abs(soft) < 120;
  const calibrated = declaresHu && looksHounsfield;

  const note = calibrated
    ? `Шкала в единицах Хаунсфилда: воздух ${air.toFixed(0)}, мягкие ткани ${soft.toFixed(0)}.`
    : `Шкала не калибрована: воздух ${air.toFixed(0)}, мягкие ткани ${soft.toFixed(0)} — ` +
      `пороги пересчитаны под этот снимок, значения показаны в условных единицах.`;

  return build(air, soft, calibrated, calibrated ? 'HU' : 'усл. ед.', note);
}

function build(
  air: number,
  soft: number,
  calibrated: boolean,
  unit: string,
  note: string
): DensityLevels {
  const perHu = (soft - air) / 1000;
  return {
    air,
    soft,
    perHu,
    calibrated,
    unit,
    note,
    fromHu: (hu: number) => air + (hu + 1000) * perHu,
    toHu: (value: number) => (value - air) / perHu - 1000,
  };
}

/** Levels for a volume that is already in Hounsfield units — tests, demo data. */
export const HOUNSFIELD_LEVELS: DensityLevels = build(-1000, 0, true, 'HU', 'Единицы Хаунсфилда.');

/** A window given in Hounsfield units, expressed in the volume's own scale. */
export function windowFromHu(
  levels: DensityLevels,
  centerHu: number,
  widthHu: number
): { center: number; width: number } {
  return {
    center: levels.fromHu(centerHu),
    width: Math.max(1, widthHu * levels.perHu),
  };
}

/**
 * Window straight from the volume's histogram, for scans whose landmarks are
 * unusual enough that even a rescaled preset lands badly.
 */
export function autoWindow(volume: VolumeLike): { center: number; width: number } {
  const sorted = Float64Array.from(sampleValues(volume)).sort();
  const lower = percentile(sorted, 0.4);
  const upper = percentile(sorted, 0.999);
  const width = Math.max(upper - lower, 1);
  return { center: lower + width / 2, width };
}
