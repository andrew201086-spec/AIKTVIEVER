import { describe, expect, it } from 'vitest';
import {
  canalCurve,
  clearanceToCanals,
  clearanceToImplants,
  describeImplant,
  distanceFromPlane,
  distanceFromPlaneToSegment,
  implantAxis,
  implantLengthMm,
  withLength,
  type CanalPath,
  type Implant,
  type Vec3,
} from './surgicalPlan';

/**
 * The numbers here are the ones a surgeon acts on, so they are checked
 * against geometry that can be worked out by hand.
 */

function implant(overrides: Partial<Implant> = {}): Implant {
  return {
    id: 'i1',
    platform: [0, 0, 10],
    apex: [0, 0, 0],
    diameterMm: 4,
    note: '',
    ...overrides,
  };
}

describe('implant geometry', () => {
  it('measures its own length', () => {
    expect(implantLengthMm(implant())).toBeCloseTo(10);
    expect(implantLengthMm(implant({ platform: [0, 0, 13], apex: [0, 0, 0] }))).toBeCloseTo(13);
  });

  it('points from the platform towards the apex', () => {
    expect(implantAxis(implant())).toEqual([0, 0, -1]);
  });

  it('resizes without re-aiming', () => {
    const angled = implant({ platform: [0, 0, 10], apex: [3, 0, 6] });
    const before = implantAxis(angled);
    const resized = withLength(angled, 12);
    expect(implantLengthMm(resized)).toBeCloseTo(12);
    expect(implantAxis(resized)[0]).toBeCloseTo(before[0]);
    expect(implantAxis(resized)[2]).toBeCloseTo(before[2]);
    // The platform is the fixed end — the apex moves.
    expect(resized.platform).toEqual(angled.platform);
  });

  it('describes itself the way a catalogue does', () => {
    expect(describeImplant(implant({ diameterMm: 4.1 }))).toBe('4.1 × 10.0 мм');
  });
});

describe('canal curve', () => {
  it('passes through the traced points', () => {
    const points: Vec3[] = [
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
    ];
    const curve = canalCurve(points);
    expect(curve[0]).toEqual([0, 0, 0]);
    expect(curve[curve.length - 1]).toEqual([20, 0, 0]);
    expect(curve.length).toBeGreaterThan(points.length);
  });

  it('leaves a single point alone', () => {
    expect(canalCurve([[1, 2, 3]])).toEqual([[1, 2, 3]]);
    expect(canalCurve([])).toEqual([]);
  });

  it('stays on a straight trace instead of overshooting it', () => {
    const curve = canalCurve([
      [0, 0, 0],
      [10, 0, 0],
      [20, 0, 0],
      [30, 0, 0],
    ]);
    for (const point of curve) {
      expect(Math.abs(point[1])).toBeLessThan(1e-6);
      expect(Math.abs(point[2])).toBeLessThan(1e-6);
    }
  });
});

describe('clearance to the canal', () => {
  /** A canal running along x at 8 mm below the implant's apex. */
  const canal: CanalPath = {
    id: 'c1',
    side: 'right',
    points: [
      [-20, 0, -8],
      [0, 0, -8],
      [20, 0, -8],
    ],
  };

  it('measures from the implant surface, not its axis', () => {
    // Apex at z = 0, canal at z = −8: axis distance 8, minus the 2 mm radius.
    const clearance = clearanceToCanals(implant(), [canal]);
    expect(clearance).not.toBeNull();
    expect(clearance!.mm).toBeCloseTo(6, 1);
  });

  it('shrinks as the implant gets longer', () => {
    const longer = withLength(implant(), 14);
    const clearance = clearanceToCanals(longer, [canal]);
    // Apex now at z = −4, so 4 mm to the canal axis, less the radius.
    expect(clearance!.mm).toBeCloseTo(2, 1);
  });

  it('goes negative when the implant reaches into the canal', () => {
    const tooLong = withLength(implant(), 19);
    const clearance = clearanceToCanals(tooLong, [canal]);
    expect(clearance!.mm).toBeLessThan(0);
  });

  it('reports which side it measured', () => {
    const left: CanalPath = { ...canal, id: 'c2', side: 'left', points: canal.points.map((p) => [p[0], p[1], p[2] - 20] as Vec3) };
    const clearance = clearanceToCanals(implant(), [canal, left]);
    expect(clearance!.side).toBe('right');
  });

  it('returns nothing when no canal is traced', () => {
    expect(clearanceToCanals(implant(), [])).toBeNull();
  });

  it('gives the two points the measurement runs between', () => {
    const clearance = clearanceToCanals(implant(), [canal])!;
    // Closest approach is at the apex, straight down onto the canal.
    expect(clearance.onImplant[2]).toBeCloseTo(0, 1);
    expect(clearance.onCanal[2]).toBeCloseTo(-8, 1);
  });
});

describe('clearance between implants', () => {
  it('measures surface to surface', () => {
    const a = implant({ id: 'a', platform: [0, 0, 10], apex: [0, 0, 0], diameterMm: 4 });
    const b = implant({ id: 'b', platform: [7, 0, 10], apex: [7, 0, 0], diameterMm: 4 });
    // Axes 7 mm apart, less 2 mm of radius each.
    expect(clearanceToImplants(a, [b])).toBeCloseTo(3, 1);
  });

  it('ignores itself', () => {
    const a = implant({ id: 'a' });
    expect(clearanceToImplants(a, [a])).toBeNull();
  });
});

describe('distanceFromPlane', () => {
  it('is signed, so a point can be told which side it is on', () => {
    expect(distanceFromPlane([0, 0, 5], [0, 0, 0], [0, 0, 1])).toBeCloseTo(5);
    expect(distanceFromPlane([0, 0, -5], [0, 0, 0], [0, 0, 1])).toBeCloseTo(-5);
  });
});

describe('distanceFromPlaneToSegment', () => {
  const plane: Vec3 = [0, 0, 5];
  const normal: Vec3 = [0, 0, 1];

  it('is zero while the plane cuts the segment', () => {
    // A fixture from z=0 to z=10 with the slice at z=5 runs straight through it.
    expect(distanceFromPlaneToSegment([0, 0, 0], [0, 0, 10], plane, normal)).toBe(0);
  });

  it('is zero when an end sits exactly on the plane', () => {
    expect(distanceFromPlaneToSegment([0, 0, 5], [0, 0, 12], plane, normal)).toBe(0);
  });

  it('measures to the nearer end when the segment is wholly on one side', () => {
    expect(distanceFromPlaneToSegment([0, 0, 8], [0, 0, 14], plane, normal)).toBeCloseTo(3);
    expect(distanceFromPlaneToSegment([0, 0, -1], [0, 0, 2], plane, normal)).toBeCloseTo(3);
  });

  it('does not report a crossing for a segment that only comes close', () => {
    expect(distanceFromPlaneToSegment([0, 0, 5.5], [0, 0, 9], plane, normal)).toBeCloseTo(0.5);
  });
});
