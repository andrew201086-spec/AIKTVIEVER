import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2,
  Download,
  RotateCcw,
  Wand2,
  Layers3,
  Maximize2,
  Minimize2,
  X,
  Sparkles,
  MapPin,
  Search,
  Crosshair,
  Waves,
} from 'lucide-react';
import {
  archOffsetProfile,
  renderPanorama,
  sharpenImage,
  toImageData,
  type ArchGeometry,
  type BlendMode,
  type PanoramaImage,
  type VolumeSampler,
} from '../utils/panorama';
import {
  archStartsOnRight,
  fdiLabel,
  guessFdi,
  occlusalHeightMm,
  type ToothMark,
} from '../utils/toothSections';
import { scanApicalLucencies, type LesionCandidate } from '../utils/periapical';
import { heightToSlice } from '../utils/orientation';

export type PanoramaLayout = 'split' | 'full';

interface PanoramaPanelProps {
  sampler: VolumeSampler | null;
  /** The sampled arch, built once by the viewer and shared with the chart. */
  geometry: ArchGeometry | null;
  /** Axial slice the arch was fitted on — the occlusal plane. */
  archSlice: number;
  marks: ToothMark[];
  onMarksChange: (marks: ToothMark[]) => void;
  /** The tooth card is a modal over the whole viewer, so the viewer owns it. */
  activeMarkId: string | null;
  onActivateMark: (id: string | null) => void;
  /** Reconstructed picture, lifted so the chart and the report can use it. */
  onImage: (image: PanoramaImage | null) => void;
  candidates: LesionCandidate[];
  onCandidates: (candidates: LesionCandidate[]) => void;
  patientName: string;
  layout: PanoramaLayout;
  onLayout: (layout: PanoramaLayout) => void;
  onClose: () => void;
  onRefit: () => void;
  /** Moves the three slice views onto a voxel of the volume. */
  onLocate: (voxel: [number, number, number]) => void;
  /**
   * Canal tracing. The panorama is the natural place for it — the canal runs
   * along the arch — so a click here reports where on the arch it landed and
   * the viewer turns that into a patient coordinate.
   */
  tracingCanal: boolean;
  onPanoramaPoint: (arcMm: number, heightMm: number) => void;
  /** Traced canals, already projected onto this reformation. */
  canalMarks: Array<{ side: 'right' | 'left'; points: Array<[number, number]> }>;
}

const WINDOWS: Record<string, { center: number; width: number } | null> = {
  auto: null,
  bone: { center: 480, width: 2500 },
  teeth: { center: 1500, width: 5000 },
  soft: { center: 40, width: 400 },
};

/** Baseline settings — a thin slab, moderate edge enhancement, no shift. */
const DEFAULTS = {
  thickness: 6,
  anteriorBoost: 0,
  offset: 0,
  sharpness: 0.8,
};

const WINDOW_LABELS: Record<string, string> = {
  auto: 'Автоматически',
  bone: 'Кость',
  teeth: 'Зубы и эмаль',
  soft: 'Мягкие ткани',
};

/**
 * The panoramic reconstruction: the volume unrolled along the dental arch.
 *
 * Rebuilding takes long enough to be felt, so it is debounced — dragging an
 * arch handle should not queue a reconstruction per pointer event.
 */
