import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import type { ArchModel } from './align';

// Million-triangle scans need a BVH for picking to stay interactive.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export interface ScanRecord {
  id: string;
  geometry: THREE.BufferGeometry;
  arch: ArchModel | null;
  /** Off-screen mesh used for ray casting against the un-transformed scan. */
  pickMesh: THREE.Mesh;
}

const records = new Map<string, ScanRecord>();

export const putScan = (record: ScanRecord) => {
  const previous = records.get(record.id);
  if (previous && previous !== record) disposeScanRecord(previous);
  records.set(record.id, record);
};

export const getScan = (id: string): ScanRecord | undefined => records.get(id);

export const allScans = (): ScanRecord[] => [...records.values()];

const disposeScanRecord = (record: ScanRecord) => {
  record.geometry.disposeBoundsTree?.();
  record.geometry.dispose();
};

export const removeScan = (id: string) => {
  const record = records.get(id);
  if (!record) return;
  disposeScanRecord(record);
  records.delete(id);
};

export const clearScans = () => {
  records.forEach(disposeScanRecord);
  records.clear();
};

/** Bakes a transform into a scan so there is a single source of truth. */
export const applyScanTransform = (
  id: string,
  matrix: THREE.Matrix4,
  rebuildArch: (geometry: THREE.BufferGeometry) => ArchModel | null,
) => {
  const record = records.get(id);
  if (!record) return;
  record.geometry.disposeBoundsTree?.();
  record.geometry.applyMatrix4(matrix);
  record.geometry.computeBoundingBox();
  record.geometry.computeBoundingSphere();
  record.geometry.computeBoundsTree();
  record.arch = rebuildArch(record.geometry);
  record.pickMesh.updateMatrixWorld(true);
};
