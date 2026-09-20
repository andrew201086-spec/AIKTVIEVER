import cornerstoneDICOMImageLoader from '@cornerstonejs/dicom-image-loader';
import dicomParser from 'dicom-parser';
import { RENDER_BUDGET_BYTES, volumeBytesPerVoxel } from './renderCapabilities';

/**
 * Parsing, validation and geometry for local DICOM files.
 *
 * Cornerstone's own wadouri metadata provider only knows about a file *after*
 * it has been decoded, but the volume loader needs geometry up front to size
 * the volume. So we parse every file here with dicom-parser, hand the result
 * to our own metadata provider, and use the same numbers to group slices into
 * series and to sanity-check them before anything is rendered.
 */

export interface SliceInfo {
  file: File;
  imageId: string;
  name: string;
  instanceNumber: number;
  seriesInstanceUID: string;
  seriesNumber: number;
  seriesDescription: string;
  studyDescription: string;
  patientName: string;
  modality: string;
  rows: number;
  columns: number;
  imagePositionPatient: number[];
  imageOrientationPatient: number[];
  pixelSpacing: number[];
  sliceThickness: number;
  /** What the file claims its pixel values mean — 'HU' or something else. */
  rescaleType: string;
  /** Position along the scan axis — the only correct way to order slices. */
  axisPosition: number;
  metadata: Record<string, any>;
}

export interface SeriesInfo {
  seriesInstanceUID: string;
  seriesNumber: number;
  description: string;
  modality: string;
  patientName: string;
  studyDescription: string;
  /**
   * The file claims Hounsfield units. A claim only — CBCT units write it
   * routinely without being calibrated, so it is checked against the data
   * before any number is printed as HU (see density.ts).
   */
  declaresHu: boolean;
  imageIds: string[];
  sliceCount: number;
  rows: number;
  columns: number;
  pixelSpacing: number[];
  sliceSpacing: number;
  /** Physical extent in mm — x, y, z. */
  extent: [number, number, number];
  estimatedBytes: number;
  /** 1 = every slice; N = every Nth slice was loaded to fit in memory. */
  step: number;
  warnings: string[];
  blockers: string[];
  loadable: boolean;
}

/** Above this the browser tab is at serious risk even with slices dropped. */
const HARD_LIMIT_BYTES = 4 * 1024 * 1024 * 1024;
/** Above this loading is noticeably slow, but the result is fine. */
const SOFT_LIMIT_BYTES = 400 * 1024 * 1024;

export { RENDER_BUDGET_BYTES };

/** Smallest step that brings a series within the render budget. */
export function stepForBudget(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / RENDER_BUDGET_BYTES));
}

/**
 * A copy of the series with only every Nth slice. Spacing and size follow, so
 * measurements stay honest about what is actually loaded.
 */
export function withStep(series: SeriesInfo, step: number): SeriesInfo {
  if (step <= 1) return series;
  const imageIds = series.imageIds.filter((_, index) => index % step === 0);
  return {
    ...series,
    imageIds,
    sliceCount: imageIds.length,
    sliceSpacing: series.sliceSpacing * step,
    estimatedBytes: volumeBytesPerVoxel() * series.rows * series.columns * imageIds.length,
    step,
    warnings: [
      ...series.warnings,
      `Загружен каждый ${step}-й срез: полный объём не помещается в память видеокарты. ` +
        `Шаг по оси Z — ${(series.sliceSpacing * step).toFixed(2)} мм вместо ${series.sliceSpacing.toFixed(2)} мм`,
    ],
  };
}

const DICM_MAGIC = [0x44, 0x49, 0x43, 0x4d]; // 'DICM'

/**
 * A DICOM Part 10 file carries 'DICM' at offset 128. Checking the signature
 * beats filtering by file name: real exports contain DICOMDIR, files with no
 * extension at all, and viewer executables sitting next to the images.
 */
export async function looksLikeDicom(file: File): Promise<boolean> {
  if (file.size < 136) return false;
  const head = new Uint8Array(await file.slice(0, 132).arrayBuffer());
  return DICM_MAGIC.every((b, i) => head[128 + i] === b);
}

function splitNumbers(value: string | undefined, expected: number): number[] | null {
  if (!value) return null;
  const parts = value.split('\\').map(Number);
  if (parts.length !== expected || parts.some((n) => !isFinite(n))) return null;
  return parts;
}