export const PanoramaPanel: React.FC<PanoramaPanelProps> = ({
  sampler,
  archSlice,
  marks,
  onMarksChange,
  patientName,
  layout,
  onLayout,
  onClose,
  onRefit,
  onLocate,
  geometry,
  activeMarkId,
  onActivateMark,
  onImage,
  candidates,
  onCandidates,
  tracingCanal,
  onPanoramaPoint,
  canalMarks,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /** Next click on the panorama places a tooth mark. */
  const [marking, setMarking] = useState(false);
  const [, forceRedraw] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);

  // The settings that read best on real scans. Everything else is a departure
  // from here, and «Сброс» comes straight back.
  const [thickness, setThickness] = useState(DEFAULTS.thickness);
  const [anteriorBoost, setAnteriorBoost] = useState(DEFAULTS.anteriorBoost);
  const [offset, setOffset] = useState(DEFAULTS.offset);
  const [blend, setBlend] = useState<BlendMode>('average');
  const [sharpness, setSharpness] = useState(DEFAULTS.sharpness);
  const [windowKey, setWindowKey] = useState('auto');
  const [zoom, setZoom] = useState<'fit' | 'actual'>('fit');
  /**
   * Follow the arch as it drifts with height, instead of holding the curve
   * fitted at the occlusal plane all the way up and down.
   */
  const [followArch, setFollowArch] = useState(true);

  const [image, setImage] = useState<PanoramaImage | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildMs, setBuildMs] = useState(0);

  useEffect(() => {
    if (!sampler || !geometry) return;

    let cancelled = false;
    setIsBuilding(true);

    const timer = window.setTimeout(() => {
      // Yield once more so the spinner paints before the main thread is taken.
      // A timer rather than a frame: a tab in the background stops painting
      // frames, and the reconstruction would hang on its spinner for as long
      // as the user was looking elsewhere.
      window.setTimeout(() => {
        if (cancelled) return;
        const started = performance.now();
        const scaleMm = Math.min(...sampler.spacing);
        const heightOffsetsMm = followArch
          ? archOffsetProfile(sampler, geometry.curve, scaleMm)
          : undefined;
        const built = renderPanorama(sampler, geometry.curve, {
          thicknessMm: thickness,
          blend,
          anteriorBoostMm: anteriorBoost,
          offsetMm: offset,
          heightOffsetsMm,
        });
        const finished = sharpenImage(built, sharpness);
        if (cancelled) return;
        setImage(finished);
        onImage(finished);
        setBuildMs(Math.round(performance.now() - started));
        setIsBuilding(false);
      }, 0);
    }, 160);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sampler, geometry, thickness, anteriorBoost, offset, blend, sharpness, followArch, onImage]);

  // A moved arch invalidates every finding measured against the old one.
  useEffect(() => {
    onCandidates([]);
    setScanned(false);
  }, [geometry, archSlice, onCandidates]);

  // «M» from the viewer's keyboard handler: the panel owns this mode, so the
  // shortcut is delivered as an event rather than lifted into shared state.
  useEffect(() => {
    const arm = () => setMarking((on) => !on);
    window.addEventListener('cbct:mark-tooth', arm);
    return () => window.removeEventListener('cbct:mark-tooth', arm);
  }, []);

  const windowing = useMemo(() => {
    if (!image) return { center: 480, width: 2500 };
    return WINDOWS[windowKey] ?? autoWindow(image);
  }, [image, windowKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.putImageData(toImageData(image, windowing.center, windowing.width), 0, 0);
  }, [image, windowing]);

  // Marks are drawn over the canvas in CSS pixels; the letterbox moves with
  // every resize, so the overlay is re-projected on each one.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => forceRedraw((n) => n + 1));
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [image, zoom]);

  /** Where the bitmap actually sits inside the wrapper, in CSS pixels. */
  const drawnRect = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !image) return null;
    const rect = wrap.getBoundingClientRect();
    const scale = Math.min(rect.width / image.width, rect.height / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    return {
      scale,
      left: (rect.width - width) / 2,
      top: (rect.height - height) / 2,
      clientLeft: rect.left,
      clientTop: rect.top,
      width,
      height,
    };
  }, [image]);

  /** Where on the arch a click landed, in millimetres. */
  const pointAt = (event: React.MouseEvent): { arcMm: number; heightMm: number } | null => {
    if (!image) return null;
    const drawn = drawnRect();
    if (!drawn) return null;
    const px = (event.clientX - drawn.clientLeft - drawn.left) / drawn.scale;
    const py = (event.clientY - drawn.clientTop - drawn.top) / drawn.scale;
    if (px < 0 || py < 0 || px > image.width || py > image.height) return null;
    return { arcMm: px * image.scaleMm, heightMm: py * image.scaleMm };
  };

  const onPanoramaClick = (event: React.MouseEvent) => {
    const at = pointAt(event);
    if (!at) return;
    if (tracingCanal) {
      onPanoramaPoint(at.arcMm, at.heightMm);
      return;
    }
    if (marking) placeMark(at);
  };

  const placeMark = (at: { arcMm: number; heightMm: number }) => {
    if (!image || !sampler) return;
    const { arcMm } = at;
    const jaw = at.heightMm < occlusalHeightMm(sampler, archSlice) ? 'upper' : 'lower';
    const mark: ToothMark = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      arcMm,
      jaw,
      fdi: guessFdi(arcMm, image.archLengthMm, jaw, archStartsOnRight(sampler)),
      note: '',
    };
    onMarksChange([...marks, mark]);
    onActivateMark(mark.id);
    setMarking(false);
  };

  const runScan = () => {
    if (!sampler || !geometry) return;
    setScanning(true);

    // Yield twice so the spinner paints before the scan takes the main thread.
    // A timer rather than a frame: a background tab stops painting frames, and
    // a scan that never starts would leave the button spinning forever.
    window.setTimeout(() => {
      window.setTimeout(() => {
        const found = scanApicalLucencies(sampler, geometry.curve, geometry.stepMm, archSlice);
        onCandidates(found);
        setScanned(true);
        setScanning(false);
      }, 0);
    }, 60);
  };

  /** Puts the slice views on a point given by its place on the arch. */
  const locate = (arcMm: number, heightMm: number) => {
    if (!sampler || !geometry) return;
    const column = Math.max(
      0,
      Math.min(Math.round(arcMm / geometry.stepMm), geometry.curve.length - 1)
    );
    const point = geometry.curve[column];
    const [, , nz] = sampler.dimensions;
    // Through the orientation-aware helper: the raw `nz - 1 - h/sz` this used
    // to do is right only for a volume stacked from the feet up, and jumps to
    // the mirrored height on one stacked the other way.
    const k = heightToSlice(heightMm, nz, sampler.spacing[2], sampler.orientation);
    if (layout === 'full') onLayout('split');
    onLocate([point.i, point.j, Math.max(0, Math.min(k, nz - 1))]);
  };

  /** Turns a candidate into a mark the doctor owns, and opens its card. */
  const acceptCandidate = (candidate: LesionCandidate) => {
    if (!sampler || !image) return;
    const existing = marks.find(
      (mark) => mark.jaw === candidate.jaw && Math.abs(mark.arcMm - candidate.arcMm) < 3
    );
    if (existing) {
      onActivateMark(existing.id);
      return;
    }

    const mark: ToothMark = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      arcMm: candidate.arcMm,
      jaw: candidate.jaw,
      fdi: guessFdi(candidate.arcMm, image.archLengthMm, candidate.jaw, archStartsOnRight(sampler)),
      note: `Подсказка: разрежение у верхушки, ~${candidate.volumeMm3.toFixed(0)} мм³`,
    };
    onMarksChange([...marks, mark]);
    onActivateMark(mark.id);
    setMarking(false);
  };

  const removeMark = (id: string) => {
    onMarksChange(marks.filter((mark) => mark.id !== id));
    if (activeMarkId === id) onActivateMark(null);
  };

  const occlusalRowMm = sampler ? occlusalHeightMm(sampler, archSlice) : 0;

  const reset = () => {
    setThickness(DEFAULTS.thickness);
    setAnteriorBoost(DEFAULTS.anteriorBoost);
    setOffset(DEFAULTS.offset);
    setSharpness(DEFAULTS.sharpness);
    setBlend('average');
    setWindowKey('auto');
    setFollowArch(true);
  };

  const save = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const who = patientName ? patientName.replace(/\s+/g, '_') : 'КЛКТ';
      link.download = `панорама_${who}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-950">
      <div className="h-11 flex items-stretch border-b border-gray-800 bg-gray-900 flex-shrink-0">
        {/* Controls scroll when they do not fit; the actions stay put, so the
            close and maximise buttons never slide off the edge. */}
        <div className="flex items-center gap-3 px-3 overflow-x-auto flex-grow min-w-0">
        <span className="flex items-center gap-1.5 text-xs font-medium text-amber-400 flex-shrink-0">
          <Layers3 className="w-3.5 h-3.5" />
          Панорама
        </span>

        <label className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0">
          Толщина
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={thickness}
            onChange={(event) => setThickness(Number(event.target.value))}
            className="w-20 accent-amber-500"
          />
          <span className="font-mono text-gray-200 tabular-nums w-10">{thickness} мм</span>
        </label>

        <label
          className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0"
          title="Насколько толще брать слой во фронтальном отделе — резцы наклонены и выпадают из ровного слоя"
        >
          Спереди
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={anteriorBoost}
            onChange={(event) => setAnteriorBoost(Number(event.target.value))}
            className="w-20 accent-amber-500"
          />
          <span className="font-mono text-gray-200 tabular-nums w-10">+{anteriorBoost} мм</span>
        </label>

        <label
          className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0"
          title="Сдвиг слоя поперёк дуги: наружу к губе или внутрь к нёбу"
        >
          Сдвиг
          <input
            type="range"
            min={-5}
            max={5}
            step={0.5}
            value={offset}
            onChange={(event) => setOffset(Number(event.target.value))}
            className="w-20 accent-amber-500"
          />
          <span className="font-mono text-gray-200 tabular-nums w-11">
            {offset > 0 ? '+' : ''}
            {offset} мм
          </span>
        </label>

        <label className="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
          <Sparkles className="w-3.5 h-3.5" />
          Резкость
          <input
            type="range"
            min={0}
            max={150}
            step={5}
            value={Math.round(sharpness * 100)}
            onChange={(event) => setSharpness(Number(event.target.value) / 100)}
            className="w-20 accent-amber-500"
          />
          <span className="font-mono text-gray-200 tabular-nums w-8">
            {Math.round(sharpness * 100)}
          </span>
        </label>

        <div className="flex items-center gap-1 bg-gray-800 p-0.5 rounded border border-gray-700 flex-shrink-0">
          {(['average', 'max'] as BlendMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setBlend(mode)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                blend === mode ? 'bg-amber-600 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              {mode === 'average' ? 'Среднее' : 'Максимум'}
            </button>
          ))}
        </div>

        <select
          value={windowKey}
          onChange={(event) => setWindowKey(event.target.value)}
          title="Окно яркости"
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white flex-shrink-0"
        >
          {Object.keys(WINDOWS).map((key) => (
            <option key={key} value={key}>
              {WINDOW_LABELS[key]}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1 bg-gray-800 p-0.5 rounded border border-gray-700 flex-shrink-0">
          {(['fit', 'actual'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setZoom(mode)}
              title={mode === 'fit' ? 'Вписать в панель' : 'Пиксель в пиксель, без растягивания'}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                zoom === mode ? 'bg-gray-600 text-white' : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              {mode === 'fit' ? 'Вписать' : '1:1'}
            </button>
          ))}
        </div>

        <button
          onClick={reset}
          title="Вернуть настройки, при которых картинка читается лучше всего"
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 flex-shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Сброс
        </button>

        <button
          onClick={() => setFollowArch((on) => !on)}
          title="Следовать за дугой по высоте: корни отклоняются от окклюзионной плоскости, и кривая, подобранная на ней, промахивается мимо верхушек"
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border flex-shrink-0 ${
            followArch
              ? 'bg-amber-600/20 border-amber-600/50 text-amber-200'
              : 'bg-gray-800 hover:bg-gray-700 border-gray-700 text-gray-300'
          }`}
        >
          <Waves className="w-3.5 h-3.5" />
          По высоте
        </button>

        <button
          onClick={onRefit}
          title="Заново подобрать дугу по зубам"
          className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 flex-shrink-0"
        >
          <Wand2 className="w-3.5 h-3.5" />
          Дуга
        </button>

        </div>

        {/* The two actions the panel exists for. They live outside the
            scrolling group: on a narrow window the settings slide away, and
            these must not go with them. */}
        <div className="flex items-center gap-2 px-3 border-l border-gray-800 flex-shrink-0">
          <button
            onClick={() => setMarking((on) => !on)}
            disabled={!image}
            title="Отметить проблемный зуб: нажмите, затем кликните по зубу на панораме"
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border disabled:opacity-40 ${
              marking
                ? 'bg-amber-600 border-amber-500 text-white'
                : 'bg-amber-600/15 hover:bg-amber-600/30 border-amber-600/50 text-amber-200'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            {marking ? 'Кликните по зубу' : 'Отметить зуб'}
          </button>

          <button
            onClick={runScan}
            disabled={!image || scanning}
            title="Подсказка: обвести места, где кость у верхушек корней темнее окружающей. Это не диагноз — решает врач"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 disabled:opacity-40"
          >
            {scanning ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{scanning ? 'Поиск…' : 'Найти разрежения'}</span>
          </button>
        </div>

        <div className="flex items-center gap-2 px-3 border-l border-gray-800 flex-shrink-0">
          {image && (
            <span className="hidden 2xl:inline text-[11px] font-mono text-gray-500 tabular-nums">
              {image.width}×{image.height} · дуга {image.archLengthMm.toFixed(0)} мм ·{' '}
              {image.scaleMm.toFixed(2)} мм/пикс · {buildMs} мс
            </span>
          )}
          <button
            onClick={save}
            disabled={!image}
            title="Сохранить панораму в PNG"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded border border-gray-700"
          >
            <Download className="w-3.5 h-3.5" />
            PNG
          </button>
          <button
            onClick={() => onLayout(layout === 'full' ? 'split' : 'full')}
            title={layout === 'full' ? 'Вернуть срезы' : 'Развернуть на всё окно'}
            className="p-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700"
          >
            {layout === 'full' ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={onClose}
            title="Закрыть панораму"
            className="p-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        className={`flex-grow min-h-0 relative bg-black flex items-center justify-center p-2 ${
          zoom === 'actual' ? 'overflow-auto' : 'overflow-hidden'
        }`}
      >
        {isBuilding && (
          <div className="absolute inset-0 z-10 bg-black/60 flex items-center justify-center gap-2 text-amber-300 text-xs">
            <Loader2 className="w-4 h-4 animate-spin" />
            Построение развёртки…
          </div>
        )}
        {!sampler && <p className="text-xs text-gray-600">Объём ещё не готов</p>}
        {/* canvas is a replaced element, so object-fit scales the bitmap to the
            panel while keeping millimetres square in both directions */}
        <div
          ref={wrapRef}
          onClick={onPanoramaClick}
          className={`relative ${zoom === 'fit' ? 'w-full h-full' : 'flex-shrink-0'} ${
            marking || tracingCanal ? 'cursor-crosshair' : ''
          }`}
          style={zoom === 'actual' && image ? { width: image.width, height: image.height } : undefined}
        >
          <canvas
            ref={canvasRef}
            className="w-full h-full"
            style={zoom === 'fit' ? { objectFit: 'contain' } : { maxWidth: 'none' }}
          />
          {image && (
            <MarkOverlay
              marks={marks}
              candidates={candidates}
              canalMarks={canalMarks}
              image={image}
              occlusalMm={occlusalRowMm}
              drawn={drawnRect()}
              activeId={activeMarkId}
              onOpen={(id) => {
                onActivateMark(id);
                setMarking(false);
              }}
              onAccept={acceptCandidate}
            />
          )}
        </div>
      </div>

      <div className="px-3 py-1.5 text-[11px] text-gray-500 border-t border-gray-800 bg-gray-900 flex-shrink-0 flex items-center gap-2 flex-wrap">
        {marks.length > 0 && (
          <>
            <span className="text-gray-400">Отмечены:</span>
            {marks.map((mark) => (
              <span
                key={mark.id}
                className="inline-flex items-center gap-1 bg-gray-800 border border-gray-700 rounded pl-2 pr-1 py-0.5 text-gray-200"
              >
                <button
                  onClick={() => onActivateMark(mark.id)}
                  className="font-mono font-semibold hover:text-amber-300"
                  title={mark.note || 'Открыть карточку зуба'}
                >
                  {fdiLabel(mark.fdi)}
                </button>
                {mark.note && <span className="text-gray-500 max-w-[160px] truncate">{mark.note}</span>}
                <button
                  onClick={() => locate(mark.arcMm, occlusalRowMm + (mark.jaw === 'upper' ? -9 : 9))}
                  className="text-gray-500 hover:text-sky-300 px-0.5"
                  title="Показать этот зуб на трёх проекциях"
                >
                  <Crosshair className="w-3 h-3" />
                </button>
                <button
                  onClick={() => removeMark(mark.id)}
                  className="text-gray-500 hover:text-red-400 px-0.5"
                  title="Убрать метку"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </>
        )}

        {scanned && (
          <span className={candidates.length ? 'text-rose-300' : 'text-gray-500'}>
            {candidates.length
              ? `Подсказок: ${candidates.length} — кликните по красному кружку`
              : 'Разрежений у верхушек не найдено'}
          </span>
        )}

        {marks.length === 0 && !scanned && (
          <span>
            Дуга правится на аксиальной проекции — перетаскивайте оранжевые точки. «Отметить зуб» — и
            клик по зубу откроет его срезы.
          </span>
        )}
      </div>

    </div>
  );
};

interface MarkOverlayProps {
  marks: ToothMark[];
  candidates: LesionCandidate[];
  canalMarks: Array<{ side: 'right' | 'left'; points: Array<[number, number]> }>;
  image: PanoramaImage;
  occlusalMm: number;
  drawn: {
    scale: number;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  activeId: string | null;
  onOpen: (id: string) => void;
  onAccept: (candidate: LesionCandidate) => void;
}

/** Tooth marks pinned to the panorama, each a click away from its card. */
const MarkOverlay: React.FC<MarkOverlayProps> = ({
  marks,
  candidates,
  canalMarks,
  image,
  occlusalMm,
  drawn,
  activeId,
  onOpen,
  onAccept,
}) => {
  if (!drawn || (marks.length === 0 && candidates.length === 0 && canalMarks.length === 0)) {
    return null;
  }

  const toCss = (arcMm: number, heightMm: number): [number, number] => [
    drawn.left + (arcMm / image.scaleMm) * drawn.scale,
    drawn.top + (heightMm / image.scaleMm) * drawn.scale,
  ];

  // A mark sits on the crown side of the occlusal plane, where the tooth is.
  const markAt = (mark: ToothMark) =>
    toCss(mark.arcMm, occlusalMm + (mark.jaw === 'upper' ? -7 : 7));

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ overflow: 'visible' }}>
      {canalMarks.map((canal) =>
        canal.points.length < 2 ? (
          canal.points.map(([arcMm, heightMm], index) => {
            const [x, y] = toCss(arcMm, heightMm);
            return <circle key={`${canal.side}-${index}`} cx={x} cy={y} r={3} fill="#f472b6" />;
          })
        ) : (
          <polyline
            key={canal.side}
            points={canal.points.map(([arcMm, heightMm]) => toCss(arcMm, heightMm).join(',')).join(' ')}
            fill="none"
            stroke="#f472b6"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={0.85}
          />
        )
      )}

      {candidates.map((candidate) => {
        const [x, y] = toCss(candidate.arcMm, candidate.centreMm);
        // The circle stands for where it looked, not for the shape of anything.
        const radius = Math.max(9, Math.min(22, (candidate.volumeMm3 / 3) ** 0.5 * 6 * drawn.scale));
        return (
          <g
            key={candidate.id}
            className="pointer-events-auto cursor-pointer"
            onClick={(event) => {
              event.stopPropagation();
              onAccept(candidate);
            }}
          >
            <title>
              {`Разрежение у верхушки: ~${candidate.volumeMm3.toFixed(0)} мм³, темнее кости на ${candidate.contrast.toFixed(
                0
              )}. Подсказка, не диагноз — кликните, чтобы посмотреть срезы`}
            </title>
            <circle
              cx={x}
              cy={y}
              r={radius}
              fill="#f43f5e"
              fillOpacity={0.12}
              stroke="#fb7185"
              strokeWidth={2}
              strokeDasharray="4 3"
              strokeOpacity={0.5 + candidate.score * 0.5}
            />
          </g>
        );
      })}

      {marks.map((mark) => {
        const [x, y] = markAt(mark);
        const active = mark.id === activeId;
        return (
          <g
            key={mark.id}
            className="pointer-events-auto cursor-pointer"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(mark.id);
            }}
          >
            <circle
              cx={x}
              cy={y}
              r={12}
              fill={active ? '#f59e0b' : '#f59e0b'}
              fillOpacity={active ? 0.55 : 0.25}
              stroke="#f59e0b"
              strokeWidth={2}
            />
            <text
              x={x}
              y={y + 4}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill="#fff"
              style={{ userSelect: 'none' }}
            >
              {fdiLabel(mark.fdi)}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

/**
 * Window from the image's own histogram. A slab average has a much narrower
 * range than raw voxels, so the fixed presets often leave it flat grey.
 */
function autoWindow(image: PanoramaImage): { center: number; width: number } {
  const sample: number[] = [];
  const stride = Math.max(1, Math.floor(image.data.length / 20000));
  for (let n = 0; n < image.data.length; n += stride) {
    const value = image.data[n];
    if (value > -900) sample.push(value);
  }
  if (sample.length < 32) return { center: 480, width: 2500 };

  sample.sort((a, b) => a - b);
  const low = sample[Math.floor(sample.length * 0.02)];
  const high = sample[Math.floor(sample.length * 0.995)];
  const width = Math.max(high - low, 200);

  return { center: low + width / 2, width };
}
