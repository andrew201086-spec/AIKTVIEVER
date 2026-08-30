import { useRef } from 'react';
import {
  Camera,
  FileText,
  FolderOpen,
  Hash,
  Maximize2,
  MousePointer2,
  Move3d,
  Play,
  Rotate3d,
  Ruler,
  Save,
  Scaling,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { RestorationType, ViewPreset } from '../types';
import { RESTORATION_LABEL } from '../data/materials';
import { useScanStore } from '../store';
import { PRESET_LABELS, PRESET_SHORT, applyViewPreset, viewportApi } from './viewport';
import { useCaseIO } from './useCaseIO';
import { ToolButton } from './ui';

const PRESETS: ViewPreset[] = [
  'front',
  'occlusalUpper',
  'occlusalLower',
  'right',
  'left',
  'upperOnly',
  'lowerOnly',
];
const PLACE_TYPES: RestorationType[] = [
  'crown',
  'veneer',
  'inlay',
  'pontic',
  'implant',
  'abutment',
];

export const Toolbar = () => {
  const mode = useScanStore((s) => s.mode);
  const pendingType = useScanStore((s) => s.pendingType);
  const gizmo = useScanStore((s) => s.gizmo);
  const showArch = useScanStore((s) => s.showArch);
  const showBefore = useScanStore((s) => s.showBefore);
  const autoRotate = useScanStore((s) => s.autoRotate);
  const selectedId = useScanStore((s) => s.selectedId);
  const scans = useScanStore((s) => s.scans);
  const restorations = useScanStore((s) => s.restorations);

  const setMode = useScanStore((s) => s.setMode);
  const setPendingType = useScanStore((s) => s.setPendingType);
  const setGizmo = useScanStore((s) => s.setGizmo);
  const toggleArch = useScanStore((s) => s.toggleArch);
  const setShowBefore = useScanStore((s) => s.setShowBefore);
  const setAutoRotate = useScanStore((s) => s.setAutoRotate);
  const setPresenting = useScanStore((s) => s.setPresenting);
  const resetCase = useScanStore((s) => s.resetCase);

  const { saveCase, openCase, screenshot, exportReport } = useCaseIO();
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800 bg-slate-900/80 px-3 py-2">
      <ToolButton
        active={mode === 'orbit'}
        onClick={() => setMode('orbit')}
        title="Навигация и выбор"
      >
        <MousePointer2 size={13} /> Навигация
      </ToolButton>
      <ToolButton
        active={mode === 'measure'}
        onClick={() => setMode('measure')}
        title="Измерение расстояний"
      >
        <Ruler size={13} /> Измерение
      </ToolButton>

      <div className="mx-1 h-5 w-px bg-slate-700" />

      <select
        value={mode === 'place' && pendingType ? pendingType : ''}
        onChange={(event) =>
          setPendingType((event.target.value || null) as RestorationType | null)
        }
        className="rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
        title="Установка кликом по 3D-модели"
      >
        <option value="">Установка кликом…</option>
        {PLACE_TYPES.map((type) => (
          <option key={type} value={type}>
            {RESTORATION_LABEL[type]}
          </option>
        ))}
      </select>

      {selectedId && (
        <>
          <div className="mx-1 h-5 w-px bg-slate-700" />
          <ToolButton
            active={gizmo === 'translate'}
            onClick={() => setGizmo('translate')}
            title="Перемещение"
          >
            <Move3d size={13} />
          </ToolButton>
          <ToolButton
            active={gizmo === 'rotate'}
            onClick={() => setGizmo('rotate')}
            title="Поворот"
          >
            <Rotate3d size={13} />
          </ToolButton>
          <ToolButton
            active={gizmo === 'scale'}
            onClick={() => setGizmo('scale')}
            title="Масштаб"
          >
            <Scaling size={13} />
          </ToolButton>
        </>
      )}

      <div className="mx-1 h-5 w-px bg-slate-700" />

      {PRESETS.map((preset) => (
        <ToolButton
          key={preset}
          onClick={() => applyViewPreset(preset)}
          title={PRESET_LABELS[preset]}
        >
          {PRESET_SHORT[preset]}
        </ToolButton>
      ))}
      <ToolButton onClick={() => viewportApi.current?.frameAll()} title="Вписать в экран">
        <Maximize2 size={13} />
      </ToolButton>

      <div className="mx-1 h-5 w-px bg-slate-700" />

      <ToolButton active={showArch} onClick={toggleArch} title="Номера зубов на дуге">
        <Hash size={13} />
      </ToolButton>
      <ToolButton
        active={showBefore}
        onClick={() => setShowBefore(!showBefore)}
        title="Показать состояние до лечения"
      >
        {showBefore ? 'До' : 'После'}
      </ToolButton>
      <ToolButton
        active={autoRotate}
        onClick={() => setAutoRotate(!autoRotate)}
        title="Автовращение"
      >
        <Rotate3d size={13} />
      </ToolButton>

      <div className="ml-auto flex items-center gap-1.5">
        <ToolButton onClick={screenshot} title="Снимок вида" disabled={scans.length === 0}>
          <Camera size={13} />
        </ToolButton>
        <ToolButton
          onClick={() => void exportReport()}
          title="Отчёт для пациента (печать / PDF)"
          disabled={restorations.length === 0}
        >
          <FileText size={13} />
        </ToolButton>
        <ToolButton
          tone="danger"
          title="Закрыть случай и начать заново"
          onClick={() => {
            if (window.confirm('Закрыть случай? Несохранённый план будет потерян.')) {
              resetCase();
            }
          }}
        >
          <Trash2 size={13} />
        </ToolButton>
        <ToolButton onClick={() => fileRef.current?.click()} title="Открыть случай">
          <FolderOpen size={13} />
        </ToolButton>
        <ToolButton
          onClick={() => void saveCase(true)}
          title="Сохранить случай"
          disabled={scans.length === 0}
        >
          <Save size={13} />
        </ToolButton>
        <ToolButton
          tone="accent"
          onClick={() => setPresenting(true)}
          title="Режим презентации пациенту"
          disabled={scans.length === 0}
        >
          <Play size={13} /> Презентация
        </ToolButton>
        <input
          ref={fileRef}
          type="file"
          accept=".aikt,.zip"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void openCase(file);
            event.target.value = '';
          }}
        />
      </div>

      {mode === 'place' && pendingType && (
        <div className="flex w-full items-center gap-2 pt-1 text-[11px] text-amber-300">
          <Sparkles size={12} />
          Кликните по зубу на 3D-модели, чтобы установить: {RESTORATION_LABEL[pendingType]}
        </div>
      )}
    </div>
  );
};
