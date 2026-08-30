import * as THREE from 'three';
import type { JawKind, ToothNumber } from '../types';
import { archOf, dimsOfTooth } from '../data/fdi';

/**
 * Scans arrive in whatever frame the scanner used. Everything downstream
 * assumes a dental frame: +X to the patient's left, +Y up, +Z anterior,
 * occlusal plane near y = 0, millimetre units.
 */

const SAMPLE_LIMIT = 60_000;

const sampleStride = (vertexCount: number) =>
  Math.max(1, Math.floor(vertexCount / SAMPLE_LIMIT));

/** Jacobi eigenvalue decomposition of a symmetric 3x3 matrix. */
const eigenSymmetric3 = (
  m: number[][],
): { values: number[]; vectors: THREE.Vector3[] } => {
  const a = m.map((row) => [...row]);
  let v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    }
    if (off < 1e-18) break;

    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t =
          Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const values = [a[0][0], a[1][1], a[2][2]];
  const vectors = [0, 1, 2].map(
    (i) => new THREE.Vector3(v[0][i], v[1][i], v[2][i]).normalize(),
  );
  return { values, vectors };
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
};

/** Mean deviation of normals from their average — cusps score high, a trimmed base low. */
const normalRoughness = (
  normals: Float32Array,
  indices: number[],
): number => {
  if (indices.length === 0) return 0;
  const mean = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const i of indices) {
    mean.add(n.fromArray(normals, i * 3));
  }
  if (mean.lengthSq() < 1e-9) return 1;
  mean.normalize();
  let sum = 0;
  for (const i of indices) {
    sum += 1 - Math.abs(n.fromArray(normals, i * 3).dot(mean));
  }
  return sum / indices.length;
};

/**
 * Rotates and centres the geometry in place. Returns the matrix that was
 * applied so the same transform can be replayed on a saved case.
 */
export const autoAlignGeometry = (
  geometry: THREE.BufferGeometry,
  jaw: JawKind,
): THREE.Matrix4 => {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const positions = position.array as Float32Array;
  const normals = normal.array as Float32Array;
  const vertexCount = position.count;
  const stride = sampleStride(vertexCount);

  // 1. Centroid and covariance of a subsample.
  const centroid = new THREE.Vector3();
  let sampled = 0;
  for (let i = 0; i < vertexCount; i += stride) {
    centroid.x += positions[i * 3];
    centroid.y += positions[i * 3 + 1];
    centroid.z += positions[i * 3 + 2];
    sampled++;
  }
  centroid.divideScalar(sampled || 1);

  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < vertexCount; i += stride) {
    const dx = positions[i * 3] - centroid.x;
    const dy = positions[i * 3 + 1] - centroid.y;
    const dz = positions[i * 3 + 2] - centroid.z;
    cov[0][0] += dx * dx;
    cov[0][1] += dx * dy;
    cov[0][2] += dx * dz;
    cov[1][1] += dy * dy;
    cov[1][2] += dy * dz;
    cov[2][2] += dz * dz;
  }
  cov[1][0] = cov[0][1];
  cov[2][0] = cov[0][2];
  cov[2][1] = cov[1][2];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cov[r][c] /= sampled || 1;

  const { values, vectors } = eigenSymmetric3(cov);
  const order = [0, 1, 2].sort((a, b) => values[b] - values[a]);
  // Widest spread is the arch width, then anteroposterior depth, then height.
  let axisX = vectors[order[0]].clone();
  let axisZ = vectors[order[1]].clone();
  let axisY = vectors[order[2]].clone();

  // Right-handed basis.
  if (axisX.clone().cross(axisY).dot(axisZ) < 0) axisZ.negate();

  const toLocal = (out: THREE.Vector3, v: THREE.Vector3) =>
    out.set(v.dot(axisX), v.dot(axisY), v.dot(axisZ));

  // 2. Anterior sign: the posterior half is much wider (two free arch ends).
  const tmp = new THREE.Vector3();
  const local = new THREE.Vector3();
  const frontX: number[] = [];
  const backX: number[] = [];
  for (let i = 0; i < vertexCount; i += stride) {
    tmp.fromArray(positions, i * 3).sub(centroid);
    toLocal(local, tmp);
    (local.z >= 0 ? frontX : backX).push(Math.abs(local.x));
  }
  if (percentile(frontX, 0.95) > percentile(backX, 0.95)) {
    axisZ.negate();
    axisX.negate();
  }

  // 3. Occlusal sign: the tooth side has far more normal variation.
  const topIdx: number[] = [];
  const bottomIdx: number[] = [];
  const yValues: number[] = [];
  for (let i = 0; i < vertexCount; i += stride) {
    tmp.fromArray(positions, i * 3).sub(centroid);
    toLocal(local, tmp);
    yValues.push(local.y);
  }
  const yLow = percentile(yValues, 0.25);
  const yHigh = percentile(yValues, 0.75);
  let k = 0;
  for (let i = 0; i < vertexCount; i += stride, k++) {
    if (yValues[k] >= yHigh) topIdx.push(i);
    else if (yValues[k] <= yLow) bottomIdx.push(i);
  }
  const topRough = normalRoughness(normals, topIdx);
  const bottomRough = normalRoughness(normals, bottomIdx);
  const occlusalIsUp = topRough >= bottomRough;
  // Upper jaw: crowns must point down. Lower jaw: crowns point up.
  const wantOcclusalUp = jaw === 'lower';
  if (occlusalIsUp !== wantOcclusalUp) {
    axisY.negate();
    axisX.negate();
  }

  const rotation = new THREE.Matrix4().makeBasis(axisX, axisY, axisZ).transpose();
  const matrix = new THREE.Matrix4()
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeTranslation(-centroid.x, -centroid.y, -centroid.z));

  geometry.applyMatrix4(matrix);
  geometry.computeBoundingBox();

  // 4. Park the occlusal surface just off the y = 0 plane so both arches meet.
  const box = geometry.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  const shift = new THREE.Vector3(
    -center.x,
    jaw === 'upper' ? 0.3 - box.min.y : -0.3 - box.max.y,
    -center.z,
  );
  const shiftMatrix = new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z);
  geometry.applyMatrix4(shiftMatrix);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return matrix.premultiply(shiftMatrix);
};

