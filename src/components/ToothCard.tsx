import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Download, Trash2, X } from 'lucide-react';
import {
  toImageData,
  type ArchGeometry,
  type PanoramaImage,
  type VolumeSampler,
} from '../utils/panorama';
import {
  ALL_FDI,
  fdiLabel,
  jawOf,
  occlusalHeightMm,
  toothName,
  type ToothMark,
} from '../utils/toothSections';
import { buildToothTiles, type Tile, type TileRow } from '../utils/toothTiles';

interface ToothCardProps {
  sampler: VolumeSampler;
  geometry: ArchGeometry | null;
  archSlice: number;
  panorama: PanoramaImage | null;
  patientName: string;
  mark: ToothMark;
  onChange: (mark: ToothMark) => void;
  onDelete: () => void;
  onClose: () => void;
  /** Puts the three slice views on this height of the tooth. */
  onLocate: (heightMm: number) => void;
}

const WINDOWS: Record<string, { center: number; width: number }> = {
  bone: { center: 480, width: 2500 },
  teeth: { center: 1500, width: 5000 },
  narrow: { center: 300, width: 1500 },
};

const WINDOW_LABELS: Record<string, string> = {
  bone: 'Кость',
  teeth: 'Зубы и эмаль',
  narrow: 'Узкое (кость мягче)',
};

/**
 * Everything about one marked tooth on one screen: where it sits on the
 * panorama, a thin slice along the arch, a fan of slices across it, and
 * axial cuts down the root. Built to be read and to be exported as a picture
 * for the report.
 */
