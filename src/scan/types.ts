/** Domain model for the intraoral-scan viewer and treatment plan. */

export type JawKind = 'upper' | 'lower';

/** FDI tooth number, e.g. 11..18, 21..28, 31..38, 41..48. */
export type ToothNumber = number;

export type ToothClass = 'incisor' | 'canine' | 'premolar' | 'molar';

export type RestorationType =
  | 'crown'
  | 'veneer'
  | 'pontic'
  | 'implant'
  | 'abutment'
  | 'inlay';

export type MaterialId =
  | 'zirconia'
  | 'emax'
  | 'pfm'
  | 'gold'
  | 'composite'
  | 'titanium';

/** Serialisable rigid transform of a restoration in scene (millimetre) space. */
export interface Transform {
  position: [number, number, number];
  /** Euler XYZ, radians. */
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface Restoration {
  id: string;
  type: RestorationType;
  tooth: ToothNumber;
  jaw: JawKind;
  material: MaterialId;
  /** Stage index (1-based) used to break the plan into presentation steps. */
  stage: number;
  transform: Transform;
  /** Per-item geometry overrides in millimetres. */
  params: RestorationParams;
  /** Free-text note shown to the patient. */
  note?: string;
  /** Price in the clinic's currency; 0 means "not quoted". */
  price: number;
  visible: boolean;
  /** Bridge grouping id — restorations sharing it are splinted together. */
  bridgeId?: string;
}

export interface RestorationParams {
  /** Mesiodistal width. */
  width: number;
  /** Buccolingual depth. */
  depth: number;
  /** Occlusogingival height. */
  height: number;
  /** Veneer / inlay shell thickness. */
  thickness?: number;
  /** Implant fixture diameter. */
  diameter?: number;
  /** Implant fixture length. */
  length?: number;
}

export interface Measurement {
  id: string;
  kind: 'distance' | 'angle';
  points: [number, number, number][];
  label: string;
}

export interface ScanMeta {
  id: string;
  jaw: JawKind;
  fileName: string;
  vertexCount: number;
  triangleCount: number;
  hasVertexColors: boolean;
  visible: boolean;
  opacity: number;
  /** Bumped whenever the baked geometry changes, to refresh derived views. */
  geomVersion: number;
}

export interface PatientInfo {
  name: string;
  chartId: string;
  date: string;
  doctor: string;
  currency: string;
}

export interface PlanStage {
  index: number;
  title: string;
  description: string;
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export type ViewPreset =
  | 'occlusalUpper'
  | 'occlusalLower'
  | 'front'
  | 'right'
  | 'left'
  | 'upperOnly'
  | 'lowerOnly';

export type InteractionMode = 'orbit' | 'place' | 'measure';

export interface CaseManifest {
  version: 1;
  app: string;
  savedAt: string;
  patient: PatientInfo;
  scans: ScanMeta[];
  restorations: Restoration[];
  measurements: Measurement[];
  stages: PlanStage[];
}