function cross(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export class NotDicomError extends Error {}

/**
 * dicom-parser hands back every string as Latin-1. Clinics here routinely have
 * Cyrillic patient names, so text fields have to be decoded according to
 * Specific Character Set (0008,0005) or they arrive as mojibake.
 */
function makeTextReader(dataSet: any): (tag: string) => string {
  const declared = (dataSet.string('x00080005') || '').toUpperCase();
  let encoding = 'iso-8859-1';
  if (declared.includes('192')) encoding = 'utf-8';
  else if (declared.includes('144')) encoding = 'iso-8859-5';
  else if (declared.includes('126')) encoding = 'iso-8859-7';
  else if (declared.includes('148')) encoding = 'iso-8859-9';
  else if (declared.includes('1251')) encoding = 'windows-1251';

  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(encoding);
  } catch {
    decoder = new TextDecoder('iso-8859-1');
  }

  return (tag: string) => {
    const element = dataSet.elements?.[tag];
    if (!element || !element.length) return '';
    const bytes = dataSet.byteArray.subarray(element.dataOffset, element.dataOffset + element.length);
    return decoder.decode(bytes).replace(/\0/g, '').trim();
  };
}

/**
 * How much of a large file we read to find the header. Everything we need
 * lives before the pixel data, and a multi-frame CBCT export runs to hundreds
 * of megabytes — reading the whole thing here and letting the loader read it
 * again is what exhausts the tab's memory before the volume is even built.
 */
const HEADER_PROBE_BYTES = 4 * 1024 * 1024;

async function readHeader(file: File): Promise<any> {
  if (file.size > HEADER_PROBE_BYTES) {
    try {
      const prefix = new Uint8Array(await file.slice(0, HEADER_PROBE_BYTES).arrayBuffer());
      // untilTag stops before the pixel data but still records its element,
      // so the "is this an image" check below keeps working.
      const dataSet = dicomParser.parseDicom(prefix, { untilTag: 'x7fe00010' });
      if (dataSet.uint16('x00280010')) return dataSet;
    } catch {
      // Header longer than the probe, or an unusual layout — read it all.
    }
  }
  return dicomParser.parseDicom(new Uint8Array(await file.arrayBuffer()));
}

/** Files whose parsed dataset we pinned in the loader's cache. */
const primedDataSets = new Set<string>();

/**
 * Parses a multi-frame file into the loader's dataset cache before any frame
 * is requested.
 *
 * The loader reads the frame number from the imageId as 1-based and converts
 * it to a 0-based index — but only once the dataset is cached. On the very
 * first request for a file it passes the 1-based number straight through, so
 * whichever frame happens to arrive first comes back off by one, and the last
 * frame throws "frame exceeds size of pixelData". Priming the cache means the
 * corrected path is the only one the volume ever takes.
 */
async function primeDataSetCache(baseImageId: string): Promise<void> {
  const url = baseImageId.substring(baseImageId.indexOf(':') + 1);
  if (primedDataSets.has(url)) return;
  const { dataSetCacheManager, loadFileRequest } = cornerstoneDICOMImageLoader.wadouri;
  await dataSetCacheManager.load(url, loadFileRequest, baseImageId);
  primedDataSets.add(url);
}

/** Frees the datasets pinned by primeDataSetCache. */
export function releaseDataSets(): void {
  const { dataSetCacheManager } = cornerstoneDICOMImageLoader.wadouri;
  for (const url of primedDataSets) {
    try {
      dataSetCacheManager.unload(url);
    } catch {
      // Already gone — nothing to free.
    }
  }
  primedDataSets.clear();
}

/** First item of a DICOM sequence, or undefined. */
function sequenceItem(dataSet: any, tag: string, index = 0): any {
  return dataSet?.elements?.[tag]?.items?.[index]?.dataSet;
}

