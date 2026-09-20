import type { ArchGeometry, PanoramaImage, VolumeSampler } from './panorama';
import {
  cropPanorama,
  jawBandMm,
  occlusalHeightMm,
  renderAxialCrop,
  renderCrossSection,
  renderTangential,
  type Jaw,
  type SectionImage,
} from './toothSections';

/**
 * The set of pictures that make up one tooth: the same ten sections whether
 * they are being read on screen or printed into a report, so what the doctor
 * signs is exactly what they looked at.
 */

export interface Tile {
  key: string;
  label: string;
  image: SectionImage;
}

export interface TileRow {
  key: string;
  title: string;
  tiles: Tile[];
}

/** Width of the bucco-lingual sections, millimetres. */
export const CROSS_WIDTH_MM = 26;
/** Side of the axial squares, millimetres. */
export const AXIAL_SIZE_MM = 22;
/** Extent of the along-arch pictures, millimetres. */
export const ALONG_WIDTH_MM = 32;

export interface ToothTileOptions {
  sampler: VolumeSampler;
  geometry: ArchGeometry;
  archSlice: number;
  /** Distance along the arch of the tooth. */
  arcMm: number;
  jaw: Jaw;
  /** Panorama to crop the overview from; omitted when none is built. */
  panorama?: PanoramaImage | null;
  /** Spacing between the five cross-sections, millimetres. */
  crossStepMm?: number;
  /** Depth of the first axial cut below the occlusal plane, millimetres. */
  axialDepthMm?: number;
}

export function buildToothTiles(options: ToothTileOptions): TileRow[] {
  const {
    sampler,
    geometry,
    archSlice,
    arcMm,
    jaw,
    panorama,
    crossStepMm = 1,
    axialDepthMm = 6,
  } = options;

  const { curve, stepMm } = geometry;
  const column = arcMm / stepMm;
  const scaleMm = stepMm;
  const { fromMm, toMm } = jawBandMm(sampler, archSlice, jaw);
  const occlusal = occlusalHeightMm(sampler, archSlice);

  const overview: Tile[] = [];
  if (panorama) {
    overview.push({
      key: 'pano',
      label: 'Панорама, фрагмент',
      image: cropPanorama(panorama, arcMm, ALONG_WIDTH_MM, fromMm, toMm),
    });
  }
  overview.push({
    key: 'tangential',
    label: 'Вдоль дуги, слой 2 мм',
    image: renderTangential(sampler, curve, column, stepMm, {
      widthMm: ALONG_WIDTH_MM,
      fromMm,
      toMm,
      slabMm: 2,
    }),
  });

  const cross: Tile[] = [-2, -1, 0, 1, 2].map((n) => {
    const offset = n * crossStepMm;
    return {
      key: `cross${n}`,
      label: offset === 0 ? 'центр' : `${offset > 0 ? '+' : ''}${offset.toFixed(1)} мм`,
      image: renderCrossSection(sampler, curve, column + offset / stepMm, {
        widthMm: CROSS_WIDTH_MM,
        fromMm,
        toMm,
        slabMm: 1,
        scaleMm,
      }),
    };
  });

  // Going from the crown towards the apex, whichever way that is.
  const direction = jaw === 'upper' ? -1 : 1;
  const axial: Tile[] = [0, 5, 10].map((extra) => {
    const depth = axialDepthMm + extra;
    return {
      key: `axial${extra}`,
      label: `${depth} мм от окклюзии`,
      image: renderAxialCrop(sampler, curve, column, {
        sizeMm: AXIAL_SIZE_MM,
        heightMm: occlusal + direction * depth,
        scaleMm,
      }),
    };
  });

  return [
    { key: 'overview', title: 'Положение', tiles: overview },
    { key: 'cross', title: 'Поперечные срезы — язычная сторона слева, щёчная справа', tiles: cross },
    { key: 'axial', title: 'Аксиальные срезы по корню', tiles: axial },
  ];
}
