import { MODULE_ID, MODULE_TITLE } from "./constants.ts";
import { logger } from "./logger.ts";
import { createExcerpt } from "./retrieval/text.ts";

export type JournalSaveKind = "recap" | "memory";
export type JournalSaveMode = "narrate" | "npc" | "lore" | "recap";

export interface JournalSaveSource {
  uuid: string;
  label: string;
  detail: string;
  excerpt: string;
}

export interface SaveAIDMJournalEntryInput {
  kind: JournalSaveKind;
  mode: JournalSaveMode;
  content: string;
  modelName: string;
  sources: JournalSaveSource[];
  transcriptEntryId: string;
  requestedTitle?: string;
}

export interface SavedAIDMJournalEntry {
  kind: JournalSaveKind;
  entryName: string;
  pageName: string;
  journalUuid: string | null;
  pageUuid: string | null;
  folderPath: string;
  savedAt: number;
}

interface FolderLike {
  id?: string | null;
  name: string;
  type?: string | null;
  folder?: FolderLike | null;
}

interface JournalPageLike {
  id?: string | null;
  uuid?: string;
}

interface JournalEntryLike {
  id?: string | null;
  uuid?: string;
  name?: string | null;
  pages?: { contents?: JournalPageLike[] };
}

type FolderStatic = {
  create: (data: Record<string, unknown>) => Promise<FolderLike>;
};

type JournalEntryStatic = {
  create: (data: Record<string, unknown>) => Promise<JournalEntryLike>;
};

const ROOT_FOLDER_NAME = "AI DM";
const RECAP_FOLDER_NAME = "Session Recaps";
const MEMORY_FOLDER_NAME = "Memory Notes";

function getFolderStatic(): FolderStatic {
  return Folder as unknown as FolderStatic;
}

function getJournalStatic(): JournalEntryStatic {
  return JournalEntry as unknown as JournalEntryStatic;
}

function getAllFolders(): FolderLike[] {
  return ((game.folders?.contents ?? []) as unknown[])
    .map((folder) => folder as FolderLike)
    .filter((folder) => folder.type === "JournalEntry");
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function textToHtml(value: string): string {
  const paragraphs = value
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) {
    return `<p>${escapeHtml(value.trim())}</p>`;
  }

  return paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("\n");
}

function nowLabel(savedAt: number): string {
  return new Date(savedAt).toLocaleString();
}

