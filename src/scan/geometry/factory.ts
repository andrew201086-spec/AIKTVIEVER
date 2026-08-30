import * as THREE from 'three';
import type { Restoration } from '../types';
import { classOfTooth, defaultImplantSize, dimsOfTooth } from '../data/fdi';
import {
  buildCrownGeometry,
  buildInlayGeometry,
  buildPonticGeometry,
  buildVeneerGeometry,
  type CrownShape,
} from './tooth';
import { buildAbutmentGeometry, buildImplantGeometry } from './implant';

const cache = new Map<string, THREE.BufferGeometry>();

const cacheKey = (item: Restoration) =>
  [
    item.type,
    classOfTooth(item.tooth),
    item.params.width.toFixed(2),
    item.params.depth.toFixed(2),
    item.params.height.toFixed(2),
    (item.params.thickness ?? 0).toFixed(2),
    (item.params.diameter ?? 0).toFixed(2),
    (item.params.length ?? 0).toFixed(2),
  ].join('|');

const build = (item: Restoration): THREE.BufferGeometry => {
  const shape: CrownShape = {
    toothClass: classOfTooth(item.tooth),
    width: item.params.width,
    depth: item.params.depth,
    height: item.params.height,
  };
  switch (item.type) {
    case 'crown':
      return buildCrownGeometry(shape);
    case 'pontic':
      return buildPonticGeometry(shape);
    case 'veneer':
      return buildVeneerGeometry(shape, item.params.thickness ?? 0.7);
    case 'inlay':
      return buildInlayGeometry(shape);
    case 'implant':
      return buildImplantGeometry({
        diameter: item.params.diameter ?? 4,
        length: item.params.length ?? 10,
      });
    case 'abutment':
      return buildAbutmentGeometry({
        platform: item.params.diameter ?? 4,
        gingivalHeight: 2,
        postHeight: Math.max(4, item.params.height * 0.6),
        crownWidth: item.params.width,
      });
    default:
      return buildCrownGeometry(shape);
  }
};

export const restorationGeometry = (item: Restoration): THREE.BufferGeometry => {
  const key = cacheKey(item);
  const hit = cache.get(key);
  if (hit) return hit;
  const geometry = build(item);
  cache.set(key, geometry);
  return geometry;
};

export const clearGeometryCache = () => {
  cache.forEach((g) => g.dispose());
  cache.clear();
};

/** Anatomically sensible starting parameters for a new restoration. */
export const defaultParams = (
  tooth: number,
  type: Restoration['type'],
): Restoration['params'] => {
  const dims = dimsOfTooth(tooth);
  const implant = defaultImplantSize(tooth);
  return {
    width: dims.width,
    depth: dims.depth,
    height: dims.height,
    thickness: type === 'veneer' ? 0.7 : undefined,
    diameter: type === 'implant' || type === 'abutment' ? implant.diameter : undefined,
    length: type === 'implant' ? implant.length : undefined,
  };
};
