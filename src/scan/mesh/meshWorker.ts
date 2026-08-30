/// <reference lib="webworker" />
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface ParseRequest {
  id: string;
  fileName: string;
  buffer: ArrayBuffer;
}

export interface ParsedMesh {
  id: string;
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array | null;
  index: Uint32Array | null;
  vertexCount: number;
  triangleCount: number;
}

export type ParseResponse =
  | ({ ok: true } & ParsedMesh)
  | { ok: false; id: string; error: string };

const extensionOf = (fileName: string) =>
  fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();

const parseObj = (buffer: ArrayBuffer): THREE.BufferGeometry => {
  const text = new TextDecoder().decode(buffer);
  const group = new OBJLoader().parse(text);
  const geometries: THREE.BufferGeometry[] = [];
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const geometry = mesh.geometry.clone();
      // Merging requires a uniform attribute set.
      for (const name of Object.keys(geometry.attributes)) {
        if (name !== 'position' && name !== 'normal') {
          geometry.deleteAttribute(name);
        }
      }
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      geometries.push(geometry.toNonIndexed());
    }
  });
  if (geometries.length === 0) throw new Error('В OBJ не найдено полигонов');
  return geometries.length === 1
    ? geometries[0]
    : (mergeGeometries(geometries, false) as THREE.BufferGeometry);
};

const parse = (fileName: string, buffer: ArrayBuffer): THREE.BufferGeometry => {
  switch (extensionOf(fileName)) {
    case 'ply':
      return new PLYLoader().parse(buffer);
    case 'stl':
      return new STLLoader().parse(buffer);
    case 'obj':
      return parseObj(buffer);
    default:
      throw new Error('Поддерживаются файлы .ply, .stl и .obj');
  }
};

const toFloat32 = (attribute: THREE.BufferAttribute): Float32Array => {
  const array = attribute.array;
  return array instanceof Float32Array ? array : Float32Array.from(array);
};

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const { id, fileName, buffer } = event.data;
  try {
    const geometry = parse(fileName, buffer);

    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    geometry.computeBoundingBox();

    const position = toFloat32(geometry.getAttribute('position') as THREE.BufferAttribute);
    const normal = toFloat32(geometry.getAttribute('normal') as THREE.BufferAttribute);
    const colorAttribute = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    const color = colorAttribute ? toFloat32(colorAttribute) : null;

    let index: Uint32Array | null = null;
    if (geometry.index) {
      const source = geometry.index.array;
      index = source instanceof Uint32Array ? source : Uint32Array.from(source);
    }

    const vertexCount = position.length / 3;
    const triangleCount = index ? index.length / 3 : vertexCount / 3;

    const message: ParseResponse = {
      ok: true,
      id,
      position,
      normal,
      color,
      index,
      vertexCount,
      triangleCount,
    };

    // A shared backing buffer must not be listed twice in the transfer list.
    const transfer = [...new Set<ArrayBuffer>(
      [position.buffer, normal.buffer, color?.buffer, index?.buffer].filter(
        (b): b is ArrayBuffer => b instanceof ArrayBuffer,
      ),
    )];
    (self as unknown as Worker).postMessage(message, transfer);
  } catch (error) {
    const message: ParseResponse = {
      ok: false,
      id,
      error: error instanceof Error ? error.message : 'Не удалось прочитать файл',
    };
    (self as unknown as Worker).postMessage(message);
  }
};
