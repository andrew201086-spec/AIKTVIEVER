import { countMeasurements } from './annotationMemory';
import type { ArchPoint } from './panorama';
import type { ToothMark } from './toothSections';
import type { ToothNotes } from './toothChart';
import type { CanalPath, Implant } from './surgicalPlan';

/**
 * What the doctor did, kept between sessions.
 *
 * Measurements, tooth marks, the fitted arch and the draft report are work,
 * not view state: half an hour of it disappearing on an accidental reload is
 * the fastest way to lose a user's trust. It lives in IndexedDB on this
 * machine — like the images themselves, it never leaves the computer — keyed
 * by the study's own SeriesInstanceUID, so reopening the same series brings
 * the work back and a different one is untouched.
 */

const DB_NAME = 'cbct-viewer';
const DB_VERSION = 1;
const STORE = 'studies';

export interface StudyRecord {
  /** Key: the series this work belongs to. */
  seriesInstanceUID: string;
  patientName: string;
  description: string;
  sliceCount: number;
  savedAt: number;
  archPoints: ArchPoint[];
  archSlice: number;
  toothMarks: ToothMark[];
  /** Cornerstone annotations as plain JSON — lengths, angles. */
  annotations: unknown[];
  /** Draft of the report text. */
  conclusion: string;
  /** Status and note the doctor set per tooth, keyed by FDI number. */
  toothNotes?: ToothNotes;
  /** Planned fixtures and the traced canal. */
  implants?: Implant[];
  canals?: CanalPath[];
}

export type StudySummary = Pick<
  StudyRecord,
  'seriesInstanceUID' | 'patientName' | 'description' | 'sliceCount' | 'savedAt'
> & {
  markCount: number;
  measurementCount: number;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Opens the database once, and never rejects: a private window, a browser
 * with site data turned off or a quota refusal must cost the memory feature,
 * not the study.
 */
function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'seriesInstanceUID' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('Память исследований недоступна:', request.error);
        resolve(null);
      };
      request.onblocked = () => resolve(null);
    } catch (err) {
      console.warn('Память исследований недоступна:', err);
      resolve(null);
    }
  });

  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const transaction = db.transaction(STORE, mode);
          const request = action(transaction.objectStore(STORE));
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => {
            console.warn('Не удалось обратиться к памяти исследований:', request.error);
            resolve(null);
          };
        } catch (err) {
          console.warn('Не удалось обратиться к памяти исследований:', err);
          resolve(null);
        }
      })
  );
}

export function loadStudy(seriesInstanceUID: string): Promise<StudyRecord | null> {
  return run<StudyRecord>('readonly', (store) => store.get(seriesInstanceUID));
}

export function saveStudy(record: StudyRecord): Promise<unknown> {
  return run('readwrite', (store) => store.put(record));
}

export function deleteStudy(seriesInstanceUID: string): Promise<unknown> {
  return run('readwrite', (store) => store.delete(seriesInstanceUID));
}

/** Everything remembered, most recently touched first. */
export async function listStudies(): Promise<StudySummary[]> {
  const all = await run<StudyRecord[]>('readonly', (store) => store.getAll());
  if (!all) return [];
  return all
    .map((record) => ({
      seriesInstanceUID: record.seriesInstanceUID,
      patientName: record.patientName,
      description: record.description,
      sliceCount: record.sliceCount,
      savedAt: record.savedAt,
      markCount: record.toothMarks?.length ?? 0,
      measurementCount: countMeasurements(record.annotations),
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/** Is anything worth restoring in this record? */
export function hasWork(record: StudyRecord | null): boolean {
  if (!record) return false;
  return (
    (record.toothMarks?.length ?? 0) > 0 ||
    countMeasurements(record.annotations) > 0 ||
    (record.conclusion?.trim().length ?? 0) > 0 ||
    Object.keys(record.toothNotes ?? {}).length > 0 ||
    (record.implants?.length ?? 0) > 0 ||
    (record.canals?.length ?? 0) > 0 ||
    (record.archPoints?.length ?? 0) > 0
  );
}

/** «восстановлено: 3 метки, 2 измерения» */
export function describeRestored(record: StudyRecord): string {
  const parts: string[] = [];
  const marks = record.toothMarks?.length ?? 0;
  const measurements = countMeasurements(record.annotations);
  if (marks) parts.push(plural(marks, 'метка зуба', 'метки зубов', 'меток зубов'));
  if (measurements) parts.push(plural(measurements, 'измерение', 'измерения', 'измерений'));
  const noted = Object.keys(record.toothNotes ?? {}).length;
  if (noted) parts.push(plural(noted, 'зуб в формуле', 'зуба в формуле', 'зубов в формуле'));
  const fixtures = record.implants?.length ?? 0;
  if (fixtures) parts.push(plural(fixtures, 'имплантат', 'имплантата', 'имплантатов'));
  if (record.canals?.some((canal) => canal.points.length > 1)) parts.push('ход канала');
  if (record.archPoints?.length) parts.push('положение зубной дуги');
  if (record.conclusion?.trim()) parts.push('черновик заключения');
  return parts.join(', ');
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} ${many}`;
  if (mod10 === 1) return `${count} ${one}`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
  return `${count} ${many}`;
}
