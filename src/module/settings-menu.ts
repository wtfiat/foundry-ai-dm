import { MODULE_ID, MODULE_TITLE } from "./constants.ts";
import { logger } from "./logger.ts";
import { runOllamaDiagnostics, type OllamaDiagnosticsResult } from "./ollama/diagnostics.ts";
import { AIDMSettings, type AIDMClientSettings, type AIDMWorldSettings } from "./settings.ts";

interface SettingsMenuTemplateData extends AIDMClientSettings, AIDMWorldSettings {
  diagnostics?: OllamaDiagnosticsResult;
  moduleTitle: string;
}

interface SettingsMenuFormData {
  ollamaBaseUrl: string;
  chatModel: string;
  embeddingModel: string;
  requestTimeoutMs: number;
  keepAlive: string;
  chatTemperature: number;
  chatNumCtx: number;
  debugLogging: boolean;
  tonePreset: string;
  confirmWrites: boolean;
  retrievalTopK: number;
  chunkSize: number;
  indexJournalEntries: boolean;
  indexScenes: boolean;
  indexActors: boolean;
  indexItems: boolean;
  indexRollTables: boolean;
}

export class AIDMSettingsMenu extends foundry.appv1.api.FormApplication {
  #diagnostics?: OllamaDiagnosticsResult;

  static override get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: `${MODULE_ID}-settings-menu`,
      classes: [MODULE_ID, "sheet"],
      template: `modules/${MODULE_ID}/templates/settings-menu.hbs`,
      width: 720,
      height: "auto",
      closeOnSubmit: false,
      submitOnChange: false,
      resizable: true,
      title: `${MODULE_TITLE} Configuration`,
    });
  }

  constructor(object: object = {}, options: object = {}) {
    super(object, options);
  }

  override getData(): SettingsMenuTemplateData {
    return {
      ...AIDMSettings.getAllSettings(),
      diagnostics: this.#diagnostics,
      moduleTitle: MODULE_TITLE,
    };
  }

  override activateListeners(html: JQuery): void {
    super.activateListeners(html);
    html.find('[data-action="test-connection"]').on("click", (event) => {
      event.preventDefault();
      void this.#onTestConnection();
    });
  }

  protected override async _updateObject(
    _event: Event,
    formData: Record<string, unknown>,
  ): Promise<void> {
    const normalized = this.#normalizeFormData(formData);

    if (
      normalized.ollamaBaseUrl.length === 0 ||
      normalized.chatModel.length === 0 ||
      normalized.embeddingModel.length === 0
    ) {
      ui.notifications?.error("Ollama URL, chat model, and embedding model are required.");
      return;
    }

    await AIDMSettings.setAll({
      ollamaBaseUrl: normalized.ollamaBaseUrl,
      chatModel: normalized.chatModel,
      embeddingModel: normalized.embeddingModel,
      requestTimeoutMs: normalized.requestTimeoutMs,
      keepAlive: normalized.keepAlive,
      chatTemperature: normalized.chatTemperature,
      chatNumCtx: normalized.chatNumCtx,
      debugLogging: normalized.debugLogging,
      tonePreset: normalized.tonePreset,
      confirmWrites: normalized.confirmWrites,
      retrievalTopK: normalized.retrievalTopK,
      chunkSize: normalized.chunkSize,
      indexJournalEntries: normalized.indexJournalEntries,
      indexScenes: normalized.indexScenes,
      indexActors: normalized.indexActors,
      indexItems: normalized.indexItems,
      indexRollTables: normalized.indexRollTables,
    });

    ui.notifications?.info(`${MODULE_TITLE} settings saved.`);
    logger.info("Settings updated.", normalized);
    this.render(false);
  }

  async #onTestConnection(): Promise<void> {
    const normalized = this.#normalizeFormData(this._getSubmitData() as Record<string, unknown>);
    logger.info("Running Ollama diagnostics.", {
      baseUrl: normalized.ollamaBaseUrl,
      chatModel: normalized.chatModel,
      embeddingModel: normalized.embeddingModel,
    });

    this.#diagnostics = await runOllamaDiagnostics({
      client: {
        baseUrl: normalized.ollamaBaseUrl,
        timeoutMs: normalized.requestTimeoutMs,
      },
      expectedChatModel: normalized.chatModel,
      expectedEmbeddingModel: normalized.embeddingModel,
    });

    if (this.#diagnostics.status === "ok") {
      ui.notifications?.info("Ollama connection test passed.");
    } else if (this.#diagnostics.status === "warning") {
      ui.notifications?.warn("Ollama is reachable, but configuration work remains.");
    } else {
      ui.notifications?.error("Ollama connection test failed.");
    }

    this.render(false);
  }

  #normalizeFormData(formData: Record<string, unknown>): SettingsMenuFormData {
    const clientSettings = AIDMSettings.getClientSettings();
    const worldSettings = AIDMSettings.getWorldSettings();

    return {
      ollamaBaseUrl: this.#stringValue(formData["ollamaBaseUrl"], clientSettings.ollamaBaseUrl),
      chatModel: this.#stringValue(formData["chatModel"], clientSettings.chatModel),
      embeddingModel: this.#stringValue(
        formData["embeddingModel"],
        clientSettings.embeddingModel,
      ),
      requestTimeoutMs: this.#numberValue(
        formData["requestTimeoutMs"],
        clientSettings.requestTimeoutMs,
        1000,
      ),
      keepAlive: this.#stringValue(formData["keepAlive"], clientSettings.keepAlive),
      chatTemperature: this.#numberValue(
        formData["chatTemperature"],
        clientSettings.chatTemperature,
        0,
      ),
      chatNumCtx: this.#numberValue(formData["chatNumCtx"], clientSettings.chatNumCtx, 1024),
      debugLogging: this.#booleanValue(formData["debugLogging"]),
      tonePreset: this.#stringValue(formData["tonePreset"], worldSettings.tonePreset),
      confirmWrites: this.#booleanValue(formData["confirmWrites"]),
      retrievalTopK: this.#numberValue(
        formData["retrievalTopK"],
        worldSettings.retrievalTopK,
        1,
      ),
      chunkSize: this.#numberValue(formData["chunkSize"], worldSettings.chunkSize, 200),
      indexJournalEntries: this.#booleanValue(formData["indexJournalEntries"]),
      indexScenes: this.#booleanValue(formData["indexScenes"]),
      indexActors: this.#booleanValue(formData["indexActors"]),
      indexItems: this.#booleanValue(formData["indexItems"]),
      indexRollTables: this.#booleanValue(formData["indexRollTables"]),
    };
  }

  #stringValue(value: unknown, fallback: string): string {
    if (typeof value === "string") {
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : fallback;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      const normalized = String(value).trim();
      return normalized.length > 0 ? normalized : fallback;
    }

    return fallback;
  }

  #numberValue(value: unknown, fallback: number, minValue: number): number {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) {
      return fallback;
    }

    return Math.max(minValue, normalized);
  }

  #booleanValue(value: unknown): boolean {
    return value === true || value === "true" || value === "on";
  }
}
