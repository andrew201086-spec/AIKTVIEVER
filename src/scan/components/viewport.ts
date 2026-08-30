import * as THREE from 'three';
import type { ViewPreset } from '../types';
import { useScanStore } from '../store';

export interface ViewportApi {
  setPreset: (preset: ViewPreset) => void;
  frameAll: () => void;
  capture: () => string | null;
  orbitTo: (direction: THREE.Vector3) => void;
}

/** Imperative handle published by the component that lives inside the Canvas. */
export const viewportApi: { current: ViewportApi | null } = { current: null };

export const PRESET_DIRECTIONS: Record<ViewPreset, THREE.Vector3> = {
  occlusalUpper: new THREE.Vector3(0, -1, 0.08),
  occlusalLower: new THREE.Vector3(0, 1, 0.08),
  front: new THREE.Vector3(0, 0.18, 1),
  right: new THREE.Vector3(-1, 0.15, 0.35),
  left: new THREE.Vector3(1, 0.15, 0.35),
  upperOnly: new THREE.Vector3(0, 0.18, 1),
  lowerOnly: new THREE.Vector3(0, 0.18, 1),
};

export const PRESET_LABELS: Record<ViewPreset, string> = {
  occlusalUpper: 'Верхняя окклюзионно',
  occlusalLower: 'Нижняя окклюзионно',
  front: 'Фронтально',
  right: 'Справа',
  left: 'Слева',
  upperOnly: 'Только верхняя',
  lowerOnly: 'Только нижняя',
};

export const PRESET_SHORT: Record<ViewPreset, string> = {
  occlusalUpper: 'Верхняя ⌄',
  occlusalLower: 'Нижняя ⌃',
  front: 'Фронт',
  right: 'Справа',
  left: 'Слева',
  upperOnly: 'Только ВЧ',
  lowerOnly: 'Только НЧ',
};

const ISOLATED_JAW: Partial<Record<ViewPreset, 'upper' | 'lower'>> = {
  occlusalUpper: 'upper',
  upperOnly: 'upper',
  occlusalLower: 'lower',
  lowerOnly: 'lower',
};

/**
 * An occlusal view is only useful with the opposing arch out of the way, so a
 * preset drives both the camera and jaw visibility.
 */
export const applyViewPreset = (preset: ViewPreset) => {
  const { scans, setScan } = useScanStore.getState();
  const isolate = ISOLATED_JAW[preset] ?? null;
  scans.forEach((scan) =>
    setScan(scan.id, { visible: isolate === null || scan.jaw === isolate }),
  );
  viewportApi.current?.setPreset(preset);
};
