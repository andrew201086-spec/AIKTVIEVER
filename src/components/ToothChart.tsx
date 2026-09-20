import React, { useState } from 'react';
import { Crosshair, Loader2, RefreshCw, X } from 'lucide-react';
import {
  ASSIGNABLE_STATUSES,
  STATUS_LABELS,
  STATUS_MARKS,
  chartRows,
  type ChartTooth,
  type ToothStatus,
} from '../utils/toothChart';
import { toothName } from '../utils/toothSections';

interface ToothChartProps {
  chart: ChartTooth[];
  /** Null while the dentition is still being read off the volume. */
  detecting?: boolean;
  onDetect?: () => void;
  onOpenCard: (tooth: ChartTooth) => void;
  onLocate: (tooth: ChartTooth) => void;
  onStatus: (fdi: number, status: ToothStatus | undefined) => void;
  onNote: (fdi: number, note: string) => void;
  onClose?: () => void;
}

/**
 * Thirty-two positions, in the arrangement every dental chart uses: upper row
 * left to right as the clinician faces the patient, lower row beneath it,
 * quadrants meeting at the midline.
 *
 * The chart is the index of the study. A tooth carries what was measured
 * (found or not), what the doctor said (status, note), and whether it has a
 * card of sections — and a click goes straight to it in the slices.
 */
