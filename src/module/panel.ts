import { openDocumentByUuid, deleteDocumentByUuid } from "./document-links.ts";
import { MODULE_ID, MODULE_TITLE } from "./constants.ts";
import { logger } from "./logger.ts";
import { saveAIDMJournalEntry } from "./memory.ts";
import { type OllamaChatMessage, OllamaClient, OllamaRequestError } from "./ollama/client.ts";
import { runOllamaDiagnostics, type OllamaDiagnosticsResult } from "./ollama/diagnostics.ts";
import {
  buildWorldIndex,
  getRetrievalIndexMeta,
  retrieveIndexedContext,
} from "./retrieval/service.ts";
import { createExcerpt, sourceTypeLabel } from "./retrieval/text.ts";
import { type RetrievalCitation, type RetrievalIndexMeta } from "./retrieval/types.ts";
import { AIDMSettings } from "./settings.ts";

type PanelMode = "narrate" | "npc" | "lore" | "recap";
type TranscriptRole = "assistant" | "user" | "system";
type ConnectionState = "unknown" | "checking" | "ok" | "warning" | "error";

interface PanelModeOption {
  value: PanelMode;
  label: string;
  selected: boolean;
}

interface PanelSourceChip {
  id: string;
  uuid: string;
  label: string;
  detail: string;
  excerpt: string;
  scoreLabel: string;
}

interface PanelTranscriptEntry {
  id: string;
  role: TranscriptRole;
  roleLabel: string;
  mode: PanelMode;
  modeLabel: string;
  content: string;
  pending: boolean;
  error: boolean;
  meta?: string;
  modelName?: string;
  savedRecapUuid?: string;
  savedMemoryUuid?: string;
  sources: PanelSourceChip[];
}

interface PanelTranscriptEntryView extends PanelTranscriptEntry {
  canSaveRecap: boolean;
  canSaveMemory: boolean;
  hasSaveControls: boolean;
  savedRecapLabel?: string;
  savedMemoryLabel?: string;
}

interface RuntimeContextPreview {
  activeSceneName: string | null;
  selectedActorName: string | null;
  controlledTokenNames: string[];
  sceneSummary: string[];
}

interface PanelTemplateData {
  moduleTitle: string;
  modeOptions: PanelModeOption[];
  selectedMode: PanelMode;
  promptDraft: string;
  transcript: PanelTranscriptEntryView[];
  isBusy: boolean;
  canCancel: boolean;
  isIndexBusy: boolean;
  connectionState: ConnectionState;
  connectionLabel: string;
  connectionSummary: string;
  configuredChatModel: string;
  configuredEmbeddingModel: string;
  tonePreset: string;
  retrievalReady: boolean;
  retrievalLabel: string;
  retrievalSummary: string;
  activeSceneName: string | null;
  selectedActorName: string | null;
  controlledTokenNames: string[];
  sceneSummary: string[];
  indexedSourceCount: number;
  indexedChunkCount: number;
  lastIndexedAtLabel: string | null;
}

const PANEL_TEMPLATE_PATH = `modules/${MODULE_ID}/templates/ai-dm-panel.hbs`;
const PANEL_MODES: ReadonlyArray<{ value: PanelMode; label: string }> = [
  { value: "narrate", label: "Narrate Scene" },
  { value: "npc", label: "NPC Voice" },
  { value: "lore", label: "Lore / World Q&A" },
  { value: "recap", label: "Session Recap" },
];

let panelSingleton: AIDMPanel | null = null;
let transcriptCounter = 0;

function createEntryId(): string {
  transcriptCounter += 1;
  return `aidm-entry-${String(transcriptCounter)}`;
}

function modeLabel(mode: PanelMode): string {
  return PANEL_MODES.find((option) => option.value === mode)?.label ?? mode;
}

function roleLabel(role: TranscriptRole): string {
  switch (role) {
    case "assistant":
      return "AI DM";
    case "user":
      return "GM";
    case "system":
      return "System";
  }
}