function nowNameSuffix(savedAt: number): string {
  const date = new Date(savedAt);
  const pad = (input: number): string => String(input).padStart(2, "0");
  return [
    String(date.getFullYear()),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + ` ${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function defaultMemoryTitle(content: string): string {
  const firstLine = content
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (firstLine != null) {
    return createExcerpt(firstLine, 64);
  }

  return "Campaign Memory";
}

function normalizeEntryName(input: { kind: JournalSaveKind; content: string; requestedTitle?: string; savedAt: number }): string {
  const timestamp = nowNameSuffix(input.savedAt);

  if (input.kind === "recap") {
    return `Recap ${timestamp}`;
  }

  const requested = readString(input.requestedTitle);
  const base = requested ?? defaultMemoryTitle(input.content);
  return `Memory - ${base} - ${timestamp}`;
}

function buildPageName(kind: JournalSaveKind, mode: JournalSaveMode): string {
  if (kind === "recap") {
    return "Session Recap";
  }

  return `Memory Note (${mode})`;
}

function kindLabel(kind: JournalSaveKind): string {
  return kind === "recap" ? "Session Recap" : "Memory Note";
}

function modeLabel(mode: JournalSaveMode): string {
  switch (mode) {
    case "narrate":
      return "Narrate Scene";
    case "npc":
      return "NPC Voice";
    case "lore":
      return "Lore / World Q&A";
    case "recap":
      return "Session Recap";
  }
}

function findFolder(name: string, parentId: string | null): FolderLike | null {
  return (
    getAllFolders().find(
      (folder) => folder.name === name && (folder.folder?.id ?? null) === parentId,
    ) ?? null
  );
}

async function ensureFolder(name: string, parentId: string | null): Promise<FolderLike> {
  const existing = findFolder(name, parentId);
  if (existing != null) {
    return existing;
  }

  return getFolderStatic().create({
    name,
    type: "JournalEntry",
    folder: parentId,
    color: null,
    sorting: "a",
  });
}

async function ensureJournalTarget(kind: JournalSaveKind): Promise<{ folderId: string | null; folderPath: string }> {
  const rootFolder = await ensureFolder(ROOT_FOLDER_NAME, null);
  const childFolder = await ensureFolder(kind === "recap" ? RECAP_FOLDER_NAME : MEMORY_FOLDER_NAME, rootFolder.id ?? null);

  return {
    folderId: childFolder.id ?? null,
    folderPath: `${ROOT_FOLDER_NAME} / ${childFolder.name}`,
  };
}

function buildSourceSection(sources: JournalSaveSource[]): string {
  if (sources.length === 0) {
    return "<p><strong>Retrieved sources:</strong> None attached to this response.</p>";
  }

  const items = sources
    .map((source) => {
      const detail = source.detail.length > 0 ? ` <em>${escapeHtml(source.detail)}</em>` : "";
      return `<li><strong>${escapeHtml(source.label)}</strong>${detail}<br>${escapeHtml(source.excerpt)}</li>`;
    })
    .join("\n");

  return `<p><strong>Retrieved sources:</strong></p>\n<ul>${items}</ul>`;
}

function buildJournalHtml(input: SaveAIDMJournalEntryInput & { entryName: string; pageName: string; savedAt: number }): string {
  return [
    `<h1>${escapeHtml(input.entryName)}</h1>`,
    `<p><strong>Saved by:</strong> ${escapeHtml(MODULE_TITLE)}</p>`,
    `<p><strong>Kind:</strong> ${escapeHtml(kindLabel(input.kind))}</p>`,
    `<p><strong>Origin mode:</strong> ${escapeHtml(modeLabel(input.mode))}</p>`,
    `<p><strong>Model:</strong> ${escapeHtml(input.modelName)}</p>`,
    `<p><strong>Saved at:</strong> ${escapeHtml(nowLabel(input.savedAt))}</p>`,
    buildSourceSection(input.sources),
    "<hr>",
    textToHtml(input.content),
  ].join("\n");
}

export async function saveAIDMJournalEntry(
  input: SaveAIDMJournalEntryInput,
): Promise<SavedAIDMJournalEntry> {
  const savedAt = Date.now();
  const entryName = normalizeEntryName({
    kind: input.kind,
    content: input.content,
    requestedTitle: input.requestedTitle,
    savedAt,
  });
  const pageName = buildPageName(input.kind, input.mode);
  const target = await ensureJournalTarget(input.kind);
  const html = buildJournalHtml({
    ...input,
    entryName,
    pageName,
    savedAt,
  });

  const flags = {
    [MODULE_ID]: {
      kind: input.kind,
      mode: input.mode,
      savedAt,
      modelName: input.modelName,
      transcriptEntryId: input.transcriptEntryId,
      sourceUuids: input.sources.map((source) => source.uuid),
      sourceLabels: input.sources.map((source) => source.label),
    },
  };

  const created = await getJournalStatic().create({
    name: entryName,
    folder: target.folderId,
    flags,
    pages: [
      {
        name: pageName,
        type: "text",
        text: {
          format: 1,
          content: html,
        },
        flags,
      },
    ],
  });

  const createdPages = created.pages?.contents ?? [];
  const pageUuid = createdPages[0]?.uuid ?? null;

  logger.info("Saved AI DM journal entry.", {
    kind: input.kind,
    entryName,
    journalUuid: created.uuid ?? null,
    pageUuid,
  });

  return {
    kind: input.kind,
    entryName,
    pageName,
    journalUuid: created.uuid ?? null,
    pageUuid,
    folderPath: target.folderPath,
    savedAt,
  };
}
