import { describe, expect, it } from 'vitest';
import { autoWindow, measureDensityLevels, windowFromHu, HOUNSFIELD_LEVELS } from './density';

/**
 * Builds a volume whose values follow a plausible head: mostly air, a good
 * amount of soft tissue, some bone, a little enamel — then shifted and scaled
 * the way an uncalibrated CBCT would report the very same anatomy.
 */
function head(offset: number, scale: number) {
  const dimensions: [number, number, number] = [60, 60, 60];
  const total = dimensions[0] * dimensions[1] * dimensions[2];
  const values = new Float32Array(total);

  for (let index = 0; index < total; index++) {
    const fraction = index / total;
    let hu: number;
    if (fraction < 0.55) hu = -1000 + ((index % 7) - 3) * 4; // air, with noise
    else if (fraction < 0.85) hu = 0 + ((index % 5) - 2) * 6; // soft tissue
    else if (fraction < 0.97) hu = 700 + ((index % 11) - 5) * 20; // bone
    else hu = 2200; // enamel
    values[index] = offset + (hu + 1000) * scale;
  }

  return { dimensions, read: (index: number) => values[index] };
}

describe('measureDensityLevels', () => {
  it('finds air and soft tissue on a properly calibrated volume', () => {
    const levels = measureDensityLevels(head(-1000, 1), true);
    expect(levels.air).toBeGreaterThan(-1060);
    expect(levels.air).toBeLessThan(-940);
    expect(Math.abs(levels.soft)).toBeLessThan(90);
    expect(levels.calibrated).toBe(true);
    expect(levels.unit).toBe('HU');
  });

  it('maps thresholds onto a shifted, stretched CBCT scale', () => {
    // The same anatomy reported as 0…4000 instead of −1000…3000.
    const levels = measureDensityLevels(head(0, 1), false);
    expect(levels.air).toBeGreaterThan(-60);
    expect(levels.air).toBeLessThan(60);
    // Bone at 500 HU must land near 1500 on this scale, not stay at 500.
    expect(levels.fromHu(500)).toBeGreaterThan(1300);
    expect(levels.fromHu(500)).toBeLessThan(1700);
  });

  it('handles a scale that is compressed as well as shifted', () => {
    const levels = measureDensityLevels(head(200, 0.5), false);
    // 1000 HU of span became 500 units of span.
    expect(levels.perHu).toBeGreaterThan(0.35);
    expect(levels.perHu).toBeLessThan(0.65);
    expect(levels.toHu(levels.fromHu(1200))).toBeCloseTo(1200, 0);
  });

  it('refuses to print HU when the file claims it but the data disagrees', () => {
    const levels = measureDensityLevels(head(0, 1), true);
    expect(levels.calibrated).toBe(false);
    expect(levels.unit).toBe('усл. ед.');
    expect(levels.note).toContain('не калибрована');
  });

  it('does not claim Hounsfield units for a file that never said so', () => {
    expect(measureDensityLevels(head(-1000, 1), false).unit).toBe('усл. ед.');
  });

  it('survives a volume with nothing in it', () => {
    const flat = {
      dimensions: [10, 10, 10] as [number, number, number],
      read: () => 0,
    };
    const levels = measureDensityLevels(flat, false);
    expect(Number.isFinite(levels.fromHu(500))).toBe(true);
    expect(levels.perHu).toBeGreaterThan(0);
  });
});

describe('windowFromHu', () => {
  it('leaves a calibrated volume alone', () => {
    const window = windowFromHu(HOUNSFIELD_LEVELS, 480, 2500);
    expect(window.center).toBeCloseTo(480);
    expect(window.width).toBeCloseTo(2500);
  });

  it('moves and stretches the window with the volume scale', () => {
    const levels = measureDensityLevels(head(0, 1), false);
    const window = windowFromHu(levels, 480, 2500);
    expect(window.center).toBeGreaterThan(1300);
    expect(window.width).toBeGreaterThan(2000);
  });
});

describe('autoWindow', () => {
  it('covers the tissue range rather than the air peak', () => {
    const window = autoWindow(head(-1000, 1));
    expect(window.width).toBeGreaterThan(0);
    expect(window.center + window.width / 2).toBeGreaterThan(0);
  });
});
