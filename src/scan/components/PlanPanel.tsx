import { useMemo, useState } from 'react';
import { Copy, Eye, EyeOff, Link2, Plus, Trash2 } from 'lucide-react';
import type { MaterialId, Restoration, RestorationType } from '../types';
import { MATERIALS, MATERIAL_LIST, RESTORATION_LABEL } from '../data/materials';
import { archOrderIndex } from '../data/fdi';
import { useScanStore, totalPrice } from '../store';
import { usePlanActions } from './usePlanActions';
import { ToothChart } from './ToothChart';
import { Field, Panel, Slider, ToolButton, inputClass } from './ui';

const QUICK_TYPES: RestorationType[] = [
  'crown',
  'veneer',
  'inlay',
  'pontic',
  'implant',
  'abutment',
];

const PatientSection = () => {
  const patient = useScanStore((s) => s.patient);
  const setPatient = useScanStore((s) => s.setPatient);

  return (
    <Panel title="Пациент">
      <div className="grid grid-cols-2 gap-2">
        <Field label="ФИО">
          <input
            className={inputClass}
            value={patient.name}
            onChange={(event) => setPatient({ name: event.target.value })}
          />
        </Field>
        <Field label="Карта">
          <input
            className={inputClass}
            value={patient.chartId}
            onChange={(event) => setPatient({ chartId: event.target.value })}
          />
        </Field>
        <Field label="Врач">
          <input
            className={inputClass}
            value={patient.doctor}
            onChange={(event) => setPatient({ doctor: event.target.value })}
          />
        </Field>
        <Field label="Дата">
          <input
            type="date"
            className={inputClass}
            value={patient.date}
            onChange={(event) => setPatient({ date: event.target.value })}
          />
        </Field>
      </div>
    </Panel>
  );
};

