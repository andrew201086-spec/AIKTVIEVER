import * as THREE from 'three';
import type { JawKind, ScanMeta } from '../types';
import { autoAlignGeometry, buildArchModel } from './align';
import { putScan } from './registry';
import type { ParseRequest, ParseResponse } from './meshWorker';

let worker: Worker | null = null;
const pending = new Map<string, (response: ParseResponse) => void>();

const getWorker = (): Worker => {
  if (worker) return worker;
  worker = new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<ParseResponse>) => {
    const resolve = pending.get(event.data.id);
    if (resolve) {
      pending.delete(event.data.id);
      resolve(event.data);
    }
  };
  worker.onerror = () => {
    pending.forEach((resolve, id) =>
      resolve({ ok: false, id, error: 'Сбой фонового потока разбора файла' }),
    );
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
};

const parseInWorker = (request: ParseRequest): Promise<ParseResponse> =>
  new Promise((resolve) => {
    pending.set(request.id, resolve);
    getWorker().postMessage(request, [request.buffer]);
  });

export interface LoadedScan {
  meta: ScanMeta;
}

export const loadScanFile = async (
  file: File,
  jaw: JawKind,
): Promise<LoadedScan> => {
  const id = `${jaw}-${Date.now().toString(36)}`;
  const buffer = await file.arrayBuffer();
  const response = await parseInWorker({ id, fileName: file.name, buffer });
  if (!response.ok) throw new Error(response.error);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(response.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(response.normal, 3));
  if (response.color) {
    geometry.setAttribute('color', new THREE.BufferAttribute(response.color, 3));
  }
  if (response.index) {
    geometry.setIndex(new THREE.BufferAttribute(response.index, 1));
  }

  autoAlignGeometry(geometry, jaw);
  geometry.computeBoundsTree();
  const arch = buildArchModel(geometry, jaw);

  const pickMesh = new THREE.Mesh(
    geometry,
    // Scanner meshes often have inconsistent winding; never cull while picking.
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  pickMesh.updateMatrixWorld();

  putScan({ id, geometry, arch, pickMesh });

  return {
    meta: {
      id,
      jaw,
      fileName: file.name,
      vertexCount: response.vertexCount,
      triangleCount: response.triangleCount,
      hasVertexColors: Boolean(response.color),
      visible: true,
      opacity: 1,
      geomVersion: 0,
    },
  };
};

/** Rebuilds a scan from the compact binary blocks stored inside a case file. */
export const restoreScan = (
  meta: ScanMeta,
  data: {
    position: Float32Array;
    normal: Float32Array;
    color: Float32Array | null;
    index: Uint32Array | null;
  },
) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normal, 3));
  if (data.color) geometry.setAttribute('color', new THREE.BufferAttribute(data.color, 3));
  if (data.index) geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeBoundsTree();

  const arch = buildArchModel(geometry, meta.jaw);
  const pickMesh = new THREE.Mesh(
    geometry,
    // Scanner meshes often have inconsistent winding; never cull while picking.
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  pickMesh.updateMatrixWorld();
  putScan({ id: meta.id, geometry, arch, pickMesh });
};
