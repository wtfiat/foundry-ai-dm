interface UuidResolver {
  (uuid: string): Promise<unknown>;
}

interface RenderableSheetLike {
  render: (force?: boolean, options?: Record<string, unknown>) => void;
}

interface UuidDocumentLike {
  id?: string | null;
  uuid?: string;
  name?: string | null;
  documentName?: string;
  parent?: UuidDocumentLike | null;
  sheet?: RenderableSheetLike | null;
  pages?: { contents?: unknown[] };
  delete?: () => Promise<unknown>;
}

function getUuidResolver(): UuidResolver | null {
  const resolver = (globalThis as { fromUuid?: UuidResolver }).fromUuid;
  return typeof resolver === "function" ? resolver : null;
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

async function resolveDocument(uuid: string): Promise<UuidDocumentLike | null> {
  const normalizedUuid = readString(uuid);
  if (normalizedUuid == null) {
    return null;
  }

  const resolver = getUuidResolver();
  if (resolver == null) {
    return null;
  }

  const resolved = await resolver(normalizedUuid);
  return resolved as UuidDocumentLike | null;
}

function pageCount(document: UuidDocumentLike | null | undefined): number {
  return Array.isArray(document?.pages?.contents) ? document.pages.contents.length : 0;
}

export async function openDocumentByUuid(uuid: string): Promise<boolean> {
  const resolved = await resolveDocument(uuid);
  if (resolved == null) {
    return false;
  }

  const documentName = readString(resolved.documentName);
  if (documentName === "JournalEntryPage") {
    const parent = resolved.parent;
    if (parent?.sheet != null) {
      const pageId = readString(resolved.id);
      parent.sheet.render(true, pageId != null ? { pageId } : {});
      return true;
    }
  }

  if (resolved.sheet != null) {
    resolved.sheet.render(true);
    return true;
  }

  const parent = resolved.parent;
  if (parent?.sheet != null) {
    parent.sheet.render(true);
    return true;
  }

  return false;
}

export async function deleteDocumentByUuid(uuid: string): Promise<boolean> {
  const resolved = await resolveDocument(uuid);
  if (resolved == null) {
    return false;
  }

  const documentName = readString(resolved.documentName);
  if (documentName === "JournalEntryPage") {
    const parent = resolved.parent;
    if (parent != null && typeof parent.delete === "function" && pageCount(parent) <= 1) {
      await parent.delete();
      return true;
    }
  }

  if (typeof resolved.delete === "function") {
    await resolved.delete();
    return true;
  }

  const parent = resolved.parent;
  if (parent != null && typeof parent.delete === "function") {
    await parent.delete();
    return true;
  }

  return false;
}
