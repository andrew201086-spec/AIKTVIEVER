import React from 'react';
import { Layers, AlertTriangle, Ban, ArrowLeft, Gauge } from 'lucide-react';
import type { SeriesInfo } from '../utils/dicomParse';
import { formatBytes, seriesCount, slices, stepForBudget } from '../utils/dicomParse';

interface SeriesPickerProps {
  series: SeriesInfo[];
  onSelect: (series: SeriesInfo, step: number) => void;
  onBack: () => void;
}

/**
 * A scanner folder normally holds several series — the scout view, a panoramic
 * reconstruction, sometimes two reconstructions of the same volume. Stacking
 * them into one volume produces garbage, so the choice has to be explicit.
 */
export const SeriesPicker: React.FC<SeriesPickerProps> = ({ series, onSelect, onBack }) => (
  <div className="w-full max-w-3xl mx-auto flex flex-col gap-4">
    <div className="flex items-center gap-3">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-800 transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Другое исследование
      </button>
      <div className="text-sm text-gray-400">
        Найдено: <span className="text-white font-medium">{seriesCount(series.length)}</span>
        {series[0]?.patientName && <span className="ml-3 text-gray-500">{series[0].patientName}</span>}
      </div>
    </div>

    <div className="flex flex-col gap-2.5">
      {series.map((item) => {
        const disabled = !item.loadable;
        const recommended = stepForBudget(item.estimatedBytes);
        const needsThinning = recommended > 1;

        return (
          <div
            key={item.seriesInstanceUID}
            className={`bg-gray-900 border rounded-xl transition-colors ${
              disabled ? 'border-gray-800 opacity-60' : 'border-gray-700 hover:border-blue-500'
            }`}
          >
            <button
              disabled={disabled}
              onClick={() => onSelect(item, recommended)}
              className={`w-full text-left p-4 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    disabled ? 'bg-gray-800 text-gray-600' : 'bg-blue-600/20 text-blue-400'
                  }`}
                >
                  {disabled ? <Ban className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
                </div>

                <div className="flex-grow min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-white font-medium text-sm truncate">{item.description}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                      {item.modality}
                    </span>
                    {item.seriesNumber > 0 && (
                      <span className="text-[11px] text-gray-500">серия {item.seriesNumber}</span>
                    )}
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400 font-mono">
                    <span>{slices(item.sliceCount)}</span>
                    <span>
                      {item.columns}×{item.rows}
                    </span>
                    <span>шаг {item.sliceSpacing.toFixed(2)} мм</span>
                    <span>
                      {item.extent[0].toFixed(0)}×{item.extent[1].toFixed(0)}×{item.extent[2].toFixed(0)} мм
                    </span>
                    <span>{formatBytes(item.estimatedBytes)} в памяти</span>
                  </div>

                  {item.blockers.map((text) => (
                    <div key={text} className="mt-2 flex items-start gap-1.5 text-[11px] text-red-400">
                      <Ban className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>{text}</span>
                    </div>
                  ))}
                  {item.warnings.map((text) => (
                    <div key={text} className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-400">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </button>

            {!disabled && needsThinning && (
              <div className="px-4 pb-4 -mt-1">
                <div className="flex items-start gap-1.5 text-[11px] text-amber-400 mb-2">
                  <Gauge className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  <span>
                    Целиком объём не поместится в память видеокарты и не отрисуется. Открывается каждый{' '}
                    {recommended}-й срез — шаг по Z станет{' '}
                    {(item.sliceSpacing * recommended).toFixed(2)} мм.
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[recommended, recommended + 1, 1].map((step, index) => (
                    <button
                      key={`${step}-${index}`}
                      onClick={() => onSelect(item, step)}
                      className={`text-[11px] font-mono px-2.5 py-1 rounded border transition-colors ${
                        step === recommended
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {step === 1 ? 'все срезы' : `каждый ${step}-й`} ·{' '}
                      {formatBytes(item.estimatedBytes / step)}
                      {step === 1 ? ' · рискованно' : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  </div>
);
