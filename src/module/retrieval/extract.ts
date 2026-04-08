import { AIDMSettings } from "../settings.ts";
import { hashString, joinSections, textFromUnknown } from "./text.ts";
import { type ExtractedWorldSource, type IndexedSourceType } from "./types.ts";

interface ExtractWorldSourcesResult {
  sources: ExtractedWorldSource[];
  warnings: string[];
}

type MaybeDocument = {
  id?: string | null;
  uuid?: string;
  name?: string | null;
  type?: string | null;
  folder?: Folder | null;
  pages?: { contents?: unknown[] };
  items?: { contents?: unknown[] };
  results?: { contents?: unknown[] };
  notes?: { contents?: unknown[] } | unknown[];
  tokens?: { contents?: unknown[] };
  navName?: string | null;
};

function getWorldId(): string {
  return game.world?.id ?? "unknown-world";
}

function getFolderPath(folder: Folder | null | undefined): string | undefined {
  const names: string[] = [];
  let current = folder;

  while (current != null) {
    names.unshift(current.name);
    current = current.folder;
  }

  return names.length > 0 ? names.join(" / ") : undefined;
}

function readString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function propertyText(record: unknown, path: string): string | null {
  if (typeof record !== "object" || record == null) {
    return null;
  }

  return textFromUnknown(foundry.utils.getProperty(record, path));
}

function createSourceRecord(input: {
  worldId: string;
  sourceId: string;
  uuid: string;
  type: IndexedSourceType;
  title: string;
  subtitle?: string;
  folderPath?: string;
  text: string;
}): ExtractedWorldSource {
  const sourceHash = hashString(
    JSON.stringify({
      type: input.type,
      title: input.title,
      subtitle: input.subtitle,
      folderPath: input.folderPath,
      text: input.text,
    }),
  );

  return {
    ...input,
    sourceHash,
  };
}

function readCollectionContents<T>(value: { contents?: T[] } | T[] | null | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }

  return value?.contents ?? [];
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const normalized = values
    .map((value) => readString(value))
    .filter((value): value is string => value != null);
  return [...new Set(normalized)];
}

function buildDocumentUuid(document: MaybeDocument, fallbackPrefix: string): string {
  return readString(document.uuid) ?? `${fallbackPrefix}.${readString(document.id) ?? crypto.randomUUID()}`;
}

function getJournalSources(worldId: string): ExtractedWorldSource[] {
  if (!AIDMSettings.getWorldSettings().indexJournalEntries) {
    return [];
  }

  const journals = (game.journal?.contents ?? []) as MaybeDocument[];
  const sources: ExtractedWorldSource[] = [];

  for (const journal of journals) {
    const journalTitle = readString(journal.name) ?? "Untitled Journal";
    const folderPath = getFolderPath(journal.folder ?? null);
    const journalUuid = buildDocumentUuid(journal, "JournalEntry");
    const pages = readCollectionContents(journal.pages);

    if (pages.length === 0) {
      const fallbackText = joinSections([
        `Journal entry: ${journalTitle}`,
        folderPath != null ? `Folder: ${folderPath}` : null,
        propertyText(journal, "content"),
        propertyText(journal, "text.content"),
      ]);

      if (fallbackText.length > 0) {
        sources.push(
          createSourceRecord({
            worldId,
            sourceId: journalUuid,
            uuid: journalUuid,
            type: "journal-page",
            title: journalTitle,
            folderPath,
            text: fallbackText,
          }),
        );
      }
      continue;
    }

    for (const pageValue of pages) {
      const page = pageValue as MaybeDocument;
      const pageType = readString(page.type) ?? "text";
      if (!["text", "markdown", "html"].includes(pageType)) {
        continue;
      }

      const pageTitle = readString(page.name) ?? "Untitled Page";
      const pageUuid = buildDocumentUuid(page, journalUuid);
      const pageText = joinSections([
        `Journal entry: ${journalTitle}`,
        `Page: ${pageTitle}`,
        folderPath != null ? `Folder: ${folderPath}` : null,
        propertyText(page, "text.content"),
        propertyText(page, "text.markdown"),
        propertyText(page, "markdown"),
        propertyText(page, "content"),
      ]);

      if (pageText.length === 0) {
        continue;
      }

      sources.push(
        createSourceRecord({
          worldId,
          sourceId: pageUuid,
          uuid: pageUuid,
          type: "journal-page",
          title: journalTitle,
          subtitle: pageTitle,
          folderPath,
          text: pageText,
        }),
      );
    }
  }

  return sources;
}

