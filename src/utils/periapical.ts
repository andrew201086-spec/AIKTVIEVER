import type { CurveSample, VolumeSampler } from './panorama';
import { heightToSlice } from './orientation';
import { createTrilinear, occlusalHeightMm, type Jaw } from './toothSections';

/**
 * A hint, not a diagnosis.
 *
 * A periapical lesion reads on CBCT as a rounded area around the apex that is
 * darker than the trabecular bone it sits in. This walks the arch, finds where
 * each root ends, and measures how much of the bone just beyond that apex is
 * darker than the bone around it. What comes out is a list of places worth
 * opening a tooth card on — nothing here decides anything, and marrow spaces,
 * the mandibular canal, the incisive canal and the sinus floor all look the
 * same to a rule this simple.
 *
 * Heights are millimetres from the superior end of the volume, matching the
 * panorama and the tooth cards.
 */

/**
 * Every threshold here is a Hounsfield value, mapped into the volume's own
 * grey scale before use — a CBCT's numbers are its own (see density.ts).
 */

/** Density a root reaches and trabecular bone does not. */
const ROOT_HU = 900;
/** Trabecular bone and above. */
const BONE_HU = 500;
/** Below this is air: sinus, airway, outside the head. */
const AIR_HU = -300;

/** How much darker than the surrounding bone counts as lucent. */
const CONTRAST_HU = 250;
/** Smallest lucency worth reporting, cubic millimetres — a sphere of ~2.3 mm. */
const MIN_VOLUME_MM3 = 6;

/** Sampling grid inside the apical box, millimetres. */
const CELL_MM = 0.5;
const CELL_VOLUME = CELL_MM ** 3;

export interface LesionCandidate {
  id: string;
  /** Distance along the arch, millimetres. */
  arcMm: number;
  jaw: Jaw;
  /** Height of the root apex. */
  apexMm: number;
  /** Height of the centre of the lucency. */
  centreMm: number;
  /** Volume of the lucency, cubic millimetres. */
  volumeMm3: number;
  /** How much darker than the surrounding bone, in density units. */
  contrast: number;
  /** 0…1, for ranking and for how loud the marker is drawn. */
  score: number;
}

interface ColumnFinding extends Omit<LesionCandidate, 'id'> {
  column: number;
}

export interface ScanOptions {
  /** Spacing of the scan along the arch, millimetres. */
  arcStepMm?: number;
  /** How far past the apex to look, millimetres. */
  beyondApexMm?: number;
}

/**
 * Walks the arch and returns the apical lucencies worth a look, strongest
 * first. `curveStepMm` is the step the centreline was built with — it is what
 * turns a column index into a distance along the arch.
 */
