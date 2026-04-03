import { DEFAULT_KEEP_ALIVE } from "../constants.ts";
import { logger } from "../logger.ts";
import { OllamaClient } from "../ollama/client.ts";
import { AIDMSettings } from "../settings.ts";
import { extractWorldSources } from "./extract.ts";
import { createExcerpt, chunkText, hashString, sourceTypeLabel } from "./text.ts";
import { getStoredMeta, getStoredSources, saveIndexState } from "./store.ts";
import {
  type IndexBuildSummary,
  type IndexProgressUpdate,
  type IndexedChunk,
  type IndexedSourceRecord,
  type RetrievalCitation,
  type RetrievedContext,
  type RetrievalIndexMeta,
} from "./types.ts";

const EMBEDDING_BATCH_SIZE = 12;
const MINIMUM_RETRIEVAL_SCORE = 0.15;

interface ChunkBuildPlan {
  sourceId: string;
  worldId: string;
  uuid: string;
  type: IndexedSourceRecord["type"];
  title: string;
  subtitle?: string;
  folderPath?: string;
  sourceHash: string;
  order: number;
  hash: string;
  text: string;
}

function getWorldId(): string {
  return game.world?.id ?? "unknown-world";
}

function buildConfigHash(): string {
  const clientSettings = AIDMSettings.getClientSettings();
  const worldSettings = AIDMSettings.getWorldSettings();

  return hashString(
    JSON.stringify({
      embeddingModel: clientSettings.embeddingModel,
      keepAlive: clientSettings.keepAlive,
      chunkSize: worldSettings.chunkSize,
      retrievalTopK: worldSettings.retrievalTopK,
      indexJournalEntries: worldSettings.indexJournalEntries,
      indexScenes: worldSettings.indexScenes,
      indexActors: worldSettings.indexActors,
      indexItems: worldSettings.indexItems,
      indexRollTables: worldSettings.indexRollTables,
    }),
  );
}

