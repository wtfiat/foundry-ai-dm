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

export class AIDMSettingsMenu extends FormApplication {
  #diagnostics?: OllamaDiagnosticsResult;

  static override get defaultOptions(): FormApplicationOptions {
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

  override async getData(): Promise<SettingsMenuTemplateData> {
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

    if (normalized.ollamaBaseUrl.length === 0 || normalized.chatModel.length === 0 || normalized.embeddingModel.length === 0) {
      ui.notifications?.error("Ollama URL, chat model, and embedding model are required.");
      return;
    }

    await Promise.all([
      game.settings.set(MODULE_ID, "ollamaBaseUrl", normalized.ollamaBaseUrl),
      game.settings.set(MODULE_ID, "chatModel", normalized.chatModel),
      game.settings.set(MODULE_ID, "embeddingModel", normalized.embeddingModel),
      game.settings.set(MODULE_ID, "requestTimeoutMs", normalized.requestTimeoutMs),
      game.settings.set(MODULE_ID, "keepAlive", normalized.keepAlive),
      game.settings.set(MODULE_ID, "chatTemperature", normalized.chatTemperature),
      game.settings.set(MODULE_ID, "chatNumCtx", normalized.chatNumCtx),
      game.settings.set(MODULE_ID, "debugLogging", normalized.debugLogging),
      game.settings.set(MODULE_ID, "tonePreset", normalized.tonePreset),
      game.settings.set(MODULE_ID, "confirmWrites", normalized.confirmWrites),
      game.settings.set(MODULE_ID, "retrievalTopK", normalized.retrievalTopK),
      game.settings.set(MODULE_ID, "chunkSize", normalized.chunkSize),
      game.settings.set(MODULE_ID, "indexJournalEntries", normalized.indexJournalEntries),
      game.settings.set(MODULE_ID, "indexScenes", normalized.indexScenes),
      game.settings.set(MODULE_ID, "indexActors", normalized.indexActors),
      game.settings.set(MODULE_ID, "indexItems", normalized.indexItems),
      game.settings.set(MODULE_ID, "indexRollTables", normalized.indexRollTables),
    ]);

    ui.notifications?.info(`${MODULE_TITLE} settings saved.`);
    logger.info("Settings updated.", normalized);
    await this.render(false);
  }

  async #onTestConnection(): Promise<void> {
    const normalized = this.#normalizeFormData(this._getSubmitData());
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

    await this.render(false);
  }

  #normalizeFormData(formData: Record<string, unknown>): SettingsMenuFormData {
    return {
      ollamaBaseUrl: this.#stringValue(
        formData.ollamaBaseUrl,
        AIDMSettings.getClientSettings().ollamaBaseUrl,
      ),
      chatModel: this.#stringValue(formData.chatModel, AIDMSettings.getClientSettings().chatModel),
      embeddingModel: this.#stringValue(
        formData.embeddingModel,
        AIDMSettings.getClientSettings().embeddingModel,
      ),
      requestTimeoutMs: this.#numberValue(
        formData.requestTimeoutMs,
        AIDMSettings.getClientSettings().requestTimeoutMs,
        1000,
      ),
      keepAlive: this.#stringValue(formData.keepAlive, AIDMSettings.getClientSettings().keepAlive),
      chatTemperature: this.#numberValue(
        formData.chatTemperature,
        AIDMSettings.getClientSettings().chatTemperature,
        0,
      ),
      chatNumCtx: this.#numberValue(
        formData.chatNumCtx,
        AIDMSettings.getClientSettings().chatNumCtx,
        1024,
      ),
      debugLogging: this.#booleanValue(formData.debugLogging),
      tonePreset: this.#stringValue(formData.tonePreset, AIDMSettings.getWorldSettings().tonePreset),
      confirmWrites: this.#booleanValue(formData.confirmWrites),
      retrievalTopK: this.#numberValue(
        formData.retrievalTopK,
        AIDMSettings.getWorldSettings().retrievalTopK,
        1,
      ),
      chunkSize: this.#numberValue(
        formData.chunkSize,
        AIDMSettings.getWorldSettings().chunkSize,
        200,
      ),
      indexJournalEntries: this.#booleanValue(formData.indexJournalEntries),
      indexScenes: this.#booleanValue(formData.indexScenes),
      indexActors: this.#booleanValue(formData.indexActors),
      indexItems: this.#booleanValue(formData.indexItems),
      indexRollTables: this.#booleanValue(formData.indexRollTables),
    };
  }

  #stringValue(value: unknown, fallback: string): string {
    const normalized = String(value ?? fallback).trim();
    return normalized.length > 0 ? normalized : fallback;
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
