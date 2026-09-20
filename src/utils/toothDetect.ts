import { createTrilinear, occlusalHeightMm, type Jaw } from './toothSections';
import { heightToSlice } from './orientation';
import type { CurveSample, VolumeSampler } from './panorama';

/**
 * Finding the teeth themselves, instead of assuming where they ought to be.
 *
 * Counting average crown widths outward from the midline is right only on a
 * complete dentition: one missing tooth and everything distal to it is
 * numbered one place off, which is a wrong tooth in a report. So the crowns
 * are measured instead. Along the arch, at crown height, tooth substance is a
 * run of high density and an interdental gap is a trough between two runs —
 * a one-dimensional profile in which teeth are the peaks.
 *
 * This is still a measurement, not a diagnosis: fused contacts read as one
 * wide tooth, a metal crown blooms, a retained root reads as present. The
 * numbering it produces is a starting point the user can correct, and every
 * tooth it reports carries the evidence it was found by.
 */

/** Enamel and dentine; trabecular bone never reaches this. */
const CROWN_HU = 1100;
/** Crown band: this far from the occlusal plane, towards the crown tips. */
const CROWN_NEAR_MM = 1.5;
const CROWN_FAR_MM = 7;
/**
 * Sampling across the arch when measuring how much tooth is at a position.
 *
 * Narrow on purpose. Taking the brightest voxel over a wide band closes every
 * interdental gap: the arch curves, so a band reaching several millimetres
 * lingually compresses neighbouring crowns into each other and the profile
 * comes out as one unbroken plateau of enamel.
 */
const ACROSS_MM = 2.5;
const ACROSS_STEP_MM = 0.5;
const ALONG_MM = 0.6;

/** Average mesiodistal crown widths, central incisor outward. */
const WIDTHS: Record<Jaw, number[]> = {
  upper: [8.5, 6.5, 7.5, 7, 6.5, 10, 9, 8.5],
  lower: [5.3, 5.7, 7, 7, 7, 11, 10.5, 10],
};

export interface DetectedTooth {
  fdi: number;
  /** Centre of the crown along the arch, millimetres. */
  arcMm: number;
  fromMm: number;
  toMm: number;
  widthMm: number;
  /** Highest density found in this crown — a proxy for how solid it is. */
  peak: number;
  /**
   * Two teeth that touch read as one run. When a run is wide enough to hold
   * more than one crown it is split, and the pieces are flagged.
   */
  fused: boolean;
}

export interface ToothMap {
  jaw: Jaw;
  teeth: DetectedTooth[];
  /** Positions where a crown was expected and the profile was empty. */
  missing: number[];
  /** Distance along the arch of the dental midline. */
  midlineMm: number;
  /** The measured profile, for drawing under the chart. */
  profile: Float32Array;
  profileStepMm: number;
  /** Density that separated crown from gap. */
  threshold: number;
}

/**
 * Where the front of the arch is: the point furthest from the straight line
 * between the two ends of the curve.
 *
 * More reliable than the halfway point by arc length, which lands off-centre
 * whenever the fit reaches further back on one side than the other.
 */
