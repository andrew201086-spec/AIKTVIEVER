import React from 'react';
import { AlertTriangle, Crosshair, Plus, Route, Trash2, X } from 'lucide-react';
import {
  IMPLANT_SIZES,
  clearanceToCanals,
  clearanceToImplants,
  implantLengthMm,
  withLength,
  type CanalPath,
  type Implant,
} from '../utils/surgicalPlan';
import { fdiLabel } from '../utils/toothSections';

interface PlanPanelProps {
  implants: Implant[];
  canals: CanalPath[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (implant: Implant) => void;
  onRemove: (id: string) => void;
  onLocate: (implant: Implant) => void;
  /** Arms placing a new fixture by clicking on a slice. */
  placing: boolean;
  onPlace: () => void;
  /** Arms tracing the canal by clicking along it. */
  tracing: CanalPath['side'] | null;
  onTrace: (side: CanalPath['side'] | null) => void;
  onUndoTracePoint: (side: CanalPath['side']) => void;
  onClearCanal: (side: CanalPath['side']) => void;
  onClose: () => void;
}

/** Below this the fixture is too close to the canal to plan without comment. */
const CANAL_WARNING_MM = 2;

/**
 * Planning: the fixtures, the canal, and the distance between them.
 *
 * The one number this panel exists for is the clearance to the mandibular
 * canal. It is stated from the implant's surface and it says plainly that the
 * canal's own width still has to be allowed on top — a margin quoted to the
 * centre of a canal has caused real injuries.
 */
export const PlanPanel: React.FC<PlanPanelProps> = ({
  implants,
  canals,
  selectedId,
  onSelect,
  onChange,
  onRemove,
  onLocate,
  placing,
  onPlace,
  tracing,
  onTrace,
  onUndoTracePoint,
  onClearCanal,
  onClose,
}) => {
  const selected = implants.find((implant) => implant.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-2 bg-gray-950 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
          Планирование
        </h3>

        <button
          onClick={onPlace}
          className={`flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded border ${
            placing
              ? 'bg-sky-600 border-sky-500 text-white'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
          }`}
          title="Поставить имплантат: нажмите, затем кликните по срезу в нужном месте"
        >
          <Plus className="w-3 h-3" />
          {placing ? 'Кликните по срезу' : 'Имплантат'}
        </button>

        {(['right', 'left'] as const).map((side) => (
          <button
            key={side}
            onClick={() => onTrace(tracing === side ? null : side)}
            className={`flex items-center gap-1.5 px-2 py-0.5 text-[11px] rounded border ${
              tracing === side
                ? 'bg-pink-600 border-pink-500 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
            }`}
            title={`Отметить ход нижнечелюстного канала: кликайте по нему на срезах или на панораме`}
          >
            <Route className="w-3 h-3" />
            Канал {side === 'right' ? 'справа' : 'слева'}
          </button>
        ))}

        <button
          onClick={onClose}
          className="ml-auto p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800"
          title="Скрыть панель"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {tracing && (
        <div className="flex items-center gap-2 text-[11px] text-pink-200 bg-pink-500/10 border border-pink-500/30 rounded px-2 py-1">
          <span className="flex-grow">
            Кликайте по ходу канала — на срезах или на панораме. Точек: {' '}
            {canals.find((canal) => canal.side === tracing)?.points.length ?? 0}
          </span>
          <button onClick={() => onUndoTracePoint(tracing)} className="hover:text-white">
            Убрать точку
          </button>
          <button onClick={() => onClearCanal(tracing)} className="hover:text-red-300">
            Очистить
          </button>
          <button onClick={() => onTrace(null)} className="hover:text-white font-semibold">
            Готово
          </button>
        </div>
      )}

      {implants.length === 0 ? (
        <p className="text-[11px] text-gray-600">
          Имплантатов пока нет. «Имплантат» → клик по срезу поставит стандартный 4.1 × 10 мм; концы
          двигаются мышью на любой проекции.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {implants.map((implant) => {
            const canal = clearanceToCanals(implant, canals);
            const neighbour = clearanceToImplants(implant, implants);
            const tight = canal !== null && canal.mm < CANAL_WARNING_MM;

            return (
              <li
                key={implant.id}
                onClick={() => onSelect(implant.id)}
                className={`flex items-center gap-2 rounded border px-2 py-1 cursor-pointer ${
                  implant.id === selectedId
                    ? 'bg-sky-600/15 border-sky-500/60'
                    : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                }`}
              >
                <span className="font-mono text-xs text-white w-10 flex-shrink-0">
                  {implant.fdi ? fdiLabel(implant.fdi) : '—'}
                </span>
                <span className="font-mono text-xs text-sky-200 w-24 flex-shrink-0 tabular-nums">
                  {implant.diameterMm.toFixed(1)} × {implantLengthMm(implant).toFixed(1)} мм
                </span>

                <span
                  className={`text-[11px] flex-grow min-w-0 truncate ${
                    tight ? 'text-red-300' : 'text-gray-400'
                  }`}
                >
                  {canal ? (
                    <>
                      {tight && <AlertTriangle className="w-3 h-3 inline mr-1 -mt-0.5" />}
                      до канала {canal.mm.toFixed(1)} мм
                    </>
                  ) : (
                    'канал не отмечен'
                  )}
                  {neighbour !== null && ` · до соседнего ${neighbour.toFixed(1)} мм`}
                </span>

                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onLocate(implant);
                  }}
                  title="Показать на срезах"
                  className="p-1 rounded text-gray-500 hover:text-sky-300"
                >
                  <Crosshair className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(implant.id);
                  }}
                  title="Убрать имплантат"
                  className="p-1 rounded text-gray-500 hover:text-red-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="flex flex-col gap-2 border-t border-gray-800 pt-2">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[11px] text-gray-500 mr-1">Размер:</span>
            {IMPLANT_SIZES.map((size) => {
              const active =
                Math.abs(selected.diameterMm - size.diameter) < 0.05 &&
                Math.abs(implantLengthMm(selected) - size.length) < 0.05;
              return (
                <button
                  key={`${size.diameter}x${size.length}`}
                  onClick={() =>
                    onChange(withLength({ ...selected, diameterMm: size.diameter }, size.length))
                  }
                  className={`px-1.5 py-0.5 text-[11px] font-mono rounded border ${
                    active
                      ? 'bg-sky-600 border-sky-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {size.diameter}×{size.length}
                </button>
              );
            })}
          </div>

          <input
            value={selected.note}
            onChange={(event) => onChange({ ...selected, note: event.target.value })}
            placeholder="Заметка по имплантату…"
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 placeholder:text-gray-600"
          />

          <p className="text-[10px] text-gray-600 leading-relaxed">
            Расстояние измеряется от поверхности имплантата до линии канала. Ширина самого канала
            (обычно 2–3 мм) в это расстояние не входит — её нужно вычесть дополнительно. Планирование
            не заменяет хирургический шаблон.
          </p>
        </div>
      )}
    </div>
  );
};
