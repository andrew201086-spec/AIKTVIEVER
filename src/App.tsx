import { useEffect, useRef, useState } from 'react';
import { DicomUploader } from './components/DicomUploader';
import { SeriesPicker } from './components/SeriesPicker';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Viewer } from './components/Viewer';
import { initCornerstone } from './utils/cornerstoneInit';
import { clearCustomMetadata } from './utils/customMetadataProvider';
import { releaseDataSets, slices, stepForBudget, withStep } from './utils/dicomParse';
import { rememberStudy } from './utils/recentStudies';
import type { SeriesInfo } from './utils/dicomParse';

type Stage = 'upload' | 'pick' | 'view';

function App() {
  const [stage, setStage] = useState<Stage>('upload');
  const [series, setSeries] = useState<SeriesInfo[]>([]);
  const [selected, setSelected] = useState<SeriesInfo | null>(null);
  /** The folder this study came from, kept so it can be offered again. */
  const folderRef = useRef<FileSystemDirectoryHandle | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    initCornerstone()
      .then(() => setIsReady(true))
      .catch((err) => {
        console.error('Не удалось инициализировать Cornerstone3D:', err);
        setInitError(String(err?.message || err));
      });
  }, []);

  const handleSeriesReady = (found: SeriesInfo[]) => {
    setSeries(found);

    // Remember where it came from, but only once there is something to name
    // it by — a folder that produced no series is not worth offering again.
    const best = found.find((item) => item.loadable) ?? found[0];
    if (folderRef.current && best) {
      rememberStudy({
        id: `${folderRef.current.name}:${best.seriesInstanceUID}`,
        folderName: folderRef.current.name,
        patientName: best.patientName,
        description: best.description,
        sliceCount: best.sliceCount,
        handle: folderRef.current,
      });
    }

    const loadable = found.filter((s) => s.loadable);
    // One usable series is the common case — don't make the user click through
    // a list of one. A series that has to be thinned to fit is a decision the
    // user should see, so that one always goes to the picker.
    const only = loadable.length === 1 && found.length === 1 ? loadable[0] : null;
    if (only && stepForBudget(only.estimatedBytes) === 1) {
      setSelected(only);
      setStage('view');
    } else {
      setStage('pick');
    }
  };

  const closeStudy = () => {
    folderRef.current = null;
    setSelected(null);
    setSeries([]);
    clearCustomMetadata();
    releaseDataSets();
    setStage('upload');
  };

  if (initError) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-black text-white p-8">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold mb-2">Движок визуализации не запустился</h1>
          <p className="text-sm text-gray-400 font-mono break-words">{initError}</p>
        </div>
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-black text-white">
        <p className="text-lg animate-pulse">Запуск движка визуализации…</p>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-black overflow-hidden flex flex-col">
      <header className="h-12 bg-gray-900 border-b border-gray-800 flex items-center px-4 flex-shrink-0 gap-4">
        <h1 className="text-white font-semibold flex items-center gap-2 text-sm">
          <span className="text-blue-500 text-lg">🦷</span>
          Просмотр КЛКТ
        </h1>

        {selected && (
          <span className="text-xs text-gray-500 truncate hidden sm:block">
            {selected.patientName ? `${selected.patientName} · ` : ''}
            {selected.description} · {slices(selected.sliceCount)}
          </span>
        )}

        {stage !== 'upload' && (
          <div className="ml-auto flex items-center gap-2">
            {stage === 'view' && series.length > 1 && (
              <button
                onClick={() => setStage('pick')}
                className="text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 px-3 py-1 rounded text-gray-300"
              >
                Другая серия
              </button>
            )}
            <button
              onClick={closeStudy}
              className="text-xs bg-red-600/90 hover:bg-red-600 px-3 py-1 rounded text-white"
            >
              Закрыть
            </button>
          </div>
        )}
      </header>

      <main className="flex-grow min-h-0 relative">
        {stage === 'upload' && (
          <div className="absolute inset-0 p-8 flex items-center justify-center overflow-y-auto">
              <DicomUploader
              onSeriesReady={handleSeriesReady}
              onFolderOpened={(handle) => {
                folderRef.current = handle;
              }}
            />
          </div>
        )}

        {stage === 'pick' && (
          <div className="absolute inset-0 p-8 overflow-y-auto">
            <SeriesPicker
              series={series}
              onBack={closeStudy}
              onSelect={(item, step) => {
                setSelected(withStep(item, step));
                setStage('view');
              }}
            />
          </div>
        )}

        {stage === 'view' && selected && (
          <ErrorBoundary
            title="Просмотр исследования"
            hint="Что-то в просмотрщике сломалось. «Попробовать снова» перестроит окна из уже загруженного объёма; если не поможет — закройте исследование и откройте заново."
            onDismiss={closeStudy}
            dismissLabel="Закрыть исследование"
          >
            <Viewer key={`${selected.seriesInstanceUID}:${selected.step}`} series={selected} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}

export default App;
