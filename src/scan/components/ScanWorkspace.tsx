import { useEffect, useState } from 'react';
import { AlertCircle, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useScanStore } from '../store';
import { ScanCanvas } from './Scene';
import { Toolbar } from './Toolbar';
import { LeftPanel } from './LeftPanel';
import { PlanPanel } from './PlanPanel';
import { PresentationOverlay } from './Presentation';
import { DropZone, OpenCaseButton } from './ScanUploader';
import { viewportApi } from './viewport';

export const ScanWorkspace = () => {
  const scans = useScanStore((s) => s.scans);
  const status = useScanStore((s) => s.statusMessage);
  const presenting = useScanStore((s) => s.presenting);
  const mode = useScanStore((s) => s.mode);
  const setStatus = useScanStore((s) => s.setStatus);

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  // Frame the arches once the first scan arrives.
  useEffect(() => {
    if (scans.length === 0) return;
    const timer = setTimeout(() => viewportApi.current?.setPreset('front'), 80);
    return () => clearTimeout(timer);
  }, [scans.length]);

  if (scans.length === 0) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-slate-950 p-8">
        <DropZone />
        <OpenCaseButton />
        {status && (
          <p className="flex items-center gap-2 text-sm text-amber-400">
            <AlertCircle size={16} /> {status}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full bg-slate-950">
      {!presenting && leftOpen && (
        <aside className="w-64 flex-shrink-0 border-r border-slate-800 bg-slate-900/70">
          <LeftPanel />
        </aside>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        {!presenting && <Toolbar />}
        <div className="relative flex-1">
          <ScanCanvas />
          <PresentationOverlay />

          {!presenting && (
            <>
              <button
                type="button"
                onClick={() => setLeftOpen((open) => !open)}
                className="absolute left-2 top-2 rounded bg-slate-900/80 p-1.5 text-slate-300 hover:text-sky-300"
                title={leftOpen ? 'Скрыть левую панель' : 'Показать левую панель'}
              >
                {leftOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
              </button>
              <button
                type="button"
                onClick={() => setRightOpen((open) => !open)}
                className="absolute right-2 top-2 rounded bg-slate-900/80 p-1.5 text-slate-300 hover:text-sky-300"
                title={rightOpen ? 'Скрыть план' : 'Показать план'}
              >
                {rightOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
              </button>

              <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center gap-3 text-[11px] text-slate-400">
                <span className="rounded bg-slate-900/80 px-2 py-1">
                  {mode === 'measure'
                    ? 'Измерение: два клика по поверхности'
                    : mode === 'place'
                      ? 'Установка: клик по зубу'
                      : 'ЛКМ — вращение, ПКМ — панорама, колесо — масштаб'}
                </span>
                {status && (
                  <span
                    className="pointer-events-auto cursor-pointer rounded bg-amber-600/90 px-2 py-1 text-white"
                    onClick={() => setStatus(null)}
                  >
                    {status}
                  </span>
                )}
                <span className="ml-auto rounded bg-slate-900/80 px-2 py-1">
                  Визуализация плана лечения — не является диагностическим заключением
                </span>
              </div>
            </>
          )}
        </div>
      </main>

      {!presenting && rightOpen && (
        <aside className="w-80 flex-shrink-0 border-l border-slate-800 bg-slate-900/70">
          <PlanPanel />
        </aside>
      )}
    </div>
  );
};
