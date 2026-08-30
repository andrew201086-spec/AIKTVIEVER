import { useCallback, useRef, useState } from 'react';
import { FolderOpen, Upload } from 'lucide-react';
import type { JawKind } from '../types';
import { useScanStore } from '../store';
import { loadScanFile } from '../mesh/loadMesh';
import { invalidatePlacementCache } from '../mesh/placement';
import { useCaseIO } from './useCaseIO';

const UPPER_HINTS = ['upper', 'maxill', 'верх', 'вч', 'oberkiefer'];
const LOWER_HINTS = ['lower', 'mandib', 'ниж', 'нч', 'unterkiefer'];

export const guessJaw = (fileName: string, taken: JawKind[]): JawKind => {
  const name = fileName.toLowerCase();
  if (UPPER_HINTS.some((hint) => name.includes(hint))) return 'upper';
  if (LOWER_HINTS.some((hint) => name.includes(hint))) return 'lower';
  return taken.includes('upper') ? 'lower' : 'upper';
};

export const SCAN_ACCEPT = '.ply,.stl,.obj,.aikt,.zip';

export const useScanLoader = () => {
  const addScan = useScanStore((s) => s.addScan);
  const setStatus = useScanStore((s) => s.setStatus);
  const { openCase } = useCaseIO();
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (files: FileList | File[], forcedJaw?: JawKind) => {
      const all = [...files];
      const caseFile = all.find((file) => /\.(aikt|zip)$/i.test(file.name));
      if (caseFile) {
        setBusy(true);
        try {
          await openCase(caseFile);
        } finally {
          setBusy(false);
        }
        return;
      }
      const list = all.filter((file) => /\.(ply|stl|obj)$/i.test(file.name));
      if (list.length === 0) {
        setStatus('Поддерживаются файлы .ply, .stl, .obj и случаи .aikt');
        return;
      }
      setBusy(true);
      try {
        for (const file of list) {
          const taken = useScanStore.getState().scans.map((scan) => scan.jaw);
          const jaw = forcedJaw ?? guessJaw(file.name, taken);
          setStatus(`Обработка ${file.name}…`);
          const { meta } = await loadScanFile(file, jaw);
          invalidatePlacementCache(meta.id);
          addScan(meta);
        }
        setStatus(null);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Ошибка загрузки скана');
      } finally {
        setBusy(false);
      }
    },
    [addScan, openCase, setStatus],
  );

  return { load, busy };
};

export const DropZone = ({ compact = false }: { compact?: boolean }) => {
  const { load, busy } = useScanLoader();
  const inputRef = useRef<HTMLInputElement>(null);
  const [hover, setHover] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (files && files.length > 0) void load(files);
  };

  if (compact) {
    return (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded border border-dashed border-slate-600 px-3 py-2 text-xs text-slate-300 hover:border-sky-500 hover:text-sky-300 disabled:opacity-50"
        >
          <Upload size={14} />
          {busy ? 'Загрузка…' : 'Добавить скан'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={SCAN_ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => {
            handleFiles(event.target.files);
            event.target.value = '';
          }}
        />
      </>
    );
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setHover(true);
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(event) => {
        event.preventDefault();
        setHover(false);
        handleFiles(event.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={`flex h-full w-full max-w-xl cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-12 text-center transition ${
        hover ? 'border-sky-400 bg-sky-500/5' : 'border-slate-700 hover:border-slate-500'
      }`}
    >
      <Upload size={40} className="text-sky-500" />
      <div>
        <p className="text-lg font-semibold text-slate-100">
          {busy ? 'Читаем скан…' : 'Перетащите сканы челюстей'}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          PLY, STL или OBJ — от внутриротового сканера или сканера моделей.
          Сюда же можно перетащить сохранённый случай .aikt
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Верхняя и нижняя челюсти распознаются по имени файла (upper / lower).
          Файлы обрабатываются локально и никуда не отправляются.
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={SCAN_ACCEPT}
        multiple
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
};

/** Entry point for a saved case when no scan is open yet. */
export const OpenCaseButton = () => {
  const { openCase } = useCaseIO();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-sky-500 hover:text-sky-300"
      >
        <FolderOpen size={15} />
        Открыть сохранённый случай (.aikt)
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".aikt,.zip"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void openCase(file);
          event.target.value = '';
        }}
      />
    </>
  );
};