export const ToothCard: React.FC<ToothCardProps> = ({
  sampler,
  geometry,
  archSlice,
  panorama,
  patientName,
  mark,
  onChange,
  onDelete,
  onClose,
  onLocate,
}) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [crossStep, setCrossStep] = useState(1);
  const [axialDepth, setAxialDepth] = useState(6);
  const [windowKey, setWindowKey] = useState('bone');
  const [tileHeight, setTileHeight] = useState(240);

  const rows = useMemo<TileRow[]>(() => {
    if (!geometry) return [];
    return buildToothTiles({
      sampler,
      geometry,
      archSlice,
      arcMm: mark.arcMm,
      jaw: mark.jaw,
      panorama,
      crossStepMm: crossStep,
      axialDepthMm: axialDepth,
    });
  }, [sampler, geometry, archSlice, panorama, mark.arcMm, mark.jaw, crossStep, axialDepth]);

  const windowing = WINDOWS[windowKey] ?? WINDOWS.bone;

  const changeFdi = (fdi: number) => onChange({ ...mark, fdi, jaw: jawOf(fdi) });

  const exportPng = () => {
    const body = bodyRef.current;
    if (!body) return;
    const canvases = Array.from(body.querySelectorAll<HTMLCanvasElement>('canvas[data-tile]'));
    const composed = composeCard(canvases, rows, {
      title: `Зуб ${fdiLabel(mark.fdi)} — ${toothName(mark.fdi)}`,
      patient: patientName,
      note: mark.note,
    });
    composed.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const who = patientName ? patientName.replace(/\s+/g, '_') : 'КЛКТ';
      link.download = `зуб_${mark.fdi}_${who}.png`;
      link.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-gray-950 border border-gray-700 rounded-xl w-full max-w-6xl max-h-full flex flex-col shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-800 flex-shrink-0 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-gray-400 text-xs">Зуб</span>
            <select
              value={mark.fdi}
              onChange={(event) => changeFdi(Number(event.target.value))}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white font-semibold"
            >
              {ALL_FDI.map((fdi) => (
                <option key={fdi} value={fdi}>
                  {fdiLabel(fdi)}
                </option>
              ))}
            </select>
          </label>
          <span className="text-sm text-gray-200">{toothName(mark.fdi)}</span>
          <span className="text-xs text-gray-500 font-mono">
            {mark.arcMm.toFixed(0)} мм по дуге
          </span>

          <input
            value={mark.note}
            onChange={(event) => onChange({ ...mark, note: event.target.value })}
            placeholder="Заметка: что видно, предварительный диагноз…"
            className="flex-grow min-w-[200px] bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 placeholder:text-gray-600"
          />

          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={() => {
                // The depth the axial slices are already showing.
                const direction = mark.jaw === 'upper' ? -1 : 1;
                onLocate(occlusalHeightMm(sampler, archSlice) + direction * axialDepth);
                onClose();
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700"
              title="Навести перекрестие на этот зуб в трёх основных проекциях"
            >
              <Crosshair className="w-3.5 h-3.5" />
              На срезах
            </button>
            <button
              onClick={exportPng}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-amber-600 hover:bg-amber-500 text-white rounded"
              title="Сохранить карточку зуба одной картинкой"
            >
              <Download className="w-3.5 h-3.5" />
              Карточка PNG
            </button>
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-gray-800 hover:bg-red-900/60 text-gray-300 rounded border border-gray-700"
              title="Убрать метку с этого зуба"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Убрать
            </button>
            <button
              onClick={onClose}
              className="p-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700"
              title="Закрыть (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800 text-xs text-gray-400 flex-shrink-0 flex-wrap">
          <label className="flex items-center gap-1.5">
            Шаг поперечных
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.5}
              value={crossStep}
              onChange={(event) => setCrossStep(Number(event.target.value))}
              className="w-20 accent-amber-500"
            />
            <span className="font-mono text-gray-200 w-12">{crossStep.toFixed(1)} мм</span>
          </label>
          <label className="flex items-center gap-1.5" title="Глубина первого аксиального среза от окклюзионной плоскости; два следующих — на 5 и 10 мм глубже">
            Аксиальные от
            <input
              type="range"
              min={2}
              max={16}
              step={1}
              value={axialDepth}
              onChange={(event) => setAxialDepth(Number(event.target.value))}
              className="w-20 accent-amber-500"
            />
            <span className="font-mono text-gray-200 w-10">{axialDepth} мм</span>
          </label>
          <label className="flex items-center gap-1.5">
            Окно
            <select
              value={windowKey}
              onChange={(event) => setWindowKey(event.target.value)}
              className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-white"
            >
              {Object.keys(WINDOWS).map((key) => (
                <option key={key} value={key}>
                  {WINDOW_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Размер
            <input
              type="range"
              min={140}
              max={420}
              step={20}
              value={tileHeight}
              onChange={(event) => setTileHeight(Number(event.target.value))}
              className="w-20 accent-amber-500"
            />
          </label>
        </div>

        <div ref={bodyRef} className="flex-grow min-h-0 overflow-auto p-4 space-y-5">
          {rows.map((row) => (
            <section key={row.key}>
              <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-2">{row.title}</h3>
              <div className="flex gap-3 flex-wrap">
                {row.tiles.map((tile) => (
                  <TileView
                    key={tile.key}
                    tile={tile}
                    height={tileHeight}
                    center={windowing.center}
                    width={windowing.width}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="px-4 py-1.5 text-[11px] text-gray-500 border-t border-gray-800 flex-shrink-0">
          Срезы построены относительно зубной дуги — если зуб не по центру, поправьте оранжевые точки дуги
          на аксиальной проекции или поставьте метку заново. Диагноз ставит врач: программа только показывает.
        </div>
      </div>
    </div>
  );
};

interface TileViewProps {
  tile: Tile;
  height: number;
  center: number;
  width: number;
}

const TileView: React.FC<TileViewProps> = ({ tile, height, center, width }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = tile.image.width;
    canvas.height = tile.image.height;
    canvas.getContext('2d')?.putImageData(toImageData(tile.image, center, width), 0, 0);
  }, [tile, center, width]);

  const aspect = tile.image.width / tile.image.height;

  return (
    <figure className="flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        data-tile={tile.key}
        className="bg-black rounded border border-gray-800"
        style={{ height, width: Math.round(height * aspect), imageRendering: 'auto' }}
      />
      <figcaption className="text-[11px] text-gray-400 font-mono">{tile.label}</figcaption>
    </figure>
  );
};

/**
 * Lays the tiles out on one canvas at a fixed number of pixels per
 * millimetre, so every picture in the export is at the same scale.
 */
function composeCard(
  canvases: HTMLCanvasElement[],
  rows: TileRow[],
  header: { title: string; patient: string; note: string }
): HTMLCanvasElement {
  const pxPerMm = 8;
  const margin = 28;
  const gap = 16;
  const captionHeight = 22;
  const rowTitleHeight = 28;
  const headerHeight = header.note ? 96 : 72;

  const byKey = new Map(canvases.map((canvas) => [canvas.dataset.tile, canvas]));
  const scaled = rows.map((row) => ({
    row,
    tiles: row.tiles.map((tile) => ({
      tile,
      canvas: byKey.get(tile.key) ?? null,
      width: Math.round(tile.image.width * tile.image.scaleMm * pxPerMm),
      height: Math.round(tile.image.height * tile.image.scaleMm * pxPerMm),
    })),
  }));

  const contentWidth = Math.max(
    640,
    ...scaled.map(({ tiles }) => tiles.reduce((sum, t) => sum + t.width, 0) + gap * (tiles.length - 1))
  );
  const contentHeight = scaled.reduce(
    (sum, { tiles }) => sum + rowTitleHeight + Math.max(...tiles.map((t) => t.height)) + captionHeight + gap,
    0
  );

  const canvas = document.createElement('canvas');
  canvas.width = contentWidth + margin * 2;
  canvas.height = headerHeight + contentHeight + margin * 2;
  const context = canvas.getContext('2d');
  if (!context) return canvas;

  context.fillStyle = '#0a0a0a';
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = '#f5f5f5';
  context.font = 'bold 22px system-ui, sans-serif';
  context.fillText(header.title, margin, margin + 22);
  context.fillStyle = '#9ca3af';
  context.font = '14px system-ui, sans-serif';
  const stamp = new Date().toLocaleDateString('ru-RU');
  context.fillText(`${header.patient || 'Пациент не указан'} · КЛКТ · ${stamp}`, margin, margin + 46);
  if (header.note) {
    context.fillStyle = '#fbbf24';
    context.fillText(header.note, margin, margin + 70);
  }

  let y = margin + headerHeight;
  for (const { row, tiles } of scaled) {
    context.fillStyle = '#6b7280';
    context.font = '600 12px system-ui, sans-serif';
    context.fillText(row.title.toUpperCase(), margin, y + 14);
    y += rowTitleHeight;

    const rowHeight = Math.max(...tiles.map((t) => t.height));
    let x = margin;
    for (const { tile, canvas: source, width, height } of tiles) {
      if (source) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(source, x, y + (rowHeight - height) / 2, width, height);
      }
      context.fillStyle = '#d1d5db';
      context.font = '12px ui-monospace, monospace';
      context.textAlign = 'center';
      context.fillText(tile.label, x + width / 2, y + rowHeight + 15);
      context.textAlign = 'left';
      x += width + gap;
    }
    y += rowHeight + captionHeight + gap;
  }

  context.fillStyle = '#4b5563';
  context.font = '11px system-ui, sans-serif';
  context.fillText('Масштаб единый: 8 пикс/мм', margin, canvas.height - 10);

  return canvas;
}
