import { LOWER_ARCH, UPPER_ARCH } from '../data/fdi';
import { useScanStore } from '../store';
import type { Restoration } from '../types';

const TYPE_MARK: Record<Restoration['type'], string> = {
  crown: 'К',
  veneer: 'В',
  pontic: 'П',
  implant: 'И',
  abutment: 'А',
  inlay: 'Вк',
};

const Row = ({ teeth }: { teeth: number[] }) => {
  const selectedTooth = useScanStore((s) => s.selectedTooth);
  const restorations = useScanStore((s) => s.restorations);
  const selectTooth = useScanStore((s) => s.selectTooth);
  const select = useScanStore((s) => s.select);

  return (
    <div className="grid grid-cols-16 gap-[2px]">
      {teeth.map((tooth) => {
        const planned = restorations.filter((item) => item.tooth === tooth);
        const active = selectedTooth === tooth;
        return (
          <button
            key={tooth}
            type="button"
            title={`Зуб ${tooth}`}
            onClick={() => {
              selectTooth(tooth);
              if (planned.length > 0) select(planned[0].id);
            }}
            className={`flex h-9 flex-col items-center justify-center rounded text-[9px] leading-tight transition ${
              active
                ? 'bg-sky-600 text-white'
                : planned.length > 0
                  ? 'bg-emerald-700/60 text-emerald-50 hover:bg-emerald-600'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            <span className="font-semibold">{tooth}</span>
            <span className="text-[8px] opacity-80">
              {planned.map((item) => TYPE_MARK[item.type]).join('') || '·'}
            </span>
          </button>
        );
      })}
    </div>
  );
};

export const ToothChart = () => (
  <div className="space-y-1">
    <Row teeth={UPPER_ARCH} />
    <Row teeth={LOWER_ARCH} />
    <p className="pt-1 text-[10px] text-slate-500">
      К — коронка, В — винир, П — промежуточная часть, И — имплантат, А — абатмент, Вк — вкладка
    </p>
  </div>
);
