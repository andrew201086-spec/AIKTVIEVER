import { describe, expect, it } from 'vitest';
import { HOUNSFIELD_LEVELS } from './density';
import { orientationFromDirection, STANDARD_AXIAL } from './orientation';
import { buildCentreline, type ArchPoint, type VolumeSampler } from './panorama';
import type { Jaw } from './toothSections';
import { archMidlineMm, detectTeeth } from './toothDetect';

/**
 * A synthetic jaw: a parabolic arch of crowns with known widths and known
 * gaps. The point of these tests is the counting — that a missing tooth
 * shifts nothing after it, which is the failure a fixed-width numbering
 * cannot avoid.
 */

const SPACING: [number, number, number] = [0.6, 0.6, 0.6];
const DIMENSIONS: [number, number, number] = [200, 200, 120];
const OCCLUSAL_SLICE = 60;

/** Arch as a parabola opening towards +j, in voxel indices. */
const ARCH: ArchPoint[] = [
  { i: 40, j: 150 },
  { i: 60, j: 100 },
  { i: 100, j: 78 },
  { i: 140, j: 100 },
  { i: 160, j: 150 },
];

interface Crown {
  /** Distance along the arch, millimetres. */
  centreMm: number;
  widthMm: number;
}

/**
 * Builds a volume in which the given crowns stand on the arch. Everything
 * else is bone; outside the head is air.
 */
function jaw(crowns: Crown[], side: Jaw = 'upper'): VolumeSampler {
  const [nx, ny] = DIMENSIONS;
  const step = Math.min(...SPACING);
  const curve = buildCentreline(ARCH, SPACING, step);

  // Pre-compute the world position of each crown centre so the volume can be
  // filled by asking «is this voxel inside a crown».
  const centres = crowns.map((crown) => {
    const column = Math.max(0, Math.min(Math.round(crown.centreMm / step), curve.length - 1));
    return { point: curve[column], crown };
  });

  const sliceStride = nx * ny;

  return {
    dimensions: DIMENSIONS,
    spacing: SPACING,
    orientation: STANDARD_AXIAL,
    levels: HOUNSFIELD_LEVELS,
    read: (index: number) => {
      const z = Math.floor(index / sliceStride);
      const rest = index % sliceStride;
      const y = Math.floor(rest / nx);
      const x = rest % nx;

      // Upper crowns hang below the maxilla — superior of the occlusal plane
      // in a standard axial volume; lower crowns stand under it.
      const fromOcclusal = side === 'upper' ? z - OCCLUSAL_SLICE : OCCLUSAL_SLICE - z;
      const inCrownBand = fromOcclusal > 2 && fromOcclusal < 16;

      if (inCrownBand) {
        for (const { point, crown } of centres) {
          const dx = (x - point.i) * SPACING[0];
          const dy = (y - point.j) * SPACING[1];
          // A crown is an ellipse: as wide as its mesiodistal width along the
          // arch, and a fixed depth across it.
          const along = dx * point.normalJ - dy * point.normalI;
          const across = dx * point.normalI + dy * point.normalJ;
          const halfWidth = crown.widthMm / 2;
          if (
            (along / halfWidth) ** 2 + (across / 4) ** 2 <= 1
          ) {
            return 1800;
          }
        }
        return -200; // air between the crowns
      }

      const fromCentre = Math.hypot(x - nx / 2, y - ny / 2);
      return fromCentre < 70 ? 500 : -1000;
    },
  };
}

/** Crowns laid out symmetrically about the midline with the given widths. */
function layout(midlineMm: number, widths: number[]): Crown[] {
  const crowns: Crown[] = [];
  for (const side of [-1, 1]) {
    let edge = midlineMm;
    for (const width of widths) {
      if (width <= 0) {
        // A gap: skip the position without placing a crown.
        edge += side * 7;
        continue;
      }
      crowns.push({ centreMm: edge + side * (width / 2), widthMm: width * 0.82 });
      edge += side * width;
    }
  }
  return crowns;
}

const step = Math.min(...SPACING);
const curve = buildCentreline(ARCH, SPACING, step);

