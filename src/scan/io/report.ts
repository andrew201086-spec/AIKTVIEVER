import type { PatientInfo, PlanStage, Restoration } from '../types';
import { MATERIALS, RESTORATION_LABEL } from '../data/materials';
import { toothLabel } from '../data/fdi';

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

export interface ReportInput {
  patient: PatientInfo;
  restorations: Restoration[];
  stages: PlanStage[];
  /** Data URLs of viewport captures. */
  images: { caption: string; dataUrl: string }[];
}

const rows = (restorations: Restoration[], currency: string) =>
  restorations
    .slice()
    .sort((a, b) => a.stage - b.stage || a.tooth - b.tooth)
    .map(
      (item) => `
        <tr>
          <td>${item.stage}</td>
          <td>${item.tooth}</td>
          <td>${escapeHtml(RESTORATION_LABEL[item.type])}</td>
          <td>${escapeHtml(MATERIALS[item.material].label)}</td>
          <td>${escapeHtml(item.note ?? '')}</td>
          <td class="num">${item.price.toLocaleString('ru-RU')} ${escapeHtml(currency)}</td>
        </tr>`,
    )
    .join('');

export const buildReportHtml = ({
  patient,
  restorations,
  stages,
  images,
}: ReportInput): string => {
  const total = restorations.reduce((sum, r) => sum + (r.price || 0), 0);
  const stageBlocks = stages
    .filter((stage) => restorations.some((r) => r.stage === stage.index))
    .map(
      (stage) => `
        <li>
          <strong>${escapeHtml(stage.title)}</strong>
          ${stage.description ? `<div class="muted">${escapeHtml(stage.description)}</div>` : ''}
          <div class="muted">${restorations
            .filter((r) => r.stage === stage.index)
            .map((r) => escapeHtml(`${RESTORATION_LABEL[r.type]} ${r.tooth}`))
            .join(', ')}</div>
        </li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>План лечения — ${escapeHtml(patient.name || 'пациент')}</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #14181f; margin: 28px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { color: #5b6472; font-size: 12px; }
  .meta { display: flex; gap: 24px; flex-wrap: wrap; margin: 12px 0 20px; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { border-bottom: 1px solid #dde2e9; padding: 7px 8px; text-align: left; vertical-align: top; }
  th { background: #f4f6f9; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 2px solid #14181f; }
  .shots { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin: 18px 0; }
  .shots figure { margin: 0; }
  .shots img { width: 100%; border: 1px solid #dde2e9; border-radius: 6px; }
  figcaption { font-size: 12px; color: #5b6472; margin-top: 4px; }
  ol { padding-left: 18px; }
  li { margin-bottom: 8px; }
  footer { margin-top: 26px; font-size: 11px; color: #79828f; border-top: 1px solid #dde2e9; padding-top: 8px; }
  @media print { body { margin: 12mm; } .shots { break-inside: avoid; } }
</style>
</head>
<body>
  <h1>План лечения</h1>
  <div class="muted">Визуализация по данным внутриротового сканирования</div>
  <div class="meta">
    <div><strong>Пациент:</strong> ${escapeHtml(patient.name || '—')}</div>
    <div><strong>Карта:</strong> ${escapeHtml(patient.chartId || '—')}</div>
    <div><strong>Врач:</strong> ${escapeHtml(patient.doctor || '—')}</div>
    <div><strong>Дата:</strong> ${escapeHtml(patient.date)}</div>
  </div>

  ${
    images.length > 0
      ? `<div class="shots">${images
          .map(
            (image) =>
              `<figure><img src="${image.dataUrl}" alt=""><figcaption>${escapeHtml(
                image.caption,
              )}</figcaption></figure>`,
          )
          .join('')}</div>`
      : ''
  }

  ${stageBlocks ? `<h2>Этапы</h2><ol>${stageBlocks}</ol>` : ''}

  <h2>Состав работ</h2>
  <table>
    <thead>
      <tr><th>Этап</th><th>Зуб</th><th>Конструкция</th><th>Материал</th><th>Комментарий</th><th class="num">Стоимость</th></tr>
    </thead>
    <tbody>${rows(restorations, patient.currency)}</tbody>
    <tfoot>
      <tr><td colspan="5">Итого</td><td class="num">${total.toLocaleString('ru-RU')} ${escapeHtml(
        patient.currency,
      )}</td></tr>
    </tfoot>
  </table>

  <p class="muted">${restorations
    .map((r) => escapeHtml(toothLabel(r.tooth)))
    .filter((value, index, all) => all.indexOf(value) === index)
    .join(' · ')}</p>

  <footer>
    Документ носит информационный характер и предназначен для обсуждения плана лечения с пациентом.
    Не является диагностическим заключением. Итоговый результат определяется клинической ситуацией.
  </footer>
</body>
</html>`;
};

export const openPrintableReport = (input: ReportInput) => {
  const win = window.open('', '_blank');
  if (!win) throw new Error('Браузер заблокировал новое окно для отчёта');
  win.document.write(buildReportHtml(input));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
};
