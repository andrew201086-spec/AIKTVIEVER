import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import {
  add,
  canalCurve,
  distanceFromPlane,
  distanceFromPlaneToSegment,
  implantAxis,
  implantLengthMm,
  normalise,
  pixelsPerMm,
  scale,
  subtract,
  type CanalPath,
  type Implant,
  type Vec3,
} from '../utils/surgicalPlan';

interface PlanOverlayProps {
  viewport: cornerstone.Types.IVolumeViewport | null;
  implants: Implant[];
  canals: CanalPath[];
  selectedImplantId: string | null;
  onSelectImplant: (id: string) => void;
  onMoveImplant: (id: string, next: { platform?: Vec3; apex?: Vec3 }) => void;
  /** True while the user is placing canal points by clicking. */
  tracing: boolean;
  onTracePoint: (world: Vec3) => void;
}

/** Beyond this far off the plane an implant is not drawn at all. */
const FADE_MM = 6;

/**
 * The plan, drawn over a slice.
 *
 * An implant and a canal are objects in the patient, not marks on a picture,
 * so they are stored in patient coordinates and projected onto whichever
 * plane is being looked at. How far each is from that plane decides how it is
 * drawn: solid where the slice cuts through it, faint where it passes nearby,
 * absent where it does not. Without that, a fixture planned in the molar
 * region would appear to stand in the incisors.
 */
export const PlanOverlay: React.FC<PlanOverlayProps> = ({
  viewport,
  implants,
  canals,
  selectedImplantId,
  onSelectImplant,
  onMoveImplant,
  tracing,
  onTracePoint,
}) => {
  const [, redraw] = useState(0);
  const dragRef = useRef<{ id: string; end: 'platform' | 'apex' } | null>(null);

  useEffect(() => {
    if (!viewport) return;
    const element = viewport.element;
    const onChange = () => redraw((n) => n + 1);
    element.addEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, onChange);
    element.addEventListener(cornerstone.Enums.Events.IMAGE_RENDERED, onChange);
    window.addEventListener('resize', onChange);
    return () => {
      element.removeEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, onChange);
      element.removeEventListener(cornerstone.Enums.Events.IMAGE_RENDERED, onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [viewport]);

  const project = useCallback(
    (world: Vec3): [number, number] | undefined => {
      try {
        const canvas = viewport?.worldToCanvas(world as cornerstone.Types.Point3);
        if (!canvas || !Number.isFinite(canvas[0]) || !Number.isFinite(canvas[1])) return undefined;
        return [canvas[0], canvas[1]];
      } catch {
        return undefined;
      }
    },
    [viewport]
  );

  const unproject = useCallback(
    (clientX: number, clientY: number): Vec3 | null => {
      try {
        if (!viewport) return null;
        const rect = viewport.getCanvas().getBoundingClientRect();
        const world = viewport.canvasToWorld([clientX - rect.left, clientY - rect.top]);
        // A hidden pane has no size, and its projection degenerates to NaN —
        // which would otherwise become a fixture at nowhere in particular.
        if (!world || ![world[0], world[1], world[2]].every(Number.isFinite)) return null;
        return [world[0], world[1], world[2]];
      } catch {
        return null;
      }
    },
    [viewport]
  );

  // Dragging an end of a fixture moves it in the plane being looked at; the
  // component perpendicular to that plane is left alone, so a drag on the
  // axial view never silently changes the depth set on the sagittal one.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || !viewport) return;
      const world = unproject(event.clientX, event.clientY);
      if (!world) return;

      const implant = implants.find((item) => item.id === drag.id);
      if (!implant) return;
      const { viewPlaneNormal } = viewport.getCamera();
      if (!viewPlaneNormal) return;

      const normal: Vec3 = [viewPlaneNormal[0], viewPlaneNormal[1], viewPlaneNormal[2]];
      const current = drag.end === 'platform' ? implant.platform : implant.apex;
      // Keep the out-of-plane component of where it already was.
      const offPlane = distanceFromPlane(current, world, normal);
      const next = add(world, scale(normal, offPlane));

      onMoveImplant(drag.id, drag.end === 'platform' ? { platform: next } : { apex: next });
    };

    const onUp = () => {
      dragRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [implants, viewport, unproject, onMoveImplant]);

  if (!viewport) return null;

  const camera = viewport.getCamera();
  const focalPoint = camera?.focalPoint;
  const viewPlaneNormal = camera?.viewPlaneNormal;
  if (!focalPoint || !viewPlaneNormal) return null;

  const planePoint: Vec3 = [focalPoint[0], focalPoint[1], focalPoint[2]];
  const planeNormal: Vec3 = [viewPlaneNormal[0], viewPlaneNormal[1], viewPlaneNormal[2]];

  // A direction lying in the plane, to measure the scale along.
  const inPlane = normalise(
    Math.abs(planeNormal[2]) < 0.9
      ? ([-planeNormal[1], planeNormal[0], 0] as Vec3)
      : ([1, 0, 0] as Vec3)
  );
  const scaleMm = pixelsPerMm(project, planePoint, inPlane);

  return (
    <svg
      className={`absolute inset-0 w-full h-full ${
        tracing ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'
      }`}
      style={{ overflow: 'visible' }}
      onClick={(event) => {
        if (!tracing) return;
        const world = unproject(event.clientX, event.clientY);
        if (world) onTracePoint(world);
      }}
    >
      {canals.map((canal) => (
        <CanalTrace key={canal.id} canal={canal} project={project} planePoint={planePoint} planeNormal={planeNormal} />
      ))}

      {implants.map((implant) => (
        <ImplantShape
          key={implant.id}
          implant={implant}
          selected={implant.id === selectedImplantId}
          project={project}
          planePoint={planePoint}
          planeNormal={planeNormal}
          scaleMm={scaleMm}
          onSelect={() => onSelectImplant(implant.id)}
          onGrab={(end) => {
            dragRef.current = { id: implant.id, end };
            onSelectImplant(implant.id);
          }}
        />
      ))}
    </svg>
  );
};