const ItemEditor = ({ item }: { item: Restoration }) => {
  const updateRestoration = useScanStore((s) => s.updateRestoration);
  const updateParams = useScanStore((s) => s.updateParams);
  const stages = useScanStore((s) => s.stages);
  const currency = useScanStore((s) => s.patient.currency);

  const isImplant = item.type === 'implant';

  return (
    <div className="space-y-2 rounded border border-sky-800/60 bg-sky-950/30 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-sky-200">
          {RESTORATION_LABEL[item.type]} · зуб {item.tooth}
        </span>
        <span className="text-[10px] text-slate-400">
          {item.bridgeId ? 'в составе моста' : 'одиночная'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Материал">
          <select
            className={inputClass}
            value={item.material}
            onChange={(event) => {
              const material = event.target.value as MaterialId;
              updateRestoration(item.id, { material, price: MATERIALS[material].price });
            }}
          >
            {MATERIAL_LIST.map((material) => (
              <option key={material.id} value={material.id}>
                {material.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Этап">
          <select
            className={inputClass}
            value={item.stage}
            onChange={(event) =>
              updateRestoration(item.id, { stage: Number(event.target.value) })
            }
          >
            {stages.map((stage) => (
              <option key={stage.index} value={stage.index}>
                {stage.index}. {stage.title}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {isImplant ? (
        <>
          <Field label={`Диаметр — ${(item.params.diameter ?? 4).toFixed(2)} мм`}>
            <Slider
              value={item.params.diameter ?? 4}
              min={2.9}
              max={6}
              step={0.05}
              onChange={(diameter) => updateParams(item.id, { diameter })}
            />
          </Field>
          <Field label={`Длина — ${(item.params.length ?? 10).toFixed(1)} мм`}>
            <Slider
              value={item.params.length ?? 10}
              min={6}
              max={16}
              step={0.5}
              onChange={(length) => updateParams(item.id, { length })}
            />
          </Field>
        </>
      ) : (
        <>
          <Field label={`Ширина — ${item.params.width.toFixed(1)} мм`}>
            <Slider
              value={item.params.width}
              min={3}
              max={16}
              step={0.1}
              onChange={(width) => updateParams(item.id, { width })}
            />
          </Field>
          <Field label={`Толщина (вестибуло-оральная) — ${item.params.depth.toFixed(1)} мм`}>
            <Slider
              value={item.params.depth}
              min={3}
              max={16}
              step={0.1}
              onChange={(depth) => updateParams(item.id, { depth })}
            />
          </Field>
          <Field label={`Высота — ${item.params.height.toFixed(1)} мм`}>
            <Slider
              value={item.params.height}
              min={3}
              max={16}
              step={0.1}
              onChange={(height) => updateParams(item.id, { height })}
            />
          </Field>
          {item.type === 'veneer' && (
            <Field label={`Толщина винира — ${(item.params.thickness ?? 0.7).toFixed(2)} мм`}>
              <Slider
                value={item.params.thickness ?? 0.7}
                min={0.3}
                max={1.5}
                step={0.05}
                onChange={(thickness) => updateParams(item.id, { thickness })}
              />
            </Field>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label={`Стоимость, ${currency}`}>
          <input
            type="number"
            className={inputClass}
            value={item.price}
            onChange={(event) =>
              updateRestoration(item.id, { price: Number(event.target.value) || 0 })
            }
          />
        </Field>
        <Field label="Комментарий">
          <input
            className={inputClass}
            value={item.note ?? ''}
            placeholder="для пациента"
            onChange={(event) => updateRestoration(item.id, { note: event.target.value })}
          />
        </Field>
      </div>
    </div>
  );
};

const StageSection = () => {
  const stages = useScanStore((s) => s.stages);
  const setStage = useScanStore((s) => s.setStage);
  const addStage = useScanStore((s) => s.addStage);

  return (
    <Panel
      title="Этапы презентации"
      actions={
        <ToolButton onClick={addStage} title="Добавить этап">
          <Plus size={12} />
        </ToolButton>
      }
    >
      <div className="space-y-2">
        {stages.map((stage) => (
          <div key={stage.index} className="flex gap-2">
            <span className="mt-1.5 w-4 text-center text-[10px] font-semibold text-slate-500">
              {stage.index}
            </span>
            <div className="flex-1 space-y-1">
              <input
                className={inputClass}
                value={stage.title}
                onChange={(event) => setStage(stage.index, { title: event.target.value })}
              />
              <input
                className={inputClass}
                placeholder="описание для пациента"
                value={stage.description}
                onChange={(event) =>
                  setStage(stage.index, { description: event.target.value })
                }
              />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
};

export const PlanPanel = () => {
  const restorations = useScanStore((s) => s.restorations);
  const stages = useScanStore((s) => s.stages);
  const selectedId = useScanStore((s) => s.selectedId);
  const selectedTooth = useScanStore((s) => s.selectedTooth);
  const currency = useScanStore((s) => s.patient.currency);
  const select = useScanStore((s) => s.select);
  const removeRestoration = useScanStore((s) => s.removeRestoration);
  const duplicateRestoration = useScanStore((s) => s.duplicateRestoration);
  const updateRestoration = useScanStore((s) => s.updateRestoration);
  const splintSelection = useScanStore((s) => s.splintSelection);

  const { addToTooth } = usePlanActions();
  const [checked, setChecked] = useState<string[]>([]);

  const selected = restorations.find((item) => item.id === selectedId) ?? null;
  const grouped = useMemo(
    () =>
      stages.map((stage) => ({
        stage,
        items: restorations
          .filter((item) => item.stage === stage.index)
          .sort((a, b) => archOrderIndex(a.tooth) - archOrderIndex(b.tooth)),
      })),
    [restorations, stages],
  );

  const toggleCheck = (id: string) =>
    setChecked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <PatientSection />

      <Panel title="Зубная формула">
        <ToothChart />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {QUICK_TYPES.map((type) => (
            <ToolButton
              key={type}
              disabled={selectedTooth === null}
              onClick={() => selectedTooth !== null && addToTooth(selectedTooth, type)}
              title={`Добавить: ${RESTORATION_LABEL[type]}`}
            >
              {RESTORATION_LABEL[type]}
            </ToolButton>
          ))}
        </div>
        {selectedTooth === null && (
          <p className="mt-2 text-[10px] text-slate-500">
            Выберите зуб в формуле или кликните по нему в 3D-виде.
          </p>
        )}
      </Panel>

      <Panel
        title="План лечения"
        actions={
          <ToolButton
            disabled={checked.length < 2}
            onClick={() => {
              splintSelection(checked);
              setChecked([]);
            }}
            title="Объединить отмеченные конструкции в мост"
          >
            <Link2 size={12} /> Мост
          </ToolButton>
        }
      >
        {restorations.length === 0 ? (
          <p className="text-xs text-slate-500">
            План пуст. Выберите зуб и добавьте конструкцию.
          </p>
        ) : (
          <div className="space-y-3">
            {grouped
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <div key={group.stage.index}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Этап {group.stage.index} — {group.stage.title}
                  </p>
                  <ul className="space-y-1">
                    {group.items.map((item) => (
                      <li
                        key={item.id}
                        className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-xs ${
                          item.id === selectedId
                            ? 'bg-sky-900/60 text-sky-100'
                            : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="accent-sky-500"
                          checked={checked.includes(item.id)}
                          onChange={() => toggleCheck(item.id)}
                        />
                        <button
                          type="button"
                          className="flex-1 text-left"
                          onClick={() => select(item.id)}
                        >
                          <span className="font-semibold">{item.tooth}</span>{' '}
                          {RESTORATION_LABEL[item.type]}
                          <span className="ml-1 text-[10px] text-slate-400">
                            {MATERIALS[item.material].label}
                          </span>
                        </button>
                        <span className="text-[10px] text-slate-400">
                          {item.price.toLocaleString('ru-RU')}
                        </span>
                        <button
                          type="button"
                          title={item.visible ? 'Скрыть' : 'Показать'}
                          onClick={() =>
                            updateRestoration(item.id, { visible: !item.visible })
                          }
                          className="text-slate-400 hover:text-sky-300"
                        >
                          {item.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                        </button>
                        <button
                          type="button"
                          title="Дублировать"
                          onClick={() => duplicateRestoration(item.id)}
                          className="text-slate-400 hover:text-sky-300"
                        >
                          <Copy size={13} />
                        </button>
                        <button
                          type="button"
                          title="Удалить"
                          onClick={() => removeRestoration(item.id)}
                          className="text-slate-400 hover:text-red-400"
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            <div className="flex items-center justify-between border-t border-slate-800 pt-2 text-xs">
              <span className="text-slate-400">Итого</span>
              <span className="font-semibold text-slate-100">
                {totalPrice(restorations).toLocaleString('ru-RU')} {currency}
              </span>
            </div>
          </div>
        )}
      </Panel>

      {selected && (
        <Panel title="Параметры конструкции">
          <ItemEditor item={selected} />
        </Panel>
      )}

      <StageSection />
    </div>
  );
};
