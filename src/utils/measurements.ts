import * as cornerstoneTools from '@cornerstonejs/tools';
import { isMeasurement } from './annotationMemory';

/**
 * The measurements on a study, as a list the doctor can work with.
 *
 * Cornerstone keeps annotations in a store addressed by frame of reference and
 * tool name — fine for drawing them, useless for «which one was 4.2 mm and
 * where». This turns that store into rows: what it measures, how much, on
 * which plane, with a handle to remove or rename just that one.
 */

export interface Measurement {
  uid: string;
  toolName: string;
  label: string;
  /** Formatted value, or an empty string while the statistics are pending. */
  value: string;
  /** Free text the doctor attached. */
  text: string;
  /** World position, so clicking a row can jump to it. */
  point?: [number, number, number];
}

const TOOL_LABELS: Record<string, string> = {
  Length: 'Длина',
  Angle: 'Угол',
  CobbAngle: 'Угол Кобба',
  Bidirectional: 'Два размера',
  Probe: 'Точка',
  DragProbe: 'Точка',
  RectangleROI: 'Прямоугольник',
  EllipticalROI: 'Эллипс',
  CircleROI: 'Круг',
  PlanarFreehandROI: 'Контур',
  ArrowAnnotate: 'Указатель',
};

export function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}

/** Pulls the number a tool computed out of its cached statistics. */
function describeValue(annotation: any, unit: string): string {
  const stats = annotation?.data?.cachedStats;
  if (!stats) return '';

  for (const key of Object.keys(stats)) {
    const entry = stats[key];
    if (!entry) continue;

    // Bidirectional reports both axes; checking it before plain length keeps
    // the second number from being dropped.
    if (typeof entry.length === 'number' && typeof entry.width === 'number') {
      return `${entry.length.toFixed(1)} × ${entry.width.toFixed(1)} мм`;
    }
    if (typeof entry.length === 'number') return `${entry.length.toFixed(1)} мм`;
    if (typeof entry.angle === 'number') return `${entry.angle.toFixed(1)}°`;
    if (typeof entry.mean === 'number') {
      const area = typeof entry.area === 'number' ? `, S ${entry.area.toFixed(1)} мм²` : '';
      return `${Math.round(entry.mean)} ${unit}${area}`;
    }
    if (typeof entry.value === 'number') return `${Math.round(entry.value)} ${unit}`;
  }
  return '';
}

/** Everything currently drawn, newest last. */
export function listMeasurements(unit: string): Measurement[] {
  try {
    const all = cornerstoneTools.annotation.state.getAllAnnotations() ?? [];
    return all.filter(isMeasurement).map((annotation: any) => ({
      uid: annotation.annotationUID,
      toolName: annotation.metadata?.toolName ?? '',
      label: toolLabel(annotation.metadata?.toolName ?? ''),
      value: describeValue(annotation, unit),
      text: annotation.data?.label ?? annotation.data?.text ?? '',
      point: annotation.data?.handles?.points?.[0],
    }));
  } catch (err) {
    console.warn('Не удалось прочитать измерения:', err);
    return [];
  }
}

export function removeMeasurement(uid: string): void {
  try {
    cornerstoneTools.annotation.state.removeAnnotation(uid);
  } catch (err) {
    console.warn('Не удалось удалить измерение:', err);
  }
}

/** Attaches a caption to one measurement. */
export function labelMeasurement(uid: string, text: string): void {
  try {
    const annotation = cornerstoneTools.annotation.state.getAnnotation(uid) as any;
    if (!annotation) return;
    annotation.data = annotation.data ?? {};
    annotation.data.label = text;
  } catch (err) {
    console.warn('Не удалось подписать измерение:', err);
  }
}