interface TraceProps {
  canal: CanalPath;
  project: (world: Vec3) => [number, number] | undefined;
  planePoint: Vec3;
  planeNormal: Vec3;
}

/**
 * The canal, drawn only where it runs near this plane.
 *
 * On an axial slice it appears as a short arc or a couple of dots — which is
 * exactly what a canal looks like when cut across.
 */
const CanalTrace: React.FC<TraceProps> = ({ canal, project, planePoint, planeNormal }) => {
  if (canal.points.length < 2) {
    return (
      <>
        {canal.points.map((point, index) => {
          const at = project(point);
          const distance = Math.abs(distanceFromPlane(point, planePoint, planeNormal));
          if (!at || distance > 3) return null;
          return <circle key={index} cx={at[0]} cy={at[1]} r={3} fill="#f472b6" fillOpacity={0.9} />;
        })}
      </>
    );
  }

  const curve = canalCurve(canal.points);
  const segments: Array<{ from: [number, number]; to: [number, number]; opacity: number }> = [];

  for (let index = 0; index < curve.length - 1; index++) {
    const a = curve[index];
    const b = curve[index + 1];
    const distance = Math.min(
      Math.abs(distanceFromPlane(a, planePoint, planeNormal)),
      Math.abs(distanceFromPlane(b, planePoint, planeNormal))
    );
    if (distance > 4) continue;
    const from = project(a);
    const to = project(b);
    if (!from || !to) continue;
    segments.push({ from, to, opacity: Math.max(0.25, 1 - distance / 4) });
  }

  return (
    <g>
      {segments.map((segment, index) => (
        <line
          key={index}
          x1={segment.from[0]}
          y1={segment.from[1]}
          x2={segment.to[0]}
          y2={segment.to[1]}
          stroke="#f472b6"
          strokeWidth={3}
          strokeLinecap="round"
          strokeOpacity={segment.opacity}
        />
      ))}
    </g>
  );
};

