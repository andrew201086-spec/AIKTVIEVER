import React, { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Upload,
  FolderOpen,
  FileText,
  Archive,
  Sparkles,
  Loader2,
  AlertCircle,
  X,
  Clock,
} from 'lucide-react';
import { addCustomMetadata, clearCustomMetadata } from '../utils/customMetadataProvider';
import { buildSeries, looksLikeDicom, NotDicomError, parseFile, slices } from '../utils/dicomParse';
import type { SeriesInfo, SliceInfo } from '../utils/dicomParse';
import { generateDemoStudy } from '../utils/demoStudy';
import {
  canReopenFolders,
  filesFromHandle,
  forgetStudy,
  listRecent,
  pickFolder,
  whenOpened,
  type RecentStudy,
} from '../utils/recentStudies';

interface DicomUploaderProps {
  onSeriesReady: (series: SeriesInfo[]) => void;
  /** Told about the folder a study came from, so it can be offered again. */
  onFolderOpened?: (handle: FileSystemDirectoryHandle) => void;
}

export const DicomUploader: React.FC<DicomUploaderProps> = ({ onSeriesReady, onFolderOpened }) => {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  /**
   * Reading a folder of six hundred files takes a while, and a user who
   * picked the wrong one should not have to wait it out or reload the page.
   */
  const cancelRef = useRef(false);
  const [recent, setRecent] = useState<RecentStudy[]>([]);

  useEffect(() => {
    listRecent().then(setRecent);
  }, []);

  /**
   * Reopening a remembered folder. The permission prompt the browser may show
   * has to come from the click itself, so the handle is used straight away.
   */
  const openRecent = async (entry: RecentStudy) => {
    if (!entry.handle) {
      setError(
        'Эта папка запомнена без разрешения на повторное открытие — выберите её через «Выбрать папку».'
      );
      return;
    }
    try {
      setError(null);
      const files = await filesFromHandle(entry.handle);
      onFolderOpened?.(entry.handle);
      await processFiles(files);
    } catch (err: any) {
      setError(
        err?.message === 'Доступ к папке не подтверждён'
          ? 'Браузер не получил доступ к папке. Нажмите ещё раз и подтвердите доступ.'
          : `Не удалось открыть папку: ${err?.message || err}`
      );
    }
  };

  /** The picker that hands back a handle we can keep. */
  const openFolderWithHandle = async () => {
    try {
      setError(null);
      const { handle, files } = await pickFolder();
      onFolderOpened?.(handle);
      await processFiles(files);
    } catch (err: any) {
      // The user closing the picker is not an error.
      if (err?.name === 'AbortError') return;
      setError(`Не удалось прочитать папку: ${err?.message || err}`);
    }
  };

  const processFiles = async (rawFiles: File[]) => {
    setError(null);
    setSkipped([]);
    setIsLoading(true);
    setProgress(0);
    setStatus('Проверка файлов…');
    cancelRef.current = false;

    clearCustomMetadata();

    try {
      // Identify DICOM by its signature rather than by file name: exports carry
      // DICOMDIR, viewer executables and files with no extension at all.
      const candidates: File[] = [];
      const rejected: string[] = [];

      for (let i = 0; i < rawFiles.length; i++) {
        if (cancelRef.current) return stopped();
        const file = rawFiles[i];
        if (file.size < 136 || file.name.startsWith('.')) {
          rejected.push(file.name);
        } else if (await looksLikeDicom(file)) {
          candidates.push(file);
        } else {
          rejected.push(file.name);
        }
        if (i % 25 === 0) {
          setProgress(Math.round((i / rawFiles.length) * 15));
          await yieldToUi();
        }
      }

      if (candidates.length === 0) {
        setError(
          `Файлов DICOM не найдено. Проверено: ${rawFiles.length}. Ожидается папка с файлами .dcm из томографа или ZIP-архив с ними.`
        );
        setIsLoading(false);
        return;
      }

      setStatus(`Чтение заголовков — ${candidates.length} файлов…`);

      const slices: SliceInfo[] = [];
      for (let i = 0; i < candidates.length; i++) {
        if (cancelRef.current) return stopped();
        try {
          // One file can hold a whole volume: multi-frame exports come back as
          // many slices from a single read.
          const parsed = await parseFile(candidates[i], i);
          for (const slice of parsed) {
            slices.push(slice);
            addCustomMetadata(slice.imageId, slice.metadata);
          }
        } catch (err) {
          if (err instanceof NotDicomError) rejected.push(err.message);
          else rejected.push(`${candidates[i].name}: ${String((err as any)?.message || err)}`);
        }

        if (i % 10 === 0 || i === candidates.length - 1) {
          setProgress(15 + Math.round((i / candidates.length) * 75));
          // Without this the tab is frozen for the whole parse on a large study.
          await yieldToUi();
        }
      }

      if (slices.length === 0) {
        setError('Ни один файл не удалось прочитать как срез изображения.');
        setSkipped(rejected.slice(0, 8));
        setIsLoading(false);
        return;
      }

      if (cancelRef.current) return stopped();

      setStatus('Группировка по сериям…');
      setProgress(95);
      await yieldToUi();

      const series = buildSeries(slices);
      setSkipped(rejected.slice(0, 8));
      setProgress(100);
      onSeriesReady(series);
    } catch (err: any) {
      console.error('Ошибка обработки DICOM:', err);
      setError(err?.message || 'Не удалось обработать выбранные файлы.');
      setIsLoading(false);
    }
  };

  /** Leaves the panel as it was before the user picked anything. */
  const stopped = () => {
    setIsLoading(false);
    setProgress(0);
    setStatus('');
    clearCustomMetadata();
  };

  const handleZipFile = async (zipFile: File) => {
    setError(null);
    setIsLoading(true);
    setProgress(0);
    setStatus('Распаковка архива…');
    cancelRef.current = false;

    try {
      const zip = await new JSZip().loadAsync(zipFile);
      const entries = Object.values(zip.files).filter((entry) => !entry.dir);
      const extracted: File[] = [];

      for (let i = 0; i < entries.length; i++) {
        if (cancelRef.current) return stopped();
        const entry = entries[i];
        const blob = await entry.async('blob');
        extracted.push(new File([blob], entry.name.split('/').pop() || entry.name));
        if (i % 20 === 0) {
          setProgress(Math.round((i / entries.length) * 20));
          await yieldToUi();
        }
      }

      await processFiles(extracted);
    } catch (err: any) {
      console.error('Не удалось распаковать архив:', err);
      setError('Архив не читается. Убедитесь, что это корректный ZIP с файлами DICOM.');
      setIsLoading(false);
    }
  };

  const handleSelection = (event: React.ChangeEvent<HTMLInputElement>, asZip = false) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    if (asZip) handleZipFile(files[0]);
    else processFiles(Array.from(files));
    // Allow picking the same folder twice in a row.
    event.target.value = '';
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);

    const items = event.dataTransfer.items;
    if (!items || items.length === 0) {
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 1 && files[0].name.toLowerCase().endsWith('.zip')) handleZipFile(files[0]);
      else if (files.length) processFiles(files);
      return;
    }

    setIsLoading(true);
    setStatus('Чтение перетащенных файлов…');

    const collected: File[] = [];
    const entries = Array.from(items)
      .filter((item) => item.kind === 'file')
      .map((item) => (item as any).webkitGetAsEntry?.())
      .filter(Boolean);

    for (const entry of entries) {
      await walkEntry(entry, collected);
    }

    if (collected.length === 0) {
      const files = Array.from(event.dataTransfer.files);
      if (files.length) collected.push(...files);
    }

    if (collected.length === 1 && collected[0].name.toLowerCase().endsWith('.zip')) {
      await handleZipFile(collected[0]);
    } else if (collected.length) {
      await processFiles(collected);
    } else {
      setIsLoading(false);
      setError('В перетащенном не оказалось файлов.');
    }
  };

  const loadDemo = async () => {
    setError(null);
    setIsLoading(true);
    setProgress(0);
    setStatus('Генерация тестовой модели челюсти…');
    const files = await generateDemoStudy((pct) => setProgress(Math.round(pct * 0.3)));
    await processFiles(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`max-w-2xl w-full mx-auto bg-gray-900 border-2 ${
        isDragging ? 'border-blue-500 bg-gray-800' : 'border-gray-700'
      } border-dashed rounded-2xl p-8 transition-colors shadow-2xl flex flex-col items-center text-center`}
    >
      <input type="file" ref={folderInputRef} onChange={(e) => handleSelection(e)} multiple className="hidden"
        // @ts-expect-error non-standard attributes for folder selection
        webkitdirectory="" directory="" />
      <input type="file" ref={filesInputRef} onChange={(e) => handleSelection(e)} multiple className="hidden" />
      <input type="file" ref={zipInputRef} onChange={(e) => handleSelection(e, true)} accept=".zip,application/zip" className="hidden" />

      <div className="w-16 h-16 bg-blue-600/20 text-blue-400 rounded-full flex items-center justify-center mb-4 ring-8 ring-blue-500/10">
        <Upload className="w-8 h-8" />
      </div>

      <h2 className="text-2xl font-bold text-white mb-2">Загрузка КЛКТ-исследования</h2>
      <p className="text-gray-400 text-sm max-w-md mb-6">
        Перетащите папку с файлами <code>.dcm</code> или ZIP-архив. Снимок никуда не отправляется — всё
        обрабатывается в браузере на этом компьютере.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full mb-6">
        <button
          disabled={isLoading}
          onClick={() =>
            canReopenFolders() ? openFolderWithHandle() : folderInputRef.current?.click()
          }
          className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <FolderOpen className="w-4 h-4" />
          Выбрать папку
        </button>
        <button
          disabled={isLoading}
          onClick={() => filesInputRef.current?.click()}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-sm font-medium rounded-xl border border-gray-700 transition-colors"
        >
          <FileText className="w-4 h-4" />
          Выбрать файлы
        </button>
        <button
          disabled={isLoading}
          onClick={() => zipInputRef.current?.click()}
          className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 text-sm font-medium rounded-xl border border-gray-700 transition-colors"
        >
          <Archive className="w-4 h-4" />
          ZIP-архив
        </button>
      </div>

      <div className="w-full pt-4 border-t border-gray-800 flex justify-center">
        <button
          disabled={isLoading}
          onClick={loadDemo}
          className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 border border-emerald-500/30 rounded-lg transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          Нет снимка под рукой? Открыть тестовую модель челюсти
        </button>
      </div>

      {recent.length > 0 && !isLoading && (
        <div className="w-full mt-6 pt-4 border-t border-gray-800 text-left">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 mb-2">
            <Clock className="w-3.5 h-3.5" />
            Недавние исследования
          </h3>
          <ul className="flex flex-col gap-1">
            {recent.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-3 py-2"
              >
                <button
                  onClick={() => openRecent(entry)}
                  disabled={!entry.handle}
                  className="flex-grow min-w-0 text-left disabled:opacity-50"
                  title={entry.handle ? 'Открыть заново' : 'Браузер не сохранил доступ к этой папке'}
                >
                  <div className="text-sm text-gray-100 truncate">
                    {entry.patientName || entry.folderName}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {entry.description} · {slices(entry.sliceCount)} · {whenOpened(entry.openedAt)}
                  </div>
                </button>
                <button
                  onClick={async () => {
                    await forgetStudy(entry.id);
                    setRecent(await listRecent());
                  }}
                  title="Убрать из списка"
                  className="p-1 rounded text-gray-600 hover:text-red-400"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-gray-600 mt-2">
            Запоминается только путь к папке — снимки остаются на диске и никуда не копируются.
          </p>
        </div>
      )}

      {isLoading && (
        <div className="mt-6 w-full bg-gray-800/80 rounded-xl p-4 border border-blue-500/30">
          <div className="flex items-center justify-between text-xs text-blue-300 mb-2 font-medium gap-3">
            <span className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              <span className="truncate">{status}</span>
            </span>
            <span className="flex items-center gap-2 flex-shrink-0">
              <span className="font-mono tabular-nums">{progress}%</span>
              <button
                onClick={() => {
                  cancelRef.current = true;
                }}
                title="Прекратить чтение файлов"
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:text-white hover:bg-gray-700"
              >
                <X className="w-3 h-3" />
                Отменить
              </button>
            </span>
          </div>
          <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-[width] duration-200 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 w-full p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-xs flex items-start gap-2 text-left">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {skipped.length > 0 && (
        <details className="mt-3 w-full text-left">
          <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-300">
            Пропущено файлов: {skipped.length}
          </summary>
          <ul className="mt-2 text-[11px] text-gray-500 font-mono space-y-0.5">
            {skipped.map((name) => (
              <li key={name} className="truncate">
                {name}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function walkEntry(entry: any, collected: File[]): Promise<void> {
  if (!entry) return;

  if (entry.isFile) {
    await new Promise<void>((resolve) => {
      entry.file((file: File) => {
        collected.push(file);
        resolve();
      }, () => resolve());
    });
    return;
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    // readEntries returns at most 100 items per call and must be drained.
    for (;;) {
      const batch: any[] = await new Promise((resolve) => {
        reader.readEntries((items: any[]) => resolve(items || []), () => resolve([]));
      });
      if (batch.length === 0) break;
      for (const child of batch) {
        await walkEntry(child, collected);
      }
    }
  }
}
