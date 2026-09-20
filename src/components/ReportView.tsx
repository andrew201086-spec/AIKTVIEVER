import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Printer, X } from 'lucide-react';
import { toImageData, type ArchGeometry, type PanoramaImage, type VolumeSampler } from '../utils/panorama';
import { chartRows, STATUS_LABELS, STATUS_MARKS, summariseChart, type ChartTooth } from '../utils/toothChart';
import { fdiLabel, toothName, type SectionImage, type ToothMark } from '../utils/toothSections';
import { buildToothTiles, type TileRow } from '../utils/toothTiles';
import {
  clearanceToCanals,
  implantLengthMm,
  type CanalPath,
  type Implant,
} from '../utils/surgicalPlan';
import { APP_NAME, APP_VERSION } from '../version';

interface ReportViewProps {
  sampler: VolumeSampler | null;
  geometry: ArchGeometry | null;
  archSlice: number;
  panorama: PanoramaImage | null;
  chart: ChartTooth[];
  marks: ToothMark[];
  patientName: string;
  studyDescription: string;
  sliceCount: number;
  conclusion: string;
  onConclusion: (text: string) => void;
  /** Planned fixtures and the traced canal, when there are any. */
  implants: Implant[];
  canals: CanalPath[];
  onClose: () => void;
}

/** Phrases a dentist writes over and over; clicking one appends it. */
const TEMPLATES = [
  'Костная ткань без очаговых изменений.',
  'В области верхушки корня определяется участок разрежения костной ткани.',
  'Периодонтальная щель расширена.',
  'Корневой канал запломбирован до верхушки.',
  'Корневой канал запломбирован не до верхушки.',
  'Определяется вертикальная убыль костной ткани.',
  'Гайморовы пазухи пневматизированы.',
  'Нижнечелюстной канал прослеживается на всём протяжении.',
  'Рекомендована консультация специалиста.',
];

const WINDOW = { center: 480, width: 2500 };

/**
 * The report: what leaves the room.
 *
 * A viewer that cannot produce one is a picture browser — the doctor's output
 * is a document with the patient's name, a chart, the sections a finding was
 * read on, and a signature. It is printed by the browser rather than built
 * with a PDF library: the text stays selectable and vector, the pictures stay
 * at the resolution they were reconstructed at, and «Сохранить как PDF» in
 * the print dialog produces the file.
 */
