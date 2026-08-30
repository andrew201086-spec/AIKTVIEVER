import { useCallback } from 'react';
import { useScanStore } from '../store';
import { buildCaseFile, downloadBlob, readCaseFile } from '../io/caseFile';
import { openPrintableReport } from '../io/report';
import { restoreScan } from '../mesh/loadMesh';
import { clearScans } from '../mesh/registry';
import { invalidatePlacementCache } from '../mesh/placement';
import { viewportApi } from './viewport';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Browsers drop non-ASCII download names, so case files get a latin slug. */
const slug = (value: string) => {
  const latin = value
    .trim()
    .toLowerCase()
    .split('')
    .map((char) => TRANSLIT[char] ?? char)
    .join('');
  return latin.replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '') || 'case';
};

export const useCaseIO = () => {
  const setStatus = useScanStore((s) => s.setStatus);
  const loadCase = useScanStore((s) => s.loadCase);

  const saveCase = useCallback(
    async (includeScans = true) => {
      const state = useScanStore.getState();
      setStatus('Сохранение случая…');
      try {
        const blob = await buildCaseFile(
          {
            patient: state.patient,
            scans: state.scans,
            restorations: state.restorations,
            measurements: state.measurements,
            stages: state.stages,
          },
          includeScans,
          (percent) => setStatus(`Сохранение случая… ${percent}%`),
        );
        downloadBlob(blob, `${slug(state.patient.name || 'case')}_${state.patient.date}.aikt`);
        setStatus(null);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Не удалось сохранить случай');
      }
    },
    [setStatus],
  );

  const openCase = useCallback(
    async (file: File) => {
      setStatus('Открытие случая…');
      try {
        const { manifest, meshes } = await readCaseFile(file);
        clearScans();
        invalidatePlacementCache();
        const scans = manifest.scans.filter((scan) => meshes.has(scan.id));
        scans.forEach((scan) => restoreScan(scan, meshes.get(scan.id)!));
        loadCase({
          patient: manifest.patient,
          scans,
          restorations: manifest.restorations,
          measurements: manifest.measurements,
          stages: manifest.stages,
        });
        setStatus(
          scans.length < manifest.scans.length
            ? 'Случай открыт, но часть сканов сохранена без геометрии'
            : null,
        );
        setTimeout(() => viewportApi.current?.setPreset('front'), 100);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Не удалось открыть случай');
      }
    },
    [loadCase, setStatus],
  );

  const screenshot = useCallback(() => {
    const dataUrl = viewportApi.current?.capture();
    if (!dataUrl) {
      setStatus('Не удалось сделать снимок вида');
      return;
    }
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `snapshot_${Date.now()}.png`;
    link.click();
  }, [setStatus]);

  /** Captures a before/after pair from the current camera and prints the plan. */
  const exportReport = useCallback(async () => {
    const store = useScanStore.getState();
    const wasBefore = store.showBefore;
    setStatus('Готовим отчёт…');
    try {
      const images: { caption: string; dataUrl: string }[] = [];

      store.setShowBefore(true);
      await wait(160);
      const before = viewportApi.current?.capture();
      if (before) images.push({ caption: 'До лечения', dataUrl: before });

      store.setShowBefore(false);
      await wait(160);
      const after = viewportApi.current?.capture();
      if (after) images.push({ caption: 'После лечения (план)', dataUrl: after });

      store.setShowBefore(wasBefore);
      openPrintableReport({
        patient: store.patient,
        restorations: useScanStore.getState().restorations,
        stages: store.stages,
        images,
      });
      setStatus(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Не удалось построить отчёт');
    }
  }, [setStatus]);

  return { saveCase, openCase, screenshot, exportReport };
};
