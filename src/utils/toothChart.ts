import { ALL_FDI, jawOf, type Jaw } from './toothSections';
import type { ToothMap } from './toothDetect';

/**
 * The dental chart: the thing a dentist actually navigates by.
 *
 * A tooth here is a position, not a finding. What the volume shows (a crown
 * was measured at this position, or nothing was) is kept apart from what the
 * doctor says (absent, implant, crown, «смотреть»), so a correction never
 * looks like a measurement and the report can be honest about which is which.
 */

export type ToothStatus =
  | 'unknown'
  | 'present'
  | 'missing'
  | 'implant'
  | 'crown'
  | 'filled'
  | 'root-canal';

export const STATUS_LABELS: Record<ToothStatus, string> = {
  unknown: 'не определён',
  present: 'зуб на месте',
  missing: 'отсутствует',
  implant: 'имплантат',
  crown: 'коронка',
  filled: 'пломба',
  'root-canal': 'лечен канал',
};

/** Short marks drawn inside the tooth on the chart. */
export const STATUS_MARKS: Record<ToothStatus, string> = {
  unknown: '',
  present: '',
  missing: '—',
  implant: 'И',
  crown: 'К',
  filled: 'П',
  'root-canal': 'Э',
};

/** Statuses a user can set, in the order they appear in the menu. */
export const ASSIGNABLE_STATUSES: ToothStatus[] = [
  'present',
  'missing',
  'crown',
  'filled',
  'root-canal',
  'implant',
];

/** What the doctor has said about one tooth. Absent entry means nothing said. */
export interface ToothNote {
  status?: ToothStatus;
  note?: string;
}

export type ToothNotes = Record<number, ToothNote>;

export interface ChartTooth {
  fdi: number;
  jaw: Jaw;
  quadrant: number;
  /** 1 (central incisor) to 8 (third molar). */
  position: number;
  /** What the volume showed, before any correction. */
  detected: 'present' | 'missing' | 'unknown';
  /** Where the crown sits along the arch, when it was found. */
  arcMm?: number;
  /** Crowns that touched their neighbour and were divided by average width. */
  fused: boolean;
  /** What the doctor set, if anything. */
  status: ToothStatus;
  /** True when the doctor's status disagrees with the measurement. */
  corrected: boolean;
  note: string;
  /** This tooth carries a mark with its own card of sections. */
  marked: boolean;
  /** A lucency candidate was reported at this tooth. */
  flagged: boolean;
}

export interface ChartInput {
  upper?: ToothMap | null;
  lower?: ToothMap | null;
  notes: ToothNotes;
  /** FDI numbers that carry a tooth mark. */
  markedFdi?: Iterable<number>;
  /** FDI numbers where the lucency scan reported something. */
  flaggedFdi?: Iterable<number>;
}

/**
 * Builds the full 32-position chart. Every position exists whether or not a
 * tooth was found there — an empty place is information.
 */
export function buildChart(input: ChartInput): ChartTooth[] {
  const marked = new Set(input.markedFdi ?? []);
  const flagged = new Set(input.flaggedFdi ?? []);

  const detectedTeeth = new Map<number, { arcMm: number; fused: boolean }>();
  const detectedMissing = new Set<number>();

  for (const map of [input.upper, input.lower]) {
    if (!map) continue;
    for (const tooth of map.teeth) {
      detectedTeeth.set(tooth.fdi, { arcMm: tooth.arcMm, fused: tooth.fused });
    }
    for (const fdi of map.missing) detectedMissing.add(fdi);
  }

  return ALL_FDI.map((fdi) => {
    const found = detectedTeeth.get(fdi);
    const detected: ChartTooth['detected'] = found
      ? 'present'
      : detectedMissing.has(fdi)
      ? 'missing'
      : 'unknown';

    const said = input.notes[fdi];
    const status: ToothStatus = said?.status ?? (detected === 'unknown' ? 'unknown' : detected);

    return {
      fdi,
      jaw: jawOf(fdi),
      quadrant: Math.floor(fdi / 10),
      position: fdi % 10,
      detected,
      arcMm: found?.arcMm,
      fused: found?.fused ?? false,
      status,
      corrected: !!said?.status && detected !== 'unknown' && said.status !== detected,
      note: said?.note ?? '',
      marked: marked.has(fdi),
      flagged: flagged.has(fdi),
    };
  });
}

/** The chart laid out the way it is drawn: two jaws, right side first. */
export function chartRows(chart: ChartTooth[]): { upper: ChartTooth[]; lower: ChartTooth[] } {
  const byFdi = new Map(chart.map((tooth) => [tooth.fdi, tooth]));
  const row = (quadrants: [number, number]) => {
    const [right, left] = quadrants;
    const out: ChartTooth[] = [];
    for (let position = 8; position >= 1; position--) {
      const tooth = byFdi.get(right * 10 + position);
      if (tooth) out.push(tooth);
    }
    for (let position = 1; position <= 8; position++) {
      const tooth = byFdi.get(left * 10 + position);
      if (tooth) out.push(tooth);
    }
    return out;
  };
  return { upper: row([1, 2]), lower: row([4, 3]) };
}

/** One line of counts for the report header. */
export function summariseChart(chart: ChartTooth[]): {
  present: number;
  missing: number;
  noted: number;
  corrected: number;
} {
  let present = 0;
  let missing = 0;
  let noted = 0;
  let corrected = 0;
  for (const tooth of chart) {
    if (tooth.status === 'missing') missing++;
    else if (tooth.status !== 'unknown') present++;
    if (tooth.note.trim() || tooth.marked) noted++;
    if (tooth.corrected) corrected++;
  }
  return { present, missing, noted, corrected };
}
