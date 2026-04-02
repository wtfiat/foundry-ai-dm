import { MODULE_ID, MODULE_TITLE } from "./constants.ts";
import { logger } from "./logger.ts";
import { type OllamaChatMessage, OllamaClient, OllamaRequestError } from "./ollama/client.ts";
import { runOllamaDiagnostics, type OllamaDiagnosticsResult } from "./ollama/diagnostics.ts";
import { AIDMSettings } from "./settings.ts";

type PanelMode = "narrate" | "npc" | "lore" | "recap";
type TranscriptRole = "assistant" | "user" | "system";
type ConnectionState = "unknown" | "checking" | "ok" | "warning" | "error";

interface PanelModeOption {
  value: PanelMode;
  label: string;
  selected: boolean;
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
  transcript: PanelTranscriptEntry[];
  isBusy: boolean;
  canCancel: boolean;
  connectionState: ConnectionState;
  connectionLabel: string;
  connectionSummary: string;
  configuredChatModel: string;
  configuredEmbeddingModel: string;
  tonePreset: string;
  retrievalReady: boolean;
  activeSceneName: string | null;
  selectedActorName: string | null;
  controlledTokenNames: string[];
  sceneSummary: string[];
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

function buildSystemPrompt(mode: PanelMode, tonePreset: string, context: RuntimeContextPreview): string {
  const lines: string[] = [
    "You are Foundry AI DM, a GM-only co-DM running inside Foundry Virtual Tabletop.",
    buildToneInstruction(tonePreset),
    "You are assisting the Game Master, not speaking to players unless the GM asks you to do so.",
    "This slice does not have full-world retrieval yet.",
    "You only have the live panel transcript, the currently active scene name, and the currently controlled token or actor names.",
    "Do not claim to know campaign facts that are not present in the prompt or current runtime context.",
    "If the GM asks for broader world lore than the runtime context provides, say that the world index is not connected yet.",
  ];

  if (context.sceneSummary.length > 0) {
    lines.push("Current runtime context:");
    lines.push(...context.sceneSummary.map((summary) => `- ${summary}`));
  } else {
    lines.push("Current runtime context is minimal: there is no active scene or controlled token context available.");
  }

  switch (mode) {
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
        "Answer only from the prompt and current runtime context.",
        "If you do not have enough information, say that plainly instead of inventing canon.",
      );
      break;
    case "recap":
      lines.push(
        "Mode: Session Recap.",
        "Summarize the current panel transcript and prompt as if preparing GM notes.",
        "Structure the answer with Markdown headings for Summary, Open Hooks, NPCs, and Consequences.",
      );
      break;
  }

  return lines.join("\n");
}

function buildConversationMessages(
  transcript: PanelTranscriptEntry[],
  mode: PanelMode,
  tonePreset: string,
  context: RuntimeContextPreview,
): OllamaChatMessage[] {
  const history = transcript
    .filter((entry) => (entry.role === "user" || entry.role === "assistant") && !entry.pending)
    .slice(-10)
    .map<OllamaChatMessage>((entry) => ({
      role: entry.role,
      content: entry.content,
    }));

  return [
    {
      role: "system",
      content: buildSystemPrompt(mode, tonePreset, context),
    },
    ...history,
  ];
}

// eslint-disable-next-line @typescript-eslint/no-deprecated
export class AIDMPanel extends foundry.appv1.api.Application {
  #transcript: PanelTranscriptEntry[] = [];
  #selectedMode: PanelMode = "narrate";
  #promptDraft = "";
  #diagnostics?: OllamaDiagnosticsResult;
  #connectionState: ConnectionState = "unknown";
  #isBusy = false;
  #abortController?: AbortController;
  #autoCheckedConnection = false;

  static override get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-panel`,
      classes: [MODULE_ID, "sheet", "aidm-panel"],
      template: PANEL_TEMPLATE_PATH,
      width: 520,
      height: 720,
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

    return {
      moduleTitle: MODULE_TITLE,
      modeOptions: PANEL_MODES.map((option) => ({
        ...option,
        selected: option.value === this.#selectedMode,
      })),
      selectedMode: this.#selectedMode,
      promptDraft: this.#promptDraft,
      transcript: [...this.#transcript],
      isBusy: this.#isBusy,
      canCancel: this.#abortController != null,
      connectionState: this.#connectionState,
      connectionLabel: this.#connectionLabel(),
      connectionSummary: this.#connectionSummary(),
      configuredChatModel: clientSettings.chatModel,
      configuredEmbeddingModel: clientSettings.embeddingModel,
      tonePreset: worldSettings.tonePreset,
      retrievalReady: false,
      activeSceneName: runtimeContext.activeSceneName,
      selectedActorName: runtimeContext.selectedActorName,
      controlledTokenNames: runtimeContext.controlledTokenNames,
      sceneSummary: runtimeContext.sceneSummary,
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

    html.find('[data-action="clear-transcript"]').on("click", (event) => {
      event.preventDefault();
      this.#clearTranscript();
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
      if (!(event instanceof KeyboardEvent)) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        void this.#submitPrompt();
      }
    });

    if (!this.#autoCheckedConnection) {
      this.#autoCheckedConnection = true;
      void this.refreshConnectionStatus();
    }
  }

  async refreshConnectionStatus(): Promise<void> {
    if (this.#isBusy || this.#connectionState === "checking") {
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

  async #submitPrompt(): Promise<void> {
    if (this.#isBusy) {
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

    const userEntry: PanelTranscriptEntry = {
      id: createEntryId(),
      role: "user",
      roleLabel: roleLabel("user"),
      mode: this.#selectedMode,
      modeLabel: modeLabel(this.#selectedMode),
      content: prompt,
      pending: false,
      error: false,
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

    const messages = buildConversationMessages(
      this.#transcript,
      this.#selectedMode,
      worldSettings.tonePreset,
      context,
    );

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
      assistantEntry.meta = [
        `Model: ${response.model}`,
        response.eval_count != null ? `Tokens: ${String(response.eval_count)}` : undefined,
      ]
        .filter((value): value is string => value != null)
        .join(" • ");

      if (assistantEntry.content.trim().length === 0) {
        assistantEntry.content = "The model returned an empty response.";
      }

      logger.info("AI DM response completed.", {
        mode: this.#selectedMode,
        model: response.model,
      });
    } catch (error) {
      assistantEntry.pending = false;

      if (error instanceof OllamaRequestError && error.code === "aborted") {
        assistantEntry.error = false;
        assistantEntry.meta = assistantEntry.meta != null ? `${assistantEntry.meta} • Cancelled` : "Cancelled";
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
    if (this.#isBusy) {
      ui.notifications?.warn("Wait for the current request to finish before clearing the transcript.");
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

  #updateAssistantEntryContent(entry: PanelTranscriptEntry): void {
    const contentNode = this.element.find(
      `[data-entry-id="${entry.id}"] .aidm-panel-transcript-content`,
    );
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
