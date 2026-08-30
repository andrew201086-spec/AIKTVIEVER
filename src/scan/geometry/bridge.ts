import * as THREE from 'three';

/**
 * Connector between two splinted units. Built directly in world space and
 * rendered by a mesh sitting at the origin, so it follows both abutments as
 * they are nudged around.
 */
export const buildConnectorGeometry = (
  from: THREE.Vector3,
  to: THREE.Vector3,
  occlusalUp: THREE.Vector3,
  height: number,
  depth: number,
): THREE.BufferGeometry => {
  const mid = from.clone().add(to).multiplyScalar(0.5).addScaledVector(occlusalUp, -0.15);
  const curve = new THREE.CatmullRomCurve3([from.clone(), mid, to.clone()]);

  const SEGMENTS = 18;
  const SIDES = 16;
  const positions: number[] = [];
  const indices: number[] = [];
  const rings: number[][] = [];

  const tangent = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const point = new THREE.Vector3();

  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent).normalize();
    binormal.crossVectors(tangent, occlusalUp).normalize();
    normal.crossVectors(binormal, tangent).normalize();

    // Waist the connector in the middle, the way a technician thins it.
    const waist = 0.7 + 0.3 * Math.abs(2 * t - 1);
    const ring: number[] = [];
    for (let s = 0; s < SIDES; s++) {
      const angle = (s / SIDES) * Math.PI * 2;
      const a = (depth / 2) * waist * Math.cos(angle);
      const b = (height / 2) * waist * Math.sin(angle);
      const id = positions.length / 3;
      positions.push(
        point.x + binormal.x * a + normal.x * b,
        point.y + binormal.y * a + normal.y * b,
        point.z + binormal.z * a + normal.z * b,
      );
      ring.push(id);
    }
    rings.push(ring);
  }

  for (let i = 0; i < SEGMENTS; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    for (let s = 0; s < SIDES; s++) {
      const n = (s + 1) % SIDES;
      indices.push(a[s], b[n], b[s]);
      indices.push(a[s], a[n], b[n]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};
