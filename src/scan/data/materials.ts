import * as THREE from 'three';
import type { MaterialId, RestorationType } from '../types';

export interface MaterialSpec {
  id: MaterialId;
  label: string;
  color: string;
  roughness: number;
  metalness: number;
  /** Physical transmission — gives lithium disilicate its translucency. */
  transmission: number;
  clearcoat: number;
  /** Indicative price per unit, editable by the clinic. */
  price: number;
}

export const MATERIALS: Record<MaterialId, MaterialSpec> = {
  zirconia: {
    id: 'zirconia',
    label: 'Диоксид циркония',
    color: '#f2ece3',
    roughness: 0.28,
    metalness: 0,
    transmission: 0.12,
    clearcoat: 0.6,
    price: 22000,
  },
  emax: {
    id: 'emax',
    label: 'Стеклокерамика (e.max)',
    color: '#f6f1e7',
    roughness: 0.16,
    metalness: 0,
    transmission: 0.42,
    clearcoat: 0.8,
    price: 26000,
  },
  pfm: {
    id: 'pfm',
    label: 'Металлокерамика',
    color: '#ece5da',
    roughness: 0.35,
    metalness: 0.05,
    transmission: 0,
    clearcoat: 0.45,
    price: 14000,
  },
  gold: {
    id: 'gold',
    label: 'Золотой сплав',
    color: '#d8ab52',
    roughness: 0.25,
    metalness: 0.95,
    transmission: 0,
    clearcoat: 0.2,
    price: 32000,
  },
  composite: {
    id: 'composite',
    label: 'Композит / временная',
    color: '#efe4d2',
    roughness: 0.5,
    metalness: 0,
    transmission: 0.05,
    clearcoat: 0.25,
    price: 6000,
  },
  titanium: {
    id: 'titanium',
    label: 'Титан',
    color: '#b9bcc0',
    roughness: 0.4,
    metalness: 0.9,
    transmission: 0,
    clearcoat: 0.1,
    price: 35000,
  },
};

export const MATERIAL_LIST = Object.values(MATERIALS);

export const RESTORATION_LABEL: Record<RestorationType, string> = {
  crown: 'Коронка',
  veneer: 'Винир',
  pontic: 'Промежуточная часть моста',
  implant: 'Имплантат',
  abutment: 'Абатмент',
  inlay: 'Вкладка',
};

export const DEFAULT_MATERIAL: Record<RestorationType, MaterialId> = {
  crown: 'zirconia',
  veneer: 'emax',
  pontic: 'zirconia',
  implant: 'titanium',
  abutment: 'titanium',
  inlay: 'emax',
};

const cache = new Map<string, THREE.MeshPhysicalMaterial>();

/** Shared physical material per (material, highlight) pair. */
export const restorationMaterial = (
  id: MaterialId,
  highlight: boolean,
): THREE.MeshPhysicalMaterial => {
  const key = `${id}:${highlight}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const spec = MATERIALS[id];
  const material = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(spec.color),
    roughness: spec.roughness,
    metalness: spec.metalness,
    transmission: spec.transmission,
    thickness: spec.transmission > 0 ? 1.2 : 0,
    clearcoat: spec.clearcoat,
    clearcoatRoughness: 0.2,
    ior: 1.55,
    emissive: new THREE.Color(highlight ? '#1d6fd0' : '#000000'),
    emissiveIntensity: highlight ? 0.35 : 0,
    side: THREE.DoubleSide,
  });
  cache.set(key, material);
  return material;
};

export const disposeMaterialCache = () => {
  cache.forEach((m) => m.dispose());
  cache.clear();
};