function getRuntimeContextPreview(): RuntimeContextPreview {
  const scene = canvas?.scene ?? game.scenes?.current ?? null;
  const controlledTokens = canvas?.tokens?.controlled ?? [];
  const selectedToken = controlledTokens[0];
  const selectedActorName = selectedToken?.actor?.name ?? selectedToken?.name ?? null;
  const controlledTokenNames = controlledTokens
    .map((token) => token.actor?.name ?? token.name)
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0);

  const sceneSummary: string[] = [];
  if (scene?.name != null && scene.name.trim().length > 0) {
    sceneSummary.push(`Scene: ${scene.name}`);
  }

  const navName = scene?.navName;
  if (typeof navName === "string" && navName.trim().length > 0 && navName !== scene?.name) {
    sceneSummary.push(`Navigation label: ${navName}`);
  }

  if (selectedActorName != null) {
    sceneSummary.push(`Selected actor: ${selectedActorName}`);
  }

  if (controlledTokenNames.length > 1) {
    sceneSummary.push(`Controlled tokens: ${controlledTokenNames.join(", ")}`);
  }

  return {
    activeSceneName: scene?.name ?? null,
    selectedActorName,
    controlledTokenNames,
    sceneSummary,
  };
}

function buildToneInstruction(tonePreset: string): string {
  if (tonePreset === "classic-fantasy-dm") {
    return [
      "Use a classic fantasy dungeon master tone.",
      "Be vivid, atmospheric, and direct.",
      "Favor short paragraphs and strong sensory detail over purple prose.",
    ].join(" ");
  }

  return `Use the GM tone preset named "${tonePreset}" while staying concise and readable.`;
}

function buildSystemPrompt(input: {
  mode: PanelMode;
  tonePreset: string;
  context: RuntimeContextPreview;
  retrievalReady: boolean;
  retrievalContext: string;
}): string {
  const lines: string[] = [
    "You are Foundry AI DM, a GM-only co-DM running inside Foundry Virtual Tabletop.",
    buildToneInstruction(input.tonePreset),
    "You are assisting the Game Master, not speaking to players unless the GM asks you to do so.",
    input.retrievalReady
      ? "You have indexed world context for this request. Prefer that indexed context over guesswork."
      : "This slice may not have full-world retrieval available yet.",
    "Do not claim to know campaign facts that are not present in the prompt, transcript, runtime context, or retrieved index excerpts.",
    "If you do not have enough information, say so plainly instead of inventing canon.",
  ];

  if (input.context.sceneSummary.length > 0) {
    lines.push("Current runtime context:");
    lines.push(...input.context.sceneSummary.map((summary) => `- ${summary}`));
  } else {
    lines.push(
      "Current runtime context is minimal: there is no active scene or controlled token context available.",
    );
  }

  if (input.retrievalContext.trim().length > 0) {
    lines.push("Retrieved world index excerpts for this request:");
    lines.push(input.retrievalContext);
  } else if (input.retrievalReady) {
    lines.push("The world index is available, but this request did not retrieve any strong matches.");
  }

  switch (input.mode) {
    case "narrate":
      lines.push(
        "Mode: Narrate Scene.",
        "Narrate in third person like a dungeon master framing the next beat of play.",
        "Keep the answer under 220 words unless the GM explicitly asks for more.",
      );
      break;
    case "npc":
      lines.push(
        "Mode: NPC Voice.",
        "Speak in first person as the selected NPC when one is available.",
        "If no NPC is selected, say that clearly and ask the GM to select an actor or name the NPC in the prompt.",
        "Stay in character and do not reveal information the NPC would not reasonably know.",
      );
      break;
    case "lore":
      lines.push(
        "Mode: Lore / World Q&A.",
        "Answer from indexed sources when they are present.",
        "If retrieval is weak or unavailable, say that clearly instead of improvising unsupported lore.",
      );
      break;
    case "recap":
      lines.push(
        "Mode: Session Recap.",
        "Summarize the current panel transcript and the indexed context that was surfaced during the conversation as if preparing GM notes.",
        "Structure the answer with Markdown headings for Summary, Open Hooks, NPCs, and Consequences.",
      );
      break;
  }

  return lines.join("\n");
}

function buildConversationMessages(input: {
  transcript: PanelTranscriptEntry[];
  mode: PanelMode;
  tonePreset: string;
  context: RuntimeContextPreview;
  retrievalReady: boolean;
  retrievalContext: string;
}): OllamaChatMessage[] {
  const history = input.transcript
    .filter((entry) => (entry.role === "user" || entry.role === "assistant") && !entry.pending)
    .slice(-10)
    .map<OllamaChatMessage>((entry) => ({
      role: entry.role,
      content: entry.content,
    }));

  return [
    {
      role: "system",
      content: buildSystemPrompt({
        mode: input.mode,
        tonePreset: input.tonePreset,
        context: input.context,
        retrievalReady: input.retrievalReady,
        retrievalContext: input.retrievalContext,
      }),
    },
    ...history,
  ];
}

