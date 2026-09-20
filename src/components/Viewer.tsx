import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as cornerstone from '@cornerstonejs/core';
import * as cornerstoneTools from '@cornerstonejs/tools';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import {
  ZoomIn,
  Move,
  SunMedium,
  RotateCcw,
  Crosshair,
  Ruler,
  Triangle,
  Sigma,
  Layers3,
  AlertTriangle,
  Activity,
  Maximize2,
  Minimize2,
  Move3d,
  Pipette,
  Square,
  ListChecks,
} from 'lucide-react';
import type { SeriesInfo } from '../utils/dicomParse';
import { formatBytes, slices } from '../utils/dicomParse';
import { decodeHalfFloat, volumeUsesHalfFloat } from '../utils/renderCapabilities';
import { ArchOverlay } from './ArchOverlay';
import { ErrorBoundary } from './ErrorBoundary';
import { ModeRail } from './ModeRail';
import { ShortcutHelp } from './ShortcutHelp';
import { ToothCard } from './ToothCard';
import { ToothChart } from './ToothChart';
import { ReportView } from './ReportView';
import { MeasurementList } from './MeasurementList';
import { PlanOverlay } from './PlanOverlay';
import { PlanPanel } from './PlanPanel';
import { VolumePanel, FULL_CROP, type CropBox } from './VolumePanel';
import { SliceScroller } from './SliceScroller';
import { PanoramaPanel, type PanoramaLayout } from './PanoramaPanel';
import type { ToothMark } from '../utils/toothSections';
import {
  AXIS_NAMES,
  describeOrientation,
  heightToSlice,
  sliceToHeight,
  edgeLabelsFor,
  orientationFromDirection,
  tiltFromAxial,
  type EdgeLabels,
} from '../utils/orientation';
import {
  autoWindow,
  measureDensityLevels,
  windowFromHu,
  type DensityLevels,
} from '../utils/density';
import {
  collectAnnotations,
  countMeasurements,
  onAnnotationsChanged,
  restoreAnnotations,
} from '../utils/annotationMemory';
import {
  describeRestored,
  hasWork,
  loadStudy,
  saveStudy,
  type StudyRecord,
} from '../utils/studyStore';
import {
  autoFitArch,
  buildArchGeometry,
  createValueReader,
  findArchSlice,
  nearestColumn,
  type ArchPoint,
  type PanoramaImage,
  type VolumeSampler,
} from '../utils/panorama';
import { detectDentition, type ToothMap } from '../utils/toothDetect';
import { buildChart, type ToothNotes } from '../utils/toothChart';
import {
  labelMeasurement,
  listMeasurements,
  removeMeasurement,
  type Measurement,
} from '../utils/measurements';
import { archStartsOnRight, guessFdi, jawOf, occlusalHeightMm } from '../utils/toothSections';
import type { LesionCandidate } from '../utils/periapical';
import { exportSurface, saveBlob } from '../utils/volumeExport';
import {
  add,
  scale as scaleVec,
  withLength,
  type CanalPath,
  type Implant,
  type Vec3,
} from '../utils/surgicalPlan';

const {
  RenderingEngine,
  Enums: { ViewportType, OrientationAxis },
  volumeLoader,
  setVolumesForViewports,
  cache,
} = cornerstone;

const {
  PanTool,
  ZoomTool,
  WindowLevelTool,
  StackScrollMouseWheelTool,
  CrosshairsTool,
  LengthTool,
  AngleTool,
  BidirectionalTool,
  ProbeTool,
  RectangleROITool,
  TrackballRotateTool,
  VolumeRotateMouseWheelTool,
  ToolGroupManager,
  Enums: { MouseBindings },
} = cornerstoneTools;

type PrimaryTool =
  | 'Crosshairs'
  | 'WindowLevel'
  | 'Pan'
  | 'Zoom'
  | 'Length'
  | 'Angle'
  | 'Bidirectional'
  | 'Probe'
  | 'RectangleROI';

const TOOL_NAME: Record<PrimaryTool, string> = {
  Crosshairs: CrosshairsTool.toolName,
  WindowLevel: WindowLevelTool.toolName,
  Pan: PanTool.toolName,
  Zoom: ZoomTool.toolName,
  Length: LengthTool.toolName,
  Angle: AngleTool.toolName,
  Bidirectional: BidirectionalTool.toolName,
  Probe: ProbeTool.toolName,
  RectangleROI: RectangleROITool.toolName,
};

/**
 * Window presets in Hounsfield units, tuned for dental CBCT, and put on the
 * volume's own scale before use. «Авто» is the exception: it comes from this
 * volume's histogram, for scans whose values sit somewhere a preset cannot
 * reach even after rescaling.
 */
const AUTO_WINDOW = 'auto';

const WL_PRESETS: Record<string, { label: string; width: number; center: number }> = {
  bone: { label: 'Кость', width: 2500, center: 480 },
  teeth: { label: 'Зубы и эмаль', width: 5000, center: 1500 },
  soft: { label: 'Мягкие ткани', width: 400, center: 40 },
  wide: { label: 'Весь диапазон', width: 8000, center: 1000 },
  [AUTO_WINDOW]: { label: 'Авто — по этому снимку', width: 0, center: 0 },
};

const VOLUME_PRESETS: Record<string, string> = {
  'CT-Bone': 'Кость',
  'CT-Bones': 'Кость (плотная)',
  'CT-Soft-Tissue': 'Мягкие ткани',
  'CT-MIP': 'MIP — максимальная интенсивность',
};

const AXIAL = 'cbct-axial';
const SAGITTAL = 'cbct-sagittal';
const CORONAL = 'cbct-coronal';
const VOLUME3D = 'cbct-3d';
const MPR_VIEWPORTS = [AXIAL, SAGITTAL, CORONAL];
const ALL_VIEWPORTS = [...MPR_VIEWPORTS, VOLUME3D];

/**
 * Stable id for a set of images. Two mounts over the same series must resolve
 * to the same volume: the streaming loader hands a frame to whichever cached
 * volume claims its imageId first, so a second volume over the same images
 * silently receives the first one's (empty) buffer.
 */
function hashImageIds(imageIds: string[]): string {
  let h = 0x811c9dc5;
  for (const id of imageIds) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return (h >>> 0).toString(36);
}

/**
 * What the selected tool answers to: the left mouse button and one finger.
 *
 * They travel together. Handing a tool only the mouse binding is how the
 * tablet lost its one-finger navigation the first time a measurement tool was
 * picked — `setToolEnabled` clears every binding a tool has, and only the
 * mouse one was ever put back.
 */
const FOREGROUND_BINDINGS = [
  { mouseButton: MouseBindings.Primary },
  { numTouchPoints: 1 },
] as const;

let mountCounter = 0;

const ALL_TOOLS = [
  PanTool,
  ZoomTool,
  WindowLevelTool,
  StackScrollMouseWheelTool,
  CrosshairsTool,
  LengthTool,
  AngleTool,
  BidirectionalTool,
  ProbeTool,
  RectangleROITool,
  TrackballRotateTool,
  VolumeRotateMouseWheelTool,
];

function registerTools() {
  for (const tool of ALL_TOOLS) {
    try {
      cornerstoneTools.addTool(tool);
    } catch {
      // Already registered — addTool throws on a duplicate name.
    }
  }
}

interface ViewerProps {
  series: SeriesInfo;
}

