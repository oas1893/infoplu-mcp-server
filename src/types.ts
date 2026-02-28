// ─── Grid / Territory ────────────────────────────────────────────────────────

export interface Grid {
  name: string;
  title: string;
  type: string;
  rnu?: boolean;
  coastline?: boolean;
  approved?: boolean;
}

// ─── Document ─────────────────────────────────────────────────────────────────

export interface DocumentFile {
  name: string;
  title?: string;
  path: string;
}

export interface Document {
  id: string;
  originalName: string;
  type: string;
  supCategory?: string;
  status: string;
  statusDate: string;
  legalStatus: string;
  name: string;
  grid?: Grid;
  uploadDate: string;
  updateDate: string;
  fileIdentifier?: string;
}

export interface DocumentDetails extends Document {
  typeref?: string;
  files?: DocumentFile[];
  metadata?: string;
  protected?: boolean;
  writingMaterials?: Record<string, string>;
  archiveUrl?: string;
  title?: string;
  projectionCode?: string;
  producer?: string;
}

// ─── Procedure ────────────────────────────────────────────────────────────────

export interface Procedure {
  id: string;
  name: string;
  documentType: string;
  documentName: string;
  procedureType: string;
  approbationDate?: string;
  grid?: Grid;
  files?: DocumentFile[];
}

// ─── Standards / Models ───────────────────────────────────────────────────────

export interface DocumentModelSummary {
  id: string;
  name: string;
  title: string;
  description?: string;
  abstract: boolean;
  type: string;
  parent?: string;
}

export interface FeatureTypeAttribute {
  name: string;
  title: string;
  type: string;
  description?: string;
}

export interface FeatureType {
  name: string;
  title: string;
  description?: string;
  attributes: FeatureTypeAttribute[];
}

export interface DocumentModel extends DocumentModelSummary {
  featureTypes: FeatureType[];
}

export interface SupCategorie {
  name: string;
  libelle: string;
  libelleCourt: string;
  downloadable: boolean;
  urlFiche?: string;
}

export interface DuCategorie {
  type: string;
  code: string;
  sous_code?: string;
  libelong: string;
}

// ─── Feature Info (GeoJSON pruned) ────────────────────────────────────────────

export interface PrunedFeature {
  id?: string;
  type: "Feature";
  properties: Record<string, unknown>;
}

export interface PrunedFeatureCollection {
  type: "FeatureCollection";
  totalFeatures: number;
  features: PrunedFeature[];
}
