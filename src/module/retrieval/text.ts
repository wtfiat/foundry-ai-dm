import { type IndexedSourceType } from "./types.ts";

export function normalizePlainText(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/\t/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ ]{2,}/g, " ")
    .trim();
}

export function stripHtml(value: string): string {
  const container = document.createElement("div");
  container.innerHTML = value;
  return container.textContent ?? container.innerText;
}

export function textFromUnknown(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = normalizePlainText(stripHtml(value));
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

export function joinSections(sections: Array<string | null | undefined>): string {
  return sections
    .map((section) => (typeof section === "string" ? normalizePlainText(section) : ""))
    .filter((section) => section.length > 0)
    .join("\n\n");
}

export function hashString(value: string): string {
  let hash = 0x811c9dc5;

  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function chunkText(value: string, targetSize: number): string[] {
  const normalized = normalizePlainText(value);
  if (normalized.length === 0) {
    return [];
  }

  const safeTargetSize = Math.max(300, targetSize);
  const paragraphs = normalized
    .split(/\n\n+/)
    .map((paragraph) => normalizePlainText(paragraph))
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";

  const flushCurrent = (): void => {
    const finalized = normalizePlainText(current);
    if (finalized.length > 0) {
      chunks.push(finalized);
    }
    current = "";
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > safeTargetSize) {
      if (current.length > 0) {
        flushCurrent();
      }

      for (const segment of splitLongText(paragraph, safeTargetSize)) {
        chunks.push(segment);
      }
      continue;
    }

    const proposed = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;
    if (proposed.length <= safeTargetSize) {
      current = proposed;
      continue;
    }

    flushCurrent();
    current = paragraph;
  }

  if (current.length > 0) {
    flushCurrent();
  }

  return chunks;
}

function splitLongText(value: string, targetSize: number): string[] {
  const sentences = value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizePlainText(sentence))
    .filter((sentence) => sentence.length > 0);

  if (sentences.length <= 1) {
    return sliceByLength(value, targetSize);
  }

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > targetSize) {
      if (current.length > 0) {
        chunks.push(normalizePlainText(current));
        current = "";
      }

      chunks.push(...sliceByLength(sentence, targetSize));
      continue;
    }

    const proposed = current.length === 0 ? sentence : `${current} ${sentence}`;
    if (proposed.length <= targetSize) {
      current = proposed;
      continue;
    }

    if (current.length > 0) {
      chunks.push(normalizePlainText(current));
    }
    current = sentence;
  }

  if (current.length > 0) {
    chunks.push(normalizePlainText(current));
  }

  return chunks;
}

function sliceByLength(value: string, targetSize: number): string[] {
  const result: string[] = [];
  let offset = 0;

  while (offset < value.length) {
    const slice = value.slice(offset, offset + targetSize);
    const normalized = normalizePlainText(slice);
    if (normalized.length > 0) {
      result.push(normalized);
    }
    offset += targetSize;
  }

  return result;
}

export function createExcerpt(value: string, maxLength: number): string {
  const normalized = normalizePlainText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function sourceTypeLabel(type: IndexedSourceType): string {
  switch (type) {
    case "journal-page":
      return "Journal";
    case "scene":
      return "Scene";
    case "actor":
      return "Actor";
    case "item":
      return "Item";
    case "roll-table":
      return "Roll Table";
  }
}