function formatIndexedTimestamp(value: number | undefined): string | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value).toLocaleString();
}

function citationToChip(citation: RetrievalCitation): PanelSourceChip {
  return {
    id: citation.sourceId,
    uuid: citation.uuid,
    label: citation.title,
    detail: `${sourceTypeLabel(citation.type)}${citation.subtitle != null ? ` • ${citation.subtitle}` : ""}`,
    excerpt: citation.excerpt,
    scoreLabel: citation.score.toFixed(3),
  };
}

function canPersistTranscriptEntry(entry: PanelTranscriptEntry): boolean {
  return (
    entry.role === "assistant" &&
    !entry.pending &&
    !entry.error &&
    entry.content.trim().length > 0
  );
}

function suggestedMemoryTitle(entry: PanelTranscriptEntry): string {
  const firstLine = entry.content
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (firstLine != null) {
    return createExcerpt(firstLine, 64);
  }

  return `${entry.modeLabel} Memory`;
}

function entryView(entry: PanelTranscriptEntry): PanelTranscriptEntryView {
  const canSaveRecap = canPersistTranscriptEntry(entry) && entry.savedRecapUuid == null;
  const canSaveMemory = canPersistTranscriptEntry(entry) && entry.savedMemoryUuid == null;
  const savedRecapLabel = entry.savedRecapUuid != null ? "Recap saved" : undefined;
  const savedMemoryLabel = entry.savedMemoryUuid != null ? "Memory saved" : undefined;

  return {
    ...entry,
    canSaveRecap,
    canSaveMemory,
    hasSaveControls: canSaveRecap || canSaveMemory || savedRecapLabel != null || savedMemoryLabel != null,
    savedRecapLabel,
    savedMemoryLabel,
  };
}

export class AIDMPanel extends foundry.appv1.api.Application {
  #transcript: PanelTranscriptEntry[] = [];
  #selectedMode: PanelMode = "narrate";
  #promptDraft = "";
  #diagnostics?: OllamaDiagnosticsResult;
  #connectionState: ConnectionState = "unknown";
  #isBusy = false;
  #indexBusy = false;
  #abortController?: AbortController;
  #autoCheckedConnection = false;
  #autoLoadedIndex = false;
  #indexMeta: RetrievalIndexMeta | null = null;
  #indexSummaryOverride: string | null = null;