export function scanApicalLucencies(
  sampler: VolumeSampler,
  curve: CurveSample[],
  curveStepMm: number,
  archSlice: number,
  options: ScanOptions = {}
): LesionCandidate[] {
  const sample = createTrilinear(sampler);
  const [sx, sy, sz] = sampler.spacing;
  const [, , nz] = sampler.dimensions;
  const totalMm = (nz - 1) * sz;
  const occlusal = occlusalHeightMm(sampler, archSlice);
  const beyondApex = options.beyondApexMm ?? 7;

  // Thresholds in this volume's own grey values.
  const levels = sampler.levels;
  const rootLevel = levels.fromHu(ROOT_HU);
  const boneLevel = levels.fromHu(BONE_HU);
  const airLevel = levels.fromHu(AIR_HU);
  const contrast = CONTRAST_HU * levels.perHu;
  const minReference = levels.fromHu(-850);

  const arcStep = options.arcStepMm ?? 1;
  const columnStep = Math.max(1, Math.round(arcStep / curveStepMm));
  // The very ends of a fitted arch wander off the last molar.
  const margin = Math.round(4 / curveStepMm);

  /** Density at a point given as offsets from the arch, in millimetres. */
  const at = (column: number, u: number, v: number, heightMm: number): number => {
    const point = curve[column];
    const tangentI = point.normalJ;
    const tangentJ = -point.normalI;
    const x = point.i + (point.normalI * u + tangentI * v) / sx;
    const y = point.j + (point.normalJ * u + tangentJ * v) / sy;
    return sample(x, y, heightToSlice(heightMm, nz, sz, sampler.orientation));
  };

  const findings: ColumnFinding[] = [];

  for (let column = margin; column < curve.length - margin; column += columnStep) {
    for (const jaw of ['upper', 'lower'] as Jaw[]) {
      // Roots run superiorly in the maxilla, inferiorly in the mandible.
      const direction = jaw === 'upper' ? -1 : 1;
      const finding = examine(column, jaw, direction);
      if (finding) findings.push(finding);
    }
  }

  return cluster(findings, curveStepMm);

  function examine(column: number, jaw: Jaw, direction: number): ColumnFinding | null {
    // 1. Follow the root away from the occlusal plane until it ends.
    let apexDepth = 0;
    for (let depth = 2; depth <= 28; depth += 0.5) {
      const height = occlusal + direction * depth;
      if (height < 0 || height > totalMm) break;

      let peak = -Infinity;
      for (let u = -3; u <= 3; u += 1) {
        for (let v = -2; v <= 2; v += 1) {
          const value = at(column, u, v, height);
          if (value > peak) peak = value;
        }
      }

      if (peak > rootLevel) apexDepth = depth;
      // Two millimetres of nothing means the root really has ended.
      else if (apexDepth > 0 && depth - apexDepth > 2) break;
    }

    // A crown fragment or a filling is not a root.
    if (apexDepth < 5) return null;

    const apexMm = occlusal + direction * apexDepth;
    const fromMm = apexMm - direction * 1.5;
    const toMm = apexMm + direction * beyondApex;
    if (Math.min(fromMm, toMm) < 0 || Math.max(fromMm, toMm) > totalMm) return null;

    const heights: number[] = [];
    for (let n = 0; n * CELL_MM <= beyondApex + 1.5; n++) {
      heights.push(fromMm + direction * n * CELL_MM);
    }

    // 2. What the bone around this apex normally looks like.
    const ring: number[] = [];
    for (const height of heights) {
      for (const u of [-8, -7, -6, 6, 7, 8]) {
        for (let v = -2; v <= 2; v += 1) ring.push(at(column, u, v, height));
      }
    }

    const bone = ring.filter((value) => value > airLevel && value < rootLevel);
    // Mostly air or teeth around means we are not inside the alveolar process.
    if (bone.length < ring.length * 0.35) return null;
    const solid = ring.filter((value) => value > boneLevel).length;
    if (solid < ring.length * 0.2) return null;

    const reference = median(bone);
    // Marrow-only or fat: not the alveolar bone a lesion would stand out from.
    if (reference < minReference) return null;

    // 3. How much of the apical box is darker than that.
    const lucentBelow = reference - contrast;
    let lucentCells = 0;
    let heightSum = 0;
    let valueSum = 0;

    for (const height of heights) {
      for (let u = -4; u <= 4; u += CELL_MM) {
        for (let v = -2.5; v <= 2.5; v += CELL_MM) {
          const value = at(column, u, v, height);
          if (value <= airLevel || value >= lucentBelow) continue;
          lucentCells++;
          heightSum += height;
          valueSum += value;
        }
      }
    }

    const volumeMm3 = lucentCells * CELL_VOLUME;
    if (volumeMm3 < MIN_VOLUME_MM3) return null;

    // Reported in Hounsfield units so the number means the same on any scan.
    const contrastHu = (reference - valueSum / lucentCells) / levels.perHu;
    if (contrastHu < CONTRAST_HU) return null;

    const score =
      Math.min(volumeMm3 / 35, 1) * 0.55 + Math.min(contrastHu / 500, 1) * 0.45;
    if (score < 0.35) return null;

    return {
      column,
      arcMm: column * curveStepMm,
      jaw,
      apexMm,
      centreMm: heightSum / lucentCells,
      volumeMm3,
      contrast: contrastHu,
      score,
    };
  }
}

/**
 * One lesion spans several columns, so neighbouring hits are folded into the
 * strongest of them. A hit standing alone on a single column is noise.
 */
function cluster(findings: ColumnFinding[], curveStepMm: number): LesionCandidate[] {
  const out: LesionCandidate[] = [];

  for (const jaw of ['upper', 'lower'] as Jaw[]) {
    const ofJaw = findings.filter((f) => f.jaw === jaw).sort((a, b) => a.arcMm - b.arcMm);
    let group: ColumnFinding[] = [];

    const flush = () => {
      if (group.length === 0) return;
      const span = group[group.length - 1].arcMm - group[0].arcMm;
      // Wider than a single sampling step, or it is a one-column artefact.
      if (span >= 1.5 - curveStepMm) {
        const best = group.reduce((a, b) => (b.score > a.score ? b : a));
        out.push({
          id: `${jaw}-${Math.round(best.arcMm * 10)}`,
          arcMm: best.arcMm,
          jaw: best.jaw,
          apexMm: best.apexMm,
          centreMm: best.centreMm,
          volumeMm3: best.volumeMm3,
          contrast: best.contrast,
          score: best.score,
        });
      }
      group = [];
    };

    for (const finding of ofJaw) {
      if (group.length > 0 && finding.arcMm - group[group.length - 1].arcMm > 3) flush();
      group.push(finding);
    }
    flush();
  }

  return out.sort((a, b) => b.score - a.score);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
