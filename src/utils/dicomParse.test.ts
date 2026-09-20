import { describe, expect, it, vi } from 'vitest';

/**
 * The DICOM image loader is a browser bundle that refuses to initialise
 * outside one. Nothing under test here touches it — grouping and validation
 * work on already-parsed headers — so it is stubbed rather than dragging a
 * DOM into the suite.
 */
vi.mock('@cornerstonejs/dicom-image-loader', () => ({
  default: {
    wadouri: {
      fileManager: { add: () => 'dicomfile:test' },
      dataSetCacheManager: { load: async () => undefined, unload: () => undefined },
    },
  },
}));

const { buildSeries, plural, slices, stepForBudget, withStep } = await import('./dicomParse');
type SliceInfo = import('./dicomParse').SliceInfo;

/**
 * Grouping is where a scanner folder either becomes a study or becomes
 * nonsense: the scout view, the panoramic reconstruction and the volume all
 * live in the same directory, and stacking them together produces a volume of
 * garbage that still renders.
 */
function slice(overrides: Partial<SliceInfo> = {}): SliceInfo {
  const axisPosition = overrides.axisPosition ?? 0;
  return {
    file: null as unknown as File,
    imageId: `id-${Math.random()}`,
    name: 'slice.dcm',
    instanceNumber: 1,
    seriesInstanceUID: 'series-a',
    seriesNumber: 1,
    seriesDescription: 'CBCT',
    studyDescription: 'Исследование',
    patientName: 'Иванов Иван',
    modality: 'CT',
    rows: 512,
    columns: 512,
    imagePositionPatient: [0, 0, axisPosition],
    imageOrientationPatient: [1, 0, 0, 0, 1, 0],
    pixelSpacing: [0.2, 0.2],
    sliceThickness: 0.2,
    rescaleType: 'HU',
    axisPosition,
    metadata: {},
    ...overrides,
  };
}

function stack(count: number, step: number, overrides: Partial<SliceInfo> = {}): SliceInfo[] {
  return Array.from({ length: count }, (_, n) =>
    slice({ ...overrides, axisPosition: n * step, instanceNumber: n + 1 })
  );
}

describe('buildSeries', () => {
  it('separates series that share a folder', () => {
    const found = buildSeries([
      ...stack(200, 0.2),
      ...stack(20, 1, { seriesInstanceUID: 'series-b', seriesDescription: 'Scout' }),
    ]);
    expect(found).toHaveLength(2);
    // Biggest first — that is almost always the volume the user wants.
    expect(found[0].sliceCount).toBe(200);
    expect(found[1].description).toBe('Scout');
  });

  it('measures slice spacing from positions, not the declared thickness', () => {
    // Overlapping reconstruction: 0.4 mm thick, stepped every 0.2 mm.
    const found = buildSeries(stack(50, 0.2, { sliceThickness: 0.4 }));
    expect(found[0].sliceSpacing).toBeCloseTo(0.2);
  });

  it('orders slices along the scan axis whatever order they arrive in', () => {
    const shuffled = [...stack(30, 0.5)].reverse();
    const found = buildSeries(shuffled);
    expect(found[0].extent[2]).toBeCloseTo(30 * 0.5);
  });

  it('blocks a single image from being opened as a volume', () => {
    const found = buildSeries([slice()]);
    expect(found[0].loadable).toBe(false);
    expect(found[0].blockers[0]).toContain('Один срез');
  });

  it('blocks slices of differing size', () => {
    const found = buildSeries([...stack(5, 0.5), slice({ axisPosition: 9, rows: 256 })]);
    expect(found[0].loadable).toBe(false);
    expect(found[0].blockers.join(' ')).toContain('разный размер');
  });

  it('warns about duplicate positions', () => {
    const found = buildSeries([...stack(10, 0.5), slice({ axisPosition: 0 })]);
    expect(found[0].warnings.join(' ')).toContain('совпадающими координатами');
  });

  it('warns when the step is uneven', () => {
    const uneven = [
      slice({ axisPosition: 0 }),
      slice({ axisPosition: 0.5 }),
      slice({ axisPosition: 1.4 }),
      slice({ axisPosition: 1.9 }),
    ];
    expect(buildSeries(uneven)[0].warnings.join(' ')).toContain('неравномерный');
  });

  it('reports whether the file claims Hounsfield units', () => {
    expect(buildSeries(stack(5, 0.5))[0].declaresHu).toBe(true);
    expect(buildSeries(stack(5, 0.5, { rescaleType: 'US' }))[0].declaresHu).toBe(false);
    expect(buildSeries(stack(5, 0.5, { modality: 'OT' }))[0].declaresHu).toBe(false);
  });
});

describe('thinning to fit memory', () => {
  it('keeps every slice when the study already fits', () => {
    expect(stepForBudget(10 * 1024 * 1024)).toBe(1);
  });

  it('asks for a bigger step the larger the study is', () => {
    const small = stepForBudget(1.5 * 1024 * 1024 * 1024);
    const large = stepForBudget(4 * 1024 * 1024 * 1024);
    expect(small).toBeGreaterThan(1);
    expect(large).toBeGreaterThan(small);
  });

  it('states the new spacing honestly when slices are dropped', () => {
    const [series] = buildSeries(stack(100, 0.25));
    const thinned = withStep(series, 3);
    expect(thinned.sliceCount).toBe(34);
    expect(thinned.sliceSpacing).toBeCloseTo(0.75);
    expect(thinned.warnings.join(' ')).toContain('каждый 3-й срез');
  });

  it('is a no-op at step one', () => {
    const [series] = buildSeries(stack(10, 0.5));
    expect(withStep(series, 1)).toBe(series);
  });
});

describe('Russian plurals', () => {
  it('agrees with the number', () => {
    expect(slices(1)).toBe('1 срез');
    expect(slices(2)).toBe('2 среза');
    expect(slices(5)).toBe('5 срезов');
    expect(slices(11)).toBe('11 срезов');
    expect(slices(21)).toBe('21 срез');
    expect(slices(102)).toBe('102 среза');
    expect(plural(0, 'серия', 'серии', 'серий')).toBe('0 серий');
  });
});