export const ToothChart: React.FC<ToothChartProps> = ({
  chart,
  detecting,
  onDetect,
  onOpenCard,
  onLocate,
  onStatus,
  onNote,
  onClose,
}) => {
  const [selected, setSelected] = useState<number | null>(null);
  const rows = chartRows(chart);
  const active = chart.find((tooth) => tooth.fdi === selected) ?? null;

  return (
    <div className="flex flex-col gap-2 bg-gray-950 border border-gray-800 rounded-lg p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
          Зубная формула
        </h3>
        {onDetect && (
          <button
            onClick={onDetect}
            disabled={detecting}
            title="Найти зубы по плотности вдоль дуги и расставить номера"
            className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 disabled:opacity-40"
          >
            {detecting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            {detecting ? 'Ищу зубы…' : 'Определить'}
          </button>
        )}
        <span className="text-[11px] text-gray-500 ml-auto">
          ЛКМ — срезы зуба · ПКМ — состояние
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded text-gray-500 hover:text-white hover:bg-gray-800"
            title="Скрыть формулу"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1 overflow-x-auto">
        <ChartRow
          teeth={rows.upper}
          selected={selected}
          onSelect={setSelected}
          onOpenCard={onOpenCard}
        />
        <div className="h-px bg-gray-700 my-0.5" />
        <ChartRow
          teeth={rows.lower}
          selected={selected}
          onSelect={setSelected}
          onOpenCard={onOpenCard}
          lower
        />
      </div>

      {active ? (
        <ToothDetails
          tooth={active}
          onOpenCard={() => onOpenCard(active)}
          onLocate={() => onLocate(active)}
          onStatus={(status) => onStatus(active.fdi, status)}
          onNote={(note) => onNote(active.fdi, note)}
        />
      ) : (
        <p className="text-[11px] text-gray-600">
          Выберите зуб, чтобы поставить состояние или заметку. Пустое место в ряду — зуб не найден
          по плотности.
        </p>
      )}
    </div>
  );
};

interface ChartRowProps {
  teeth: ChartTooth[];
  selected: number | null;
  onSelect: (fdi: number) => void;
  onOpenCard: (tooth: ChartTooth) => void;
  lower?: boolean;
}

const ChartRow: React.FC<ChartRowProps> = ({ teeth, selected, onSelect, onOpenCard, lower }) => (
  <div className="flex gap-0.5 justify-center min-w-max">
    {teeth.map((tooth, index) => (
      <React.Fragment key={tooth.fdi}>
        {index === 8 && <div className="w-2" />}
        <ToothButton
          tooth={tooth}
          selected={selected === tooth.fdi}
          onSelect={() => onSelect(tooth.fdi)}
          onOpenCard={() => onOpenCard(tooth)}
          lower={lower}
        />
      </React.Fragment>
    ))}
  </div>
);

interface ToothButtonProps {
  tooth: ChartTooth;
  selected: boolean;
  onSelect: () => void;
  onOpenCard: () => void;
  lower?: boolean;
}

const ToothButton: React.FC<ToothButtonProps> = ({ tooth, selected, onSelect, onOpenCard, lower }) => {
  const absent = tooth.status === 'missing';
  const unknown = tooth.status === 'unknown';

  // Colour carries state, so the row can be read at a glance: amber where the
  // doctor has been, rose where the scan flagged something, hollow where no
  // crown was found.
  const tone = tooth.flagged
    ? 'border-rose-500 bg-rose-500/15 text-rose-200'
    : tooth.marked || tooth.note
    ? 'border-amber-500 bg-amber-500/15 text-amber-200'
    : absent
    ? 'border-gray-800 bg-transparent text-gray-600'
    : unknown
    ? 'border-dashed border-gray-700 bg-transparent text-gray-600'
    : 'border-gray-600 bg-gray-800 text-gray-200';

  const title = [
    `${tooth.fdi} — ${toothName(tooth.fdi)}`,
    STATUS_LABELS[tooth.status],
    tooth.corrected ? 'исправлено вручную' : '',
    tooth.fused ? 'коронка в контакте с соседней — граница по средней ширине' : '',
    tooth.note,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      onClick={onSelect}
      onDoubleClick={onOpenCard}
      onContextMenu={(event) => {
        event.preventDefault();
        onSelect();
      }}
      title={title}
      className={`relative w-7 flex flex-col items-center gap-0.5 ${
        lower ? 'flex-col-reverse' : ''
      }`}
    >
      <span
        className={`w-7 h-8 rounded-sm border flex items-center justify-center text-[11px] font-semibold transition-colors ${tone} ${
          selected ? 'ring-2 ring-sky-400 ring-offset-1 ring-offset-gray-950' : ''
        }`}
      >
        {STATUS_MARKS[tooth.status] || ''}
      </span>
      <span
        className={`text-[9px] font-mono ${
          tooth.corrected ? 'text-sky-300' : 'text-gray-500'
        }`}
      >
        {tooth.fdi}
      </span>
    </button>
  );
};

interface ToothDetailsProps {
  tooth: ChartTooth;
  onOpenCard: () => void;
  onLocate: () => void;
  onStatus: (status: ToothStatus | undefined) => void;
  onNote: (note: string) => void;
}

const ToothDetails: React.FC<ToothDetailsProps> = ({
  tooth,
  onOpenCard,
  onLocate,
  onStatus,
  onNote,
}) => (
  <div className="flex flex-col gap-2 border-t border-gray-800 pt-2">
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="font-mono font-bold text-white">{tooth.fdi}</span>
      <span className="text-gray-300">{toothName(tooth.fdi)}</span>
      {tooth.detected !== 'unknown' && (
        <span className="text-[11px] text-gray-500">
          по снимку: {tooth.detected === 'present' ? 'коронка найдена' : 'коронки нет'}
          {tooth.fused && ', в контакте с соседней'}
        </span>
      )}
      {tooth.corrected && <span className="text-[11px] text-sky-300">исправлено вручную</span>}

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={onLocate}
          disabled={tooth.arcMm === undefined}
          title="Навести перекрестие на этот зуб"
          className="flex items-center gap-1 px-2 py-1 text-[11px] bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-300 rounded border border-gray-700"
        >
          <Crosshair className="w-3 h-3" />
          На срезах
        </button>
        <button
          onClick={onOpenCard}
          disabled={tooth.arcMm === undefined}
          title="Открыть карточку срезов этого зуба"
          className="px-2 py-1 text-[11px] bg-amber-600/20 hover:bg-amber-600/40 disabled:opacity-40 text-amber-200 rounded border border-amber-600/50"
        >
          Карточка
        </button>
      </div>
    </div>

    <div className="flex items-center gap-1 flex-wrap">
      {ASSIGNABLE_STATUSES.map((status) => (
        <button
          key={status}
          onClick={() => onStatus(tooth.status === status ? undefined : status)}
          className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
            tooth.status === status
              ? 'bg-sky-600 border-sky-500 text-white'
              : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
          }`}
        >
          {STATUS_LABELS[status]}
        </button>
      ))}
    </div>

    <input
      value={tooth.note}
      onChange={(event) => onNote(event.target.value)}
      placeholder={`Заметка по зубу ${tooth.fdi}…`}
      className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-100 placeholder:text-gray-600"
    />
  </div>
);