function getSceneSources(worldId: string): ExtractedWorldSource[] {
  if (!AIDMSettings.getWorldSettings().indexScenes) {
    return [];
  }

  const scenes = (game.scenes?.contents ?? []) as MaybeDocument[];
  const sources: ExtractedWorldSource[] = [];

  for (const scene of scenes) {
    const sceneTitle = readString(scene.name) ?? "Untitled Scene";
    const folderPath = getFolderPath(scene.folder ?? null);
    const sceneUuid = buildDocumentUuid(scene, "Scene");
    const tokenNames = uniqueStrings(
      readCollectionContents(scene.tokens).map((token) => {
        const tokenRecord = token as Record<string, unknown>;
        return readString(tokenRecord["name"]) ?? propertyText(tokenRecord, "actor.name");
      }),
    );
    const noteLabels = uniqueStrings(
      readCollectionContents(scene.notes).map((note) => {
        const noteRecord = note as Record<string, unknown>;
        return readString(noteRecord["text"]) ?? readString(noteRecord["label"]) ?? readString(noteRecord["entryId"]);
      }),
    );

    const sceneText = joinSections([
      `Scene: ${sceneTitle}`,
      folderPath != null ? `Folder: ${folderPath}` : null,
      readString(scene.navName) != null && readString(scene.navName) !== sceneTitle
        ? `Navigation name: ${readString(scene.navName)}`
        : null,
      tokenNames.length > 0 ? `Scene tokens: ${tokenNames.join(", ")}` : null,
      noteLabels.length > 0 ? `Scene notes: ${noteLabels.join(", ")}` : null,
      propertyText(scene, "description"),
      propertyText(scene, "journal"),
    ]);

    if (sceneText.length === 0) {
      continue;
    }

    sources.push(
      createSourceRecord({
        worldId,
        sourceId: sceneUuid,
        uuid: sceneUuid,
        type: "scene",
        title: sceneTitle,
        folderPath,
        text: sceneText,
      }),
    );
  }

  return sources;
}

function getActorSources(worldId: string): ExtractedWorldSource[] {
  if (!AIDMSettings.getWorldSettings().indexActors) {
    return [];
  }

  const actors = (game.actors?.contents ?? []) as MaybeDocument[];
  const sources: ExtractedWorldSource[] = [];

  for (const actor of actors) {
    const actorTitle = readString(actor.name) ?? "Unnamed Actor";
    const actorType = readString(actor.type);
    const folderPath = getFolderPath(actor.folder ?? null);
    const actorUuid = buildDocumentUuid(actor, "Actor");
    const itemNames = uniqueStrings(
      readCollectionContents(actor.items).map((item) => readString((item as MaybeDocument).name)),
    ).slice(0, 40);

    const actorText = joinSections([
      `Actor: ${actorTitle}`,
      actorType != null ? `Type: ${actorType}` : null,
      folderPath != null ? `Folder: ${folderPath}` : null,
      propertyText(actor, "system.details.biography.value"),
      propertyText(actor, "system.details.biography.public"),
      propertyText(actor, "system.description.value"),
      propertyText(actor, "system.details.appearance"),
      propertyText(actor, "system.details.trait"),
      propertyText(actor, "system.details.ideal"),
      propertyText(actor, "system.details.bond"),
      propertyText(actor, "system.details.flaw"),
      itemNames.length > 0 ? `Items and features: ${itemNames.join(", ")}` : null,
    ]);

    if (actorText.length === 0) {
      continue;
    }

    sources.push(
      createSourceRecord({
        worldId,
        sourceId: actorUuid,
        uuid: actorUuid,
        type: "actor",
        title: actorTitle,
        subtitle: actorType ?? undefined,
        folderPath,
        text: actorText,
      }),
    );
  }

  return sources;
}