export interface ToothSlot {
  tooth: ToothNumber;
  /** Centre of the tooth site on the arch, at the occlusal plane. */
  position: THREE.Vector3;
  /** Mesiodistal direction along the arch. */
  tangent: THREE.Vector3;
  /** Buccal (outward) direction. */
  outward: THREE.Vector3;
}

export interface ArchModel {
  jaw: JawKind;
  curve: THREE.CatmullRomCurve3;
  slots: Map<ToothNumber, ToothSlot>;
}

/**
 * Traces the dental arch by taking, for each angular sector around the arch
 * centre, a representative radius of the occlusal band.
 */
export const buildArchModel = (
  geometry: THREE.BufferGeometry,
  jaw: JawKind,
): ArchModel | null => {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const positions = position.array as Float32Array;
  const vertexCount = position.count;
  const stride = sampleStride(vertexCount);

  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  // The occlusal third of the scan: the band that actually contains crowns.
  const bandMin = jaw === 'upper' ? box.min.y : box.max.y - (box.max.y - box.min.y) * 0.35;
  const bandMax = jaw === 'upper' ? box.min.y + (box.max.y - box.min.y) * 0.35 : box.max.y;

  const points: THREE.Vector2[] = [];
  const centre = new THREE.Vector2();
  for (let i = 0; i < vertexCount; i += stride) {
    const y = positions[i * 3 + 1];
    if (y < bandMin || y > bandMax) continue;
    const p = new THREE.Vector2(positions[i * 3], positions[i * 3 + 2]);
    points.push(p);
    centre.add(p);
  }
  if (points.length < 200) return null;
  centre.divideScalar(points.length);

  const BINS = 96;
  const buckets: number[][] = Array.from({ length: BINS }, () => []);
  for (const p of points) {
    const dx = p.x - centre.x;
    const dz = p.y - centre.y;
    const angle = Math.atan2(dx, dz); // 0 = anterior, +pi/2 = patient's left
    const bin = Math.min(BINS - 1, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * BINS));
    buckets[bin].push(Math.hypot(dx, dz));
  }

  const curvePoints: THREE.Vector3[] = [];
  const occlusalY = jaw === 'upper' ? box.min.y : box.max.y;
  for (let bin = 0; bin < BINS; bin++) {
    if (buckets[bin].length < 6) continue;
    const radius = percentile(buckets[bin], 0.65);
    const angle = ((bin + 0.5) / BINS) * 2 * Math.PI - Math.PI;
    curvePoints.push(
      new THREE.Vector3(
        centre.x + Math.sin(angle) * radius,
        occlusalY,
        centre.y + Math.cos(angle) * radius,
      ),
    );
  }
  if (curvePoints.length < 8) return null;

  // Order from the patient's right end, through the front, to the left end.
  curvePoints.sort(
    (a, b) =>
      Math.atan2(a.x - centre.x, a.z - centre.y) -
      Math.atan2(b.x - centre.x, b.z - centre.y),
  );

  const curve = new THREE.CatmullRomCurve3(curvePoints, false, 'centripetal', 0.5);
  const total = curve.getLength();

  // Arc-length coordinate of the midline (the point nearest the median plane
  // on the anterior side of the arch).
  const SAMPLES = 400;
  let midlineU = 0.5;
  let best = Infinity;
  const probe = new THREE.Vector3();
  for (let i = 0; i <= SAMPLES; i++) {
    const u = i / SAMPLES;
    curve.getPointAt(u, probe);
    if (probe.z < centre.y) continue;
    const score = Math.abs(probe.x - centre.x);
    if (score < best) {
      best = score;
      midlineU = u;
    }
  }

  const arch = archOf(jaw);
  const midIndex = arch.length / 2; // between the two central incisors
  const slots = new Map<ToothNumber, ToothSlot>();

  const distances: number[] = [];
  let cursor = 0;
  for (let i = midIndex; i < arch.length; i++) {
    const w = dimsOfTooth(arch[i]).width;
    distances[i] = cursor + w / 2;
    cursor += w;
  }
  cursor = 0;
  for (let i = midIndex - 1; i >= 0; i--) {
    const w = dimsOfTooth(arch[i]).width;
    distances[i] = -(cursor + w / 2);
    cursor += w;
  }

  // A trimmed or narrow scan can be shorter than the sum of average tooth
  // widths; distribute the teeth proportionally instead of piling them up at
  // the clamped ends.
  const needed = distances[arch.length - 1] - distances[0] + dimsOfTooth(arch[0]).width;
  const available = total * 0.98;
  if (needed > available) {
    const factor = available / needed;
    for (let i = 0; i < distances.length; i++) distances[i] *= factor;
  }

  const tangent = new THREE.Vector3();
  for (let i = 0; i < arch.length; i++) {
    const u = THREE.MathUtils.clamp(midlineU + distances[i] / total, 0, 1);
    const point = curve.getPointAt(u).clone();
    curve.getTangentAt(u, tangent);
    const outward = new THREE.Vector3(point.x - centre.x, 0, point.z - centre.y);
    if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
    outward.normalize();
    slots.set(arch[i], {
      tooth: arch[i],
      position: point,
      tangent: tangent.clone().normalize(),
      outward,
    });
  }

  return { jaw, curve, slots };
};
