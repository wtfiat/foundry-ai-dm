export type IndexedSourceType = "journal-page" | "scene" | "actor" | "item" | "roll-table";

export interface ExtractedWorldSource {
  worldId: string;
  sourceId: string;
  uuid: string;
  type: IndexedSourceType;
  title: string;
  subtitle?: string;
  folderPath?: string;
  text: string;
  sourceHash: string;
}

export interface IndexedChunk {
  id: string;
  sourceId: string;
  worldId: string;
  uuid: string;
  type: IndexedSourceType;
  title: string;
  subtitle?: string;
  folderPath?: string;
  order: number;
  hash: string;
  text: string;
  embedding: number[];
}

export interface IndexedSourceRecord {
  worldId: string;
  sourceId: string;
  sourceHash: string;
  uuid: string;
  type: IndexedSourceType;
  title: string;
  subtitle?: string;
  folderPath?: string;
  updatedAt: number;
  chunks: IndexedChunk[];
}

export interface RetrievalIndexMeta {
  key: string;
  worldId: string;
  builtAt: number;
  sourceCount: number;
  chunkCount: number;
  sourceCounts: Partial<Record<IndexedSourceType, number>>;
  configHash: string;
  lastOperation: "build" | "refresh";
}

export interface RetrievalCitation {
  sourceId: string;
  uuid: string;
  title: string;
  subtitle?: string;
  type: IndexedSourceType;
  score: number;
  excerpt: string;
}

export interface RetrievedContext {
  ready: boolean;
  citations: RetrievalCitation[];
  promptContext: string;
  chunkCount: number;
}

export interface IndexProgressUpdate {
  phase: "extract" | "embed" | "store";
  message: string;
  current: number;
  total: number;
}

export interface IndexBuildSummary {
  mode: "build" | "refresh";
  sourceCount: number;
  chunkCount: number;
  newSourceCount: number;
  rebuiltSourceCount: number;
  reusedSourceCount: number;
  deletedSourceCount: number;
  warnings: string[];
  meta: RetrievalIndexMeta;
}
