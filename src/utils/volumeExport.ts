import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkSTLWriter from '@kitware/vtk.js/IO/Geometry/STLWriter';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import type { VolumeSampler } from './panorama';
import type { VolumeOrientation } from './orientation';

/**
 * Turning the volume into a surface the lab can open.
 *
 * A dental laboratory works in STL: a guide, a model, a printed splint all
 * start from a triangle mesh. Marching cubes over a density threshold is the
 * standard way there — everything denser than the threshold becomes solid,
 * everything else disappears.
 *
 * A full CBCT is far too much to mesh in a browser tab (a 700³ grid is
 * hundreds of millions of cells), so the volume is reduced first. The step is
 * reported, because the resolution of the mesh is the resolution of whatever
 * is made from it.
 */

export interface SurfaceOptions {
  /** Density above which a voxel is solid, in Hounsfield units. */
  thresholdHu: number;
  /**
   * Largest number of cells to mesh. Above roughly a hundred million the tab
   * runs out of memory rather than slowing down.
   */
  budgetCells?: number;
  onProgress?: (stage: string) => void;
}

export interface SurfaceResult {
  /** STL bytes, ready to be written to a file. */
  blob: Blob;
  triangles: number;
  /** Millimetres between samples of the reduced grid. */
  stepMm: number;
  dimensions: [number, number, number];
}

const DEFAULT_BUDGET = 40_000_000;

/**
 * Reduces the grid until it fits the budget, taking the *maximum* of each
 * block rather than the average: thinning by averaging erodes the cortical
 * plate until a real bone surface develops holes.
 */
function reduce(
  sampler: VolumeSampler,
  budget: number
): { data: Float32Array; dimensions: [number, number, number]; spacing: [number, number, number]; factor: number } {
  const [nx, ny, nz] = sampler.dimensions;
  const total = nx * ny * nz;

  let factor = 1;
  while (total / factor ** 3 > budget) factor++;

  const dx = Math.max(1, Math.floor(nx / factor));
  const dy = Math.max(1, Math.floor(ny / factor));
  const dz = Math.max(1, Math.floor(nz / factor));

  const data = new Float32Array(dx * dy * dz);
  const sliceStride = nx * ny;

  for (let z = 0; z < dz; z++) {
    for (let y = 0; y < dy; y++) {
      for (let x = 0; x < dx; x++) {
        let peak = -Infinity;
        for (let kz = 0; kz < factor; kz++) {
          const sz = z * factor + kz;
          if (sz >= nz) break;
          for (let ky = 0; ky < factor; ky++) {
            const sy = y * factor + ky;
            if (sy >= ny) break;
            const rowBase = sz * sliceStride + sy * nx;
            for (let kx = 0; kx < factor; kx++) {
              const sx = x * factor + kx;
              if (sx >= nx) break;
              const value = sampler.read(rowBase + sx);
              if (value > peak) peak = value;
            }
          }
        }
        data[z * dx * dy + y * dx + x] = peak === -Infinity ? -1000 : peak;
      }
    }
  }

  return {
    data,
    dimensions: [dx, dy, dz],
    spacing: [
      sampler.spacing[0] * factor,
      sampler.spacing[1] * factor,
      sampler.spacing[2] * factor,
    ],
    factor,
  };
}

/** Meshes everything above the threshold and writes it out as binary STL. */
export function exportSurface(sampler: VolumeSampler, options: SurfaceOptions): SurfaceResult {
  const budget = options.budgetCells ?? DEFAULT_BUDGET;

  options.onProgress?.('Уменьшение объёма…');
  const reduced = reduce(sampler, budget);

  options.onProgress?.('Построение поверхности…');
  const image = vtkImageData.newInstance();
  image.setDimensions(reduced.dimensions);
  image.setSpacing(reduced.spacing);
  image.setOrigin([0, 0, 0]);
  image.getPointData().setScalars(
    vtkDataArray.newInstance({ name: 'scalars', values: reduced.data, numberOfComponents: 1 })
  );

  const marching = vtkImageMarchingCubes.newInstance({
    contourValue: sampler.levels.fromHu(options.thresholdHu),
    computeNormals: true,
    mergePoints: true,
  });
  marching.setInputData(image);
  const surface = marching.getOutputData();

  // Marching cubes reads only origin and spacing — it ignores the direction
  // matrix — so the mesh comes out in voxel axes. On a volume whose axes are
  // not the identity that is a mirrored model, and a mirrored surgical guide
  // is drilled on the wrong side. The points are rotated into patient axes
  // here instead.
  orientPoints(surface, sampler.orientation);

  options.onProgress?.('Запись STL…');
  const writer = vtkSTLWriter.newInstance();
  writer.setInputData(surface);
  const stl = writer.getOutputData();

  const triangles = Math.round((surface.getPolys?.()?.getNumberOfValues?.() ?? 0) / 4);

  return {
    blob: new Blob([stl as ArrayBuffer | string], { type: 'model/stl' }),
    triangles,
    stepMm: Math.max(...reduced.spacing),
    dimensions: reduced.dimensions,
  };
}

/**
 * Rotates a mesh from voxel axes into the patient's.
 *
 * Only the rotation is applied, not the volume's position: an STL is a
 * standalone model, and where it sat in the scanner is meaningless to whoever
 * prints it. Which side is which is not.
 */
function orientPoints(surface: any, orientation: VolumeOrientation): void {
  const identity =
    orientation.i[0] === 1 && orientation.j[1] === 1 && orientation.k[2] === 1;
  if (identity) return;

  const points = surface?.getPoints?.();
  const values: Float32Array | Float64Array | undefined = points?.getData?.();
  if (!values) return;

  const { i, j, k } = orientation;
  for (let at = 0; at < values.length; at += 3) {
    const x = values[at];
    const y = values[at + 1];
    const z = values[at + 2];
    values[at] = i[0] * x + j[0] * y + k[0] * z;
    values[at + 1] = i[1] * x + j[1] * y + k[1] * z;
    values[at + 2] = i[2] * x + j[2] * y + k[2] * z;
  }
  points.modified?.();
  surface.modified?.();
}

/** Hands a blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoked on the next turn of the loop: Safari needs the URL alive for the
  // duration of the click it just handled.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
