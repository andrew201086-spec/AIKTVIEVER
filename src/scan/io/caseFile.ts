import JSZip from 'jszip';
import type { CaseManifest, ScanMeta } from '../types';
import { getScan } from '../mesh/registry';

const MAGIC = 0x4d4b4941; // "AIKM"
const HEADER_BYTES = 20;
const FLAG_COLOR = 1;

export interface MeshBlock {
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array | null;
  index: Uint32Array | null;
}

const encodeMesh = (scanId: string): ArrayBuffer | null => {
  const record = getScan(scanId);
  if (!record) return null;
  const geometry = record.geometry;
  const position = geometry.getAttribute('position').array as Float32Array;
  const normal = geometry.getAttribute('normal').array as Float32Array;
  const colorAttribute = geometry.getAttribute('color');
  const color = colorAttribute ? (colorAttribute.array as Float32Array) : null;
  const index = geometry.index ? (geometry.index.array as Uint32Array) : null;

  const vertexCount = position.length / 3;
  const bytes =
    HEADER_BYTES +
    position.byteLength +
    normal.byteLength +
    (color ? color.byteLength : 0) +
    (index ? index.byteLength : 0);

  const buffer = new ArrayBuffer(bytes);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, vertexCount, true);
  view.setUint32(12, index ? index.length : 0, true);
  view.setUint32(16, color ? FLAG_COLOR : 0, true);

  let offset = HEADER_BYTES;
  new Float32Array(buffer, offset, position.length).set(position);
  offset += position.byteLength;
  new Float32Array(buffer, offset, normal.length).set(normal);
  offset += normal.byteLength;
  if (color) {
    new Float32Array(buffer, offset, color.length).set(color);
    offset += color.byteLength;
  }
  if (index) new Uint32Array(buffer, offset, index.length).set(index);

  return buffer;
};

export const decodeMesh = (buffer: ArrayBuffer): MeshBlock => {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Повреждённый блок сетки');
  const vertexCount = view.getUint32(8, true);
  const indexCount = view.getUint32(12, true);
  const hasColor = (view.getUint32(16, true) & FLAG_COLOR) !== 0;

  let offset = HEADER_BYTES;
  const position = new Float32Array(buffer.slice(offset, offset + vertexCount * 12));
  offset += vertexCount * 12;
  const normal = new Float32Array(buffer.slice(offset, offset + vertexCount * 12));
  offset += vertexCount * 12;
  let color: Float32Array | null = null;
  if (hasColor) {
    color = new Float32Array(buffer.slice(offset, offset + vertexCount * 12));
    offset += vertexCount * 12;
  }
  const index =
    indexCount > 0
      ? new Uint32Array(buffer.slice(offset, offset + indexCount * 4))
      : null;

  return { position, normal, color, index };
};

export const buildCaseFile = async (
  manifest: Omit<CaseManifest, 'version' | 'app' | 'savedAt'>,
  includeScans: boolean,
  onProgress?: (percent: number) => void,
): Promise<Blob> => {
  const zip = new JSZip();
  const full: CaseManifest = {
    version: 1,
    app: 'AIKT Viewer',
    savedAt: new Date().toISOString(),
    ...manifest,
  };
  zip.file('manifest.json', JSON.stringify(full, null, 2));

  if (includeScans) {
    for (const scan of manifest.scans) {
      const buffer = encodeMesh(scan.id);
      if (buffer) {
        zip.file(`meshes/${scan.id}.bin`, buffer, { compression: 'STORE' });
      }
    }
  }

  return zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } },
    (meta) => onProgress?.(Math.round(meta.percent)),
  );
};

export interface LoadedCase {
  manifest: CaseManifest;
  meshes: Map<string, MeshBlock>;
}

export const readCaseFile = async (file: File): Promise<LoadedCase> => {
  const zip = await JSZip.loadAsync(file);
  const manifestEntry = zip.file('manifest.json');
  if (!manifestEntry) throw new Error('Это не файл клинического случая');
  const manifest = JSON.parse(await manifestEntry.async('string')) as CaseManifest;

  const meshes = new Map<string, MeshBlock>();
  for (const scan of manifest.scans as ScanMeta[]) {
    const entry = zip.file(`meshes/${scan.id}.bin`);
    if (!entry) continue;
    meshes.set(scan.id, decodeMesh(await entry.async('arraybuffer')));
  }
  return { manifest, meshes };
};

export const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
