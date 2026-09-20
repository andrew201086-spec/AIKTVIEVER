import React, { useCallback, useEffect, useState } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import { axisLabel, type PatientAxis } from '../utils/orientation';

/**
 * The 1.x typings lag the implementation: `getSliceIndex` and
 * `getNumberOfSlices` are on VolumeViewport at runtime but absent from
 * IVolumeViewport, so the two are declared here rather than cast away at
 * every call.
 */
type SliceAwareViewport = cornerstone.Types.IVolumeViewport & {
  getSliceIndex?: () => number;
  getNumberOfSlices?: () => number;
};

interface SliceScrollerProps {
  viewport: SliceAwareViewport | null;
  /** Hidden on the shrunken panes, where there is no room for it. */
  compact?: boolean;
}

interface SlicePosition {
  index: number;
  count: number;
  /** Coordinate of this slice along the axis it moves through, millimetres. */
  positionMm: number;
  /** The patient axis that coordinate is measured on: L, P or S. */
  axis: PatientAxis;
}

/**
 * Where in the stack the slice on screen is, and a way to move through it.
 *
 * A radiologist reads a study by running up and down the stack, and needs to
 * be able to say which slice a finding is on. Without a number, a position and
 * something to drag, the only way through the volume is the scroll wheel and
 * the only way to describe a slice is «примерно посередине».
 */
export const SliceScroller: React.FC<SliceScrollerProps> = ({ viewport, compact }) => {
  const [position, setPosition] = useState<SlicePosition | null>(null);

  const read = useCallback(() => {
    if (!viewport?.getSliceIndex) return;
    try {
      const index = viewport.getSliceIndex();
      const count = viewport.getNumberOfSlices?.() ?? 0;
      if (!Number.isFinite(index) || !count) {
        setPosition(null);
        return;
      }
      // The coordinate is reported on the patient axis the slices actually
      // move along, so «S 48.3 мм» means something to whoever reads the
      // report — a raw dot product against the view normal does not.
      const { focalPoint, viewPlaneNormal } = viewport.getCamera();
      let positionMm = 0;
      let axis: PatientAxis = 'S';
      if (focalPoint && viewPlaneNormal) {
        let dominant = 0;
        for (let n = 1; n < 3; n++) {
          if (Math.abs(viewPlaneNormal[n]) > Math.abs(viewPlaneNormal[dominant])) dominant = n;
        }
        positionMm = focalPoint[dominant];
        const positive: [number, number, number] = [0, 0, 0];
        positive[dominant] = 1;
        axis = axisLabel(positive);
      }

      setPosition((previous) =>
        previous && previous.index === index && previous.count === count
          ? previous
          : { index, count, positionMm, axis }
      );
    } catch {
      setPosition(null);
    }
  }, [viewport]);

  useEffect(() => {
    if (!viewport) return;
    const element = viewport.element;
    read();
    element.addEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, read);
    element.addEventListener(cornerstone.Enums.Events.IMAGE_RENDERED, read);
    return () => {
      element.removeEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, read);
      element.removeEventListener(cornerstone.Enums.Events.IMAGE_RENDERED, read);
    };
  }, [viewport, read]);

  if (!position || position.count < 2) return null;

  const goTo = (target: number) => {
    if (!viewport) return;
    try {
      cornerstoneTools.utilities.scroll(viewport as any, {
        delta: Math.round(target) - position.index,
      });
    } catch {
      // Nothing to scroll — the volume is still streaming in.
    }
  };

  return (
    <>
      <div
        className={`absolute bottom-2 left-2.5 font-mono text-gray-300 bg-black/70 px-2 py-0.5 rounded pointer-events-none tabular-nums ${
          compact ? 'text-[9px]' : 'text-[11px]'
        }`}
        title="Номер среза в стопке и его положение по оси просмотра"
      >
        {position.index + 1}/{position.count}
        {!compact && ` · ${position.axis} ${position.positionMm.toFixed(1)} мм`}
      </div>

      {!compact && (
        <input
          type="range"
          min={0}
          max={position.count - 1}
          step={1}
          value={position.index}
          onChange={(event) => goTo(Number(event.target.value))}
          // The pointer must not reach the viewport, or Cornerstone starts a
          // tool drag underneath the slider.
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          aria-label="Срез"
          title="Перемотка по срезам"
          className="slice-range absolute right-1 top-8 bottom-8 w-4 opacity-40 hover:opacity-100 focus:opacity-100 transition-opacity accent-sky-400 cursor-ns-resize"
        />
      )}
    </>
  );
};
