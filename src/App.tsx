import { Suspense, lazy, useState } from 'react';
import { ArrowLeft, Boxes, Layers, ScanLine } from 'lucide-react';
import { ScanWorkspace } from './scan/components/ScanWorkspace';
import { useScanStore } from './scan/store';

const CbctModule = lazy(() =>
  import('./cbct/CbctModule').then((module) => ({ default: module.CbctModule })),
);

type ModuleId = 'home' | 'scan' | 'cbct';

const MODULES = [
  {
    id: 'scan' as const,
    title: 'Сканы челюстей',
    subtitle: 'PLY · STL · OBJ',
    description:
      'Просмотр внутриротовых сканов, планирование коронок, виниров, мостов и имплантатов, презентация плана пациенту.',
    icon: ScanLine,
    accent: 'from-sky-500/20 to-sky-500/5 border-sky-700 hover:border-sky-500',
  },
  {
    id: 'cbct' as const,
    title: 'КЛКТ (DICOM)',
    subtitle: 'Компьютерная томография',
    description:
      'Мультипланарная реконструкция, объёмный рендер и оценка костной ткани по данным конусно-лучевой томографии.',
    icon: Boxes,
    accent: 'from-emerald-500/20 to-emerald-500/5 border-emerald-800 hover:border-emerald-600',
  },
];

const Home = ({ onOpen }: { onOpen: (id: ModuleId) => void }) => (
  <div className="flex h-full flex-col items-center justify-center gap-10 bg-slate-950 p-8">
    <div className="text-center">
      <h1 className="flex items-center justify-center gap-3 text-3xl font-semibold text-white">
        <span className="text-4xl">🦷</span> AIKT Viewer
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        Визуализация плана лечения по данным сканирования и томографии
      </p>
    </div>

    <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-2">
      {MODULES.map((module) => (
        <button
          key={module.id}
          type="button"
          onClick={() => onOpen(module.id)}
          className={`group rounded-2xl border bg-gradient-to-b p-6 text-left transition ${module.accent}`}
        >
          <module.icon size={28} className="mb-4 text-white/80" />
          <h2 className="text-lg font-semibold text-white">{module.title}</h2>
          <p className="text-xs uppercase tracking-wider text-slate-400">
            {module.subtitle}
          </p>
          <p className="mt-3 text-sm text-slate-300">{module.description}</p>
        </button>
      ))}
    </div>

    <p className="max-w-2xl text-center text-xs text-slate-500">
      Все файлы обрабатываются локально в браузере и не передаются на сервер.
      Программа предназначена для визуализации и обсуждения плана лечения с пациентом
      и не является средством постановки диагноза.
    </p>
  </div>
);

function App() {
  const [module, setModule] = useState<ModuleId>('home');
  // The patient-facing presentation takes over the whole window.
  const presenting = useScanStore((s) => s.presenting);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950">
      {module !== 'home' && !presenting && (
        <header className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900 px-3">
          <button
            type="button"
            onClick={() => setModule('home')}
            className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <ArrowLeft size={14} /> Модули
          </button>
          <span className="flex items-center gap-2 text-sm font-semibold text-white">
            <Layers size={15} className="text-sky-500" />
            {module === 'scan' ? 'Сканы челюстей' : 'КЛКТ (DICOM)'}
          </span>
        </header>
      )}

      <div className="min-h-0 flex-1">
        {module === 'home' && <Home onOpen={setModule} />}
        {module === 'scan' && <ScanWorkspace />}
        {module === 'cbct' && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-slate-400">
                Загрузка модуля КЛКТ…
              </div>
            }
          >
            <CbctModule />
          </Suspense>
        )}
      </div>
    </div>
  );
}

export default App;
