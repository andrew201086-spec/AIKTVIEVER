import { describe, expect, it } from 'vitest';
import {
  axisLabel,
  columnsGoLeft,
  heightToSlice,
  orientationFromDirection,
  sliceToHeight,
  slicesGoSuperior,
  tiltFromAxial,
  STANDARD_AXIAL,
} from './orientation';

/**
 * These are the tests that guard against reporting the wrong side of the
 * mouth. A mirrored volume indexes exactly like a correct one, so nothing but
 * the geometry can catch it.
 */

describe('axisLabel', () => {
  it('names the six patient directions', () => {
    expect(axisLabel([1, 0, 0])).toBe('L');
    expect(axisLabel([-1, 0, 0])).toBe('R');
    expect(axisLabel([0, 1, 0])).toBe('P');
    expect(axisLabel([0, -1, 0])).toBe('A');
    expect(axisLabel([0, 0, 1])).toBe('S');
    expect(axisLabel([0, 0, -1])).toBe('I');
  });

  it('picks the dominant direction of a tilted vector', () => {
    expect(axisLabel([0.94, 0.2, -0.28])).toBe('L');
    expect(axisLabel([0.2, -0.1, -0.97])).toBe('I');
  });
});

describe('orientationFromDirection', () => {
  it('reads the three axes out of a direction matrix', () => {
    const orientation = orientationFromDirection([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(orientation.i).toEqual([1, 0, 0]);
    expect(orientation.k).toEqual([0, 0, 1]);
  });

  it('normalises axes that are not unit length', () => {
    const orientation = orientationFromDirection([2, 0, 0, 0, 2, 0, 0, 0, 2]);
    expect(orientation.i[0]).toBeCloseTo(1);
  });

  it('falls back to a standard axial layout when there is no matrix', () => {
    expect(orientationFromDirection([])).toEqual(STANDARD_AXIAL);
  });
});

describe('laterality', () => {
  it('recognises a standard head-first axial scan', () => {
    expect(columnsGoLeft(STANDARD_AXIAL)).toBe(true);
    expect(slicesGoSuperior(STANDARD_AXIAL)).toBe(true);
    expect(tiltFromAxial(STANDARD_AXIAL)).toBeCloseTo(0);
  });

  it('detects a volume whose columns run the other way', () => {
    const mirrored = orientationFromDirection([-1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(columnsGoLeft(mirrored)).toBe(false);
  });

  it('detects slices stacked from the top of the head downward', () => {
    const flipped = orientationFromDirection([1, 0, 0, 0, 1, 0, 0, 0, -1]);
    expect(slicesGoSuperior(flipped)).toBe(false);
  });

  it('measures how far a gantry-tilted scan is from axial', () => {
    const tilted = orientationFromDirection([1, 0, 0, 0, 0.966, -0.259, 0, 0.259, 0.966]);
    expect(tiltFromAxial(tilted)).toBeCloseTo(15, 0);
  });
});

describe('height and slice index', () => {
  const count = 100;
  const spacing = 0.5;

  it('puts height zero at the top of the head when slices go up', () => {
    expect(heightToSlice(0, count, spacing, STANDARD_AXIAL)).toBe(count - 1);
    expect(sliceToHeight(count - 1, count, spacing, STANDARD_AXIAL)).toBe(0);
  });

  it('puts height zero at the first slice when they go down', () => {
    const flipped = orientationFromDirection([1, 0, 0, 0, 1, 0, 0, 0, -1]);
    expect(heightToSlice(0, count, spacing, flipped)).toBe(0);
    expect(sliceToHeight(0, count, spacing, flipped)).toBe(0);
  });

  it('round-trips a height through the slice index either way round', () => {
    for (const orientation of [
      STANDARD_AXIAL,
      orientationFromDirection([1, 0, 0, 0, 1, 0, 0, 0, -1]),
    ]) {
      const height = 12.5;
      const slice = heightToSlice(height, count, spacing, orientation);
      expect(sliceToHeight(slice, count, spacing, orientation)).toBeCloseTo(height);
    }
  });
});
