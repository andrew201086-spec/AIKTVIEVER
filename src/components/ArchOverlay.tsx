import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import type { ArchPoint } from '../utils/panorama';

interface ArchOverlayProps {
  /** The axial viewport the arch is drawn over. */
  viewport: cornerstone.Types.IVolumeViewport | null;
  points: ArchPoint[];
  /** Axial slice the arch was fitted on — only used to place it in world space. */
  sliceIndex: number;
  onChange: (points: ArchPoint[]) => void;
}

/**
 * The dental arch, drawn on the axial view and draggable by its control
 * points.
 *
 * It projects through the viewport rather than sitting at fixed pixel
 * positions, so panning and zooming the axial image carries the curve with it.
 * Everything except the handles ignores the pointer, leaving the crosshairs
 * and the other tools usable.
 */
export const ArchOverlay: React.FC<ArchOverlayProps> = ({ viewport, points, sliceIndex, onChange }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [, forceRedraw] = useState(0);
  const draggingRef = useRef<number | null>(null);

  // The curve has to be re-projected whenever the camera moves.
  useEffect(() => {
    if (!viewport) return;
    const element = viewport.element;
    const redraw = () => forceRedraw((n) => n + 1);

    element.addEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, redraw);
    element.addEventListener(cornerstone.Enums.Events.IMAGE_RENDERED, redraw);
    window.addEventListener('resize', redraw);

    return () => {
      element.removeEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, redraw);
      element.removeEventListener(cornerstone.Enums.Events.IMAGE_RENDERED, redraw);
      window.removeEventListener('resize', redraw);
    };
  }, [viewport]);

  const toCanvas = useCallback(
    (point: ArchPoint): [number, number] | null => {
      const data = viewport?.getImageData?.();
      if (!viewport || !data) return null;
      try {
        const world = cornerstone.utilities.transformIndexToWorld(data.imageData, [
          point.i,
          point.j,
          sliceIndex,
        ] as cornerstone.Types.Point3);
        const [x, y] = viewport.worldToCanvas(world);
        // The viewport has no size while the panorama is maximised, and the
        // projection degenerates to NaN.
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return [x, y];
      } catch {
        return null;
      }
    },
    [viewport, sliceIndex]
  );

  const toIndex = useCallback(
    (clientX: number, clientY: number): ArchPoint | null => {
      const data = viewport?.getImageData?.();
      if (!viewport || !data) return null;
      try {
        const rect = viewport.getCanvas().getBoundingClientRect();
        const world = viewport.canvasToWorld([clientX - rect.left, clientY - rect.top]);
        const index = cornerstone.utilities.transformWorldToIndex(data.imageData, world);
        return { i: index[0], j: index[1] };
      } catch {
        return null;
      }
    },
    [viewport]
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const handle = draggingRef.current;
      if (handle === null) return;
      const position = toIndex(event.clientX, event.clientY);
      if (!position) return;
      const next = points.map((point, index) => (index === handle ? position : point));
      onChange(next);
    };
    const onUp = () => {
      draggingRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [points, onChange, toIndex]);

  const projected = points.map(toCanvas);
  if (projected.some((p) => p === null)) return null;

  const canvasPoints = projected as Array<[number, number]>;
  const path = smoothPath(canvasPoints);

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ overflow: 'visible' }}
    >
      <path d={path} fill="none" stroke="#f59e0b" strokeWidth={2} strokeOpacity={0.95} />
      {canvasPoints.map(([x, y], index) => (
        <circle
          key={index}
          cx={x}
          cy={y}
          r={7}
          fill="#f59e0b"
          fillOpacity={0.25}
          stroke="#f59e0b"
          strokeWidth={2}
          className="pointer-events-auto cursor-grab"
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            draggingRef.current = index;
          }}
        />
      ))}
    </svg>
  );
};

/** Catmull-Rom rendered as cubic béziers, matching the sampling in panorama.ts. */
function smoothPath(points: Array<[number, number]>): string {
  if (points.length < 2) return '';
  let path = `M ${points[0][0]} ${points[0][1]}`;

  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[Math.max(index - 1, 0)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(index + 2, points.length - 1)];

    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;

    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }

  return path;
}
