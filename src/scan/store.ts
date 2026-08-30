import { create } from 'zustand';
import type {
  InteractionMode,
  MaterialId,
  Measurement,
  PatientInfo,
  PlanStage,
  Restoration,
  RestorationType,
  ScanMeta,
  Transform,
} from './types';
import { MATERIALS, DEFAULT_MATERIAL } from './data/materials';
import { defaultParams } from './geometry/factory';
import { jawOfTooth } from './data/fdi';
import { clearScans, removeScan } from './mesh/registry';
import { invalidatePlacementCache } from './mesh/placement';

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${counter++}`;

const today = () => new Date().toISOString().slice(0, 10);

const initialPatient = (): PatientInfo => ({
  name: '',
  chartId: '',
  date: today(),
  doctor: '',
  currency: '₽',
});

const initialStages = (): PlanStage[] => [
  { index: 1, title: 'Подготовка', description: 'Санация, снятие оттисков, диагностика' },
  { index: 2, title: 'Основной этап', description: 'Установка конструкций' },
  { index: 3, title: 'Результат', description: 'Итоговый вид улыбки' },
];

export interface ScanStore {
  patient: PatientInfo;
  scans: ScanMeta[];
  restorations: Restoration[];
  measurements: Measurement[];
  stages: PlanStage[];

  selectedId: string | null;
  selectedTooth: number | null;
  mode: InteractionMode;
  pendingType: RestorationType | null;
  gizmo: 'translate' | 'rotate' | 'scale';

  showArch: boolean;
  showBefore: boolean;
  presenting: boolean;
  presentationStage: number;
  autoRotate: boolean;
  statusMessage: string | null;
  clip: { enabled: boolean; axis: 'x' | 'y' | 'z'; offset: number; flip: boolean };

  setPatient: (patch: Partial<PatientInfo>) => void;
  addScan: (meta: ScanMeta) => void;
  dropScan: (id: string) => void;
  setScan: (id: string, patch: Partial<ScanMeta>) => void;

  addRestoration: (item: Restoration) => void;
  createRestoration: (
    tooth: number,
    type: RestorationType,
    transform: Transform,
    heightOverride?: number,
  ) => Restoration;
  updateRestoration: (id: string, patch: Partial<Restoration>) => void;
  updateParams: (id: string, patch: Partial<Restoration['params']>) => void;
  removeRestoration: (id: string) => void;
  duplicateRestoration: (id: string) => void;
  setMaterialForAll: (material: MaterialId) => void;
  splintSelection: (ids: string[]) => void;

  addMeasurement: (m: Measurement) => void;
  removeMeasurement: (id: string) => void;

  setStage: (index: number, patch: Partial<PlanStage>) => void;
  addStage: () => void;

  select: (id: string | null) => void;
  selectTooth: (tooth: number | null) => void;
  setMode: (mode: InteractionMode) => void;
  setPendingType: (type: RestorationType | null) => void;
  setGizmo: (gizmo: 'translate' | 'rotate' | 'scale') => void;

  toggleArch: () => void;
  setShowBefore: (value: boolean) => void;
  setPresenting: (value: boolean) => void;
  setPresentationStage: (index: number) => void;
  setAutoRotate: (value: boolean) => void;
  setStatus: (message: string | null) => void;
  setClip: (patch: Partial<ScanStore['clip']>) => void;

  loadCase: (payload: {
    patient: PatientInfo;
    scans: ScanMeta[];
    restorations: Restoration[];
    measurements: Measurement[];
    stages: PlanStage[];
  }) => void;
  resetCase: () => void;
}

export const useScanStore = create<ScanStore>((set, get) => ({
  patient: initialPatient(),
  scans: [],
  restorations: [],
  measurements: [],
  stages: initialStages(),

  selectedId: null,
  selectedTooth: null,
  mode: 'orbit',
  pendingType: null,
  gizmo: 'translate',

  showArch: false,
  showBefore: false,
  presenting: false,
  presentationStage: 0,
  autoRotate: false,
  statusMessage: null,
  clip: { enabled: false, axis: 'z', offset: 0, flip: false },

  setPatient: (patch) => set((s) => ({ patient: { ...s.patient, ...patch } })),

  addScan: (meta) =>
    set((s) => ({
      scans: [...s.scans.filter((x) => x.jaw !== meta.jaw), meta],
    })),

  dropScan: (id) => {
    removeScan(id);
    invalidatePlacementCache(id);
    set((s) => ({ scans: s.scans.filter((x) => x.id !== id) }));
  },

  setScan: (id, patch) =>
    set((s) => ({
      scans: s.scans.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),

  addRestoration: (item) =>
    set((s) => ({ restorations: [...s.restorations, item], selectedId: item.id })),

  createRestoration: (tooth, type, transform, heightOverride) => {
    const params = defaultParams(tooth, type);
    if (heightOverride) params.height = heightOverride;
    const material = DEFAULT_MATERIAL[type];
    const item: Restoration = {
      id: nextId('r'),
      type,
      tooth,
      jaw: jawOfTooth(tooth),
      material,
      stage: Math.max(1, Math.min(get().stages.length, 2)),
      transform,
      params,
      price: MATERIALS[material].price,
      visible: true,
    };
    get().addRestoration(item);
    return item;
  },

  updateRestoration: (id, patch) =>
    set((s) => ({
      restorations: s.restorations.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),

  updateParams: (id, patch) =>
    set((s) => ({
      restorations: s.restorations.map((x) =>
        x.id === id ? { ...x, params: { ...x.params, ...patch } } : x,
      ),
    })),

  removeRestoration: (id) =>
    set((s) => ({
      restorations: s.restorations.filter((x) => x.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),

  duplicateRestoration: (id) =>
    set((s) => {
      const source = s.restorations.find((x) => x.id === id);
      if (!source) return {};
      const copy: Restoration = {
        ...source,
        id: nextId('r'),
        transform: {
          ...source.transform,
          position: [
            source.transform.position[0] + source.params.width,
            source.transform.position[1],
            source.transform.position[2],
          ],
        },
      };
      return { restorations: [...s.restorations, copy], selectedId: copy.id };
    }),

  setMaterialForAll: (material) =>
    set((s) => ({
      restorations: s.restorations.map((x) =>
        x.type === 'implant' || x.type === 'abutment'
          ? x
          : { ...x, material, price: MATERIALS[material].price },
      ),
    })),

  splintSelection: (ids) =>
    set((s) => {
      const bridgeId = nextId('bridge');
      return {
        restorations: s.restorations.map((x) =>
          ids.includes(x.id) ? { ...x, bridgeId } : x,
        ),
      };
    }),

  addMeasurement: (m) => set((s) => ({ measurements: [...s.measurements, m] })),
  removeMeasurement: (id) =>
    set((s) => ({ measurements: s.measurements.filter((x) => x.id !== id) })),

  setStage: (index, patch) =>
    set((s) => ({
      stages: s.stages.map((x) => (x.index === index ? { ...x, ...patch } : x)),
    })),

  addStage: () =>
    set((s) => ({
      stages: [
        ...s.stages,
        {
          index: s.stages.length + 1,
          title: `Этап ${s.stages.length + 1}`,
          description: '',
        },
      ],
    })),

  select: (id) => set({ selectedId: id }),
  selectTooth: (tooth) => set({ selectedTooth: tooth }),
  setMode: (mode) => set({ mode, pendingType: mode === 'place' ? get().pendingType : null }),
  setPendingType: (type) => set({ pendingType: type, mode: type ? 'place' : 'orbit' }),
  setGizmo: (gizmo) => set({ gizmo }),

  toggleArch: () => set((s) => ({ showArch: !s.showArch })),
  setShowBefore: (value) => set({ showBefore: value }),
  setPresenting: (value) =>
    set({ presenting: value, presentationStage: 0, showBefore: value ? true : false }),
  setPresentationStage: (index) => set({ presentationStage: index }),
  setAutoRotate: (value) => set({ autoRotate: value }),
  setStatus: (message) => set({ statusMessage: message }),
  setClip: (patch) => set((s) => ({ clip: { ...s.clip, ...patch } })),

  loadCase: (payload) =>
    set({
      patient: payload.patient,
      scans: payload.scans,
      restorations: payload.restorations,
      measurements: payload.measurements,
      stages: payload.stages.length > 0 ? payload.stages : initialStages(),
      selectedId: null,
      selectedTooth: null,
      mode: 'orbit',
      pendingType: null,
      showBefore: false,
      presenting: false,
    }),

  resetCase: () => {
    clearScans();
    invalidatePlacementCache();
    set({
      patient: initialPatient(),
      scans: [],
      restorations: [],
      measurements: [],
      stages: initialStages(),
      selectedId: null,
      selectedTooth: null,
      mode: 'orbit',
      pendingType: null,
      showBefore: false,
      presenting: false,
      statusMessage: null,
    });
  },
}));

export const totalPrice = (restorations: Restoration[]): number =>
  restorations.reduce((sum, item) => sum + (item.price || 0), 0);