function firstNumber(...values: Array<string | undefined>): number | undefined {
  for (const value of values) {
    const n = Number(value);
    if (value !== undefined && value !== '' && isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Reads one file and returns every slice it holds.
 *
 * Most scanners write one file per slice, but plenty of CBCT units export the
 * whole volume as a single multi-frame file. Reading such a file as one image
 * yields a "series" of one slice that nothing can reconstruct, so the frames
 * have to be unrolled here. Geometry comes from the functional group sequences
 * when the file has them, and from the first frame's position stepped along
 * the slice normal when it does not.
 *
 * Throws NotDicomError for files that are not stackable images (DICOMDIR,
 * structured reports, junk).
 */
export async function parseFile(file: File, fallbackIndex: number): Promise<SliceInfo[]> {
  let dataSet: any;
  try {
    dataSet = await readHeader(file);
  } catch (err: any) {
    throw new NotDicomError(`${file.name}: не удалось разобрать DICOM (${err?.message || err})`);
  }

  const sopClassUID = dataSet.string('x00080016') || '';
  // Media Storage Directory — an index file, never an image.
  if (sopClassUID === '1.2.840.10008.1.3.10') {
    throw new NotDicomError(`${file.name}: DICOMDIR, не изображение`);
  }
  if (!dataSet.elements['x7fe00010']) {
    throw new NotDicomError(`${file.name}: нет пиксельных данных`);
  }

  const rows = dataSet.uint16('x00280010') || 0;
  const columns = dataSet.uint16('x00280011') || 0;
  if (!rows || !columns) {
    throw new NotDicomError(`${file.name}: не указан размер изображения`);
  }

  const bitsAllocated = dataSet.uint16('x00280100') || 16;
  const bitsStored = dataSet.uint16('x00280101') || bitsAllocated;
  const highBit = dataSet.uint16('x00280102') ?? bitsStored - 1;
  const pixelRepresentation = dataSet.uint16('x00280103') ?? 0;
  const samplesPerPixel = dataSet.uint16('x00280002') || 1;
  const photometricInterpretation = dataSet.string('x00280004') || 'MONOCHROME2';

  const text = makeTextReader(dataSet);

  const modality = dataSet.string('x00080060') || 'CT';
  const seriesInstanceUID = dataSet.string('x0020000e') || 'unknown-series';
  const seriesNumber = Number(dataSet.string('x00200011') ?? NaN);
  const seriesDescription = text('x0008103e');
  const studyDescription = text('x00081030');
  const patientName = text('x00100010').replace(/\^+/g, ' ').trim();
  const frameOfReferenceUID = dataSet.string('x00200052') || seriesInstanceUID;
  const instanceNumber = Number(dataSet.string('x00200013') ?? NaN);

  const numberOfFrames = Math.max(1, dataSet.intString('x00280008') || 1);

  // Enhanced multi-frame objects keep geometry in functional group sequences
  // rather than at the top level.
  const shared = sequenceItem(dataSet, 'x52009229');
  const sharedMeasures = shared && sequenceItem(shared, 'x00289110');
  const sharedOrientation = shared && sequenceItem(shared, 'x00209116');
  const perFrameGroups = dataSet.elements?.['x52009230']?.items;

  const pixelSpacing =
    splitNumbers(sharedMeasures?.string('x00280030'), 2) ||
    splitNumbers(dataSet.string('x00280030'), 2) ||
    // Some CBCT units write Imager Pixel Spacing instead.
    splitNumbers(dataSet.string('x00181164'), 2) ||
    [1, 1];

  const sliceThicknessRaw = firstNumber(
    sharedMeasures?.string('x00180050'),
    dataSet.string('x00180050')
  );
  const sliceThickness = sliceThicknessRaw && sliceThicknessRaw > 0 ? sliceThicknessRaw : 0;

  // Distance between slice centres. Overlapping reconstructions declare a
  // thickness larger than the actual step, so this tag wins when present.
  const spacingBetweenSlices = firstNumber(
    sharedMeasures?.string('x00180088'),
    dataSet.string('x00180088')
  );
  const frameStep = spacingBetweenSlices || sliceThickness || 1;

  const baseOrientation =
    splitNumbers(sharedOrientation?.string('x00200037'), 6) ||
    splitNumbers(dataSet.string('x00200037'), 6) ||
    [1, 0, 0, 0, 1, 0];
  const basePosition =
    splitNumbers(dataSet.string('x00200032'), 3) ||
    [-(columns * pixelSpacing[1]) / 2, -(rows * pixelSpacing[0]) / 2, fallbackIndex * frameStep];

  const windowCenter = splitNumbersLoose(dataSet.string('x00281050'));
  const windowWidth = splitNumbersLoose(dataSet.string('x00281051'));

  const rescaleInterceptRaw = Number(dataSet.string('x00281052'));
  const rescaleSlopeRaw = Number(dataSet.string('x00281053'));
  const rescaleIntercept = isFinite(rescaleInterceptRaw) ? rescaleInterceptRaw : 0;
  const rescaleSlope = isFinite(rescaleSlopeRaw) && rescaleSlopeRaw !== 0 ? rescaleSlopeRaw : 1;

  const baseImageId = cornerstoneDICOMImageLoader.wadouri.fileManager.add(file);
  const baseSopInstanceUID = dataSet.string('x00080018') || `generated.${fallbackIndex}`;

  const imagePixelModule = {
    bitsAllocated,
    bitsStored,
    highBit,
    samplesPerPixel,
    pixelRepresentation,
    photometricInterpretation,
    rows,
    columns,
  };
  const generalSeriesModule = { modality, seriesInstanceUID, seriesNumber, seriesDescription };
  const rescaleType = (dataSet.string('x00281054') || (modality === 'CT' ? 'HU' : 'US')).toUpperCase();
  const modalityLutModule = { rescaleIntercept, rescaleSlope, rescaleType };
  const voiLutModule =
    windowCenter && windowWidth
      ? { voiLutModule: { windowCenter, windowWidth, voiLUTFunction: 'LINEAR' } }
      : {};

  if (numberOfFrames > 1) {
    await primeDataSetCache(baseImageId);
  }

  const slices: SliceInfo[] = [];

  for (let frame = 0; frame < numberOfFrames; frame++) {
    const perFrame = perFrameGroups?.[frame]?.dataSet;
    const framePosition = perFrame && sequenceItem(perFrame, 'x00209113');
    const frameOrientation = perFrame && sequenceItem(perFrame, 'x00209116');
    const frameMeasures = perFrame && sequenceItem(perFrame, 'x00289110');

    const imageOrientationPatient =
      splitNumbers(frameOrientation?.string('x00200037'), 6) || baseOrientation;
    const rowCosines = imageOrientationPatient.slice(0, 3);
    const columnCosines = imageOrientationPatient.slice(3, 6);
    const normal = cross(rowCosines, columnCosines);

    const framePixelSpacing =
      splitNumbers(frameMeasures?.string('x00280030'), 2) || pixelSpacing;

    const explicitPosition = splitNumbers(framePosition?.string('x00200032'), 3);
    const imagePositionPatient =
      explicitPosition ||
      // No per-frame position: step along the slice normal from the first one.
      basePosition.map((value, axis) => value + normal[axis] * frame * frameStep);

    const axisPosition = dot(imagePositionPatient, normal);

    // Frames are addressed with a 1-based &frame= suffix, which is the syntax
    // @cornerstonejs/dicom-image-loader expects for multi-frame files.
    const imageId = numberOfFrames > 1 ? `${baseImageId}&frame=${frame + 1}` : baseImageId;

    slices.push({
      file,
      imageId,
      name: numberOfFrames > 1 ? `${file.name} · кадр ${frame + 1}` : file.name,
      instanceNumber:
        numberOfFrames > 1 ? frame + 1 : isFinite(instanceNumber) ? instanceNumber : fallbackIndex,
      seriesInstanceUID,
      seriesNumber: isFinite(seriesNumber) ? seriesNumber : 0,
      seriesDescription,
      studyDescription,
      patientName,
      modality,
      rows,
      columns,
      imagePositionPatient,
      imageOrientationPatient,
      pixelSpacing: framePixelSpacing,
      sliceThickness,
      rescaleType,
      axisPosition,
      metadata: {
        imagePixelModule,
        imagePlaneModule: {
          rows,
          columns,
          imageOrientationPatient,
          rowCosines,
          columnCosines,
          imagePositionPatient,
          sliceThickness,
          sliceLocation: axisPosition,
          pixelSpacing: framePixelSpacing,
          rowPixelSpacing: framePixelSpacing[0],
          columnPixelSpacing: framePixelSpacing[1],
          frameOfReferenceUID,
        },
        generalSeriesModule,
        ...voiLutModule,
        modalityLutModule,
        sopCommonModule: {
          sopClassUID,
          sopInstanceUID:
            numberOfFrames > 1 ? `${baseSopInstanceUID}.${frame + 1}` : baseSopInstanceUID,
        },
      },
    });
  }

  return slices;
}

function splitNumbersLoose(value: string | undefined): number[] | undefined {
  if (!value) return undefined;
  const parts = value.split('\\').map(Number).filter((n) => isFinite(n));
  return parts.length ? parts : undefined;
}

/**
 * Groups slices into series and works out whether each one can be rendered as
 * a volume. A single folder from a scanner routinely holds the scout view, a
 * panoramic reconstruction and the CBCT volume itself — stacking them together
 * produces a garbage volume, so they have to be separated before loading.
 */
export function buildSeries(slices: SliceInfo[]): SeriesInfo[] {
  const groups = new Map<string, SliceInfo[]>();
  for (const slice of slices) {
    const list = groups.get(slice.seriesInstanceUID);
    if (list) list.push(slice);
    else groups.set(slice.seriesInstanceUID, [slice]);
  }

  const series: SeriesInfo[] = [];

  for (const [uid, group] of groups) {
    // Order along the scan axis. Sorting by the raw Z coordinate only works
    // for axial series; projecting onto the slice normal works for any tilt.
    group.sort((a, b) => {
      if (a.axisPosition !== b.axisPosition) return a.axisPosition - b.axisPosition;
      if (a.instanceNumber !== b.instanceNumber) return a.instanceNumber - b.instanceNumber;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });

    const first = group[0];
    const warnings: string[] = [];
    const blockers: string[] = [];

    const inconsistentSize = group.some((s) => s.rows !== first.rows || s.columns !== first.columns);
    if (inconsistentSize) {
      blockers.push('Срезы имеют разный размер — объём собрать нельзя');
    }

    // Slice spacing from actual positions, not from the declared thickness:
    // overlapping reconstructions declare thickness larger than the step.
    const gaps: number[] = [];
    for (let i = 1; i < group.length; i++) {
      gaps.push(Math.abs(group[i].axisPosition - group[i - 1].axisPosition));
    }
    const positive = gaps.filter((g) => g > 1e-4);
    const medianGap = positive.length ? median(positive) : first.sliceThickness || 1;

    if (gaps.some((g) => g <= 1e-4)) {
      warnings.push('Есть срезы с совпадающими координатами — возможны дубликаты файлов');
    }
    const spread = positive.length ? (Math.max(...positive) - Math.min(...positive)) / medianGap : 0;
    if (spread > 0.02) {
      warnings.push(
        `Шаг срезов неравномерный (разброс ${(spread * 100).toFixed(0)}%) — измерения по оси Z могут быть неточными`
      );
    }

    if (group.length < 3) {
      blockers.push(
        group.length === 1
          ? 'Один срез — объём построить не из чего. Если выбирали отдельный файл, укажите папку с серией целиком или ZIP-архив'
          : 'Меньше 3 срезов — это не объёмное исследование'
      );
    }

    const estimatedBytes = volumeBytesPerVoxel() * first.rows * first.columns * group.length;
    if (estimatedBytes > HARD_LIMIT_BYTES) {
      blockers.push(
        `Объём потребует ${formatBytes(estimatedBytes)} оперативной памяти — браузер это не выдержит`
      );
    } else if (estimatedBytes > SOFT_LIMIT_BYTES) {
      warnings.push(`Крупное исследование: около ${formatBytes(estimatedBytes)} в памяти, загрузка займёт время`);
    }

    series.push({
      seriesInstanceUID: uid,
      seriesNumber: first.seriesNumber,
      description: first.seriesDescription || first.studyDescription || 'Без описания',
      modality: first.modality,
      patientName: first.patientName,
      studyDescription: first.studyDescription,
      declaresHu: first.modality === 'CT' && first.rescaleType === 'HU',
      imageIds: group.map((s) => s.imageId),
      sliceCount: group.length,
      rows: first.rows,
      columns: first.columns,
      pixelSpacing: first.pixelSpacing,
      sliceSpacing: medianGap,
      extent: [
        first.columns * first.pixelSpacing[1],
        first.rows * first.pixelSpacing[0],
        group.length * medianGap,
      ],
      estimatedBytes,
      step: 1,
      warnings,
      blockers,
      loadable: blockers.length === 0,
    });
  }

  // Biggest, most complete series first — that is almost always the CBCT volume.
  series.sort((a, b) => {
    if (a.loadable !== b.loadable) return a.loadable ? -1 : 1;
    return b.sliceCount - a.sliceCount;
  });

  return series;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} ГБ`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} МБ`;
  return `${Math.round(bytes / 1024)} КБ`;
}

/** 1 срез · 2 среза · 5 срезов */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} ${many}`;
  if (mod10 === 1) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}

export function slices(count: number): string {
  return plural(count, 'срез', 'среза', 'срезов');
}

export function seriesCount(count: number): string {
  return plural(count, 'серия', 'серии', 'серий');
}