export const Viewer: React.FC<ViewerProps> = ({ series }) => {
  const axialRef = useRef<HTMLDivElement>(null);
  const sagittalRef = useRef<HTMLDivElement>(null);
  const coronalRef = useRef<HTMLDivElement>(null);
  const volume3dRef = useRef<HTMLDivElement>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<cornerstone.RenderingEngine | null>(null);
  const idsRef = useRef({ engine: '', mpr: '', vol3d: '' });
  const mountRef = useRef(0);

  const [activeTool, setActiveTool] = useState<PrimaryTool>('Crosshairs');
  const [wlPreset, setWlPreset] = useState('bone');
  const [volumePreset, setVolumePreset] = useState('CT-Bone');
  const [progress, setProgress] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [voiText, setVoiText] = useState('');
  const [loadWarning, setLoadWarning] = useState<string | null>(null);
  const [huText, setHuText] = useState<string | null>(null);
  const halfFloatRef = useRef(false);

  const volumeIdRef = useRef('');
  const [panoramaOpen, setPanoramaOpen] = useState(false);
  const [panoramaLayout, setPanoramaLayout] = useState<PanoramaLayout>('split');
  /** Share of the height given to the slices while the panorama is open. */
  const [gridShare, setGridShare] = useState(0.46);
  const splitRef = useRef<HTMLDivElement>(null);
  const [sampler, setSampler] = useState<VolumeSampler | null>(null);
  /** Measured meaning of this volume's grey values; null until the panorama needs it. */
  const [densityLevels, setDensityLevels] = useState<DensityLevels | null>(null);
  const [orientationNote, setOrientationNote] = useState<string | null>(null);
  /** Window taken straight from this volume's histogram. */
  const [autoVoi, setAutoVoi] = useState<{ center: number; width: number } | null>(null);
  /** R/L/A/P markers, re-read from the cameras whenever they move. */
  const [edges, setEdges] = useState<Record<string, EdgeLabels | null>>({});
  const [archPoints, setArchPoints] = useState<ArchPoint[]>([]);
  const [archSlice, setArchSlice] = useState(0);
  /** Teeth the doctor has flagged; each opens a card of reformations. */
  const [toothMarks, setToothMarks] = useState<ToothMark[]>([]);
  /** The card is a modal over the whole viewer, so it is owned here. */
  const [activeMarkId, setActiveMarkId] = useState<string | null>(null);
  const [panoramaImage, setPanoramaImage] = useState<PanoramaImage | null>(null);
  const [candidates, setCandidates] = useState<LesionCandidate[]>([]);
  /** What the volume showed about each tooth, and what the doctor said. */
  const [dentition, setDentition] = useState<{ upper: ToothMap; lower: ToothMap } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [toothNotes, setToothNotes] = useState<ToothNotes>({});
  const [chartOpen, setChartOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);

  /** Surgical plan: fixtures and the canal they must clear. */
  const [implants, setImplants] = useState<Implant[]>([]);
  const [canals, setCanals] = useState<CanalPath[]>([]);
  const [selectedImplantId, setSelectedImplantId] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [placingImplant, setPlacingImplant] = useState(false);
  const [tracingSide, setTracingSide] = useState<CanalPath['side'] | null>(null);

  /** Slab: how thick a slice is, and how the samples through it are combined. */
  const [slabMm, setSlabMm] = useState(0);
  const [slabMode, setSlabMode] = useState<'mip' | 'minip' | 'average'>('mip');

  /** The 3D view: what part of the volume is shown, and taking it out. */
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [crop, setCrop] = useState<CropBox>(FULL_CROP);
  const [exporting, setExporting] = useState<string | null>(null);
  const [warningsOpen, setWarningsOpen] = useState(series.warnings.length > 0);
  /** Viewport blown up to fill the grid; the rest shrink into a column on the right. */
  const [maximized, setMaximized] = useState<string | null>(null);
  /**
   * A tablet cannot show four panes and a toolbar at once, and has no middle
   * or right mouse button. Below this width the grid becomes one pane with a
   * switcher, and the tools get touch bindings.
   */
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 900
  );
  const [visiblePane, setVisiblePane] = useState<string>(AXIAL);

  useEffect(() => {
    const onResize = () => setCompact(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /** Draft of the report text — stored with the rest of the work. */
  const [conclusion, setConclusion] = useState('');
  /** Nothing is written until the previous session has been read back. */
  const [memoryReady, setMemoryReady] = useState(false);
  const [restoredNote, setRestoredNote] = useState<string | null>(null);
  /** Bumped by annotation events so saving notices a new measurement. */
  const [annotationVersion, setAnnotationVersion] = useState(0);
  /** The debounced write that has not happened yet, if any. */
  const pendingSaveRef = useRef<StudyRecord | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  /** Pane the pointer is over — what F maximises and the arrows scroll. */
  const hoveredRef = useRef<string>(AXIAL);

  const { imageIds } = series;

  useEffect(() => {
    const mountId = ++mountCounter;
    mountRef.current = mountId;

    // Unique per mount so a StrictMode remount never collides with the engine
    // and tool groups the previous mount is still tearing down.
    const engineId = `cbct-engine-${mountId}`;
    const mprGroupId = `cbct-mpr-${mountId}`;
    const vol3dGroupId = `cbct-3d-${mountId}`;
    idsRef.current = { engine: engineId, mpr: mprGroupId, vol3d: vol3dGroupId };

    const volumeId = `cornerstoneStreamingImageVolume:cbct-${hashImageIds(imageIds)}`;
    volumeIdRef.current = volumeId;
    setSampler(null);
    setArchPoints([]);

    let disposed = false;
    let engine: cornerstone.RenderingEngine | null = null;
    let resizeObserver: ResizeObserver | null = null;

    // A frame that fails to decode leaves its slice at zero, which renders as
    // flat grey — indistinguishable from real tissue unless we say so.
    const ourImageIds = new Set(imageIds);
    let failedFrames = 0;
    let firstFailure = '';
    const onLoadError = (evt: any) => {
      const imageId = evt?.detail?.imageId;
      if (!imageId || !ourImageIds.has(imageId)) return;
      failedFrames++;
      if (!firstFailure) {
        firstFailure = String(evt?.detail?.error?.message || evt?.detail?.error || '');
      }
    };
    cornerstone.eventTarget.addEventListener(
      cornerstone.Enums.Events.IMAGE_LOAD_ERROR,
      onLoadError
    );

    const setup = async () => {
      try {
        setErrorMsg(null);
        setLoadWarning(null);
        setIsLoaded(false);
        setProgress(2);

        registerTools();

        engine = new RenderingEngine(engineId);
        engineRef.current = engine;

        const background = [0.04, 0.05, 0.06] as cornerstone.Types.Point3;

        engine.setViewports([
          {
            viewportId: AXIAL,
            type: ViewportType.ORTHOGRAPHIC,
            element: axialRef.current!,
            defaultOptions: { orientation: OrientationAxis.AXIAL, background },
          },
          {
            viewportId: SAGITTAL,
            type: ViewportType.ORTHOGRAPHIC,
            element: sagittalRef.current!,
            defaultOptions: { orientation: OrientationAxis.SAGITTAL, background },
          },
          {
            viewportId: CORONAL,
            type: ViewportType.ORTHOGRAPHIC,
            element: coronalRef.current!,
            defaultOptions: { orientation: OrientationAxis.CORONAL, background },
          },
          {
            viewportId: VOLUME3D,
            type: ViewportType.VOLUME_3D,
            element: volume3dRef.current!,
            defaultOptions: { background: [0.06, 0.07, 0.09] as cornerstone.Types.Point3 },
          },
        ]);

        buildToolGroups(engineId, mprGroupId, vol3dGroupId);

        // All four viewports share one offscreen canvas, and the engine slices
        // it up by the element sizes it saw at setViewports time. The grid has
        // not settled by then, so without a resize each pane blits a strip of
        // its neighbour.
        if (gridRef.current) {
          resizeObserver = new ResizeObserver((entries) => {
            if (disposed || !engine) return;
            // Hidden while the panorama is maximised: resizing to nothing puts
            // NaN through the camera maths.
            const box = entries[0]?.contentRect;
            if (box && (box.width < 20 || box.height < 20)) return;
            try {
              engine.resize(true, true);
            } catch (err) {
              console.warn('Не удалось пересчитать размеры вьюпортов', err);
            }
          });
          resizeObserver.observe(gridRef.current);
        }

        setProgress(6);

        // Returns the cached volume when one already exists for this id, which
        // is exactly what makes the second StrictMode mount safe.
        const volume = await volumeLoader.createAndCacheVolume(volumeId, { imageIds });
        if (disposed) return;

        setProgress(10);

        await setVolumesForViewports(engine, [{ volumeId }], ALL_VIEWPORTS);
        if (disposed) return;

        applyWindowLevel(engine, wlPreset, null, null);

        const paint = () => {
          if (disposed || !engine) return;
          engine.renderViewports(ALL_VIEWPORTS);
        };

        const resetCameras = () => {
          if (!engine) return;
          ALL_VIEWPORTS.forEach((id) => {
            const vp = engine!.getViewport(id);
            if (vp) vp.resetCamera();
          });
        };

        const streaming = volume as any;
        streaming.load?.();

        // Polling beats the load() callback here: when a second mount arrives
        // while the volume is already streaming, load() returns early and
        // silently drops the callback, leaving the UI stuck on the spinner.
        await new Promise<void>((resolve) => {
          const timer = window.setInterval(() => {
            if (disposed) {
              window.clearInterval(timer);
              resolve();
              return;
            }

            const total = streaming.totalNumFrames || imageIds.length;
            const done = streaming.framesProcessed ?? 0;
            setProgress(Math.min(99, Math.round((done / total) * 100)));
            paint();

            if (streaming.loadStatus?.loaded) {
              window.clearInterval(timer);
              resolve();
            }
          }, 200);
        });

        if (disposed) return;

        try {
          engine.resize(true, false);
        } catch {}
        resetCameras();
        applyWindowLevel(engine, wlPreset, null, null);
        // The 3D transfer function only makes sense once voxels are present.
        applyVolumePreset(engine, volumePreset);
        paint();

        halfFloatRef.current = volumeUsesHalfFloat(engine.getViewport(AXIAL));

        setIsLoaded(true);
        setProgress(100);
        readVoi(engine);

        if (failedFrames > 0) {
          const detail = firstFailure ? ` Первая ошибка: ${firstFailure}` : '';
          if (failedFrames >= imageIds.length) {
            setErrorMsg(
              `Ни один срез не удалось раскодировать (${failedFrames} из ${imageIds.length}). ` +
                `Обычно это либо формат сжатия, который браузер не тянет, либо нехватка памяти на исследование такого размера.${detail}`
            );
          } else {
            setLoadWarning(
              `${failedFrames} из ${imageIds.length} срезов не раскодировались — в этих местах объём пустой.${detail}`
            );
          }
        }
      } catch (err: any) {
        console.error('Не удалось построить объём:', err);
        if (!disposed) setErrorMsg(describeError(err, series));
      }
    };

    setup();

    return () => {
      disposed = true;

      cornerstone.eventTarget.removeEventListener(
        cornerstone.Enums.Events.IMAGE_LOAD_ERROR,
        onLoadError
      );
      resizeObserver?.disconnect();
      resizeObserver = null;

      try {
        ToolGroupManager.destroyToolGroup(mprGroupId);
      } catch {}
      try {
        ToolGroupManager.destroyToolGroup(vol3dGroupId);
      } catch {}
      try {
        engineRef.current?.destroy();
      } catch {}
      engineRef.current = null;

      // Deferred, and only if nothing has taken over: under StrictMode the
      // next mount is already using this volume by the time we get here.
      setTimeout(() => {
        if (mountRef.current !== mountId) return;
        try {
          cache.removeVolumeLoadObject(volumeId);
        } catch {}
      }, 0);
    };
    // wlPreset / volumePreset are applied imperatively below, not rebuilt here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageIds]);

  const readVoi = (engine: cornerstone.RenderingEngine | null) => {
    if (!engine) return;
    const vp = engine.getViewport(AXIAL) as cornerstone.Types.IVolumeViewport | undefined;
    const range = vp?.getProperties?.()?.voiRange;
    if (range) {
      const width = Math.round(range.upper - range.lower);
      const center = Math.round((range.upper + range.lower) / 2);
      setVoiText(`Ш ${width} / Ц ${center}`);
    }
  };

  /** The sampled arch — one build, shared by everything that measures on it. */
  const geometry = useMemo(
    () => (sampler ? buildArchGeometry(sampler, archPoints) : null),
    [sampler, archPoints]
  );

  /**
   * Reads the dentition off the volume. Runs on request rather than on load:
   * it walks the whole arch at crown height, which is a second of work, and
   * on a study the user only wanted to look at it would be a second wasted.
   */
  const detectTeethNow = useCallback(() => {
    if (!sampler || !geometry) return;
    setDetecting(true);
    window.setTimeout(() => {
      window.setTimeout(() => {
        try {
          setDentition(detectDentition(sampler, geometry.curve, geometry.stepMm, archSlice));
        } catch (err) {
          console.warn('Не удалось определить зубы', err);
        } finally {
          setDetecting(false);
        }
      }, 0);
    }, 40);
  }, [sampler, geometry, archSlice]);

  /** Which teeth the lucency scan pointed at, for the chart. */
  const flaggedFdi = useMemo(() => {
    if (!sampler || !panoramaImage) return [];
    return candidates.map((candidate) =>
      guessFdi(
        candidate.arcMm,
        panoramaImage.archLengthMm,
        candidate.jaw,
        archStartsOnRight(sampler)
      )
    );
  }, [candidates, panoramaImage, sampler]);

  const measurements = useMemo<Measurement[]>(
    () => (isLoaded ? listMeasurements(densityLevels?.unit ?? 'HU') : []),
    // annotationVersion is the store's change signal; the store itself is not
    // reactive, so nothing else here can stand in for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLoaded, annotationVersion, densityLevels]
  );

  const chart = useMemo(
    () =>
      buildChart({
        upper: dentition?.upper ?? null,
        lower: dentition?.lower ?? null,
        notes: toothNotes,
        markedFdi: toothMarks.map((mark) => mark.fdi),
        flaggedFdi,
      }),
    [dentition, toothNotes, toothMarks, flaggedFdi]
  );

  /** A voxel index of the loaded volume in patient coordinates. */
  const voxelToWorld = useCallback((voxel: [number, number, number]): Vec3 | null => {
    const reference = engineRef.current?.getViewport(AXIAL) as
      | cornerstone.Types.IVolumeViewport
      | undefined;
    const data = reference?.getImageData?.();
    if (!data) return null;
    try {
      const world = cornerstone.utilities.transformIndexToWorld(
        data.imageData,
        voxel as cornerstone.Types.Point3
      );
      return [world[0], world[1], world[2]];
    } catch {
      return null;
    }
  }, []);

  /** Patient coordinates back to a voxel index of the loaded volume. */
  const worldToVoxel = useCallback((world: Vec3): [number, number, number] | null => {
    const reference = engineRef.current?.getViewport(AXIAL) as
      | cornerstone.Types.IVolumeViewport
      | undefined;
    const data = reference?.getImageData?.();
    if (!data) return null;
    try {
      const index = cornerstone.utilities.transformWorldToIndex(
        data.imageData,
        world as cornerstone.Types.Point3
      );
      return [index[0], index[1], index[2]];
    } catch {
      return null;
    }
  }, []);

  /** Moves the three slice views onto a point in patient coordinates. */
  /**
   * Slab thickness, applied to the three slice views.
   *
   * A one-voxel slice hides a canal that runs obliquely through it and makes
   * a thin cortical plate flicker in and out. Averaging or projecting a few
   * millimetres is how those are actually read.
   */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !isLoaded) return;

    const blend =
      slabMm <= 0
        ? cornerstone.Enums.BlendModes.COMPOSITE
        : slabMode === 'mip'
        ? cornerstone.Enums.BlendModes.MAXIMUM_INTENSITY_BLEND
        : slabMode === 'minip'
        ? cornerstone.Enums.BlendModes.MINIMUM_INTENSITY_BLEND
        : cornerstone.Enums.BlendModes.AVERAGE_INTENSITY_BLEND;

    for (const id of MPR_VIEWPORTS) {
      const viewport = engine.getViewport(id) as any;
      try {
        viewport?.setBlendMode?.(blend);
        // Zero would collapse the slab; the renderer wants a real thickness.
        viewport?.setSlabThickness?.(slabMm <= 0 ? 0.1 : slabMm);
      } catch (err) {
        console.warn('Не удалось задать толщину слоя', err);
      }
    }
    engine.renderViewports(MPR_VIEWPORTS);
  }, [slabMm, slabMode, isLoaded]);

  /**
   * Cropping the 3D reconstruction.
   *
   * Six planes against the volume's own bounds. The mapper takes them
   * directly, so the crop costs nothing per frame and — unlike changing the
   * transfer function — removes the tissue in front rather than making it
   * transparent, which is what lets the region being planned be seen at all.
   */
  useEffect(() => {
    if (!isLoaded) return;
    const viewport = engineRef.current?.getViewport(VOLUME3D) as any;
    const actor = viewport?.getActors?.()[0]?.actor;
    const mapper = actor?.getMapper?.();
    if (!mapper?.addClippingPlane) return;

    try {
      mapper.removeAllClippingPlanes();
      const bounds = actor.getBounds?.();
      if (!bounds) return;

      const faces: Array<{ axis: 0 | 1 | 2; at: number; normal: [number, number, number] }> = [
        { axis: 0, at: crop.xMin, normal: [1, 0, 0] },
        { axis: 0, at: crop.xMax, normal: [-1, 0, 0] },
        { axis: 1, at: crop.yMin, normal: [0, 1, 0] },
        { axis: 1, at: crop.yMax, normal: [0, -1, 0] },
        { axis: 2, at: crop.zMin, normal: [0, 0, 1] },
        { axis: 2, at: crop.zMax, normal: [0, 0, -1] },
      ];

      for (const face of faces) {
        // A plane flush with the edge clips nothing; skip it rather than
        // paying for six planes on an uncropped volume.
        if (face.normal[face.axis] > 0 ? face.at <= 0 : face.at >= 1) continue;
        const low = bounds[face.axis * 2];
        const high = bounds[face.axis * 2 + 1];
        const origin: [number, number, number] = [0, 0, 0];
        origin[face.axis] = low + (high - low) * face.at;

        const plane = vtkPlane.newInstance();
        plane.setOrigin(origin);
        plane.setNormal(face.normal);
        mapper.addClippingPlane(plane);
      }

      viewport.render();
    } catch (err) {
      console.warn('Не удалось обрезать объём', err);
    }
  }, [crop, isLoaded, volumePreset]);

  const locateWorld = useCallback((world: [number, number, number]) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      MPR_VIEWPORTS.forEach((id) => {
        const viewport = engine.getViewport(id) as cornerstone.Types.IVolumeViewport | undefined;
        if (!viewport?.getCamera) return;
        const { focalPoint, position } = viewport.getCamera();
        if (!focalPoint || !position) return;
        viewport.setCamera({
          focalPoint: world,
          position: [
            position[0] + (world[0] - focalPoint[0]),
            position[1] + (world[1] - focalPoint[1]),
            position[2] + (world[2] - focalPoint[2]),
          ] as cornerstone.Types.Point3,
        });
      });
      engine.renderViewports(MPR_VIEWPORTS);
    } catch (err) {
      console.warn('Не удалось перевести срезы на точку', err);
    }
  }, []);

  /**
   * Moves the three slice views onto a voxel of the volume.
   *
   * The index has to be turned into patient coordinates by the viewport that
   * owns the volume; from there it is the same camera move as any other.
   */
  const locateVoxel = useCallback(
    (voxel: [number, number, number]) => {
      const engine = engineRef.current;
      const reference = engine?.getViewport(AXIAL) as cornerstone.Types.IVolumeViewport | undefined;
      const data = reference?.getImageData?.();
      if (!data) return;
      try {
        const world = cornerstone.utilities.transformIndexToWorld(
          data.imageData,
          voxel as cornerstone.Types.Point3
        );
        locateWorld([world[0], world[1], world[2]]);
      } catch (err) {
        console.warn('Не удалось перевести срезы на зуб', err);
      }
    },
    [locateWorld]
  );

  /**
   * Puts a new fixture where the user clicked, standing into its own jaw.
   *
   * Which way that is has to be worked out, not assumed: a maxillary fixture
   * runs up into the bone and a mandibular one runs down, and a default that
   * always pointed one way created upper implants aimed out of the mouth.
   * World coordinates are patient coordinates, so «up» is +Z; the jaw comes
   * from which side of the occlusal plane the click landed on.
   */
  const placeImplant = useCallback(
    (world: Vec3) => {
      let towards: Vec3 = [0, 0, -1];

      if (sampler) {
        const voxel = worldToVoxel(world);
        if (voxel) {
          const [, , nz] = sampler.dimensions;
          const heightMm = sliceToHeight(voxel[2], nz, sampler.spacing[2], sampler.orientation);
          // The arch is normally fitted by the time the plan is open; if it
          // is not, the occlusal plane is measured here rather than defaulting
          // to slice zero, which would call every site maxillary.
          const occlusal = occlusalHeightMm(
            sampler,
            archPoints.length > 0 ? archSlice : findArchSlice(sampler)
          );
          // Height is measured down from the top of the head, so a smaller
          // number is more superior — that is the upper jaw.
          towards = heightMm < occlusal ? [0, 0, 1] : [0, 0, -1];
        }
      }

      const implant: Implant = withLength(
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          platform: world,
          apex: add(world, scaleVec(towards, 10)),
          diameterMm: 4.1,
          note: '',
        },
        10
      );
      setImplants((current) => [...current, implant]);
      setSelectedImplantId(implant.id);
      setPlacingImplant(false);
    },
    [sampler, archSlice, archPoints.length, worldToVoxel]
  );

  /**
   * A place on the arch, as a patient coordinate.
   *
   * The panorama knows only distance along the arch and height; turning that
   * into a point in the patient needs the centreline and the volume, both of
   * which live here.
   */
  const archPointToWorld = useCallback(
    (arcMm: number, heightMm: number): Vec3 | null => {
      if (!sampler || !geometry) return null;
      const column = Math.max(
        0,
        Math.min(Math.round(arcMm / geometry.stepMm), geometry.curve.length - 1)
      );
      const point = geometry.curve[column];
      const [, , nz] = sampler.dimensions;
      const k = heightToSlice(heightMm, nz, sampler.spacing[2], sampler.orientation);
      return voxelToWorld([point.i, point.j, Math.max(0, Math.min(k, nz - 1))]);
    },
    [sampler, geometry, voxelToWorld]
  );

  /** The traced canals projected back onto the panorama, so they can be drawn. */
  const canalMarks = useMemo(() => {
    if (!sampler || !geometry) return [];
    const [, , nz] = sampler.dimensions;

    return canals.map((canal) => ({
      side: canal.side,
      points: canal.points
        .map((world) => {
          const voxel = worldToVoxel(world);
          if (!voxel) return null;
          const column = nearestColumn(geometry.curve, voxel[0], voxel[1], sampler.spacing);
          const heightMm = sliceToHeight(voxel[2], nz, sampler.spacing[2], sampler.orientation);
          return [column * geometry.stepMm, heightMm] as [number, number];
        })
        .filter((point): point is [number, number] => point !== null),
    }));
  }, [canals, sampler, geometry, worldToVoxel]);

  const addCanalPoint = useCallback(
    (world: Vec3) => {
      if (!tracingSide) return;
      setCanals((current) => {
        const existing = current.find((canal) => canal.side === tracingSide);
        if (existing) {
          return current.map((canal) =>
            canal.side === tracingSide ? { ...canal, points: [...canal.points, world] } : canal
          );
        }
        return [...current, { id: `canal-${tracingSide}`, side: tracingSide, points: [world] }];
      });
    },
    [tracingSide]
  );

  /** Takes the picture, or explains why there is nothing to take. */
  const captureVolume = useCallback(() => {
    const viewport = engineRef.current?.getViewport(VOLUME3D) as any;
    const canvas: HTMLCanvasElement | undefined = viewport?.getCanvas?.();
    // A hidden pane has a zero-sized canvas, and `toBlob` on one returns null
    // — silently, which made the button look broken.
    if (!canvas || !canvas.width || !canvas.height) {
      setLoadWarning('Снимок берётся с того, что на экране: откройте окно «3D объём» и повторите.');
      return;
    }
    try {
      // The WebGL buffer is cleared after each paint, so it has to be redrawn
      // in the same turn the pixels are read.
      viewport.render();
      canvas.toBlob((blob: Blob | null) => {
        if (!blob) {
          setLoadWarning('Не удалось прочитать изображение объёма — попробуйте ещё раз.');
          return;
        }
        const who = series.patientName ? series.patientName.replace(/\s+/g, '_') : 'КЛКТ';
        saveBlob(blob, `объём_${who}.png`);
      }, 'image/png');
    } catch (err) {
      console.warn('Не удалось сохранить снимок объёма', err);
      setLoadWarning('Не удалось сохранить снимок объёма.');
    }
  }, [series.patientName]);

  /**
   * On a tablet the 3D pane is one of four behind a switcher, so the snapshot
   * brings it to the front first and lets the engine resize before reading
   * the pixels.
   */
  const snapshot3d = useCallback(() => {
    if (compact && visiblePane !== VOLUME3D) {
      setVisiblePane(VOLUME3D);
      window.setTimeout(captureVolume, 300);
      return;
    }
    captureVolume();
  }, [compact, visiblePane, captureVolume]);

  /** Meshes the volume at a threshold and saves it as STL for the lab. */
  const exportStl = useCallback(
    (thresholdHu: number) => {
      if (!sampler) return;
      setExporting('Подготовка…');
      window.setTimeout(() => {
        window.setTimeout(() => {
          try {
            const result = exportSurface(sampler, {
              thresholdHu,
              onProgress: (stage) => setExporting(stage),
            });
            const who = series.patientName ? series.patientName.replace(/\s+/g, '_') : 'КЛКТ';
            saveBlob(result.blob, `поверхность_${who}.stl`);
            setLoadWarning(
              `STL сохранён: ${result.triangles.toLocaleString('ru-RU')} треугольников, ` +
                `шаг сетки ${result.stepMm.toFixed(2)} мм. Для точной работы в лаборатории ` +
                'проверьте, что этого разрешения достаточно.'
            );
          } catch (err: any) {
            setLoadWarning(`Не удалось построить поверхность: ${err?.message || err}`);
          } finally {
            setExporting(null);
          }
        }, 0);
      }, 40);
    },
    [sampler, series.patientName]
  );

  /** The plan, drawn over one slice view. */
  const planLayer = (viewportId: string) => {
    if (!planOpen && implants.length === 0 && canals.length === 0) return null;
    return (
      <PlanOverlay
        viewport={
          (engineRef.current?.getViewport(viewportId) as cornerstone.Types.IVolumeViewport) ?? null
        }
        implants={implants}
        canals={canals}
        selectedImplantId={selectedImplantId}
        onSelectImplant={setSelectedImplantId}
        onMoveImplant={(id, next) =>
          setImplants((current) =>
            current.map((implant) => (implant.id === id ? { ...implant, ...next } : implant))
          )
        }
        tracing={!!tracingSide || placingImplant}
        onTracePoint={(world) => {
          if (placingImplant) placeImplant(world);
          else addCanalPoint(world);
        }}
      />
    );
  };

  const activeMark = toothMarks.find((mark) => mark.id === activeMarkId) ?? null;

  /** Puts the slice views on a point given by its place on the arch. */
  const locateOnArch = useCallback(
    (arcMm: number, heightMm: number) => {
      if (!sampler || !geometry) return;
      const column = Math.max(
        0,
        Math.min(Math.round(arcMm / geometry.stepMm), geometry.curve.length - 1)
      );
      const point = geometry.curve[column];
      const [, , nz] = sampler.dimensions;
      const k = heightToSlice(heightMm, nz, sampler.spacing[2], sampler.orientation);
      if (panoramaLayout === 'full') setPanoramaLayout('split');
      locateVoxel([point.i, point.j, Math.max(0, Math.min(k, nz - 1))]);
    },
    [sampler, geometry, panoramaLayout, locateVoxel]
  );

  const locateTooth = useCallback(
    (tooth: { fdi: number; arcMm?: number }) => {
      if (tooth.arcMm === undefined || !sampler) return;
      const occlusal = occlusalHeightMm(sampler, archSlice);
      const direction = jawOf(tooth.fdi) === 'upper' ? -1 : 1;
      locateOnArch(tooth.arcMm, occlusal + direction * 9);
    },
    [sampler, archSlice, locateOnArch]
  );

  /**
   * A tooth on the chart opens the same card the panorama marks open — and
   * becomes a mark itself, so the work is in one place.
   */
  const openCardForTooth = useCallback(
    (tooth: { fdi: number; arcMm?: number }) => {
      if (tooth.arcMm === undefined) return;
      const existing = toothMarks.find((mark) => mark.fdi === tooth.fdi);
      if (existing) {
        setActiveMarkId(existing.id);
        return;
      }
      const mark: ToothMark = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        arcMm: tooth.arcMm,
        jaw: jawOf(tooth.fdi),
        fdi: tooth.fdi,
        note: toothNotes[tooth.fdi]?.note ?? '',
      };
      setToothMarks((marks) => [...marks, mark]);
      setActiveMarkId(mark.id);
    },
    [toothMarks, toothNotes]
  );

  const buildArch = useCallback(
    (target: VolumeSampler) => {
      const slice = findArchSlice(target);
      setArchSlice(slice);
      setArchPoints(autoFitArch(target, slice));
    },
    []
  );

  // What this volume is, measured rather than assumed: where the patient lies
  // in the voxel grid, and what its grey values mean. Both are needed by the
  // toolbar and the side markers, not only by the panorama, so they are taken
  // as soon as the voxels arrive — a quarter-million samples, tens of
  // milliseconds.
  useEffect(() => {
    if (!isLoaded) return;
    const volume = cache.getVolume(volumeIdRef.current);
    if (!volume) return;

    try {
      const read = createValueReader(volume.getScalarData(), halfFloatRef.current);
      const dimensions = volume.dimensions as [number, number, number];
      const orientation = orientationFromDirection(volume.direction as ArrayLike<number>);
      const levels = measureDensityLevels({ dimensions, read }, series.declaresHu);
      const measured = autoWindow({ dimensions, read });

      setDensityLevels(levels);
      setAutoVoi(measured);
      setSampler({
        dimensions,
        spacing: volume.spacing as [number, number, number],
        read,
        orientation,
        levels,
      });
      setOrientationNote(
        tiltFromAxial(orientation) > 15
          ? `Снимок наклонён к аксиальной плоскости: ${describeOrientation(orientation)}. ` +
              'Панорама и срезы по зубам исходят из того, что корни идут вверх и вниз — ' +
              'сверьте стороны по маркерам на срезах, прежде чем указывать номера зубов.'
          : null
      );
      // The presets applied during loading were in raw Hounsfield units;
      // now that the scale is known they can be put where they belong.
      applyWindowLevel(engineRef.current, wlPreset, levels, measured);
    } catch (err) {
      console.warn('Не удалось измерить плотностную шкалу объёма', err);
    }
    // wlPreset is applied, not depended on: a preset change re-applies itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, series.declaresHu]);

  /**
   * Bring back what was done to this study last time.
   *
   * Runs once the volume is on screen, because restoring a measurement needs
   * a viewport to attach it to. Until it has finished, saving is held off —
   * an empty state written over a full record is exactly the loss this
   * feature exists to prevent.
   */
  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;

    loadStudy(series.seriesInstanceUID)
      .then((record) => {
        if (cancelled || !record) return;

        if (record.toothMarks?.length) setToothMarks(record.toothMarks);
        if (record.archPoints?.length) {
          setArchPoints(record.archPoints);
          setArchSlice(record.archSlice ?? 0);
        }
        if (record.conclusion) setConclusion(record.conclusion);
        if (record.toothNotes) setToothNotes(record.toothNotes);
        if (record.implants?.length) setImplants(record.implants);
        if (record.canals?.length) setCanals(record.canals);

        const restored = restoreAnnotations(record.annotations ?? [], axialRef.current);
        if (restored) engineRef.current?.renderViewports(MPR_VIEWPORTS);

        if (hasWork(record)) {
          const expected = countMeasurements(record.annotations);
          const missing =
            restored < expected ? ` Не удалось восстановить измерений: ${expected - restored}.` : '';
          setRestoredNote(`Восстановлено с прошлого раза: ${describeRestored(record)}.${missing}`);
        }
      })
      .finally(() => {
        if (!cancelled) setMemoryReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, series.seriesInstanceUID]);

  // Measurements live inside Cornerstone, so the only way to know they changed
  // is to listen for it.
  useEffect(() => {
    if (!isLoaded) return;
    return onAnnotationsChanged(() => setAnnotationVersion((n) => n + 1));
  }, [isLoaded]);

  /**
   * Write the work back, a beat after it settles. Dragging a measurement
   * fires continuously; the study should be saved once at the end of it.
   *
   * Whatever is still waiting is kept in a ref so it can be flushed the
   * moment the study or the tab goes away — clearing the timer on unmount and
   * calling it done loses the last edit before «Закрыть», which is exactly
   * the loss this feature exists to prevent.
   */
  useEffect(() => {
    if (!memoryReady) return;
    const record = {
      seriesInstanceUID: series.seriesInstanceUID,
      patientName: series.patientName,
      description: series.description,
      sliceCount: series.sliceCount,
      savedAt: Date.now(),
      archPoints,
      archSlice,
      toothMarks,
      annotations: collectAnnotations(),
      conclusion,
      toothNotes,
      implants,
      canals,
    };
    pendingSaveRef.current = record;

    const timer = window.setTimeout(() => {
      saveStudy(record);
      pendingSaveRef.current = null;
    }, 800);
    return () => window.clearTimeout(timer);
  }, [
    memoryReady,
    series,
    archPoints,
    archSlice,
    toothMarks,
    conclusion,
    toothNotes,
    implants,
    canals,
    annotationVersion,
  ]);

  /**
   * Anything still waiting goes to disk when the study closes or the tab is
   * hidden. `visibilitychange` is the reliable hook — `beforeunload` often
   * ends the page before an IndexedDB write completes — and the cleanup
   * covers closing the study, which is the common case.
   */
  useEffect(() => {
    const flush = () => {
      const pending = pendingSaveRef.current;
      if (!pending) return;
      pendingSaveRef.current = null;
      saveStudy(pending);
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);

  /**
   * Fitting the arch scans the whole volume, so it waits to be asked for — by
   * the panorama, the chart or the plan, whichever the user opens first.
   *
   * The plan needs it as much as the other two: the occlusal plane is what
   * says whether a click landed in the upper jaw or the lower one, and an
   * unfitted arch leaves that plane at the very bottom of the volume, so
   * every fixture would be created as a maxillary one.
   */
  useEffect(() => {
    if ((!panoramaOpen && !chartOpen && !planOpen) || !sampler || archPoints.length > 0) return;
    buildArch(sampler);
  }, [panoramaOpen, chartOpen, planOpen, sampler, archPoints.length, buildArch]);

  const startSplitDrag = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    const container = splitRef.current;
    if (!container) return;

    const onMove = (move: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const share = (move.clientY - rect.top) / rect.height;
      setGridShare(Math.min(Math.max(share, 0.12), 0.88));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  // Cornerstone sizes its viewports from the DOM, so it has to be told after
  // the split moves or the panorama gives the slices their height back.
  useEffect(() => {
    if (!isLoaded) return;
    const timer = window.setTimeout(() => {
      try {
        engineRef.current?.resize(true, true);
      } catch {
        // Viewports are hidden — nothing to resize.
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [gridShare, panoramaOpen, panoramaLayout, maximized, visiblePane, compact, isLoaded]);

  // Density under the cursor, read straight from the volume.
  //
  // The library's probe tool prints the raw sample, which is wrong whenever
  // Cornerstone stores the volume as half-float — 40 HU comes back as 20736.
  // Reading the voxel ourselves means the number is right in both modes.
  useEffect(() => {
    const panes: Array<[React.RefObject<HTMLDivElement>, string]> = [
      [axialRef, AXIAL],
      [sagittalRef, SAGITTAL],
      [coronalRef, CORONAL],
    ];

    let lastRead = 0;
    const handlers: Array<[HTMLDivElement, (e: MouseEvent) => void, () => void]> = [];

    for (const [ref, viewportId] of panes) {
      const element = ref.current;
      if (!element) continue;

      const onMove = (event: MouseEvent) => {
        const now = performance.now();
        if (now - lastRead < 40) return;
        lastRead = now;
        setHuText(readDensity(engineRef.current, viewportId, event, halfFloatRef.current, densityLevels));
      };
      const onLeave = () => setHuText(null);

      element.addEventListener('mousemove', onMove);
      element.addEventListener('mouseleave', onLeave);
      handlers.push([element, onMove, onLeave]);
    }

    return () => {
      for (const [element, onMove, onLeave] of handlers) {
        element.removeEventListener('mousemove', onMove);
        element.removeEventListener('mouseleave', onLeave);
      }
    };
  }, [isLoaded, densityLevels]);

  /**
   * Side markers, asked of the viewports rather than derived from the volume.
   *
   * Probing where two points on screen land in the patient costs nothing and
   * is right for any acquisition orientation — and it follows the plane when
   * the crosshair tool rotates it, which a label computed once would not.
   */
  useEffect(() => {
    if (!isLoaded) return;
    const engine = engineRef.current;
    if (!engine) return;

    const update = () => {
      const next: Record<string, EdgeLabels | null> = {};
      for (const id of MPR_VIEWPORTS) {
        next[id] = edgeLabelsFor(engine.getViewport(id) as any);
      }
      setEdges((previous) => (sameEdges(previous, next) ? previous : next));
    };

    update();

    const elements = [axialRef.current, sagittalRef.current, coronalRef.current].filter(
      (element): element is HTMLDivElement => !!element
    );
    for (const element of elements) {
      element.addEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, update);
    }
    window.addEventListener('resize', update);

    return () => {
      for (const element of elements) {
        element.removeEventListener(cornerstone.Enums.Events.CAMERA_MODIFIED, update);
      }
      window.removeEventListener('resize', update);
    };
  }, [isLoaded, maximized, panoramaOpen, panoramaLayout, gridShare]);

  // Keep the readout honest when the user drags with the window/level tool.
  useEffect(() => {
    const element = axialRef.current;
    if (!element) return;
    const handler = () => readVoi(engineRef.current);
    element.addEventListener(cornerstone.Enums.Events.VOI_MODIFIED, handler);
    return () => element.removeEventListener(cornerstone.Enums.Events.VOI_MODIFIED, handler);
  }, []);

  const switchTool = useCallback((tool: PrimaryTool) => {
    const group = ToolGroupManager.getToolGroup(idsRef.current.mpr);
    if (!group) return;

    (Object.keys(TOOL_NAME) as PrimaryTool[]).forEach((key) => {
      try {
        // Crosshairs keeps drawing its reference lines while another tool is
        // in use, but only Enabled leaves it non-interactive; Passive keeps
        // its drag handles alive and they compute NaN positions once the
        // pointer belongs to a different tool.
        if (key === 'Crosshairs') group.setToolEnabled(TOOL_NAME[key]);
        // Strip exactly the foreground bindings and nothing else: passing no
        // list removes only the mouse one, which would leave the previous
        // tool still answering to a finger, and passing `true` would take
        // away the background gestures (middle-button pan, two-finger zoom)
        // that belong to Pan and Zoom whatever is selected.
        else group.setToolPassive(TOOL_NAME[key], { removeAllBindings: [...FOREGROUND_BINDINGS] });
      } catch {}
    });

    group.setToolActive(TOOL_NAME[tool], { bindings: [...FOREGROUND_BINDINGS] });
    setActiveTool(tool);
  }, []);

  const changeWindowLevel = useCallback(
    (key: string) => {
      setWlPreset(key);
      applyWindowLevel(engineRef.current, key, densityLevels, autoVoi);
      readVoi(engineRef.current);
    },
    [densityLevels, autoVoi]
  );

  const changeVolumePreset = useCallback((preset: string) => {
    setVolumePreset(preset);
    applyVolumePreset(engineRef.current, preset);
  }, []);

  const resetViews = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    ALL_VIEWPORTS.forEach((id) => {
      const vp = engine.getViewport(id);
      if (vp) vp.resetCamera();
    });
    applyWindowLevel(engine, wlPreset, null, null);
    engine.renderViewports(ALL_VIEWPORTS);
    readVoi(engine);
  }, [wlPreset]);

  const clearMeasurements = useCallback(() => {
    try {
      // Reached through the namespace on purpose: destructuring `annotation`
      // at module scope makes Rollup emit a reference to a namespace object it
      // never declares, and the production bundle dies on load with
      // "Cannot access '…' before initialization".
      cornerstoneTools.annotation.state.removeAllAnnotations();
    } catch {}
    engineRef.current?.renderViewports(ALL_VIEWPORTS);
  }, []);

  const toggleMaximized = useCallback((viewportId: string) => {
    setMaximized((current) => (current === viewportId ? null : viewportId));
  }, []);

  /**
   * The keyboard, because a study is read by running through slices.
   *
   * Bindings act on whichever pane the pointer is over, which is what a user
   * expects and what avoids a «selected viewport» concept nothing else needs.
   * Anything typed into a field — a tooth note, the report draft — is left
   * alone.
   */
  useEffect(() => {
    if (!isLoaded) return;

    const scrollBy = (delta: number) => {
      const viewport = engineRef.current?.getViewport(hoveredRef.current);
      if (!viewport) return;
      try {
        cornerstoneTools.utilities.scroll(viewport as any, { delta });
      } catch {
        // Still streaming, or the pane is hidden.
      }
    };

    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key;

      if (key === 'Escape') {
        if (helpOpen) setHelpOpen(false);
        else if (maximized) setMaximized(null);
        return;
      }
      // The report and the tooth card are documents: they own the keyboard.
      if (reportOpen || activeMarkId) return;
      if (key === '?' || (key === '/' && event.shiftKey)) {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }

      const handled = () => event.preventDefault();

      switch (key) {
        case 'ArrowUp':
          handled();
          return scrollBy(-1);
        case 'ArrowDown':
          handled();
          return scrollBy(1);
        case 'PageUp':
          handled();
          return scrollBy(-10);
        case 'PageDown':
          handled();
          return scrollBy(10);
      }

      switch (key.toLowerCase()) {
        case '1':
          return switchTool('Crosshairs');
        case '2':
          return switchTool('WindowLevel');
        case '3':
          return switchTool('Pan');
        case '4':
          return switchTool('Zoom');
        case 'l':
          return switchTool('Length');
        case 'a':
          return switchTool('Angle');
        case 'b':
          return switchTool('Bidirectional');
        case 'k':
          return changeWindowLevel('bone');
        case 't':
          return changeWindowLevel('teeth');
        case 's':
          return changeWindowLevel('soft');
        case 'w':
          return changeWindowLevel('wide');
        case 'r':
          return resetViews();
        case 'p':
          return setPanoramaOpen((open) => !open);
        case 'c':
          return setChartOpen((open) => !open);
        case 'd':
          return setReportOpen(true);
        case 'i':
          return setPlanOpen((open) => !open);
        case 'v':
          return setVolumeOpen((open) => !open);
        case 'm':
          if (panoramaOpen) window.dispatchEvent(new CustomEvent('cbct:mark-tooth'));
          return;
        case 'f':
          return toggleMaximized(hoveredRef.current);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    isLoaded,
    helpOpen,
    maximized,
    panoramaOpen,
    reportOpen,
    activeMarkId,
    switchTool,
    changeWindowLevel,
    resetViews,
    toggleMaximized,
  ]);

  // The enlarged pane takes the whole left side; the other three stack into a
  // narrow column on the right. Grid placement keeps the DOM order untouched,
  // so Cornerstone never loses the elements it bound its viewports to.
  const paneStyle = (viewportId: string): React.CSSProperties | undefined => {
    if (compact) {
      // Hidden, not unmounted: a destroyed element takes its viewport with it.
      return viewportId === visiblePane
        ? { gridColumn: 1, gridRow: 1 }
        : { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' };
    }
    if (!maximized) return undefined;
    if (viewportId === maximized) return { gridColumn: 1, gridRow: '1 / span 3' };
    const rest = ALL_VIEWPORTS.filter((id) => id !== maximized);
    return { gridColumn: 2, gridRow: rest.indexOf(viewportId) + 1 };
  };

  const PANE_NAMES: Record<string, string> = {
    [AXIAL]: 'Аксиальная',
    [SAGITTAL]: 'Сагиттальная',
    [CORONAL]: 'Корональная',
    [VOLUME3D]: '3D',
  };

  return (
    <div className="w-full h-full flex flex-col bg-black text-white select-none">
      <Toolbar
        slabMm={slabMm}
        onSlab={setSlabMm}
        slabMode={slabMode}
        onSlabMode={setSlabMode}
        listOpen={listOpen}
        onToggleList={() => setListOpen((open) => !open)}
        measurementCount={measurements.length}
        huText={huText}
        densityNote={densityLevels?.note ?? null}
        densityUnit={densityLevels?.unit ?? 'HU'}
        activeTool={activeTool}
        onTool={switchTool}
        wlPreset={wlPreset}
        onWindowLevel={changeWindowLevel}
        onReset={resetViews}
        onHelp={() => setHelpOpen(true)}
      />

      {loadWarning && (
        <div className="flex items-start gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-red-300 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="flex-grow">{loadWarning}</span>
          <button onClick={() => setLoadWarning(null)} className="text-red-400/70 hover:text-red-200 px-2">
            Скрыть
          </button>
        </div>
      )}

      {restoredNote && (
        <div className="flex items-start gap-2 px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-300 text-xs">
          <Activity className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="flex-grow">{restoredNote}</span>
          <button
            onClick={() => setRestoredNote(null)}
            className="text-emerald-400/70 hover:text-emerald-200 px-2"
          >
            Скрыть
          </button>
        </div>
      )}

      {orientationNote && (
        <div className="flex items-start gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span className="flex-grow">{orientationNote}</span>
          <button
            onClick={() => setOrientationNote(null)}
            className="text-amber-400/70 hover:text-amber-200 px-2"
          >
            Скрыть
          </button>
        </div>
      )}

      {warningsOpen && series.warnings.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-300 text-xs">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-grow">
            {series.warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <button
            onClick={() => setWarningsOpen(false)}
            className="text-amber-400/70 hover:text-amber-200 px-2"
          >
            Скрыть
          </button>
        </div>
      )}

      {/*
        The rail sits under the toolbar and beside everything else: panels and
        slices share the column to its right, so switching mode never moves the
        tools the user just reached for.
      */}
      <div className="flex-grow min-h-0 flex">
      <ModeRail
        panoramaOpen={panoramaOpen}
        onTogglePanorama={() => setPanoramaOpen((open) => !open)}
        volumeOpen={volumeOpen}
        onVolume={() => setVolumeOpen((open) => !open)}
        chartOpen={chartOpen}
        onToggleChart={() => setChartOpen((open) => !open)}
        planOpen={planOpen}
        onPlan={() => setPlanOpen((open) => !open)}
        onReport={() => setReportOpen(true)}
        onSlicesOnly={() => {
          setPanoramaOpen(false);
          setVolumeOpen(false);
          setChartOpen(false);
          setPlanOpen(false);
          setPlacingImplant(false);
          setTracingSide(null);
        }}
        compact={compact}
      />

      <div className="flex-grow min-w-0 flex flex-col">

      {listOpen && (
        <div className="px-2 pt-2 flex-shrink-0">
          <MeasurementList
            measurements={measurements}
            onRemove={(uid) => {
              removeMeasurement(uid);
              setAnnotationVersion((n) => n + 1);
              engineRef.current?.renderViewports(MPR_VIEWPORTS);
            }}
            onLabel={(uid, text) => {
              labelMeasurement(uid, text);
              setAnnotationVersion((n) => n + 1);
              engineRef.current?.renderViewports(MPR_VIEWPORTS);
            }}
            onLocate={(measurement) => {
              if (!measurement.point) return;
              locateWorld(measurement.point);
            }}
            onClearAll={() => {
              clearMeasurements();
              setAnnotationVersion((n) => n + 1);
            }}
            onClose={() => setListOpen(false)}
          />
        </div>
      )}

      {volumeOpen && (
        <div className="px-2 pt-2 flex-shrink-0">
          <ErrorBoundary title="Объём" onDismiss={() => setVolumeOpen(false)}>
            <VolumePanel
              crop={crop}
              onCrop={setCrop}
              onSnapshot={snapshot3d}
              onExportStl={exportStl}
              exporting={exporting}
              onClose={() => setVolumeOpen(false)}
              volumePreset={volumePreset}
              onVolumePreset={changeVolumePreset}
              volumePresets={VOLUME_PRESETS}
            />
          </ErrorBoundary>
        </div>
      )}

      {planOpen && (
        <div className="px-2 pt-2 flex-shrink-0">
          <ErrorBoundary title="Планирование" onDismiss={() => setPlanOpen(false)}>
            <PlanPanel
              implants={implants}
              canals={canals}
              selectedId={selectedImplantId}
              onSelect={setSelectedImplantId}
              onChange={(next) =>
                setImplants((current) =>
                  current.map((implant) => (implant.id === next.id ? next : implant))
                )
              }
              onRemove={(id) => {
                setImplants((current) => current.filter((implant) => implant.id !== id));
                if (selectedImplantId === id) setSelectedImplantId(null);
              }}
              onLocate={(implant) => locateWorld(implant.platform)}
              placing={placingImplant}
              onPlace={() => {
                setPlacingImplant((on) => !on);
                setTracingSide(null);
              }}
              tracing={tracingSide}
              onTrace={(side) => {
                setTracingSide(side);
                setPlacingImplant(false);
              }}
              onUndoTracePoint={(side) =>
                setCanals((current) =>
                  current.map((canal) =>
                    canal.side === side ? { ...canal, points: canal.points.slice(0, -1) } : canal
                  )
                )
              }
              onClearCanal={(side) => setCanals((current) => current.filter((c) => c.side !== side))}
              onClose={() => {
                setPlanOpen(false);
                setPlacingImplant(false);
                setTracingSide(null);
              }}
            />
          </ErrorBoundary>
        </div>
      )}

      {chartOpen && (
        <div className="px-2 pt-2 flex-shrink-0">
          <ErrorBoundary title="Зубная формула" onDismiss={() => setChartOpen(false)}>
            <ToothChart
              chart={chart}
              detecting={detecting}
              onDetect={detectTeethNow}
              onOpenCard={openCardForTooth}
              onLocate={locateTooth}
              onStatus={(fdi, status) =>
                setToothNotes((current) => ({
                  ...current,
                  [fdi]: { ...current[fdi], status },
                }))
              }
              onNote={(fdi, note) =>
                setToothNotes((current) => ({ ...current, [fdi]: { ...current[fdi], note } }))
              }
              onClose={() => setChartOpen(false)}
            />
          </ErrorBoundary>
        </div>
      )}

      <div ref={splitRef} className="flex-grow flex flex-col min-h-0">
      {compact && (
        <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-900 border-b border-gray-800 flex-shrink-0 overflow-x-auto">
          {ALL_VIEWPORTS.map((id) => (
            <button
              key={id}
              onClick={() => setVisiblePane(id)}
              className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap ${
                visiblePane === id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {PANE_NAMES[id]}
            </button>
          ))}
        </div>
      )}

      <div
        ref={gridRef}
        className={`grid gap-1 p-1 bg-black relative ${
          compact
            ? 'grid-cols-1 grid-rows-1'
            : maximized
            ? 'grid-cols-[1fr_minmax(120px,17%)] grid-rows-3'
            : 'grid-cols-2 grid-rows-2'
        } ${panoramaOpen && panoramaLayout === 'full' ? 'hidden' : ''} ${
          panoramaOpen && panoramaLayout === 'split' ? 'flex-shrink-0' : 'flex-grow'
        }`}
        style={
          panoramaOpen && panoramaLayout === 'split'
            ? { height: `${gridShare * 100}%` }
            : undefined
        }
      >
        {errorMsg && (
          <div className="absolute inset-0 z-30 bg-black/85 flex items-center justify-center p-6">
            <div className="bg-red-950/70 border border-red-500/60 rounded-xl p-6 max-w-lg text-center">
              <Activity className="w-7 h-7 text-red-400 mx-auto mb-3" />
              <h3 className="text-base font-semibold text-red-100 mb-2">Не удалось открыть исследование</h3>
              <p className="text-sm text-red-200/90 leading-relaxed">{errorMsg}</p>
            </div>
          </div>
        )}

        {!isLoaded && !errorMsg && (
          <div className="absolute inset-0 z-30 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
            <div className="w-11 h-11 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium text-blue-300">Построение объёма — {progress}%</p>
              <p className="text-xs text-gray-500 mt-1">
                {slices(series.sliceCount)} · {series.columns}×{series.rows} · {formatBytes(series.estimatedBytes)}
              </p>
            </div>
          </div>
        )}

        <Pane
          label="Аксиальная"
          accent="text-sky-400"
          border="border-sky-900/50"
          dot="bg-sky-500"
          elRef={axialRef}
          note={voiText}
          edges={edges[AXIAL]}
          viewportId={AXIAL}
          engine={isLoaded ? engineRef.current : null}
          onHover={(id) => (hoveredRef.current = id)}
          style={paneStyle(AXIAL)}
          maximized={maximized === AXIAL}
          shrunk={!!maximized && maximized !== AXIAL}
          onToggleMaximize={() => toggleMaximized(AXIAL)}
        >
          {panoramaOpen && archPoints.length > 1 && (
            <ArchOverlay
              viewport={
                (engineRef.current?.getViewport(AXIAL) as cornerstone.Types.IVolumeViewport) ?? null
              }
              points={archPoints}
              sliceIndex={archSlice}
              onChange={setArchPoints}
            />
          )}
          {planLayer(AXIAL)}
        </Pane>
        <Pane
          label="Сагиттальная"
          accent="text-emerald-400"
          border="border-emerald-900/50"
          dot="bg-emerald-500"
          elRef={sagittalRef}
          edges={edges[SAGITTAL]}
          viewportId={SAGITTAL}
          engine={isLoaded ? engineRef.current : null}
          onHover={(id) => (hoveredRef.current = id)}
          style={paneStyle(SAGITTAL)}
          maximized={maximized === SAGITTAL}
          shrunk={!!maximized && maximized !== SAGITTAL}
          onToggleMaximize={() => toggleMaximized(SAGITTAL)}
        >
          {planLayer(SAGITTAL)}
        </Pane>
        <Pane
          label="Корональная"
          accent="text-rose-400"
          border="border-rose-900/50"
          dot="bg-rose-500"
          elRef={coronalRef}
          edges={edges[CORONAL]}
          viewportId={CORONAL}
          engine={isLoaded ? engineRef.current : null}
          onHover={(id) => (hoveredRef.current = id)}
          style={paneStyle(CORONAL)}
          maximized={maximized === CORONAL}
          shrunk={!!maximized && maximized !== CORONAL}
          onToggleMaximize={() => toggleMaximized(CORONAL)}
        >
          {planLayer(CORONAL)}
        </Pane>
        <Pane
          label="3D объём"
          accent="text-amber-400"
          border="border-amber-900/50"
          dot="bg-amber-500"
          elRef={volume3dRef}
          viewportId={VOLUME3D}
          onHover={(id) => (hoveredRef.current = id)}
          note="ЛКМ — вращение · колесо — масштаб"
          style={paneStyle(VOLUME3D)}
          maximized={maximized === VOLUME3D}
          shrunk={!!maximized && maximized !== VOLUME3D}
          onToggleMaximize={() => toggleMaximized(VOLUME3D)}
        />
      </div>

      {panoramaOpen && panoramaLayout === 'split' && (
        <div
          onPointerDown={startSplitDrag}
          title="Потяните, чтобы изменить высоту панели"
          className="h-1.5 flex-shrink-0 cursor-row-resize bg-gray-800 hover:bg-amber-600 transition-colors relative group"
        >
          <div className="absolute left-1/2 -translate-x-1/2 -top-0.5 h-2.5 w-16 rounded bg-gray-700 group-hover:bg-amber-500 transition-colors" />
        </div>
      )}

      {panoramaOpen && (
        <div className="flex-grow min-h-0">
          <ErrorBoundary
            title="Панорама"
            hint="Срезы и объём в порядке — можно закрыть панораму и продолжить работу с ними. Если сбой повторяется, попробуйте заново подобрать дугу."
            onDismiss={() => setPanoramaOpen(false)}
            dismissLabel="Закрыть панораму"
          >
          <PanoramaPanel
            sampler={sampler}
            geometry={geometry}
            archSlice={archSlice}
            marks={toothMarks}
            onMarksChange={setToothMarks}
            activeMarkId={activeMarkId}
            onActivateMark={setActiveMarkId}
            onImage={setPanoramaImage}
            candidates={candidates}
            onCandidates={setCandidates}
            tracingCanal={!!tracingSide}
            onPanoramaPoint={(arcMm, heightMm) => {
              const world = archPointToWorld(arcMm, heightMm);
              if (world) addCanalPoint(world);
            }}
            canalMarks={canalMarks}
            patientName={series.patientName}
            layout={panoramaLayout}
            onLayout={setPanoramaLayout}
            onClose={() => setPanoramaOpen(false)}
            onRefit={() => sampler && buildArch(sampler)}
            onLocate={locateVoxel}
          />
          </ErrorBoundary>
        </div>
      )}
      </div>
      </div>
      </div>

      {activeMark && sampler && (
        <ErrorBoundary
          title="Карточка зуба"
          hint="Срезы этого зуба построить не удалось. Исследование и панорама в порядке."
          onDismiss={() => setActiveMarkId(null)}
        >
          <ToothCard
            sampler={sampler}
            geometry={geometry}
            archSlice={archSlice}
            panorama={panoramaImage}
            patientName={series.patientName}
            mark={activeMark}
            onChange={(next) =>
              setToothMarks((marks) => marks.map((mark) => (mark.id === next.id ? next : mark)))
            }
            onDelete={() => {
              setToothMarks((marks) => marks.filter((mark) => mark.id !== activeMark.id));
              setActiveMarkId(null);
            }}
            onClose={() => setActiveMarkId(null)}
            onLocate={(heightMm) => locateOnArch(activeMark.arcMm, heightMm)}
          />
        </ErrorBoundary>
      )}

      {reportOpen && (
        <ErrorBoundary
          title="Заключение"
          hint="Собрать документ не удалось. Разметка и снимок в порядке."
          onDismiss={() => setReportOpen(false)}
        >
          <ReportView
            sampler={sampler}
            geometry={geometry}
            archSlice={archSlice}
            panorama={panoramaImage}
            chart={chart}
            marks={toothMarks}
            patientName={series.patientName}
            studyDescription={series.description}
            sliceCount={series.sliceCount}
            conclusion={conclusion}
            onConclusion={setConclusion}
            implants={implants}
            canals={canals}
            onClose={() => setReportOpen(false)}
          />
        </ErrorBoundary>
      )}

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
};

/* ---------------------------------------------------------------- helpers */

function buildToolGroups(engineId: string, mprGroupId: string, vol3dGroupId: string) {
  const mpr = ToolGroupManager.createToolGroup(mprGroupId);
  if (mpr) {
    mpr.addTool(CrosshairsTool.toolName, {
      // Handles sized for a fingertip; ignored by the mouse path.
      mobile: { enabled: true, opacity: 0.8, handleRadius: 12 },
    });
    mpr.addTool(WindowLevelTool.toolName);
    mpr.addTool(PanTool.toolName);
    mpr.addTool(ZoomTool.toolName);
    mpr.addTool(StackScrollMouseWheelTool.toolName);
    mpr.addTool(LengthTool.toolName);
    mpr.addTool(AngleTool.toolName);
    // Width and height of bone at a site, a density probe, and an area — the
    // three a dentist reaches for after length and angle.
    mpr.addTool(BidirectionalTool.toolName);
    mpr.addTool(ProbeTool.toolName);
    mpr.addTool(RectangleROITool.toolName);

    // Crosshairs on the left button gives synchronised navigation out of the
    // box: clicking in one plane moves the other two to the same point. One
    // finger does the same on a tablet — FOREGROUND_BINDINGS carries both, so
    // whatever tool is selected always answers to either.
    mpr.setToolActive(CrosshairsTool.toolName, { bindings: [...FOREGROUND_BINDINGS] });
    mpr.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
    mpr.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Secondary }, { numTouchPoints: 2 }],
    });
    mpr.setToolActive(StackScrollMouseWheelTool.toolName);

    MPR_VIEWPORTS.forEach((id) => mpr.addViewport(id, engineId));
  }

  const vol3d = ToolGroupManager.createToolGroup(vol3dGroupId);
  if (vol3d) {
    vol3d.addTool(TrackballRotateTool.toolName);
    vol3d.addTool(ZoomTool.toolName);
    vol3d.addTool(PanTool.toolName);
    vol3d.addTool(VolumeRotateMouseWheelTool.toolName);

    vol3d.setToolActive(TrackballRotateTool.toolName, { bindings: [...FOREGROUND_BINDINGS] });
    vol3d.setToolActive(PanTool.toolName, { bindings: [{ mouseButton: MouseBindings.Auxiliary }] });
    vol3d.setToolActive(ZoomTool.toolName, {
      bindings: [{ mouseButton: MouseBindings.Secondary }, { numTouchPoints: 2 }],
    });

    vol3d.addViewport(VOLUME3D, engineId);
  }
}

function applyWindowLevel(
  engine: cornerstone.RenderingEngine | null,
  key: string,
  levels: DensityLevels | null,
  measured: { center: number; width: number } | null
) {
  if (!engine) return;
  const preset = WL_PRESETS[key];
  if (!preset) return;

  // Presets are written in Hounsfield units and put on this volume's own
  // scale: on an uncalibrated CBCT a raw «центр 480» is simply black.
  const window =
    key === AUTO_WINDOW
      ? measured ?? { center: preset.center, width: preset.width }
      : levels
      ? windowFromHu(levels, preset.center, preset.width)
      : { center: preset.center, width: preset.width };
  if (!window.width) return;
  const voiRange = {
    lower: window.center - window.width / 2,
    upper: window.center + window.width / 2,
  };
  MPR_VIEWPORTS.forEach((id) => {
    const vp = engine.getViewport(id) as cornerstone.Types.IVolumeViewport | undefined;
    if (!vp?.setProperties) return;
    try {
      vp.setProperties({ voiRange });
      vp.render();
    } catch (err) {
      console.warn('Не удалось применить окно яркости', err);
    }
  });
}

function applyVolumePreset(engine: cornerstone.RenderingEngine | null, preset: string) {
  if (!engine) return;
  const vp = engine.getViewport(VOLUME3D) as cornerstone.Types.IVolumeViewport | undefined;
  if (!vp?.setProperties) return;
  try {
    vp.setProperties({ preset });
    vp.render();
  } catch (err) {
    console.warn('Не удалось применить 3D-пресет', err);
  }
}

/** Hounsfield value under the pointer, or null when it is off the volume. */
function readDensity(
  engine: cornerstone.RenderingEngine | null,
  viewportId: string,
  event: MouseEvent,
  halfFloat: boolean,
  levels: DensityLevels | null
): string | null {
  if (!engine) return null;
  try {
    const viewport = engine.getViewport(viewportId) as cornerstone.Types.IVolumeViewport | undefined;
    const data = viewport?.getImageData?.();
    if (!viewport || !data) return null;

    const rect = viewport.getCanvas().getBoundingClientRect();
    const world = viewport.canvasToWorld([event.clientX - rect.left, event.clientY - rect.top]);
    const index = cornerstone.utilities.transformWorldToIndex(data.imageData, world);

    const [columns, rows, frames] = data.dimensions;
    const [x, y, z] = index;
    if (x < 0 || y < 0 || z < 0 || x >= columns || y >= rows || z >= frames) return null;

    const raw = (data.scalarData as any)[z * columns * rows + y * columns + x];
    if (raw === undefined) return null;

    const value = halfFloat ? decodeHalfFloat(raw) : raw;
    // «HU» only when the file claims Hounsfield units and the volume's own
    // histogram agrees; otherwise the number is real but the unit is not.
    return `${Math.round(value)} ${levels ? levels.unit : 'усл. ед.'}`;
  } catch {
    return null;
  }
}

function sameEdges(
  a: Record<string, EdgeLabels | null>,
  b: Record<string, EdgeLabels | null>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (!left || !right) {
      if (left !== right) return false;
      continue;
    }
    if (
      left.top !== right.top ||
      left.bottom !== right.bottom ||
      left.left !== right.left ||
      left.right !== right.right
    ) {
      return false;
    }
  }
  return true;
}

function describeError(err: any, series: SeriesInfo): string {
  const message = String(err?.message || err || '');
  if (message.includes('CACHE_SIZE_EXCEEDED') || message.includes('cacheSize')) {
    return `Исследованию нужно около ${formatBytes(
      series.estimatedBytes
    )} оперативной памяти, а браузер столько не выделяет. Откройте серию с меньшим числом срезов или уменьшите область реконструкции при экспорте из томографа.`;
  }
  if (message.includes('z-spacing') || message.includes('zSpacing')) {
    return 'Срезы расположены с неравномерным шагом, и собрать из них корректный объём нельзя. Проверьте, не попали ли в серию файлы из другой реконструкции.';
  }
  return message || 'Неизвестная ошибка при построении объёма.';
}

/* ------------------------------------------------------------------- UI */

interface PaneProps {
  label: string;
  accent: string;
  border: string;
  dot: string;
  elRef: React.RefObject<HTMLDivElement>;
  note?: string;
  /** Which patient direction each edge of this slice points to. */
  edges?: EdgeLabels | null;
  /** Viewport id, for the panes that carry a slice readout. */
  viewportId?: string;
  engine?: cornerstone.RenderingEngine | null;
  onHover?: (viewportId: string) => void;
  /** Grid placement, set only while some pane is maximised. */
  style?: React.CSSProperties;
  maximized?: boolean;
  /** Squeezed into the right-hand column because another pane is maximised. */
  shrunk?: boolean;
  onToggleMaximize?: () => void;
  children?: React.ReactNode;
}

const Pane: React.FC<PaneProps> = ({
  label,
  accent,
  border,
  dot,
  elRef,
  note,
  edges,
  viewportId,
  engine,
  onHover,
  style,
  maximized,
  shrunk,
  onToggleMaximize,
  children,
}) => (
  <div
    style={style}
    onMouseEnter={() => viewportId && onHover?.(viewportId)}
    className={`group relative bg-gray-950 border rounded-md overflow-hidden min-w-0 min-h-0 ${
      maximized ? 'border-amber-600/60' : border
    }`}
  >
    <div
      ref={elRef}
      className="w-full h-full"
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={onToggleMaximize}
    />
    {children}
    {viewportId && engine && (
      <SliceScroller
        viewport={
          (engine.getViewport(viewportId) as cornerstone.Types.IVolumeViewport | undefined) ?? null
        }
        compact={shrunk}
      />
    )}
    {edges && (
      <div
        className={`absolute inset-0 pointer-events-none font-mono font-bold text-gray-200/85 ${
          shrunk ? 'text-[9px]' : 'text-xs'
        }`}
      >
        <span className="absolute top-1.5 left-1/2 -translate-x-1/2" title={AXIS_NAMES[edges.top]}>
          {edges.top}
        </span>
        <span
          className="absolute bottom-1.5 left-1/2 -translate-x-1/2"
          title={AXIS_NAMES[edges.bottom]}
        >
          {edges.bottom}
        </span>
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2" title={AXIS_NAMES[edges.left]}>
          {edges.left}
        </span>
        <span
          className="absolute right-1.5 top-1/2 -translate-y-1/2"
          title={AXIS_NAMES[edges.right]}
        >
          {edges.right}
        </span>
      </div>
    )}
    <div
      className={`absolute top-2 left-2.5 flex items-center gap-1.5 bg-black/70 px-2 py-0.5 rounded ${accent} font-mono pointer-events-none ${
        shrunk ? 'text-[9px]' : 'text-[11px]'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </div>
    {onToggleMaximize && (
      <button
        type="button"
        // Cornerstone starts a tool drag on mousedown, so the press must not
        // reach the viewport element underneath.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onToggleMaximize();
        }}
        title={
          maximized
            ? 'Свернуть окно (Esc)'
            : 'Развернуть окно (F) · двойной клик по срезу делает то же самое'
        }
        className={`absolute top-1.5 right-1.5 p-1 rounded bg-black/70 text-gray-400 hover:text-white hover:bg-black/90 transition-colors ${
          shrunk ? 'opacity-0 group-hover:opacity-100 focus:opacity-100' : ''
        }`}
      >
        {maximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </button>
    )}
    {note && !shrunk && (
      <div className="absolute bottom-2 right-2.5 text-[10px] text-gray-500 font-mono pointer-events-none">
        {note}
      </div>
    )}
  </div>
);

/** Modes moved to the ModeRail; what is left here acts on the current slice. */
interface ToolbarProps {
  slabMm: number;
  onSlab: (mm: number) => void;
  slabMode: 'mip' | 'minip' | 'average';
  onSlabMode: (mode: 'mip' | 'minip' | 'average') => void;
  listOpen: boolean;
  onToggleList: () => void;
  measurementCount: number;
  huText: string | null;
  /** How this volume's grey scale was measured — shown on the readout. */
  densityNote: string | null;
  /** «HU» or «усл. ед.», per the measurement. */
  densityUnit: string;
  activeTool: PrimaryTool;
  onTool: (tool: PrimaryTool) => void;
  wlPreset: string;
  onWindowLevel: (key: string) => void;
  onReset: () => void;
  onHelp: () => void;
}

const Toolbar: React.FC<ToolbarProps> = ({
  slabMm,
  onSlab,
  slabMode,
  onSlabMode,
  listOpen,
  onToggleList,
  measurementCount,
  huText,
  densityNote,
  densityUnit,
  activeTool,
  onTool,
  wlPreset,
  onWindowLevel,
  onReset,
  onHelp,
}) => {
  const navTools: Array<{ id: PrimaryTool; icon: React.ReactNode; label: string; title: string }> = [
    { id: 'Crosshairs', icon: <Crosshair className="w-3.5 h-3.5" />, label: 'Перекрестье', title: 'Синхронная навигация по трём проекциям (1)' },
    { id: 'WindowLevel', icon: <SunMedium className="w-3.5 h-3.5" />, label: 'Яркость', title: 'Яркость и контраст (окно HU) (2)' },
    { id: 'Pan', icon: <Move className="w-3.5 h-3.5" />, label: 'Сдвиг', title: 'Панорамирование (3)' },
    { id: 'Zoom', icon: <ZoomIn className="w-3.5 h-3.5" />, label: 'Масштаб', title: 'Масштабирование (4)' },
  ];

  const measureTools: Array<{ id: PrimaryTool; icon: React.ReactNode; label: string; title: string }> = [
    { id: 'Length', icon: <Ruler className="w-3.5 h-3.5" />, label: 'Длина', title: 'Измерение расстояния в мм (L)' },
    { id: 'Angle', icon: <Triangle className="w-3.5 h-3.5" />, label: 'Угол', title: 'Измерение угла (A)' },
    {
      id: 'Bidirectional',
      icon: <Move3d className="w-3.5 h-3.5" />,
      label: 'Ш×В',
      title: 'Ширина и высота — например, кости в месте имплантации (B)',
    },
    {
      // Not a Crosshair: without a label beside it, that would be the
      // navigation tool's icon twice over.
      id: 'Probe',
      icon: <Pipette className="w-3.5 h-3.5" />,
      label: 'Точка',
      title: 'Плотность в точке с отметкой на срезе',
    },
    {
      id: 'RectangleROI',
      icon: <Square className="w-3.5 h-3.5" />,
      label: 'Область',
      title: 'Средняя плотность и площадь в прямоугольнике',
    },
  ];

  /**
   * The four navigation tools keep their names — they are reached for
   * constantly. The measurements are icon-only: five more labels is what
   * pushed the presets off a 1280px screen, and each icon has its own shape
   * plus a tooltip that says more than the label did.
   */
  const button = (
    t: { id: PrimaryTool; icon: React.ReactNode; label: string; title: string },
    labelled = true
  ) => (
    <button
      key={t.id}
      onClick={() => onTool(t.id)}
      title={t.title}
      aria-label={t.label}
      className={`flex items-center gap-1.5 py-1 text-xs font-medium rounded transition-colors ${
        labelled ? 'px-2.5' : 'px-2'
      } ${activeTool === t.id ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
    >
      {t.icon}
      {labelled && <span>{t.label}</span>}
    </button>
  );

  return (
    // Tools and presets scroll when the window is narrow; the slab control and
    // the readouts on the right do not. The measurement tools alone can outrun
    // a laptop screen — but the modes no longer sit here to be pushed off it.
    <div className="h-12 bg-gray-900 border-b border-gray-800 flex items-stretch flex-shrink-0">
      <div className="flex items-center px-3 gap-3 overflow-x-auto flex-grow min-w-0">
      <div className="flex items-center gap-1 bg-gray-800 p-1 rounded-lg border border-gray-700 flex-shrink-0">
        {navTools.map((t) => button(t))}
      </div>

      <div className="flex items-center gap-1 bg-gray-800 p-1 rounded-lg border border-gray-700 flex-shrink-0">
        {measureTools.map((t) => button(t, false))}
        <button
          onClick={onToggleList}
          title="Список измерений: значения, подписи, удаление по одному"
          className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors ${
            listOpen ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          <ListChecks className="w-3.5 h-3.5" />
          {measurementCount > 0 && (
            <span className="font-mono tabular-nums">{measurementCount}</span>
          )}
        </button>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0">
        <SunMedium className="w-3.5 h-3.5" />
        <select
          value={wlPreset}
          onChange={(e) => onWindowLevel(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
        >
          {Object.entries(WL_PRESETS).map(([key, p]) => (
            <option key={key} value={key}>
              {p.label}
            </option>
          ))}
        </select>
      </label>

      </div>

      <div className="flex items-center gap-2 px-3 border-l border-gray-800 flex-shrink-0">
      <label
        className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0"
        title="Толщина слоя: срез в один воксель прячет канал, идущий наискось, и тонкую кортикальную пластинку"
      >
        <Layers3 className="w-3.5 h-3.5" />
        Слой
        <input
          type="range"
          min={0}
          max={12}
          step={1}
          value={slabMm}
          onChange={(event) => onSlab(Number(event.target.value))}
          className="w-16 accent-blue-500"
        />
        <span className="font-mono text-gray-200 tabular-nums w-10">
          {slabMm ? `${slabMm} мм` : 'срез'}
        </span>
        {slabMm > 0 && (
          <select
            value={slabMode}
            onChange={(event) => onSlabMode(event.target.value as 'mip' | 'minip' | 'average')}
            className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 text-xs text-white"
          >
            <option value="mip">максимум</option>
            <option value="minip">минимум</option>
            <option value="average">среднее</option>
          </select>
        )}
      </label>

      </div>

      <div className="flex items-center gap-2 px-3 border-l border-gray-800 flex-shrink-0">
      <div
        title={
          densityNote
            ? `Плотность в точке под курсором. ${densityNote}`
            : 'Плотность в точке под курсором'
        }
        className="hidden lg:flex items-center gap-1.5 text-xs font-mono text-gray-300 bg-gray-800 border border-gray-700 rounded px-2.5 py-1.5 flex-shrink-0 tabular-nums"
      >
        <Sigma className="w-3.5 h-3.5 text-gray-500" />
        <span className={huText ? 'text-emerald-300' : 'text-gray-600'}>
          {huText ?? `— ${densityUnit}`}
        </span>
      </div>

      <button
        onClick={onReset}
        title="Вернуть камеры и окно яркости в исходное положение (R)"
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 text-xs flex-shrink-0"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        <span>Сброс</span>
      </button>

      <button
        onClick={onHelp}
        title="Горячие клавиши (?)"
        className="flex items-center justify-center w-7 h-7 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded border border-gray-700 text-xs font-semibold flex-shrink-0"
      >
        ?
      </button>
      </div>
    </div>
  );
};
