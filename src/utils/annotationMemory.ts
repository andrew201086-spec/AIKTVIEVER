import { eventTarget } from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';

/**
 * Cornerstone's measurements, turned into something that survives a reload.
 *
 * The annotation objects are plain data apart from their cached statistics,
 * which point at a volume that will not exist next time. Those are dropped on
 * the way out and recomputed on the way back in, so a restored length is
 * measured against the volume actually on screen rather than a remembered
 * number.
 */

/**
 * Only what the doctor drew.
 *
 * The annotation store also holds the crosshair tool's own state — one entry
 * per plane, rewritten on every navigation. Storing those and putting them
 * back would duplicate the crosshairs on top of the ones the tool creates for
 * itself, so the list is restricted to tools that produce a measurement.
 */
const MEASUREMENT_TOOLS = new Set([
  'Length',
  'Angle',
  'CobbAngle',
  'Bidirectional',
  'Probe',
  'DragProbe',
  'RectangleROI',
  'EllipticalROI',
  'CircleROI',
  'PlanarFreehandROI',
  'SplineROI',
  'ArrowAnnotate',
  'KeyImage',
]);

export function isMeasurement(annotation: any): boolean {
  return MEASUREMENT_TOOLS.has(annotation?.metadata?.toolName);
}

/** Measurements currently on screen, ready to be stored. */
export function collectAnnotations(): unknown[] {
  try {
    const all = cornerstoneTools.annotation.state.getAllAnnotations();
    return (all ?? []).filter(isMeasurement).map((annotation: any) => {
      const copy = JSON.parse(JSON.stringify(annotation));
      if (copy?.data) delete copy.data.cachedStats;
      // Nothing should come back selected or mid-drag.
      if (copy?.isLocked) copy.isLocked = false;
      if (copy?.highlighted) copy.highlighted = false;
      return copy;
    });
  } catch (err) {
    console.warn('Не удалось собрать измерения:', err);
    return [];
  }
}

/**
 * Puts stored measurements back on the study. Returns how many landed —
 * a restore that half-fails should say so rather than pretend.
 */
export function restoreAnnotations(stored: unknown[], element: HTMLDivElement | null): number {
  if (!stored?.length || !element) return 0;

  let restored = 0;
  for (const annotation of stored) {
    // A record written by an older version may still hold tool state.
    if (!isMeasurement(annotation)) continue;
    try {
      cornerstoneTools.annotation.state.addAnnotation(annotation as any, element);
      restored++;
    } catch (err) {
      console.warn('Измерение не восстановлено:', err);
    }
  }
  return restored;
}

/** How many of a stored list are measurements worth mentioning. */
export function countMeasurements(stored: unknown[] | undefined): number {
  return (stored ?? []).filter(isMeasurement).length;
}

/**
 * Fires whenever a measurement is drawn, moved or deleted.
 *
 * The tools package dispatches these on the core event target, not on its own
 * namespace — it does not export one.
 */
export function onAnnotationsChanged(handler: () => void): () => void {
  const events = [
    cornerstoneTools.Enums.Events.ANNOTATION_ADDED,
    cornerstoneTools.Enums.Events.ANNOTATION_COMPLETED,
    cornerstoneTools.Enums.Events.ANNOTATION_MODIFIED,
    cornerstoneTools.Enums.Events.ANNOTATION_REMOVED,
  ];

  for (const event of events) {
    eventTarget.addEventListener(event, handler);
  }

  return () => {
    for (const event of events) {
      eventTarget.removeEventListener(event, handler);
    }
  };
}
