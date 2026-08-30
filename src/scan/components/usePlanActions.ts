import { useCallback } from 'react';
import type { RestorationType } from '../types';
import { useScanStore } from '../store';
import { archOrderIndex, jawOfTooth } from '../data/fdi';
import { placeOnTooth } from '../mesh/placement';
import { defaultParams } from '../geometry/factory';

/** Adds a restoration to a tooth using the arch model of the matching scan. */
export const usePlanActions = () => {
  const createRestoration = useScanStore((s) => s.createRestoration);
  const setStatus = useScanStore((s) => s.setStatus);

  const addToTooth = useCallback(
    (tooth: number, type: RestorationType) => {
      const jaw = jawOfTooth(tooth);
      const scan = useScanStore.getState().scans.find((item) => item.jaw === jaw);
      if (!scan) {
        setStatus(
          `Сначала загрузите скан ${jaw === 'upper' ? 'верхней' : 'нижней'} челюсти`,
        );
        return null;
      }
      const nominal = defaultParams(tooth, type);
      const placement = placeOnTooth(
        scan.id,
        jaw,
        tooth,
        type,
        type === 'implant' ? (nominal.length ?? 10) : nominal.height,
      );
      if (!placement) {
        setStatus('Не удалось распознать зубную дугу на этом скане');
        return null;
      }
      setStatus(null);
      return createRestoration(tooth, type, placement.transform, placement.height);
    },
    [createRestoration, setStatus],
  );

  /** Places abutment crowns plus pontics and splints them into one bridge. */
  const addBridge = useCallback(
    (teeth: number[]) => {
      const sorted = [...new Set(teeth)].sort(
        (a, b) => archOrderIndex(a) - archOrderIndex(b),
      );
      if (sorted.length < 3) {
        setStatus('Для моста нужно минимум три единицы: две опоры и промежуточная часть');
        return;
      }
      const ids: string[] = [];
      sorted.forEach((tooth, index) => {
        const isAbutment = index === 0 || index === sorted.length - 1;
        const item = addToTooth(tooth, isAbutment ? 'crown' : 'pontic');
        if (item) ids.push(item.id);
      });
      if (ids.length > 1) useScanStore.getState().splintSelection(ids);
    },
    [addToTooth, setStatus],
  );

  return { addToTooth, addBridge };
};