interface ShapeProps {
  implant: Implant;
  selected: boolean;
  project: (world: Vec3) => [number, number] | undefined;
  planePoint: Vec3;
  planeNormal: Vec3;
  scaleMm: number;
  onSelect: () => void;
  onGrab: (end: 'platform' | 'apex') => void;
}

/** The fixture: a capsule the width of its diameter, with two handles. */
const ImplantShape: React.FC<ShapeProps> = ({
  implant,
  selected,
  project,
  planePoint,
  planeNormal,
  scaleMm,
  onSelect,
  onGrab,
}) => {
  const platform = project(implant.platform);
  const apex = project(implant.apex);
  if (!platform || !apex) return null;

  // Distance to the fixture's *body*: zero while the slice cuts through it.
  // Taking the nearer end instead drew a fixture the plane runs straight
  // down the middle of as though it were five millimetres away.
  const offPlane = distanceFromPlaneToSegment(
    implant.platform,
    implant.apex,
    planePoint,
    planeNormal
  );
  // Anything further from the plane than the fixture is wide is not on it.
  if (offPlane > FADE_MM + implant.diameterMm) return null;
  const opacity = offPlane <= implant.diameterMm / 2 ? 1 : Math.max(0.2, 1 - (offPlane - implant.diameterMm / 2) / FADE_MM);

  const widthPx = Math.max(3, implant.diameterMm * scaleMm);
  const lengthPx = Math.hypot(apex[0] - platform[0], apex[1] - platform[1]);
  const angle = (Math.atan2(apex[1] - platform[1], apex[0] - platform[0]) * 180) / Math.PI;

  // Threads: a few rungs across the body, enough to read as a fixture rather
  // than a bar, without pretending to be any particular manufacturer's.
  const rungs: number[] = [];
  for (let at = widthPx * 0.6; at < lengthPx - widthPx * 0.4; at += Math.max(3, widthPx * 0.45)) {
    rungs.push(at);
  }

  return (
    <g opacity={opacity}>
      <g transform={`translate(${platform[0]} ${platform[1]}) rotate(${angle})`}>
        <rect
          x={0}
          y={-widthPx / 2}
          width={Math.max(lengthPx, 1)}
          height={widthPx}
          rx={widthPx / 2}
          fill={selected ? '#38bdf8' : '#0ea5e9'}
          fillOpacity={0.22}
          stroke={selected ? '#7dd3fc' : '#38bdf8'}
          strokeWidth={selected ? 2 : 1.5}
          className="pointer-events-auto cursor-pointer"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        />
        {rungs.map((at) => (
          <line
            key={at}
            x1={at}
            y1={-widthPx / 2 + 1}
            x2={at}
            y2={widthPx / 2 - 1}
            stroke="#38bdf8"
            strokeWidth={1}
            strokeOpacity={0.5}
          />
        ))}
      </g>

      {[
        { end: 'platform' as const, at: platform },
        { end: 'apex' as const, at: apex },
      ].map(({ end, at }) => (
        <circle
          key={end}
          cx={at[0]}
          cy={at[1]}
          r={selected ? 6 : 4}
          fill="#0ea5e9"
          fillOpacity={0.35}
          stroke="#7dd3fc"
          strokeWidth={2}
          className="pointer-events-auto cursor-grab"
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onGrab(end);
          }}
        />
      ))}

      {selected && (
        <text
          x={(platform[0] + apex[0]) / 2}
          y={(platform[1] + apex[1]) / 2 - widthPx}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          fill="#e0f2fe"
          style={{ userSelect: 'none', paintOrder: 'stroke', stroke: '#0c4a6e', strokeWidth: 3 }}
        >
          {implant.diameterMm.toFixed(1)} × {implantLengthMm(implant).toFixed(1)}
        </text>
      )}
    </g>
  );
};

/** Unit direction of the patient's inferior–superior axis, for a new fixture. */
export function defaultImplantAxis(): Vec3 {
  return normalise(subtract([0, 0, 0], [0, 0, 1]));
}

export { implantAxis };