  static override get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-panel`,
      classes: [MODULE_ID, "sheet", "aidm-panel"],
      template: PANEL_TEMPLATE_PATH,
      width: 560,
      height: 760,
      resizable: true,
      minimizable: true,
      title: `${MODULE_TITLE} Panel`,
    });
  }

  constructor(options: object = {}) {
    const clientSettings = AIDMSettings.getClientSettings();
    const mergedOptions = foundry.utils.mergeObject(options, {
      width: clientSettings.panelSize.width ?? undefined,
      height: clientSettings.panelSize.height ?? undefined,
      left: clientSettings.panelPosition.left ?? undefined,
      top: clientSettings.panelPosition.top ?? undefined,
    });

    super(mergedOptions);
  }

  override getData(): PanelTemplateData {
    const clientSettings = AIDMSettings.getClientSettings();
    const worldSettings = AIDMSettings.getWorldSettings();
    const runtimeContext = getRuntimeContextPreview();
    const retrievalReady = (this.#indexMeta?.chunkCount ?? 0) > 0;

    return {
      moduleTitle: MODULE_TITLE,
      modeOptions: PANEL_MODES.map((option) => ({
        ...option,
        selected: option.value === this.#selectedMode,
      })),
      selectedMode: this.#selectedMode,
      promptDraft: this.#promptDraft,
      transcript: this.#transcript.map(entryView),
      isBusy: this.#isBusy,
      canCancel: this.#abortController != null,
      isIndexBusy: this.#indexBusy,
      connectionState: this.#connectionState,
      connectionLabel: this.#connectionLabel(),
      connectionSummary: this.#connectionSummary(),
      configuredChatModel: clientSettings.chatModel,
      configuredEmbeddingModel: clientSettings.embeddingModel,
      tonePreset: worldSettings.tonePreset,
      retrievalReady,
      retrievalLabel: this.#retrievalLabel(),
      retrievalSummary: this.#retrievalSummary(),
      activeSceneName: runtimeContext.activeSceneName,
      selectedActorName: runtimeContext.selectedActorName,
      controlledTokenNames: runtimeContext.controlledTokenNames,
      sceneSummary: runtimeContext.sceneSummary,
      indexedSourceCount: this.#indexMeta?.sourceCount ?? 0,
      indexedChunkCount: this.#indexMeta?.chunkCount ?? 0,
      lastIndexedAtLabel: formatIndexedTimestamp(this.#indexMeta?.builtAt),
    };
  }

  override async close(options: object = {}): Promise<void> {
    if (this.#abortController != null) {
      this.#abortController.abort();
    }

    const { left, top, width, height } = this.position;
    const readNumericValue = (value: unknown): number | null =>
      typeof value === "number" && Number.isFinite(value) ? value : null;

    try {
      await AIDMSettings.setAll({
        panelPosition: {
          left: readNumericValue(left),
          top: readNumericValue(top),
        },
        panelSize: {
          width: readNumericValue(width),
          height: readNumericValue(height),
        },
      });
    } catch (error) {
      logger.warn("Unable to persist AI DM panel position.", error);
    }

    await super.close(options);
  }

  override activateListeners(html: JQuery): void {
    super.activateListeners(html);

    html.on("submit", (event) => {
      event.preventDefault();
      void this.#submitPrompt();
    });

    html.find('[data-action="refresh-status"]').on("click", (event) => {
      event.preventDefault();
      void this.refreshConnectionStatus();
    });

    html.find('[data-action="build-index"]').on("click", (event) => {
      event.preventDefault();
      void this.#runIndexBuild("build");
    });

    html.find('[data-action="reindex-changed"]').on("click", (event) => {
      event.preventDefault();
      void this.#runIndexBuild("refresh");
    });

    html.find('[data-action="clear-transcript"]').on("click", (event) => {
      event.preventDefault();
      this.#clearTranscript();
    });

    html.find('[data-action="save-recap"]').on("click", (event) => {
      event.preventDefault();
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const entryId = target.dataset["entryId"];
      if (entryId != null) {
        void this.#saveTranscriptEntry("recap", entryId);
      }
    });

    html.find('[data-action="save-memory"]').on("click", (event) => {
      event.preventDefault();
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const entryId = target.dataset["entryId"];
      if (entryId != null) {
        void this.#saveTranscriptEntry("memory", entryId);
      }
    });

    html.find('[data-action="open-source"]').on("click", (event) => {
      event.preventDefault();
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const sourceUuid = target.dataset["sourceUuid"];
      if (sourceUuid != null) {
        void this.#openSourceDocument(sourceUuid);
      }
    });

    html.find('[data-action="open-saved-recap"]').on("click", (event) => {
      event.preventDefault();
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const entryId = target.dataset["entryId"];
      if (entryId != null) {
        void this.#openSavedEntry("recap", entryId);
      }
    });

    html.find('[data-action="delete-saved-recap"]').on("click", (event) => {
      event.preventDefault();
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const entryId = target.dataset["entryId"];
      if (entryId != null) {
        void this.#deleteSavedEntry("recap", entryId);
      }
    });

    html.find('[data-action="open-saved-memory"]').on("click", (event) => {
      event.preventDefault();
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const entryId = target.dataset["entryId"];
      if (entryId != null) {
        void this.#openSavedEntry("memory", entryId);
      }
    });

    html.find('[data-action="delete-saved-memory"]').on("click", (event) => {
      event.preventDefault();
      const target = event.currentTarget;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      const entryId = target.dataset["entryId"];
      if (entryId != null) {
        void this.#deleteSavedEntry("memory", entryId);
      }
    });

    html.find('[data-action="cancel-request"]').on("click", (event) => {
      event.preventDefault();
      this.#cancelRequest();
    });

    html.find('[name="mode"]').on("change", (event) => {
      const target = event.currentTarget;
      if (target instanceof HTMLSelectElement) {
        this.#selectedMode = target.value as PanelMode;
      }
    });

    html.find('[name="prompt"]').on("input", (event) => {
      const target = event.currentTarget;
      if (target instanceof HTMLTextAreaElement) {
        this.#promptDraft = target.value;
      }
    });

    html.find('[name="prompt"]').on("keydown", (event) => {
      const keyEvent = event as JQuery.KeyDownEvent;
      if ((keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.key === "Enter") {
        keyEvent.preventDefault();
        void this.#submitPrompt();
      }
    });

    if (!this.#autoCheckedConnection) {
      this.#autoCheckedConnection = true;
      void this.refreshConnectionStatus();
    }

    if (!this.#autoLoadedIndex) {
      this.#autoLoadedIndex = true;
      void this.refreshIndexStatus();
    }
  }

  async refreshConnectionStatus(): Promise<void> {
    if (this.#isBusy || this.#indexBusy || this.#connectionState === "checking") {
      return;
    }

    this.#connectionState = "checking";
    this.render(false);

    const clientSettings = AIDMSettings.getClientSettings();

    try {
      this.#diagnostics = await runOllamaDiagnostics({
        client: {
          baseUrl: clientSettings.ollamaBaseUrl,
          timeoutMs: clientSettings.requestTimeoutMs,
        },
        expectedChatModel: clientSettings.chatModel,
        expectedEmbeddingModel: clientSettings.embeddingModel,
      });
      this.#connectionState = this.#diagnostics.status;
    } catch (error) {
      logger.error("Unexpected error while refreshing AI DM connection status.", error);
      this.#connectionState = "error";
      this.#diagnostics = {
        status: "error",
        summary: "An unexpected error occurred while checking Ollama.",
        configuredBaseUrl: clientSettings.ollamaBaseUrl,
        browserOrigin: window.location.origin,
        availableModels: [],
        runningModels: [],
        missingModels: [clientSettings.chatModel, clientSettings.embeddingModel],
        details: [error instanceof Error ? error.message : "Unknown error"],
        troubleshooting: ["Open the browser console and module logs for more detail."],
      };
    }

    this.render(false);
  }

  async refreshIndexStatus(): Promise<void> {
    try {
      this.#indexMeta = await getRetrievalIndexMeta();
    } catch (error) {
      logger.warn("Unable to load retrieval index status.", error);
      this.#indexMeta = null;
      this.#indexSummaryOverride = "Unable to load retrieval index status.";
    }

    this.render(false);
  }

  async #runIndexBuild(mode: "build" | "refresh"): Promise<void> {
    if (this.#isBusy || this.#indexBusy) {
      return;
    }

    this.#indexBusy = true;
    this.#indexSummaryOverride =
      mode === "build" ? "Building retrieval index from scratch..." : "Reindexing changed world documents...";
    this.render(false);

    try {
      const summary = await buildWorldIndex({
        mode,
        onProgress: (update) => {
          this.#indexSummaryOverride = update.message;
          this.render(false);
        },
      });

      this.#indexMeta = summary.meta;
      this.#indexSummaryOverride =
        mode === "build"
          ? `Built ${String(summary.sourceCount)} sources and ${String(summary.chunkCount)} chunks.`
          : `Indexed ${String(summary.sourceCount)} sources and ${String(summary.chunkCount)} chunks. Reused ${String(summary.reusedSourceCount)} unchanged sources.`;

      const firstWarning = summary.warnings[0];
      if (firstWarning !== undefined) {
        ui.notifications?.warn(firstWarning);
      } else {
        ui.notifications?.info(this.#indexSummaryOverride);
      }

      logger.info("Retrieval index operation completed.", summary);
    } catch (error) {
      logger.error("Retrieval index operation failed.", error);
      this.#indexSummaryOverride =
        error instanceof Error ? `Indexing failed: ${error.message}` : "Indexing failed unexpectedly.";
      ui.notifications?.error(this.#indexSummaryOverride);
    } finally {
      this.#indexBusy = false;
      this.render(false);
    }
  }

  async #saveTranscriptEntry(kind: "recap" | "memory", entryId: string): Promise<void> {
    if (this.#isBusy || this.#indexBusy) {
      ui.notifications?.warn("Wait for the current operation to finish before saving AI DM notes.");
      return;
    }

    const entry = this.#transcript.find((candidate) => candidate.id === entryId);
    if (entry == null || !canPersistTranscriptEntry(entry)) {
      ui.notifications?.warn("Only completed AI DM responses can be saved to campaign memory.");
      return;
    }

    if (kind === "recap" && entry.savedRecapUuid != null) {
      ui.notifications?.info("This response has already been saved as a recap.");
      return;
    }

    if (kind === "memory" && entry.savedMemoryUuid != null) {
      ui.notifications?.info("This response has already been saved as a memory note.");
      return;
    }

    let requestedTitle: string | undefined;
    if (kind === "memory") {
      const defaultTitle = suggestedMemoryTitle(entry);
      const promptedTitle = window.prompt("Memory note title", defaultTitle);
      if (promptedTitle == null) {
        return;
      }

      const trimmedTitle = promptedTitle.trim();
      requestedTitle = trimmedTitle.length > 0 ? trimmedTitle : defaultTitle;
    }

    const worldSettings = AIDMSettings.getWorldSettings();
    if (worldSettings.confirmWrites) {
      const confirmationMessage =
        kind === "recap"
          ? "Save this AI response as a session recap in the AI DM journals?"
          : `Save this AI response as a memory note titled "${requestedTitle ?? "Campaign Memory"}"?`;

      if (!window.confirm(confirmationMessage)) {
        return;
      }
    }

    this.#indexBusy = true;
    this.#indexSummaryOverride =
      kind === "recap" ? "Saving session recap to AI DM journals..." : "Saving memory note to AI DM journals...";
    this.render(false);

    try {
      const saved = await saveAIDMJournalEntry({
        kind,
        mode: entry.mode,
        content: entry.content,
        modelName: entry.modelName ?? AIDMSettings.getClientSettings().chatModel,
        sources: entry.sources.map((source) => ({
          uuid: source.uuid,
          label: source.label,
          detail: source.detail,
          excerpt: source.excerpt,
        })),
        transcriptEntryId: entry.id,
        requestedTitle,
      });

      if (kind === "recap") {
        entry.savedRecapUuid = saved.pageUuid ?? saved.journalUuid ?? saved.entryName;
      } else {
        entry.savedMemoryUuid = saved.pageUuid ?? saved.journalUuid ?? saved.entryName;
      }

      ui.notifications?.info(
        `${kind === "recap" ? "Recap" : "Memory note"} saved to ${saved.folderPath}. Reindexing now...`,
      );
      logger.info("AI DM transcript entry saved.", {
        kind,
        entryId,
        journalUuid: saved.journalUuid,
        pageUuid: saved.pageUuid,
      });
    } catch (error) {
      logger.error("Unable to save AI DM transcript entry.", error);
      const message =
        error instanceof Error ? `Unable to save AI DM journal entry: ${error.message}` : "Unable to save AI DM journal entry.";
      this.#indexSummaryOverride = message;
      ui.notifications?.error(message);
      return;
    } finally {
      this.#indexBusy = false;
      this.render(false);
    }

    await this.#runIndexBuild((this.#indexMeta?.chunkCount ?? 0) > 0 ? "refresh" : "build");
  }

  async #openSourceDocument(uuid: string): Promise<void> {
    try {
      const opened = await openDocumentByUuid(uuid);
      if (!opened) {
        ui.notifications?.warn("Unable to open the selected source document.");
      }
    } catch (error) {
      logger.error("Unable to open source document.", error);
      ui.notifications?.error("Unable to open the selected source document.");
    }
  }

  async #openSavedEntry(kind: "recap" | "memory", entryId: string): Promise<void> {
    const entry = this.#transcript.find((candidate) => candidate.id === entryId);
    if (entry == null) {
      ui.notifications?.warn("The saved AI DM entry could not be found in the transcript.");
      return;
    }

    const uuid = kind === "recap" ? entry.savedRecapUuid : entry.savedMemoryUuid;
    if (uuid == null) {
      ui.notifications?.warn(`No saved ${kind === "recap" ? "recap" : "memory note"} is attached to this response.`);
      return;
    }

    await this.#openSourceDocument(uuid);
  }

  async #deleteSavedEntry(kind: "recap" | "memory", entryId: string): Promise<void> {
    if (this.#isBusy || this.#indexBusy) {
      ui.notifications?.warn("Wait for the current operation to finish before deleting AI DM notes.");
      return;
    }

    const entry = this.#transcript.find((candidate) => candidate.id === entryId);
    if (entry == null) {
      ui.notifications?.warn("The saved AI DM entry could not be found in the transcript.");
      return;
    }

    const uuid = kind === "recap" ? entry.savedRecapUuid : entry.savedMemoryUuid;
    if (uuid == null) {
      ui.notifications?.warn(`No saved ${kind === "recap" ? "recap" : "memory note"} is attached to this response.`);
      return;
    }

    const noun = kind === "recap" ? "session recap" : "memory note";
    if (!window.confirm(`Delete the saved ${noun} for this AI response?`)) {
      return;
    }

    this.#indexBusy = true;
    this.#indexSummaryOverride = `Deleting saved ${noun}...`;
    this.render(false);

    try {
      const deleted = await deleteDocumentByUuid(uuid);
      if (!deleted) {
        ui.notifications?.warn(`Unable to locate the saved ${noun}.`);
        return;
      }

      if (kind === "recap") {
        entry.savedRecapUuid = undefined;
      } else {
        entry.savedMemoryUuid = undefined;
      }

      ui.notifications?.info(`Deleted ${noun}. Reindexing now...`);
      logger.info("AI DM saved entry deleted.", {
        kind,
        entryId,
        uuid,
      });
    } catch (error) {
      logger.error("Unable to delete saved AI DM entry.", error);
      const message =
        error instanceof Error ? `Unable to delete saved AI DM entry: ${error.message}` : "Unable to delete saved AI DM entry.";
      this.#indexSummaryOverride = message;
      ui.notifications?.error(message);
      return;
    } finally {
      this.#indexBusy = false;
      this.render(false);
    }

    await this.#runIndexBuild((this.#indexMeta?.chunkCount ?? 0) > 0 ? "refresh" : "build");
  }

  async #submitPrompt(): Promise<void> {
    if (this.#isBusy || this.#indexBusy) {
      return;
    }

    const prompt = this.#promptDraft.trim();
    if (prompt.length === 0) {
      ui.notifications?.warn("Enter a prompt before sending it to the AI DM.");
      return;
    }

    const context = getRuntimeContextPreview();
    const worldSettings = AIDMSettings.getWorldSettings();
    const clientSettings = AIDMSettings.getClientSettings();

    if (this.#selectedMode === "npc" && context.selectedActorName == null) {
      ui.notifications?.warn(
        "NPC Voice works best when you have a token selected. You can still continue, but the model will ask for an NPC name if it needs one.",
      );
    }

    const retrievedContext = await retrieveIndexedContext(
      [prompt, ...context.sceneSummary].filter((section) => section.trim().length > 0).join("\n"),
    );

    const userEntry: PanelTranscriptEntry = {
      id: createEntryId(),
      role: "user",
      roleLabel: roleLabel("user"),
      mode: this.#selectedMode,
      modeLabel: modeLabel(this.#selectedMode),
      content: prompt,
      pending: false,
      error: false,
      modelName: undefined,
      sources: [],
    };

    const assistantEntry: PanelTranscriptEntry = {
      id: createEntryId(),
      role: "assistant",
      roleLabel: roleLabel("assistant"),
      mode: this.#selectedMode,
      modeLabel: modeLabel(this.#selectedMode),
      content: "",
      pending: true,
      error: false,
      meta: `Model: ${clientSettings.chatModel}`,
      modelName: clientSettings.chatModel,
      sources: retrievedContext.citations.map(citationToChip),
    };

    this.#transcript.push(userEntry, assistantEntry);
    this.#promptDraft = "";
    this.#isBusy = true;
    this.#abortController = new AbortController();
    this.render(false);

    const client = new OllamaClient({
      baseUrl: clientSettings.ollamaBaseUrl,
      timeoutMs: clientSettings.requestTimeoutMs,
    });

    const messages = buildConversationMessages({
      transcript: this.#transcript,
      mode: this.#selectedMode,
      tonePreset: worldSettings.tonePreset,
      context,
      retrievalReady: retrievedContext.ready,
      retrievalContext: retrievedContext.promptContext,
    });

    try {
      const response = await client.chatStream(
        {
          model: clientSettings.chatModel,
          messages,
          think: false,
          keep_alive: clientSettings.keepAlive,
          options: {
            temperature: clientSettings.chatTemperature,
            num_ctx: clientSettings.chatNumCtx,
          },
        },
        {
          signal: this.#abortController.signal,
          onChunk: (chunk) => {
            const chunkContent = chunk.message.content;
            if (chunkContent.length === 0) {
              return;
            }

            assistantEntry.content += chunkContent;
            this.#updateAssistantEntryContent(assistantEntry);
          },
        },
      );

      assistantEntry.pending = false;
      assistantEntry.modelName = response.model;
      assistantEntry.meta = [
        `Model: ${response.model}`,
        response.eval_count != null ? `Tokens: ${String(response.eval_count)}` : undefined,
        assistantEntry.sources.length > 0 ? `Sources: ${String(assistantEntry.sources.length)}` : undefined,
      ]
        .filter((value): value is string => value != null)
        .join(" • ");

      if (assistantEntry.content.trim().length === 0) {
        assistantEntry.content = "The model returned an empty response.";
      }

      logger.info("AI DM response completed.", {
        mode: this.#selectedMode,
        model: response.model,
        retrievedChunks: retrievedContext.chunkCount,
      });
    } catch (error) {
      assistantEntry.pending = false;

      if (error instanceof OllamaRequestError && error.code === "aborted") {
        assistantEntry.error = false;
        assistantEntry.meta =
          assistantEntry.meta != null ? `${assistantEntry.meta} • Cancelled` : "Cancelled";
        if (assistantEntry.content.trim().length === 0) {
          assistantEntry.content = "Request cancelled.";
        }
        logger.info("AI DM request cancelled.");
      } else {
        assistantEntry.error = true;

        if (error instanceof OllamaRequestError) {
          assistantEntry.content = `Request failed: ${error.message}`;
        } else if (error instanceof Error) {
          assistantEntry.content = `Request failed: ${error.message}`;
        } else {
          assistantEntry.content = "Request failed for an unknown reason.";
        }

        logger.error("AI DM request failed.", error);
        ui.notifications?.error("The AI DM request failed. See the panel transcript for details.");
      }
    } finally {
      this.#isBusy = false;
      this.#abortController = undefined;
      this.render(false);
      this.#scrollTranscriptToBottom();
    }
  }

  #cancelRequest(): void {
    if (this.#abortController == null) {
      return;
    }

    this.#abortController.abort();
    this.#abortController = undefined;
    this.#isBusy = false;
  }

  #clearTranscript(): void {
    if (this.#isBusy || this.#indexBusy) {
      ui.notifications?.warn("Wait for the current operation to finish before clearing the transcript.");
      return;
    }

    this.#transcript = [];
    this.render(false);
  }

  #connectionLabel(): string {
    switch (this.#connectionState) {
      case "checking":
        return "Checking Ollama";
      case "ok":
        return "Connected";
      case "warning":
        return "Connected with warnings";
      case "error":
        return "Connection failed";
      case "unknown":
      default:
        return "Status unknown";
    }
  }

  #connectionSummary(): string {
    if (this.#diagnostics != null) {
      return this.#diagnostics.summary;
    }

    if (this.#connectionState === "checking") {
      return "Checking the configured Ollama endpoint and model availability.";
    }

    return "Open the panel or press Refresh status to validate the local Ollama connection.";
  }

  #retrievalLabel(): string {
    if (this.#indexBusy) {
      return "Indexing world data";
    }

    if ((this.#indexMeta?.chunkCount ?? 0) > 0) {
      return "World retrieval ready";
    }

    return "World retrieval not ready";
  }

  #retrievalSummary(): string {
    if (this.#indexBusy && this.#indexSummaryOverride != null) {
      return this.#indexSummaryOverride;
    }

    if (this.#indexSummaryOverride != null && !this.#indexBusy) {
      return this.#indexSummaryOverride;
    }

    if (this.#indexMeta == null || this.#indexMeta.chunkCount === 0) {
      return "Build the index to ground Lore / World Q&A in journals, scenes, actors, items, and roll tables.";
    }

    const builtAtLabel = formatIndexedTimestamp(this.#indexMeta.builtAt);
    return `${String(this.#indexMeta.sourceCount)} sources • ${String(this.#indexMeta.chunkCount)} chunks${builtAtLabel != null ? ` • ${builtAtLabel}` : ""}`;
  }

  #updateAssistantEntryContent(entry: PanelTranscriptEntry): void {
    const contentNode = this.element.find(`[data-entry-id="${entry.id}"] .aidm-panel-transcript-content`);
    if (contentNode.length === 0) {
      return;
    }

    contentNode.text(entry.content);
    this.#scrollTranscriptToBottom();
  }

  #scrollTranscriptToBottom(): void {
    const transcript = this.element.find(".aidm-panel-transcript");
    if (transcript.length === 0) {
      return;
    }

    transcript.scrollTop(Number(transcript.prop("scrollHeight")));
  }
}

export function openAIDMPanel(): AIDMPanel {
  if (panelSingleton == null) {
    panelSingleton = new AIDMPanel();
  }

  if (panelSingleton.rendered) {
    panelSingleton.bringToTop();
    return panelSingleton;
  }

  panelSingleton.render(true);
  return panelSingleton;
}

export function toggleAIDMPanel(): void {
  if (panelSingleton != null && panelSingleton.rendered) {
    void panelSingleton.close();
    return;
  }

  openAIDMPanel();
}
