import React, { useState } from 'react';
import { Crosshair, Pencil, Trash2, X } from 'lucide-react';
import type { Measurement } from '../utils/measurements';

interface MeasurementListProps {
  measurements: Measurement[];
  onRemove: (uid: string) => void;
  onLabel: (uid: string, text: string) => void;
  onLocate: (measurement: Measurement) => void;
  onClearAll: () => void;
  onClose: () => void;
}

/**
 * Every measurement on the study, listed.
 *
 * Before this there was one button — «удалить все» — so a mistyped length
 * could only be cleared by throwing away the whole session's work. A list
 * gives each one a value, a caption and its own delete.
 */
export const MeasurementList: React.FC<MeasurementListProps> = ({
  measurements,
  onRemove,
  onLabel,
  onLocate,
  onClearAll,
  onClose,
}) => {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const commit = (uid: string) => {
    onLabel(uid, draft.trim());
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-1.5 bg-gray-950 border border-gray-800 rounded-lg p-3 max-h-64 overflow-auto">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">Измерения</h3>
        <span className="text-[11px] text-gray-500">{measurements.length}</span>
        {measurements.length > 0 && (
          <button
            onClick={onClearAll}
            className="ml-auto text-[11px] text-gray-500 hover:text-red-300"
          >
            Удалить все
          </button>
        )}
        <button
          onClick={onClose}
          className={`p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800 ${
            measurements.length > 0 ? '' : 'ml-auto'
          }`}
          title="Скрыть список"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {measurements.length === 0 ? (
        <p className="text-[11px] text-gray-600">
          Пока ничего не измерено. Выберите «Длина» (L) или «Угол» (A) и проведите по срезу.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {measurements.map((measurement) => (
            <li
              key={measurement.uid}
              className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded px-2 py-1"
            >
              <span className="text-[11px] text-gray-400 w-20 flex-shrink-0">
                {measurement.label}
              </span>
              <span className="text-xs font-mono text-emerald-300 w-28 flex-shrink-0 tabular-nums">
                {measurement.value || '—'}
              </span>

              {editing === measurement.uid ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => commit(measurement.uid)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commit(measurement.uid);
                    if (event.key === 'Escape') setEditing(null);
                  }}
                  placeholder="Подпись…"
                  className="flex-grow min-w-0 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-100"
                />
              ) : (
                <span className="flex-grow min-w-0 truncate text-xs text-gray-300">
                  {measurement.text || <span className="text-gray-600">без подписи</span>}
                </span>
              )}

              <button
                onClick={() => onLocate(measurement)}
                disabled={!measurement.point}
                title="Показать на срезах"
                className="p-1 rounded text-gray-500 hover:text-sky-300 disabled:opacity-30"
              >
                <Crosshair className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  setEditing(measurement.uid);
                  setDraft(measurement.text);
                }}
                title="Подписать"
                className="p-1 rounded text-gray-500 hover:text-white"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onRemove(measurement.uid)}
                title="Удалить это измерение"
                className="p-1 rounded text-gray-500 hover:text-red-400"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