export const ReportView: React.FC<ReportViewProps> = ({
  sampler,
  geometry,
  archSlice,
  panorama,
  chart,
  marks,
  patientName,
  studyDescription,
  sliceCount,
  conclusion,
  onConclusion,
  implants,
  canals,
  onClose,
}) => {
  const summary = useMemo(() => summariseChart(chart), [chart]);
  const rows = useMemo(() => chartRows(chart), [chart]);

  /** Teeth worth a page: marked, noted, or with a status the doctor set. */
  const detailed = useMemo(() => {
    const byFdi = new Map(chart.map((tooth) => [tooth.fdi, tooth]));
    const seen = new Set<number>();
    const out: Array<{ tooth: ChartTooth; mark?: ToothMark }> = [];

    for (const mark of marks) {
      const tooth = byFdi.get(mark.fdi);
      if (!tooth || seen.has(mark.fdi)) continue;
      seen.add(mark.fdi);
      out.push({ tooth, mark });
    }
    for (const tooth of chart) {
      if (seen.has(tooth.fdi)) continue;
      if (!tooth.note.trim() && !tooth.corrected) continue;
      if (tooth.arcMm === undefined) continue;
      seen.add(tooth.fdi);
      out.push({ tooth });
    }
    return out.sort((a, b) => a.tooth.fdi - b.tooth.fdi);
  }, [chart, marks]);

  const stamp = new Date();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const append = (phrase: string) => {
    const separator = conclusion.trim().length ? '\n' : '';
    onConclusion(conclusion + separator + phrase);
  };

  return (
    <div className="report-overlay fixed inset-0 z-[70] bg-gray-900/90 overflow-auto">
      <div className="no-print sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-gray-950 border-b border-gray-700">
        <h2 className="text-sm font-semibold text-white">Заключение</h2>
        <span className="text-[11px] text-gray-500">
          Печать браузера · в диалоге выберите «Сохранить как PDF»
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded"
          >
            <Printer className="w-3.5 h-3.5" />
            Печать / PDF
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

      <article className="report-page mx-auto my-4 bg-white text-black p-8 shadow-2xl">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div>
            <h1 className="text-xl font-bold leading-tight">
              Описание конусно-лучевой компьютерной томограммы
            </h1>
            <p className="text-sm mt-1">
              <b>Пациент:</b> {patientName || '—'}
            </p>
            <p className="text-sm">
              <b>Исследование:</b> {studyDescription || '—'} · {sliceCount} срезов
            </p>
          </div>
          <div className="text-xs text-right leading-relaxed flex-shrink-0">
            <div>{stamp.toLocaleDateString('ru-RU')}</div>
            <div>{stamp.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
            <div className="mt-1 text-gray-600">
              {APP_NAME} {APP_VERSION}
            </div>
          </div>
        </header>

        <section className="mt-5">
          <h2 className="text-sm font-bold uppercase tracking-wide mb-2">Зубная формула</h2>
          <PrintChart rows={rows} />
          <p className="text-[11px] text-gray-700 mt-1.5">
            Зубов на месте: {summary.present} · отсутствует: {summary.missing} · с заметками:{' '}
            {summary.noted}
            {summary.corrected > 0 && ` · исправлено врачом: ${summary.corrected}`}
          </p>
        </section>

        {panorama && (
          <section className="mt-5 break-inside-avoid">
            <h2 className="text-sm font-bold uppercase tracking-wide mb-2">Панорамная реконструкция</h2>
            {/* Capped by height: a wide panorama at full width would take a
                page to itself and push every tooth onto the next one. */}
            <SectionCanvas
              image={panorama}
              className="border border-gray-400 mx-auto block"
              style={{ maxHeight: '75mm', maxWidth: '100%', width: 'auto', height: 'auto' }}
            />
          </section>
        )}

        {detailed.length > 0 && sampler && geometry && (
          <section className="mt-5">
            <h2 className="text-sm font-bold uppercase tracking-wide mb-2">Срезы по зубам</h2>
            <div className="flex flex-col gap-4">
              {detailed.map(({ tooth, mark }) => (
                <ToothPage
                  key={tooth.fdi}
                  tooth={tooth}
                  note={mark?.note || tooth.note}
                  sampler={sampler}
                  geometry={geometry}
                  archSlice={archSlice}
                  panorama={panorama}
                  arcMm={mark?.arcMm ?? tooth.arcMm ?? 0}
                />
              ))}
            </div>
          </section>
        )}

        {implants.length > 0 && (
          <section className="mt-5 break-inside-avoid">
            <h2 className="text-sm font-bold uppercase tracking-wide mb-2">План имплантации</h2>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-500">
                  <th className="text-left py-1 pr-2 font-semibold">Позиция</th>
                  <th className="text-left py-1 pr-2 font-semibold">Размер</th>
                  <th className="text-left py-1 pr-2 font-semibold">До канала</th>
                  <th className="text-left py-1 font-semibold">Примечание</th>
                </tr>
              </thead>
              <tbody>
                {implants.map((implant) => {
                  const clearance = clearanceToCanals(implant, canals);
                  return (
                    <tr key={implant.id} className="border-b border-gray-300">
                      <td className="py-1 pr-2 font-mono">
                        {implant.fdi ? fdiLabel(implant.fdi) : '—'}
                      </td>
                      <td className="py-1 pr-2 font-mono">
                        {implant.diameterMm.toFixed(1)} × {implantLengthMm(implant).toFixed(1)} мм
                      </td>
                      <td className="py-1 pr-2 font-mono">
                        {clearance ? `${clearance.mm.toFixed(1)} мм` : 'канал не отмечен'}
                      </td>
                      <td className="py-1">{implant.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-700 mt-1.5 leading-relaxed">
              Расстояние измерено от поверхности имплантата до линии канала, отмеченной врачом;
              ширина самого канала в него не входит. План носит предварительный характер и не
              заменяет хирургический шаблон.
            </p>
          </section>
        )}

        <section className="mt-5 break-inside-avoid">
          <h2 className="text-sm font-bold uppercase tracking-wide mb-2">Заключение</h2>
          {/* Two renderings of the same text. A textarea prints its box and
              clips whatever does not fit — `rows` counts newlines, not the
              lines a paragraph wraps into — so what is printed is a plain
              block that grows with its content, and the editable field is
              left on screen only. */}
          <textarea
            value={conclusion}
            onChange={(event) => onConclusion(event.target.value)}
            rows={Math.max(5, conclusion.split('\n').length + 1)}
            placeholder="Текст заключения…"
            className="no-print w-full border border-gray-400 rounded p-2 text-sm leading-relaxed"
          />
          <div className="report-text-print hidden text-sm leading-relaxed whitespace-pre-wrap">
            {conclusion || ' '}
          </div>
          <div className="no-print flex flex-wrap gap-1.5 mt-2">
            {TEMPLATES.map((phrase) => (
              <button
                key={phrase}
                onClick={() => append(phrase)}
                className="px-2 py-0.5 text-[11px] bg-gray-100 hover:bg-gray-200 border border-gray-400 rounded text-gray-800"
              >
                + {phrase}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-8 flex items-end justify-between gap-8 text-sm break-inside-avoid">
          <div className="flex-1">
            <div className="border-b border-black h-6" />
            <div className="text-[11px] text-gray-700 mt-1">Врач (ФИО, подпись)</div>
          </div>
          <div className="w-40">
            <div className="border-b border-black h-6" />
            <div className="text-[11px] text-gray-700 mt-1">Дата</div>
          </div>
        </section>

        <footer className="mt-6 pt-2 border-t border-gray-400 text-[10px] text-gray-600 leading-relaxed">
          Документ подготовлен в программе «{APP_NAME}» {APP_VERSION}. Программа предназначена для
          просмотра и измерения; диагностическое заключение делает врач. Автоматические подсказки о
          разрежениях костной ткани не являются диагнозом и требуют подтверждения. Обработка
          выполнена на компьютере врача, снимок не передавался в сторонние сервисы.
        </footer>
      </article>
    </div>
  );
};

/* ------------------------------------------------------------------ parts */

const PrintChart: React.FC<{ rows: { upper: ChartTooth[]; lower: ChartTooth[] } }> = ({ rows }) => (
  <div className="flex flex-col gap-0.5">
    {[rows.upper, rows.lower].map((row, index) => (
      <div key={index} className="flex gap-0.5 justify-center">
        {row.map((tooth, position) => (
          <React.Fragment key={tooth.fdi}>
            {position === 8 && <div className="w-2" />}
            <div className="w-6 flex flex-col items-center">
              <div
                className={`w-6 h-7 border flex items-center justify-center text-[10px] font-bold ${
                  tooth.status === 'missing'
                    ? 'border-gray-300 text-gray-400'
                    : tooth.marked || tooth.note || tooth.flagged
                    ? 'border-black border-2 bg-gray-200'
                    : tooth.status === 'unknown'
                    ? 'border-dashed border-gray-400 text-gray-400'
                    : 'border-gray-700'
                }`}
              >
                {STATUS_MARKS[tooth.status] || (tooth.marked || tooth.note ? '•' : '')}
              </div>
              <div className="text-[8px] font-mono">{tooth.fdi}</div>
            </div>
          </React.Fragment>
        ))}
      </div>
    ))}
  </div>
);

interface ToothPageProps {
  tooth: ChartTooth;
  note: string;
  sampler: VolumeSampler;
  geometry: ArchGeometry;
  archSlice: number;
  panorama: PanoramaImage | null;
  arcMm: number;
}

const ToothPage: React.FC<ToothPageProps> = ({
  tooth,
  note,
  sampler,
  geometry,
  archSlice,
  panorama,
  arcMm,
}) => {
  const [rows, setRows] = useState<TileRow[] | null>(null);

  // Reformations for every reported tooth would freeze the page if they were
  // all built at once, so each one yields to the browser first.
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      try {
        setRows(
          buildToothTiles({
            sampler,
            geometry,
            archSlice,
            arcMm,
            jaw: tooth.jaw,
            panorama,
          })
        );
      } catch (err) {
        console.warn('Не удалось построить срезы для отчёта', err);
        setRows([]);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sampler, geometry, archSlice, arcMm, tooth.jaw, panorama]);

  return (
    <div className="break-inside-avoid border border-gray-400 rounded p-2">
      <div className="flex items-baseline gap-2 flex-wrap mb-1.5">
        <span className="text-sm font-bold font-mono">{fdiLabel(tooth.fdi)}</span>
        <span className="text-sm">{toothName(tooth.fdi)}</span>
        {tooth.status !== 'unknown' && tooth.status !== 'present' && (
          <span className="text-xs text-gray-700">{STATUS_LABELS[tooth.status]}</span>
        )}
        {note && <span className="text-xs italic flex-1">{note}</span>}
      </div>

      {rows === null ? (
        <p className="text-[11px] text-gray-500">Построение срезов…</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <div key={row.key}>
              <div className="text-[9px] uppercase tracking-wide text-gray-600 mb-0.5">
                {row.title}
              </div>
              <div className="flex gap-1 flex-wrap">
                {row.tiles.map((tile) => (
                  <figure key={tile.key} className="flex flex-col items-center">
                    <SectionCanvas image={tile.image} style={{ height: 96 }} className="border border-gray-400" />
                    <figcaption className="text-[8px] font-mono text-gray-700">
                      {tile.label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface SectionCanvasProps {
  image: SectionImage | PanoramaImage;
  className?: string;
  style?: React.CSSProperties;
}

/** Paints a reformation into a canvas at its own pixel size. */
const SectionCanvas: React.FC<SectionCanvasProps> = ({ image, className, style }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.putImageData(toImageData(image, WINDOW.center, WINDOW.width), 0, 0);
  }, [image]);

  const aspect = image.width / image.height;
  const height = typeof style?.height === 'number' ? style.height : undefined;

  return (
    <canvas
      ref={ref}
      className={className}
      style={height ? { ...style, width: Math.round(height * aspect) } : style}
    />
  );
};
