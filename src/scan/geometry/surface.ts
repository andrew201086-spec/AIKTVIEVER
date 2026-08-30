import * as THREE from 'three';

/** 1-D Catmull-Rom through (t, value) control points, clamped at the ends. */
export const sampleProfile = (points: [number, number][], t: number): number => {
  const n = points.length;
  if (n === 0) return 1;
  if (t <= points[0][0]) return points[0][1];
  if (t >= points[n - 1][0]) return points[n - 1][1];

  let i = 0;
  while (i < n - 2 && points[i + 1][0] < t) i++;

  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(n - 1, i + 2)];
  const span = p2[0] - p1[0] || 1;
  const s = (t - p1[0]) / span;
  const s2 = s * s;
  const s3 = s2 * s;

  return (
    0.5 *
    (2 * p1[1] +
      (-p0[1] + p2[1]) * s +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3)
  );
};

/** Angular Gaussian bump, used to place cusps around the occlusal rim. */
export const angularBump = (angle: number, centre: number, sigma: number): number => {
  let d = angle - centre;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
};

/** Superellipse outline: a rounded rectangle that reads as a tooth cross-section. */
export const superellipse = (
  angle: number,
  a: number,
  b: number,
  exponent = 0.78,
): { x: number; z: number } => {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  return {
    x: a * Math.sign(s) * Math.pow(Math.abs(s), exponent),
    z: b * Math.sign(c) * Math.pow(Math.abs(c), exponent),
  };
};

/**
 * Assembles indexed triangles from a list of vertex rings. Consecutive rings
 * are stitched; a ring of length 1 closes the strip as a fan.
 */
export class RingMeshBuilder {
  private positions: number[] = [];
  private indices: number[] = [];
  private rings: number[][] = [];

  addRing(points: THREE.Vector3[]): number[] {
    const ids = points.map((p) => {
      const id = this.positions.length / 3;
      this.positions.push(p.x, p.y, p.z);
      return id;
    });
    this.rings.push(ids);
    return ids;
  }

  /** Stitches the last two rings added. */
  stitchLast(closed = true) {
    const b = this.rings[this.rings.length - 1];
    const a = this.rings[this.rings.length - 2];
    if (!a || !b) return;
    this.stitch(a, b, closed);
  }

  /**
   * Rings must be ordered by increasing angle with x = sin(a), z = cos(a),
   * and ring `a` must sit below ring `b` along +Y, which makes the emitted
   * winding face outwards.
   */
  stitch(a: number[], b: number[], closed = true) {
    if (a.length === 1 || b.length === 1) {
      const apexIsFirst = a.length === 1;
      const ring = apexIsFirst ? b : a;
      const apex = apexIsFirst ? a[0] : b[0];
      const count = closed ? ring.length : ring.length - 1;
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % ring.length;
        if (apexIsFirst) this.indices.push(apex, ring[j], ring[i]);
        else this.indices.push(ring[i], ring[j], apex);
      }
      return;
    }
    const count = closed ? a.length : a.length - 1;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % a.length;
      this.indices.push(a[i], b[j], b[i]);
      this.indices.push(a[i], a[j], b[j]);
    }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }
}