function getItemSources(worldId: string): ExtractedWorldSource[] {
  if (!AIDMSettings.getWorldSettings().indexItems) {
    return [];
  }

  const items = (game.items?.contents ?? []) as MaybeDocument[];
  const sources: ExtractedWorldSource[] = [];

  for (const item of items) {
    const itemTitle = readString(item.name) ?? "Unnamed Item";
    const itemType = readString(item.type);
    const folderPath = getFolderPath(item.folder ?? null);
    const itemUuid = buildDocumentUuid(item, "Item");

    const itemText = joinSections([
      `Item: ${itemTitle}`,
      itemType != null ? `Type: ${itemType}` : null,
      folderPath != null ? `Folder: ${folderPath}` : null,
      propertyText(item, "system.description.value"),
      propertyText(item, "system.description.chat"),
      propertyText(item, "description"),
    ]);

    if (itemText.length === 0) {
      continue;
    }

    sources.push(
      createSourceRecord({
        worldId,
        sourceId: itemUuid,
        uuid: itemUuid,
        type: "item",
        title: itemTitle,
        subtitle: itemType ?? undefined,
        folderPath,
        text: itemText,
      }),
    );
  }

  return sources;
}

function getRollTableSources(worldId: string): ExtractedWorldSource[] {
  if (!AIDMSettings.getWorldSettings().indexRollTables) {
    return [];
  }

  const tables = (game.tables?.contents ?? []) as MaybeDocument[];
  const sources: ExtractedWorldSource[] = [];

  for (const table of tables) {
    const tableTitle = readString(table.name) ?? "Unnamed Roll Table";
    const folderPath = getFolderPath(table.folder ?? null);
    const tableUuid = buildDocumentUuid(table, "RollTable");
    const results = uniqueStrings(
      readCollectionContents(table.results).map((result) => {
        const resultRecord = result as Record<string, unknown>;
        return (
          readString(resultRecord["text"]) ??
          propertyText(resultRecord, "documentCollection") ??
          propertyText(resultRecord, "documentId")
        );
      }),
    );

    const tableText = joinSections([
      `Roll table: ${tableTitle}`,
      folderPath != null ? `Folder: ${folderPath}` : null,
      propertyText(table, "description"),
      results.length > 0 ? `Results: ${results.join("; ")}` : null,
    ]);

    if (tableText.length === 0) {
      continue;
    }

    sources.push(
      createSourceRecord({
        worldId,
        sourceId: tableUuid,
        uuid: tableUuid,
        type: "roll-table",
        title: tableTitle,
        folderPath,
        text: tableText,
      }),
    );
  }

  return sources;
}

export function extractWorldSources(): ExtractWorldSourcesResult {
  const worldId = getWorldId();
  const warnings: string[] = [];

  const sources = [
    ...getJournalSources(worldId),
    ...getSceneSources(worldId),
    ...getActorSources(worldId),
    ...getItemSources(worldId),
    ...getRollTableSources(worldId),
  ].filter((source) => source.text.trim().length > 0);

  if (sources.length === 0) {
    warnings.push("No indexable world text was found in the currently enabled document types.");
  }

  const uniqueSources = new Map<string, ExtractedWorldSource>();
  for (const source of sources) {
    uniqueSources.set(source.sourceId, source);
  }

  return {
    sources: [...uniqueSources.values()],
    warnings,
  };
}
