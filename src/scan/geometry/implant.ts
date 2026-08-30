import * as THREE from 'three';
import { RingMeshBuilder } from './surface';

/**
 * Implant fixture and abutment. Local frame: origin at the implant platform,
 * +Y coronal, the body running apically along -Y. Millimetres.
 */

const RADIAL = 48;
const RING_STEP = 0.18;

const threadWave = (u: number) => Math.pow(0.5 * (1 + Math.cos(2 * Math.PI * u)), 0.8);

export interface ImplantShape {
  diameter: number;
  length: number;
  /** Thread pitch; 0 gives a smooth cylindrical body. */
  pitch?: number;
}

export const buildImplantGeometry = ({
  diameter,
  length,
  pitch = 0.8,
}: ImplantShape): THREE.BufferGeometry => {
  const outerRadius = diameter / 2;
  const collar = 1.2;
  const apexRound = 1.2;
  const threadDepth = Math.max(0.18, outerRadius * 0.16);

  /** Core radius at depth t below the platform. */
  const coreRadius = (t: number) => {
    if (t <= collar) return outerRadius * 0.98;
    const bodyEnd = length - apexRound;
    if (t >= bodyEnd) {
      const k = Math.min(1, (t - bodyEnd) / apexRound);
      return (outerRadius - threadDepth) * 0.7 * Math.sqrt(Math.max(0, 1 - k * k));
    }
    const k = (t - collar) / Math.max(1e-3, bodyEnd - collar);
    return (outerRadius - threadDepth) * (1 - 0.3 * k);
  };

  const radiusAt = (t: number, angle: number) => {
    const core = coreRadius(t);
    if (t <= collar + 0.4 || t >= length - apexRound) return core;
    const u = (t + (pitch * angle) / (2 * Math.PI)) / pitch;
    return core + threadDepth * threadWave(u - Math.floor(u));
  };

  const builder = new RingMeshBuilder();
  const steps = Math.max(24, Math.round(length / RING_STEP));

  // Rings are emitted apex-first so that increasing index moves along +Y.
  const apex = builder.addRing([new THREE.Vector3(0, -length, 0)]);
  let previous = apex;
  for (let k = steps; k >= 0; k--) {
    const t = (length * k) / steps;
    const ring = Array.from({ length: RADIAL }, (_, i) => {
      const angle = (i / RADIAL) * Math.PI * 2 - Math.PI;
      const r = Math.max(0.02, radiusAt(t, angle));
      return new THREE.Vector3(Math.sin(angle) * r, -t, Math.cos(angle) * r);
    });
    const ids = builder.addRing(ring);
    builder.stitch(previous, ids);
    previous = ids;
  }

  // Flat platform disc; the connection detail sits under the abutment.
  const platformRings = 4;
  for (let k = 1; k <= platformRings; k++) {
    const rho = 1 - k / platformRings;
    if (k === platformRings) {
      builder.stitch(previous, builder.addRing([new THREE.Vector3(0, 0, 0)]));
      break;
    }
    const ring = Array.from({ length: RADIAL }, (_, i) => {
      const angle = (i / RADIAL) * Math.PI * 2 - Math.PI;
      const r = outerRadius * 0.98 * rho;
      return new THREE.Vector3(Math.sin(angle) * r, 0, Math.cos(angle) * r);
    });
    const ids = builder.addRing(ring);
    builder.stitch(previous, ids);
    previous = ids;
  }

  return builder.build();
};

export interface AbutmentShape {
  /** Implant platform diameter. */
  platform: number;
  /** Gingival height from the platform to the finish line. */
  gingivalHeight: number;
  /** Post height above the finish line. */
  postHeight: number;
  /** Width of the crown the abutment supports. */
  crownWidth: number;
}

export const buildAbutmentGeometry = ({
  platform,
  gingivalHeight,
  postHeight,
  crownWidth,
}: AbutmentShape): THREE.BufferGeometry => {
  const base = platform / 2;
  const shoulder = Math.max(base + 0.3, crownWidth * 0.34);
  const post = shoulder * 0.72;
  const top = post * 0.55;
  const h1 = gingivalHeight;
  const h2 = gingivalHeight + postHeight;

  const profile: THREE.Vector2[] = [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(base, 0),
    new THREE.Vector2(base * 1.02, h1 * 0.25),
    new THREE.Vector2(shoulder * 0.85, h1 * 0.7),
    new THREE.Vector2(shoulder, h1),
    new THREE.Vector2(shoulder * 0.98, h1 + 0.2),
    new THREE.Vector2(post, h1 + (h2 - h1) * 0.45),
    new THREE.Vector2(top, h2 - 0.4),
    new THREE.Vector2(top * 0.55, h2),
    new THREE.Vector2(0, h2),
  ];

  const geometry = new THREE.LatheGeometry(profile, RADIAL);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
};

/** Translucent cylinder marking the safety envelope around a fixture. */
export const buildSafetyZoneGeometry = ({
  diameter,
  length,
}: ImplantShape): THREE.BufferGeometry => {
  const radius = diameter / 2 + 1.5;
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.85, length + 1.5, 32, 1, true);
  geometry.translate(0, -(length + 1.5) / 2, 0);
  return geometry;
};
