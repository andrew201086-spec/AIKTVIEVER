import { describe, expect, it } from 'vitest';
import { HOUNSFIELD_LEVELS } from './density';
import { orientationFromDirection, STANDARD_AXIAL } from './orientation';
import { buildCentreline, type VolumeSampler } from './panorama';
import {
  ALL_FDI,
  archStartsOnRight,
  fdiLabel,
  guessFdi,
  jawBandMm,
  occlusalHeightMm,
  renderAxialCrop,
  renderCrossSection,
  toothName,
  jawOf,
} from './toothSections';

/** A cylinder of bone with a denser column standing in it, in Hounsfield units. */
function phantom(overrides: Partial<VolumeSampler> = {}): VolumeSampler {
  const dimensions: [number, number, number] = [80, 80, 60];
  const [nx, ny] = dimensions;
  return {
    dimensions,
    spacing: [0.5, 0.5, 0.5],
    orientation: STANDARD_AXIAL,
    levels: HOUNSFIELD_LEVELS,
    read: (index: number) => {
      const x = index % nx;
      const y = Math.floor(index / nx) % ny;
      const fromCentre = Math.hypot(x - nx / 2, y - ny / 2);
      if (fromCentre > 30) return -1000;
      return fromCentre < 4 ? 1600 : 400;
    },
    ...overrides,
  };
}

const arch = [
  { i: 20, j: 55 },
  { i: 30, j: 35 },
  { i: 40, j: 28 },
  { i: 50, j: 35 },
  { i: 60, j: 55 },
];

describe('FDI numbering', () => {
  const archLength = 100;

  it('numbers from the midline outward', () => {
    // Just left of the midline is the upper left central incisor.
    expect(guessFdi(archLength / 2 + 1, archLength, 'upper', true)).toBe(21);
    expect(guessFdi(archLength / 2 - 1, archLength, 'upper', true)).toBe(11);
  });

  it('puts the far ends in the molar positions', () => {
    expect(guessFdi(2, archLength, 'upper', true) % 10).toBeGreaterThanOrEqual(7);
    expect(guessFdi(archLength - 2, archLength, 'upper', true) % 10).toBeGreaterThanOrEqual(7);
  });

  it('assigns the lower jaw to quadrants 3 and 4', () => {
    expect(Math.floor(guessFdi(archLength / 2 - 1, archLength, 'lower', true) / 10)).toBe(4);
    expect(Math.floor(guessFdi(archLength / 2 + 1, archLength, 'lower', true) / 10)).toBe(3);
  });

  /**
   * The one that matters: on a volume whose columns run the other way, the
   * same place on the arch is the *other* side of the patient. Getting this
   * wrong means reporting 1.6 for a lesion in 2.6.
   */
  it('mirrors the quadrants when the arch starts on the left', () => {
    const nearStart = archLength / 2 - 10;
    expect(guessFdi(nearStart, archLength, 'upper', true)).toBeGreaterThanOrEqual(11);
    expect(guessFdi(nearStart, archLength, 'upper', true)).toBeLessThan(20);
    expect(guessFdi(nearStart, archLength, 'upper', false)).toBeGreaterThanOrEqual(21);
    expect(guessFdi(nearStart, archLength, 'upper', false)).toBeLessThan(30);
  });

  it('keeps the tooth number the same when only the side flips', () => {
    const at = archLength / 2 - 10;
    expect(guessFdi(at, archLength, 'upper', true) % 10).toBe(
      guessFdi(at, archLength, 'upper', false) % 10
    );
  });

  it('reads the side off the volume geometry', () => {
    expect(archStartsOnRight(phantom())).toBe(true);
    expect(
      archStartsOnRight(
        phantom({ orientation: orientationFromDirection([-1, 0, 0, 0, 1, 0, 0, 0, 1]) })
      )
    ).toBe(false);
  });
});

describe('tooth names', () => {
  it('covers every permanent tooth', () => {
    expect(ALL_FDI).toHaveLength(32);
    for (const fdi of ALL_FDI) {
      expect(toothName(fdi)).not.toContain('undefined');
      expect(fdiLabel(fdi)).toMatch(/^[1-4]\.[1-8]$/);
    }
  });

  it('splits the jaws the way the quadrants do', () => {
    expect(jawOf(16)).toBe('upper');
    expect(jawOf(26)).toBe('upper');
    expect(jawOf(36)).toBe('lower');
    expect(jawOf(46)).toBe('lower');
  });
});

describe('height of the occlusal plane', () => {
  it('is measured down from the top of the volume', () => {
    const sampler = phantom();
    // Slice 59 of 60 at 0.5 mm is the superior end: height zero.
    expect(occlusalHeightMm(sampler, 59)).toBeCloseTo(0);
    expect(occlusalHeightMm(sampler, 39)).toBeCloseTo(10);
  });

  it('flips with a volume stacked the other way', () => {
    const sampler = phantom({
      orientation: orientationFromDirection([1, 0, 0, 0, 1, 0, 0, 0, -1]),
    });
    expect(occlusalHeightMm(sampler, 0)).toBeCloseTo(0);
    expect(occlusalHeightMm(sampler, 20)).toBeCloseTo(10);
  });
});

describe('jaw band', () => {
  it('reaches up from the occlusal plane for the maxilla and down for the mandible', () => {
    const sampler = phantom();
    const occlusal = occlusalHeightMm(sampler, 30);
    const upper = jawBandMm(sampler, 30, 'upper');
    const lower = jawBandMm(sampler, 30, 'lower');
    // Smaller height is more superior.
    expect(upper.fromMm).toBeLessThan(occlusal);
    expect(lower.toMm).toBeGreaterThan(occlusal);
  });

  it('never leaves the volume', () => {
    const sampler = phantom();
    for (const slice of [0, 30, 59]) {
      for (const jaw of ['upper', 'lower'] as const) {
        const band = jawBandMm(sampler, slice, jaw);
        expect(band.fromMm).toBeGreaterThanOrEqual(0);
        expect(band.toMm).toBeLessThanOrEqual((sampler.dimensions[2] - 1) * sampler.spacing[2]);
      }
    }
  });
});

describe('reformations', () => {
  const sampler = phantom();
  const step = 0.5;
  const curve = buildCentreline(arch, sampler.spacing, step);

  it('builds a cross-section of the requested size in millimetres', () => {
    const section = renderCrossSection(sampler, curve, curve.length / 2, {
      widthMm: 20,
      fromMm: 5,
      toMm: 25,
      slabMm: 1,
      scaleMm: 0.5,
    });
    expect(section.width).toBe(40);
    expect(section.height).toBe(40);
    expect(section.scaleMm).toBe(0.5);
  });

  it('samples real densities rather than empty space', () => {
    const section = renderCrossSection(sampler, curve, curve.length / 2, {
      widthMm: 20,
      fromMm: 5,
      toMm: 25,
      slabMm: 1,
      scaleMm: 0.5,
    });
    const highest = section.data.reduce((a, b) => Math.max(a, b), -Infinity);
    expect(highest).toBeGreaterThan(0);
  });

  it('produces a square axial crop', () => {
    const crop = renderAxialCrop(sampler, curve, curve.length / 2, {
      sizeMm: 10,
      heightMm: 15,
      scaleMm: 0.5,
    });
    expect(crop.width).toBe(crop.height);
    expect(crop.width).toBe(20);
  });

  it('reads air outside the volume instead of throwing', () => {
    const crop = renderAxialCrop(sampler, curve, 0, {
      sizeMm: 400,
      heightMm: 15,
      scaleMm: 0.5,
    });
    expect(crop.data.some((value) => value === -1000)).toBe(true);
  });
});
