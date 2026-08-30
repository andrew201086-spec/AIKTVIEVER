import type { JawKind, ToothClass, ToothNumber } from '../types';

/** Teeth in anatomical order, patient's right to left. */
export const UPPER_ARCH: ToothNumber[] = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
];
export const LOWER_ARCH: ToothNumber[] = [
  48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
];

export const archOf = (jaw: JawKind): ToothNumber[] =>
  jaw === 'upper' ? UPPER_ARCH : LOWER_ARCH;

export const jawOfTooth = (tooth: ToothNumber): JawKind => {
  const quadrant = Math.floor(tooth / 10);
  return quadrant === 1 || quadrant === 2 ? 'upper' : 'lower';
};

/** Patient's own side, not screen side. */
export const sideOfTooth = (tooth: ToothNumber): 'right' | 'left' => {
  const quadrant = Math.floor(tooth / 10);
  return quadrant === 1 || quadrant === 4 ? 'right' : 'left';
};

export const toothIndex = (tooth: ToothNumber): number => tooth % 10;

export const classOfTooth = (tooth: ToothNumber): ToothClass => {
  const i = toothIndex(tooth);
  if (i <= 2) return 'incisor';
  if (i === 3) return 'canine';
  if (i <= 5) return 'premolar';
  return 'molar';
};

/**
 * Average crown dimensions in millimetres (Wheeler's anatomy tables, rounded).
 * width = mesiodistal, depth = buccolingual, height = crown height.
 */
interface ToothDims {
  width: number;
  depth: number;
  height: number;
}

const MAXILLARY: Record<number, ToothDims> = {
  1: { width: 8.5, depth: 7.0, height: 10.5 },
  2: { width: 6.5, depth: 6.0, height: 9.0 },
  3: { width: 7.6, depth: 8.0, height: 10.0 },
  4: { width: 7.1, depth: 9.2, height: 8.5 },
  5: { width: 6.6, depth: 9.0, height: 7.5 },
  6: { width: 10.4, depth: 11.5, height: 7.5 },
  7: { width: 9.8, depth: 11.0, height: 7.0 },
  8: { width: 8.8, depth: 10.5, height: 6.5 },
};

const MANDIBULAR: Record<number, ToothDims> = {
  1: { width: 5.3, depth: 6.0, height: 9.0 },
  2: { width: 5.7, depth: 6.2, height: 9.5 },
  3: { width: 6.8, depth: 7.5, height: 11.0 },
  4: { width: 7.0, depth: 7.9, height: 8.5 },
  5: { width: 7.1, depth: 8.7, height: 8.0 },
  6: { width: 11.2, depth: 10.3, height: 7.5 },
  7: { width: 10.7, depth: 10.1, height: 7.0 },
  8: { width: 10.0, depth: 9.5, height: 7.0 },
};

export const dimsOfTooth = (tooth: ToothNumber): ToothDims => {
  const table = jawOfTooth(tooth) === 'upper' ? MAXILLARY : MANDIBULAR;
  return table[toothIndex(tooth)] ?? { width: 8, depth: 8, height: 8 };
};

const RU_CLASS: Record<ToothClass, string> = {
  incisor: 'резец',
  canine: 'клык',
  premolar: 'премоляр',
  molar: 'моляр',
};

export const toothLabel = (tooth: ToothNumber): string => {
  const side = sideOfTooth(tooth) === 'right' ? 'справа' : 'слева';
  const jaw = jawOfTooth(tooth) === 'upper' ? 'верх' : 'низ';
  return `${tooth} — ${RU_CLASS[classOfTooth(tooth)]}, ${jaw} ${side}`;
};

/** Default implant fixture size that fits the given site. */
export const defaultImplantSize = (
  tooth: ToothNumber,
): { diameter: number; length: number } => {
  const cls = classOfTooth(tooth);
  if (cls === 'molar') return { diameter: 4.5, length: 10 };
  if (cls === 'premolar') return { diameter: 4.0, length: 11.5 };
  if (cls === 'canine') return { diameter: 3.75, length: 13 };
  return { diameter: 3.3, length: 11.5 };
};

/** Position along the arch, right to left — the order connectors must follow. */
export const archOrderIndex = (tooth: ToothNumber): number => {
  const arch = archOf(jawOfTooth(tooth));
  const index = arch.indexOf(tooth);
  return index === -1 ? 99 : index;
};