function getEmbeddingClient(): OllamaClient {
  const clientSettings = AIDMSettings.getClientSettings();
  return new OllamaClient({
    baseUrl: clientSettings.ollamaBaseUrl,
    timeoutMs: clientSettings.requestTimeoutMs,
  });
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return Number.NEGATIVE_INFINITY;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function buildChunkPlans(records: Array<{
  worldId: string;
  sourceId: string;
  uuid: string;
  type: IndexedSourceRecord["type"];
  title: string;
  subtitle?: string;
  folderPath?: string;
  sourceHash: string;
  text: string;
}>): ChunkBuildPlan[] {
  const chunkSize = AIDMSettings.getWorldSettings().chunkSize;
  const plans: ChunkBuildPlan[] = [];

  for (const record of records) {
    const chunks = chunkText(record.text, chunkSize);

    for (const [index, chunkTextValue] of chunks.entries()) {
      plans.push({
        sourceId: record.sourceId,
        worldId: record.worldId,
        uuid: record.uuid,
        type: record.type,
        title: record.title,
        subtitle: record.subtitle,
        folderPath: record.folderPath,
        sourceHash: record.sourceHash,
        order: index,
        hash: hashString(`${record.sourceHash}:${String(index)}:${chunkTextValue}`),
        text: chunkTextValue,
      });
    }
  }

  return plans;
}

function buildSourceRecords(
  plans: ChunkBuildPlan[],
  embeddings: number[][],
): IndexedSourceRecord[] {
  const grouped = new Map<string, IndexedSourceRecord>();

  for (const [index, plan] of plans.entries()) {
    const embedding = embeddings[index] ?? [];
    const chunk: IndexedChunk = {
      id: `${plan.sourceId}::${String(plan.order)}`,
      sourceId: plan.sourceId,
      worldId: plan.worldId,
      uuid: plan.uuid,
      type: plan.type,
      title: plan.title,
      subtitle: plan.subtitle,
      folderPath: plan.folderPath,
      order: plan.order,
      hash: plan.hash,
      text: plan.text,
      embedding,
    };

    const existing = grouped.get(plan.sourceId);
    if (existing == null) {
      grouped.set(plan.sourceId, {
        worldId: plan.worldId,
        sourceId: plan.sourceId,
        sourceHash: plan.sourceHash,
        uuid: plan.uuid,
        type: plan.type,
        title: plan.title,
        subtitle: plan.subtitle,
        folderPath: plan.folderPath,
        updatedAt: Date.now(),
        chunks: [chunk],
      });
      continue;
    }

    existing.chunks.push(chunk);
  }

  return [...grouped.values()].map((record) => ({
    ...record,
    chunks: [...record.chunks].sort((left, right) => left.order - right.order),
  }));
}

function countSourceTypes(records: IndexedSourceRecord[]): Partial<Record<IndexedSourceRecord["type"], number>> {
  const counts: Partial<Record<IndexedSourceRecord["type"], number>> = {};

  for (const record of records) {
    const currentCount = counts[record.type] ?? 0;
    counts[record.type] = currentCount + 1;
  }

  return counts;
}

function buildMeta(
  records: IndexedSourceRecord[],
  input: {
    worldId: string;
    configHash: string;
    mode: "build" | "refresh";
  },
): RetrievalIndexMeta {
  return {
    key: input.worldId,
    worldId: input.worldId,
    builtAt: Date.now(),
    sourceCount: records.length,
    chunkCount: records.reduce((total, record) => total + record.chunks.length, 0),
    sourceCounts: countSourceTypes(records),
    configHash: input.configHash,
    lastOperation: input.mode,
  };
}

async function embedTexts(
  chunkPlans: ChunkBuildPlan[],
  onProgress?: (update: IndexProgressUpdate) => void,
): Promise<number[][]> {
  if (chunkPlans.length === 0) {
    return [];
  }

  const client = getEmbeddingClient();
  const clientSettings = AIDMSettings.getClientSettings();
  const embeddings: number[][] = [];

  for (let offset = 0; offset < chunkPlans.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = chunkPlans.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    onProgress?.({
      phase: "embed",
      message: `Embedding chunks ${String(offset + 1)}-${String(Math.min(offset + batch.length, chunkPlans.length))} of ${String(chunkPlans.length)}`,
      current: Math.min(offset + batch.length, chunkPlans.length),
      total: chunkPlans.length,
    });

    const response = await client.embed({
      model: clientSettings.embeddingModel,
      input: batch.map((plan) => plan.text),
      keep_alive: clientSettings.keepAlive || DEFAULT_KEEP_ALIVE,
    });

    embeddings.push(...response.embeddings);
  }

  return embeddings;
}

export async function getRetrievalIndexMeta(): Promise<RetrievalIndexMeta | null> {
  return getStoredMeta(getWorldId());
}

export async function buildWorldIndex(input: {
  mode: "build" | "refresh";
  onProgress?: (update: IndexProgressUpdate) => void;
}): Promise<IndexBuildSummary> {
  const worldId = getWorldId();
  const configHash = buildConfigHash();
  const currentMeta = await getStoredMeta(worldId);
  const existingRecords = await getStoredSources(worldId);
  const { sources, warnings } = extractWorldSources();

  input.onProgress?.({
    phase: "extract",
    message: `Scanned ${String(sources.length)} world sources for indexing.`,
    current: sources.length,
    total: sources.length,
  });

  const fullRebuild = input.mode === "build" || currentMeta?.configHash !== configHash;
  const existingBySourceId = new Map(existingRecords.map((record) => [record.sourceId, record]));
  const extractedIds = new Set(sources.map((source) => source.sourceId));

  const deletedSourceIds = existingRecords
    .filter((record) => !extractedIds.has(record.sourceId))
    .map((record) => record.sourceId);

  const reusedRecords: IndexedSourceRecord[] = [];
  const recordsToBuild = sources.filter((source) => {
    if (fullRebuild) {
      return true;
    }

    const existing = existingBySourceId.get(source.sourceId);
    if (existing == null) {
      return true;
    }

    if (existing.sourceHash === source.sourceHash) {
      reusedRecords.push(existing);
      return false;
    }

    return true;
  });

  const chunkPlans = buildChunkPlans(recordsToBuild);
  const embeddings = await embedTexts(chunkPlans, input.onProgress);
  const rebuiltRecords = buildSourceRecords(chunkPlans, embeddings);
  const finalRecords = [...reusedRecords, ...rebuiltRecords].sort((left, right) =>
    left.title.localeCompare(right.title),
  );
  const meta = buildMeta(finalRecords, {
    worldId,
    configHash,
    mode: input.mode,
  });

  input.onProgress?.({
    phase: "store",
    message: `Saving ${String(finalRecords.length)} indexed sources.`,
    current: finalRecords.length,
    total: finalRecords.length,
  });

  await saveIndexState({
    worldId,
    records: finalRecords,
    deletedSourceIds,
    meta,
  });

  const existingSourceIds = new Set(existingRecords.map((record) => record.sourceId));
  const newSourceCount = rebuiltRecords.filter((record) => !existingSourceIds.has(record.sourceId)).length;
  const rebuiltSourceCount = rebuiltRecords.length - newSourceCount;

  logger.info("World index updated.", {
    mode: input.mode,
    sourceCount: meta.sourceCount,
    chunkCount: meta.chunkCount,
    newSourceCount,
    rebuiltSourceCount,
    reusedSourceCount: reusedRecords.length,
    deletedSourceCount: deletedSourceIds.length,
  });

  return {
    mode: input.mode,
    sourceCount: meta.sourceCount,
    chunkCount: meta.chunkCount,
    newSourceCount,
    rebuiltSourceCount,
    reusedSourceCount: reusedRecords.length,
    deletedSourceCount: deletedSourceIds.length,
    warnings,
    meta,
  };
}

export async function retrieveIndexedContext(query: string): Promise<RetrievedContext> {
  const worldId = getWorldId();
  const meta = await getStoredMeta(worldId);
  if (meta == null || meta.chunkCount === 0) {
    return {
      ready: false,
      citations: [],
      promptContext: "",
      chunkCount: 0,
    };
  }

  const normalizedQuery = query.trim();
  if (normalizedQuery.length === 0) {
    return {
      ready: true,
      citations: [],
      promptContext: "",
      chunkCount: 0,
    };
  }

  const sourceRecords = await getStoredSources(worldId);
  const chunks = sourceRecords.flatMap((record) => record.chunks);
  if (chunks.length === 0) {
    return {
      ready: true,
      citations: [],
      promptContext: "",
      chunkCount: 0,
    };
  }

  const client = getEmbeddingClient();
  const clientSettings = AIDMSettings.getClientSettings();
  const embeddingResponse = await client.embed({
    model: clientSettings.embeddingModel,
    input: [normalizedQuery],
    keep_alive: clientSettings.keepAlive || DEFAULT_KEEP_ALIVE,
  });
  const queryEmbedding = embeddingResponse.embeddings[0] ?? [];

  const rankedChunks = chunks
    .map((chunk) => ({
      chunk,
      score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }))
    .filter((match) => Number.isFinite(match.score) && match.score >= MINIMUM_RETRIEVAL_SCORE)
    .sort((left, right) => right.score - left.score)
    .slice(0, AIDMSettings.getWorldSettings().retrievalTopK);

  if (rankedChunks.length === 0) {
    return {
      ready: true,
      citations: [],
      promptContext: "",
      chunkCount: 0,
    };
  }

  const citationMap = new Map<string, RetrievalCitation>();
  for (const match of rankedChunks) {
    if (citationMap.has(match.chunk.sourceId)) {
      continue;
    }

    citationMap.set(match.chunk.sourceId, {
      sourceId: match.chunk.sourceId,
      uuid: match.chunk.uuid,
      title: match.chunk.title,
      subtitle: match.chunk.subtitle,
      type: match.chunk.type,
      score: match.score,
      excerpt: createExcerpt(match.chunk.text, 180),
    });

    if (citationMap.size >= 4) {
      break;
    }
  }

  const citations = [...citationMap.values()];
  const promptContext = rankedChunks
    .map(({ chunk, score }, index) => {
      const header = `${String(index + 1)}. ${sourceTypeLabel(chunk.type)}: ${chunk.title}${chunk.subtitle != null ? ` / ${chunk.subtitle}` : ""}`;
      const scoreSuffix = Number.isFinite(score) ? ` (similarity ${score.toFixed(3)})` : "";
      return `${header}${scoreSuffix}\n${chunk.text}`;
    })
    .join("\n\n");

  return {
    ready: true,
    citations,
    promptContext,
    chunkCount: rankedChunks.length,
  };
}
