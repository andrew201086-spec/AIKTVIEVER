import React, { useState } from 'react';
import { Box, Camera, Download, Loader2, RotateCcw, X } from 'lucide-react';

export interface CropBox {
  /** Fractions of the volume kept along each axis, 0…1. */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

export const FULL_CROP: CropBox = { xMin: 0, xMax: 1, yMin: 0, yMax: 1, zMin: 0, zMax: 1 };

interface VolumePanelProps {
  crop: CropBox;
  onCrop: (crop: CropBox) => void;
  onSnapshot: () => void;
  onExportStl: (thresholdHu: number) => void;
  exporting: string | null;
  onClose: () => void;
  /** How the 3D viewport is shaded — it belongs to this mode, not the tool row. */
  volumePreset: string;
  onVolumePreset: (preset: string) => void;
  volumePresets: Record<string, string>;
}

const AXES: Array<{ key: 'x' | 'y' | 'z'; label: string; hint: string }> = [
  { key: 'x', label: 'Право — лево', hint: 'Отсечь справа и слева' },
  { key: 'y', label: 'Вперёд — назад', hint: 'Отсечь спереди и сзади' },
  { key: 'z', label: 'Верх — низ', hint: 'Отсечь сверху и снизу' },
];

/** Thresholds that pick out one tissue, in Hounsfield units. */
const PRESETS: Array<{ label: string; hu: number; hint: string }> = [
  { label: 'Зубы и эмаль', hu: 1200, hint: 'Только зубы — для коронок и моделей' },
  { label: 'Кость', hu: 500, hint: 'Кость с зубами — для хирургического шаблона' },
  { label: 'Мягкие ткани', hu: -300, hint: 'Внешний контур лица' },
];

/**
 * The volume as an object: cut it open, and take it out.
 *
 * Cropping is what makes a 3D reconstruction readable — the whole head hides
 * the very region being planned. The export is the other half: a laboratory
 * works in STL, and the threshold chosen here is what decides whether the
 * printed model is teeth, bone, or a face.
 */
export const VolumePanel: React.FC<VolumePanelProps> = ({
  crop,
  onCrop,
  onSnapshot,
  onExportStl,
  exporting,
  onClose,
  volumePreset,
  onVolumePreset,
  volumePresets,
}) => {
  const [thresholdHu, setThresholdHu] = useState(500);

  const set = (key: keyof CropBox, value: number) => {
    const next = { ...crop, [key]: value };
    // Keep each pair the right way round, or the crop turns inside out.
    if (next.xMin > next.xMax - 0.02) return;
    if (next.yMin > next.yMax - 0.02) return;
    if (next.zMin > next.zMax - 0.02) return;
    onCrop(next);
  };

  const cropped =
    crop.xMin > 0 || crop.xMax < 1 || crop.yMin > 0 || crop.yMax < 1 || crop.zMin > 0 || crop.zMax < 1;

  return (
    <div className="flex flex-col gap-2 bg-gray-950 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-300 uppercase tracking-wide">
          <Box className="w-3.5 h-3.5" />
          Объём
        </h3>

        <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
          Вид
          <select
            value={volumePreset}
            onChange={(event) => onVolumePreset(event.target.value)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-0.5 text-[11px] text-white"
            title="Как затеняется трёхмерная реконструкция"
          >
            {Object.entries(volumePresets).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {cropped && (
          <button
            onClick={() => onCrop(FULL_CROP)}
            className="flex items-center gap-1 px-2 py-0.5 text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700"
          >
            <RotateCcw className="w-3 h-3" />
            Показать целиком
          </button>
        )}
        <button
          onClick={onClose}
          className="ml-auto p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800"
          title="Скрыть панель"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {AXES.map((axis) => (
          <div key={axis.key} className="flex items-center gap-2 text-[11px]" title={axis.hint}>
            <span className="w-24 text-gray-400 flex-shrink-0">{axis.label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={crop[`${axis.key}Min` as keyof CropBox]}
              onChange={(event) =>
                set(`${axis.key}Min` as keyof CropBox, Number(event.target.value))
              }
              className="flex-grow accent-amber-500"
              aria-label={`${axis.label}: начало`}
            />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={crop[`${axis.key}Max` as keyof CropBox]}
              onChange={(event) =>
                set(`${axis.key}Max` as keyof CropBox, Number(event.target.value))
              }
              className="flex-grow accent-amber-500"
              aria-label={`${axis.label}: конец`}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap border-t border-gray-800 pt-2">
        <button
          onClick={onSnapshot}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700"
          title="Сохранить текущий вид объёма в PNG"
        >
          <Camera className="w-3.5 h-3.5" />
          Снимок PNG
        </button>

        <span className="text-[11px] text-gray-500 ml-2">Экспорт STL:</span>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            onClick={() => setThresholdHu(preset.hu)}
            title={preset.hint}
            className={`px-2 py-0.5 text-[11px] rounded border ${
              thresholdHu === preset.hu
                ? 'bg-amber-600 border-amber-500 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {preset.label}
          </button>
        ))}

        <button
          onClick={() => onExportStl(thresholdHu)}
          disabled={!!exporting}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          {exporting ?? 'Сохранить STL'}
        </button>
      </div>

      <p className="text-[10px] text-gray-600 leading-relaxed">
        Обрезка меняет только вид объёма — на срезы и измерения она не влияет. STL строится по всему
        снимку, а не по обрезанному виду, и с огрублением: шаг сетки указывается после экспорта.
      </p>
    </div>
  );
};