export function archMidlineMm(curve: CurveSample[], stepMm: number, spacing: [number, number, number]): number {
  if (curve.length < 3) return ((curve.length - 1) * stepMm) / 2;

  const [sx, sy] = spacing;
  const first = curve[0];
  const last = curve[curve.length - 1];
  const chordX = (last.i - first.i) * sx;
  const chordY = (last.j - first.j) * sy;
  const chordLength = Math.hypot(chordX, chordY) || 1;

  let bestIndex = Math.floor(curve.length / 2);
  let bestDistance = -Infinity;

  for (let index = 0; index < curve.length; index++) {
    const dx = (curve[index].i - first.i) * sx;
    const dy = (curve[index].j - first.j) * sy;
    // Perpendicular distance from the chord.
    const distance = Math.abs(dx * chordY - dy * chordX) / chordLength;
    if (distance > bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex * stepMm;
}

/** How much tooth substance stands at each position along the arch. */
function crownProfile(
  sampler: VolumeSampler,
  curve: CurveSample[],
  curveStepMm: number,
  archSlice: number,
  jaw: Jaw
): Float32Array {
  const sample = createTrilinear(sampler);
  const [sx, sy, sz] = sampler.spacing;
  const [, , nz] = sampler.dimensions;
  const occlusal = occlusalHeightMm(sampler, archSlice);
  const totalMm = (nz - 1) * sz;
  // Crowns stand away from the occlusal plane towards their own jaw.
  const direction = jaw === 'upper' ? -1 : 1;

  const profile = new Float32Array(curve.length);

  for (let column = 0; column < curve.length; column++) {
    const point = curve[column];
    const tangentI = point.normalJ;
    const tangentJ = -point.normalI;
    let peak = -Infinity;

    for (let depth = CROWN_NEAR_MM; depth <= CROWN_FAR_MM; depth += 1) {
      const height = occlusal + direction * depth;
      if (height < 0 || height > totalMm) continue;
      const z = heightToSlice(height, nz, sz, sampler.orientation);

      for (let u = -ACROSS_MM; u <= ACROSS_MM; u += ACROSS_STEP_MM) {
        for (let v = -ALONG_MM; v <= ALONG_MM; v += ALONG_MM) {
          const x = point.i + (point.normalI * u + tangentI * v) / sx;
          const y = point.j + (point.normalJ * u + tangentJ * v) / sy;
          const value = sample(x, y, z);
          if (value > peak) peak = value;
        }
      }
    }

    profile[column] = peak === -Infinity ? -1000 : peak;
  }

  // A light smooth: a fissure or a restoration edge is not an interdental gap.
  const smoothed = new Float32Array(profile.length);
  const radius = Math.max(1, Math.round(0.4 / curveStepMm));
  for (let index = 0; index < profile.length; index++) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k++) {
      const at = index + k;
      if (at < 0 || at >= profile.length) continue;
      sum += profile[at];
      count++;
    }
    smoothed[index] = sum / count;
  }
  return smoothed;
}

interface Run {
  from: number;
  to: number;
  peak: number;
}

/** Contiguous stretches of the profile that are above the crown threshold. */
function findRuns(profile: Float32Array, threshold: number, minColumns: number): Run[] {
  const runs: Run[] = [];
  let start = -1;
  let peak = -Infinity;

  for (let index = 0; index <= profile.length; index++) {
    const above = index < profile.length && profile[index] >= threshold;
    if (above) {
      if (start < 0) {
        start = index;
        peak = -Infinity;
      }
      if (profile[index] > peak) peak = profile[index];
    } else if (start >= 0) {
      if (index - start >= minColumns) runs.push({ from: start, to: index - 1, peak });
      start = -1;
    }
  }

  return runs;
}

/**
 * Reads the dentition of one jaw off the arch.
 *
 * `curveStepMm` is the step the centreline was built with, so a column index
 * and a distance along the arch are the same measurement.
 */
