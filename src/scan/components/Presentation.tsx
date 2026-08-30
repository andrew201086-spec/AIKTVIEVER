import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Rotate3d, X } from 'lucide-react';
import { RESTORATION_LABEL } from '../data/materials';
import { archOrderIndex } from '../data/fdi';
import { useScanStore, totalPrice } from '../store';
import { PRESET_LABELS, PRESET_SHORT, applyViewPreset } from './viewport';
import type { ViewPreset } from '../types';

const VIEWS: ViewPreset[] = ['front', 'occlusalUpper', 'occlusalLower', 'right', 'left'];

export const PresentationOverlay = () => {
  const presenting = useScanStore((s) => s.presenting);
  const stages = useScanStore((s) => s.stages);
  const restorations = useScanStore((s) => s.restorations);
  const step = useScanStore((s) => s.presentationStage);
  const autoRotate = useScanStore((s) => s.autoRotate);
  const patient = useScanStore((s) => s.patient);

  const setPresenting = useScanStore((s) => s.setPresenting);
  const setPresentationStage = useScanStore((s) => s.setPresentationStage);
  const setShowBefore = useScanStore((s) => s.setShowBefore);
  const setAutoRotate = useScanStore((s) => s.setAutoRotate);

  const lastStep = stages.length;

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(lastStep, next));
    setPresentationStage(clamped);
    setShowBefore(clamped === 0);
  };

  useEffect(() => {
    if (!presenting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPresenting(false);
      if (event.key === 'ArrowRight') goTo(useScanStore.getState().presentationStage + 1);
      if (event.key === 'ArrowLeft') goTo(useScanStore.getState().presentationStage - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!presenting) {
      setAutoRotate(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      return;
    }
    applyViewPreset('front');
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }, [presenting, setAutoRotate]);

  if (!presenting) return null;

  const stage = step === 0 ? null : stages[step - 1];
  const shown = restorations.filter((item) => item.stage <= step);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between">
      <div className="pointer-events-auto flex items-start justify-between p-5">
        <div className="rounded-xl bg-black/55 px-4 py-3 backdrop-blur">
          <p className="text-[11px] uppercase tracking-widest text-sky-300">
            {step === 0 ? 'Исходная ситуация' : `Этап ${step} из ${lastStep}`}
          </p>
          <h2 className="text-xl font-semibold text-white">
            {step === 0 ? 'До лечения' : stage?.title}
          </h2>
          {step > 0 && stage?.description && (
            <p className="mt-1 max-w-md text-sm text-slate-300">{stage.description}</p>
          )}
          {patient.name && (
            <p className="mt-2 text-xs text-slate-400">{patient.name}</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setPresenting(false)}
          className="rounded-full bg-black/55 p-2 text-slate-200 backdrop-blur hover:bg-black/80"
          title="Выйти из презентации (Esc)"
        >
          <X size={18} />
        </button>
      </div>

      {shown.length > 0 && (
        <div className="pointer-events-auto mx-5 max-w-xs rounded-xl bg-black/55 px-4 py-3 backdrop-blur">
          <p className="mb-1 text-[11px] uppercase tracking-widest text-sky-300">
            Что делаем
          </p>
          <ul className="space-y-0.5 text-sm text-slate-200">
            {shown
              .slice()
              .sort((a, b) => archOrderIndex(a.tooth) - archOrderIndex(b.tooth))
              .map((item) => (
                <li key={item.id}>
                  <span className="font-semibold text-white">{item.tooth}</span>{' '}
                  {RESTORATION_LABEL[item.type]}
                  {item.note ? ` — ${item.note}` : ''}
                </li>
              ))}
          </ul>
          {step === lastStep && (
            <p className="mt-2 border-t border-white/15 pt-2 text-sm text-slate-200">
              Итого:{' '}
              <span className="font-semibold text-white">
                {totalPrice(restorations).toLocaleString('ru-RU')} {patient.currency}
              </span>
            </p>
          )}
        </div>
      )}

      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 bg-gradient-to-t from-black/80 to-transparent p-5">
        <button
          type="button"
          onClick={() => goTo(step - 1)}
          disabled={step === 0}
          className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20 disabled:opacity-30"
        >
          <ChevronLeft size={20} />
        </button>

        {['До', ...stages.map((s) => `${s.index}`)].map((label, index) => (
          <button
            key={label + index}
            type="button"
            onClick={() => goTo(index)}
            className={`h-9 min-w-9 rounded-full px-3 text-sm font-semibold transition ${
              index === step ? 'bg-sky-500 text-white' : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
          >
            {label}
          </button>
        ))}

        <button
          type="button"
          onClick={() => goTo(step + 1)}
          disabled={step === lastStep}
          className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20 disabled:opacity-30"
        >
          <ChevronRight size={20} />
        </button>

        <div className="mx-2 h-6 w-px bg-white/20" />

        {VIEWS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => applyViewPreset(preset)}
            title={PRESET_LABELS[preset]}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/20"
          >
            {PRESET_SHORT[preset]}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setAutoRotate(!autoRotate)}
          className={`rounded-full p-2 ${
            autoRotate ? 'bg-sky-500 text-white' : 'bg-white/10 text-slate-200 hover:bg-white/20'
          }`}
          title="Автовращение"
        >
          <Rotate3d size={18} />
        </button>
      </div>
    </div>
  );
};