describe('archMidlineMm', () => {
  it('finds the front of the arch, not the halfway point', () => {
    const midline = archMidlineMm(curve, step, SPACING);
    const total = (curve.length - 1) * step;
    expect(midline).toBeGreaterThan(total * 0.35);
    expect(midline).toBeLessThan(total * 0.65);
  });

  it('follows the arch when it is fitted further back on one side', () => {
    const lopsided: ArchPoint[] = [
      { i: 40, j: 170 },
      { i: 60, j: 100 },
      { i: 100, j: 78 },
      { i: 130, j: 95 },
      { i: 145, j: 120 },
    ];
    const other = buildCentreline(lopsided, SPACING, step);
    const midline = archMidlineMm(other, step, SPACING);
    expect(Number.isFinite(midline)).toBe(true);
    expect(midline).toBeGreaterThan(0);
  });
});

describe('detectTeeth', () => {
  const midline = archMidlineMm(curve, step, SPACING);

  it('finds crowns and numbers them outward from the midline', () => {
    const sampler = jaw(layout(midline, [8.5, 6.5, 7.5, 7, 6.5]));
    const map = detectTeeth(sampler, curve, step, OCCLUSAL_SLICE, 'upper');

    expect(map.teeth.length).toBeGreaterThanOrEqual(8);
    // Both central incisors, one either side of the midline.
    const numbers = map.teeth.map((tooth) => tooth.fdi);
    expect(numbers).toContain(11);
    expect(numbers).toContain(21);
    // And they are the two nearest the midline.
    const nearest = [...map.teeth]
      .sort((a, b) => Math.abs(a.arcMm - midline) - Math.abs(b.arcMm - midline))
      .slice(0, 2)
      .map((tooth) => tooth.fdi)
      .sort();
    expect(nearest).toEqual([11, 21]);
  });

  it('numbers the lower jaw into quadrants 3 and 4', () => {
    const sampler = jaw(layout(midline, [5.3, 5.7, 7, 7]), 'lower');
    const map = detectTeeth(sampler, curve, step, OCCLUSAL_SLICE, 'lower');
    const quadrants = new Set(map.teeth.map((tooth) => Math.floor(tooth.fdi / 10)));
    expect([...quadrants].sort()).toEqual([3, 4]);
  });

  /**
   * The reason this module exists: with the second premolar absent, the
   * molars behind it must keep their own numbers.
   */
  it('keeps numbering correct across a missing tooth', () => {
    // Positions 1–4 present, position 5 absent, position 6 present.
    const sampler = jaw(layout(midline, [8.5, 6.5, 7.5, 7, 0, 10]));
    const map = detectTeeth(sampler, curve, step, OCCLUSAL_SLICE, 'upper');

    const numbers = map.teeth.map((tooth) => tooth.fdi);
    expect(numbers).toContain(16);
    expect(numbers).toContain(26);
    expect(map.missing).toContain(15);
    expect(map.missing).toContain(25);
    expect(numbers).not.toContain(15);
    expect(numbers).not.toContain(25);
  });

  it('reports an empty jaw rather than inventing teeth', () => {
    const sampler = jaw([]);
    const map = detectTeeth(sampler, curve, step, OCCLUSAL_SLICE, 'upper');
    expect(map.teeth).toHaveLength(0);
  });

  it('mirrors the quadrants on a volume whose columns run the other way', () => {
    const crowns = layout(midline, [8.5, 6.5]);
    const normal = detectTeeth(jaw(crowns), curve, step, OCCLUSAL_SLICE, 'upper');
    const mirrored = detectTeeth(
      { ...jaw(crowns), orientation: orientationFromDirection([-1, 0, 0, 0, 1, 0, 0, 0, 1]) },
      curve,
      step,
      OCCLUSAL_SLICE,
      'upper'
    );

    const quadrantAt = (map: typeof normal, arcMm: number) =>
      Math.floor(
        (map.teeth.find((tooth) => Math.abs(tooth.arcMm - arcMm) < 4)?.fdi ?? 0) / 10
      );

    const somewhere = normal.teeth[0]?.arcMm ?? 0;
    expect(quadrantAt(normal, somewhere)).not.toBe(0);
    expect(quadrantAt(mirrored, somewhere)).not.toBe(quadrantAt(normal, somewhere));
  });

  it('never numbers past the third molar', () => {
    const sampler = jaw(layout(midline, [7, 7, 7, 7, 7, 7, 7, 7, 7, 7]));
    const map = detectTeeth(sampler, curve, step, OCCLUSAL_SLICE, 'upper');
    for (const tooth of map.teeth) {
      expect(tooth.fdi % 10).toBeGreaterThanOrEqual(1);
      expect(tooth.fdi % 10).toBeLessThanOrEqual(8);
    }
  });
});