export function detectTeeth(
  sampler: VolumeSampler,
  curve: CurveSample[],
  curveStepMm: number,
  archSlice: number,
  jaw: Jaw
): ToothMap {
  const profile = crownProfile(sampler, curve, curveStepMm, archSlice, jaw);
  const threshold = sampler.levels.fromHu(CROWN_HU);
  const midlineMm = archMidlineMm(curve, curveStepMm, sampler.spacing);

  // A crown narrower than three millimetres is a fragment, not a tooth.
  const minColumns = Math.max(1, Math.round(3 / curveStepMm));
  const midlineColumn = midlineMm / curveStepMm;

  // The two central incisors meet at the midline and usually read as one run.
  // Left whole, that run belongs to neither side and every tooth behind it is
  // numbered from the wrong end — so it is cut at the midline first.
  const runs: Run[] = [];
  for (const run of findRuns(profile, threshold, minColumns)) {
    if (run.from < midlineColumn - 1 && run.to > midlineColumn + 1) {
      const left = { from: run.from, to: Math.floor(midlineColumn), peak: run.peak };
      const right = { from: Math.ceil(midlineColumn), to: run.to, peak: run.peak };
      if (left.to - left.from >= minColumns) runs.push(left);
      if (right.to - right.from >= minColumns) runs.push(right);
    } else {
      runs.push(run);
    }
  }

  const widths = WIDTHS[jaw];
  const teeth: DetectedTooth[] = [];
  const missing: number[] = [];

  // Each side of the midline is numbered independently, outward from it.
  for (const side of ['start', 'end'] as const) {
    const onThisSide = runs.filter((run) => {
      const centre = ((run.from + run.to) / 2) * curveStepMm;
      return side === 'start' ? centre < midlineMm : centre >= midlineMm;
    });

    // Nearest the midline first.
    onThisSide.sort((a, b) => {
      const centreA = Math.abs(((a.from + a.to) / 2) * curveStepMm - midlineMm);
      const centreB = Math.abs(((b.from + b.to) / 2) * curveStepMm - midlineMm);
      return centreA - centreB;
    });

    const quadrant = quadrantFor(jaw, side, sampler);
    // Distances are measured outward from the midline, so both sides are
    // counted by the same arithmetic and only the geometry differs.
    const outward = side === 'start' ? -1 : 1;
    let position = 1;
    let covered = 0;

    for (const run of onThisSide) {
      if (position > 8) break;

      const fromMm = run.from * curveStepMm;
      const toMm = (run.to + 1) * curveStepMm;
      const widthMm = toMm - fromMm;
      // The edge of this run facing the midline, and the one facing away.
      const nearEdge = side === 'start' ? toMm : fromMm;
      const near = Math.abs(nearEdge - midlineMm);

      // Ground already covered by earlier runs and by gaps: whatever is left
      // between there and this run is wide enough to have held a crown.
      while (position <= 8 && near - covered > widths[position - 1] * 0.7) {
        missing.push(quadrant * 10 + position);
        covered += widths[position - 1];
        position++;
      }
      if (position > 8) break;

      // Crowns in contact read as one run. It is divided by consuming the
      // expected width of each position in turn — dividing by a single
      // average would misplace every tooth after the first.
      let remaining = widthMm;
      let cursor = 0;
      let pieces = 0;

      while (position <= 8 && remaining > widths[position - 1] * 0.55) {
        const width = Math.min(widths[position - 1], remaining);
        const centre = nearEdge + outward * (cursor + width / 2);
        teeth.push({
          fdi: quadrant * 10 + position,
          arcMm: centre,
          fromMm: Math.min(centre - width / 2, centre + width / 2),
          toMm: Math.max(centre - width / 2, centre + width / 2),
          widthMm: width,
          peak: run.peak,
          fused: false,
        });
        cursor += width;
        remaining -= width;
        position++;
        pieces++;
      }

      // A run that held more than one crown had them in contact.
      if (pieces > 1) {
        for (let n = teeth.length - pieces; n < teeth.length; n++) teeth[n].fused = true;
      }

      covered = near + widthMm;
    }
  }

  teeth.sort((a, b) => a.arcMm - b.arcMm);
  return { jaw, teeth, missing: missing.sort((a, b) => a - b), midlineMm, profile, profileStepMm: curveStepMm, threshold };
}

/** Which quadrant a side of the arch belongs to, given where the patient is. */
function quadrantFor(jaw: Jaw, side: 'start' | 'end', sampler: VolumeSampler): number {
  // The curve is walked from the lowest column index; whether that end is the
  // patient's right depends on the acquisition, never on the index.
  const startIsRight = sampler.orientation.i[0] >= 0;
  const isRight = side === 'start' ? startIsRight : !startIsRight;
  if (jaw === 'upper') return isRight ? 1 : 2;
  return isRight ? 4 : 3;
}

/** Both jaws at once, as the chart needs them. */
export function detectDentition(
  sampler: VolumeSampler,
  curve: CurveSample[],
  curveStepMm: number,
  archSlice: number
): { upper: ToothMap; lower: ToothMap } {
  return {
    upper: detectTeeth(sampler, curve, curveStepMm, archSlice, 'upper'),
    lower: detectTeeth(sampler, curve, curveStepMm, archSlice, 'lower'),
  };
}
