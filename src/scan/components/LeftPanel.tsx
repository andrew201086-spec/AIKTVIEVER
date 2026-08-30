import * as THREE from 'three';
import { FlipVertical2, Ruler, RotateCw, Trash2 } from 'lucide-react';
import { useScanStore } from '../store';
import { applyScanTransform, getScan } from '../mesh/registry';
import { buildArchModel } from '../mesh/align';
import { invalidatePlacementCache } from '../mesh/placement';
import { DropZone } from './ScanUploader';
import { Field, Panel, Slider, ToolButton, inputClass } from './ui';

const JAW_LABEL = { upper: 'Верхняя челюсть', lower: 'Нижняя челюсть' } as const;

const ScanRow = ({ id }: { id: string }) => {
  const meta = useScanStore((s) => s.scans.find((scan) => scan.id === id));
  const setScan = useScanStore((s) => s.setScan);
  const dropScan = useScanStore((s) => s.dropScan);
  if (!meta) return null;

  const rebake = (matrix: THREE.Matrix4) => {
    applyScanTransform(meta.id, matrix, (geometry) => buildArchModel(geometry, meta.jaw));
    invalidatePlacementCache(meta.id);
    setScan(meta.id, { geomVersion: meta.geomVersion + 1 });
  };

  const record = getScan(meta.id);

  return (
    <div className="mb-2 rounded border border-slate-800 bg-slate-900/60 p-2">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-slate-200">
          <input
            type="checkbox"
            className="accent-sky-500"
            checked={meta.visible}
            onChange={(event) => setScan(meta.id, { visible: event.target.checked })}
          />
          {JAW_LABEL[meta.jaw]}
        </label>
        <button
          type="button"
          title="Удалить скан"
          onClick={() => dropScan(meta.id)}
          className="text-slate-500 hover:text-red-400"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <p className="mt-1 truncate text-[10px] text-slate-500" title={meta.fileName}>
        {meta.fileName} · {(meta.triangleCount / 1000).toFixed(0)}k полигонов
        {meta.hasVertexColors ? ' · цветной' : ''}
        {record?.arch ? '' : ' · дуга не распознана'}
      </p>

      <div className="mt-2">
        <Field label={`Прозрачность — ${Math.round((1 - meta.opacity) * 100)}%`}>
          <Slider
            value={meta.opacity}
            min={0.15}
            max={1}
            step={0.05}
            onChange={(opacity) => setScan(meta.id, { opacity })}
          />
        </Field>
      </div>

      <div className="mt-2 flex gap-1.5">
        <ToolButton
          title="Повернуть на 90° вокруг вертикали"
          onClick={() => rebake(new THREE.Matrix4().makeRotationY(Math.PI / 2))}
        >
          <RotateCw size={12} /> 90°
        </ToolButton>
        <ToolButton
          title="Перевернуть челюсть (окклюзионная плоскость)"
          onClick={() => rebake(new THREE.Matrix4().makeRotationX(Math.PI))}
        >
          <FlipVertical2 size={12} /> Перевернуть
        </ToolButton>
      </div>
    </div>
  );
};

const ClipSection = () => {
  const clip = useScanStore((s) => s.clip);
  const setClip = useScanStore((s) => s.setClip);

  return (
    <Panel title="Разрез">
      <label className="mb-2 flex items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          className="accent-sky-500"
          checked={clip.enabled}
          onChange={(event) => setClip({ enabled: event.target.checked })}
        />
        Секущая плоскость
      </label>
      {clip.enabled && (
        <div className="space-y-2">
          <Field label="Ось">
            <select
              className={inputClass}
              value={clip.axis}
              onChange={(event) =>
                setClip({ axis: event.target.value as 'x' | 'y' | 'z' })
              }
            >
              <option value="x">Сагиттальная (влево-вправо)</option>
              <option value="y">Горизонтальная (вверх-вниз)</option>
              <option value="z">Фронтальная (вперёд-назад)</option>
            </select>
          </Field>
          <Field label={`Положение — ${clip.offset.toFixed(1)} мм`}>
            <Slider
              value={clip.offset}
              min={-45}
              max={45}
              step={0.5}
              onChange={(offset) => setClip({ offset })}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              className="accent-sky-500"
              checked={clip.flip}
              onChange={(event) => setClip({ flip: event.target.checked })}
            />
            Обратная сторона
          </label>
        </div>
      )}
    </Panel>
  );
};

const MeasurementSection = () => {
  const measurements = useScanStore((s) => s.measurements);
  const removeMeasurement = useScanStore((s) => s.removeMeasurement);

  return (
    <Panel title="Измерения">
      {measurements.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          Режим «Измерение»: два клика по поверхности — расстояние в миллиметрах.
        </p>
      ) : (
        <ul className="space-y-1">
          {measurements.map((measurement) => (
            <li
              key={measurement.id}
              className="flex items-center justify-between rounded bg-slate-800/60 px-2 py-1 text-xs text-slate-300"
            >
              <span className="flex items-center gap-1.5">
                <Ruler size={12} className="text-sky-400" />
                {measurement.label}
              </span>
              <button
                type="button"
                onClick={() => removeMeasurement(measurement.id)}
                className="text-slate-500 hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
};

export const LeftPanel = () => {
  const scans = useScanStore((s) => s.scans);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Panel title="Сканы">
        {scans.map((scan) => (
          <ScanRow key={scan.id} id={scan.id} />
        ))}
        <DropZone compact />
      </Panel>
      <ClipSection />
      <MeasurementSection />
    </div>
  );
};
