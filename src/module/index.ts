import { MODULE_ID, MODULE_TITLE } from "./constants.ts";
import { logger } from "./logger.ts";
import { OllamaClient } from "./ollama/client.ts";
import { runOllamaDiagnostics } from "./ollama/diagnostics.ts";
import { openAIDMPanel, toggleAIDMPanel } from "./panel.ts";
import { registerSettings, AIDMSettings } from "./settings.ts";

type SceneControlToolRecord = Record<string, Record<string, unknown>> & {
  tools?: Record<string, Record<string, unknown>>;
};

type SceneControlsRecord = Record<string, SceneControlToolRecord>;

Hooks.once("init", () => {
  logger.info(`Initializing ${MODULE_TITLE}.`);
  registerSettings();

  const moduleData = game.modules?.get(MODULE_ID) as
    | ({ api?: unknown } & Record<string, unknown>)
    | undefined;
  if (moduleData === undefined) {
    logger.warn(`Unable to locate module data for ${MODULE_ID}.`);
    return;
  }

  moduleData.api = {
    createOllamaClient: () =>
      new OllamaClient({
        baseUrl: AIDMSettings.getClientSettings().ollamaBaseUrl,
        timeoutMs: AIDMSettings.getClientSettings().requestTimeoutMs,
      }),
    getSettingsSnapshot: () => AIDMSettings.getAllSettings(),
    runDiagnostics: () =>
      runOllamaDiagnostics({
        client: {
          baseUrl: AIDMSettings.getClientSettings().ollamaBaseUrl,
          timeoutMs: AIDMSettings.getClientSettings().requestTimeoutMs,
        },
        expectedChatModel: AIDMSettings.getClientSettings().chatModel,
        expectedEmbeddingModel: AIDMSettings.getClientSettings().embeddingModel,
      }),
    openPanel: () => openAIDMPanel(),
    togglePanel: () => toggleAIDMPanel(),
  };
});

Hooks.once("ready", () => {
  logger.info(`${MODULE_TITLE} is ready.`);

  if (!game.user?.isGM) {
    logger.debug("Skipping GM-only runtime initialization for non-GM user.");
    return;
  }

  logger.debug("Current AI DM settings snapshot.", AIDMSettings.getAllSettings());
});

Hooks.on("getSceneControlButtons", (controls: SceneControlsRecord) => {
  if (!game.user?.isGM) {
    return;
  }

  const tokenControls = controls["tokens"];
  const tools = tokenControls?.tools;
  if (tools == null) {
    logger.warn("Unable to register AI DM panel toggle: token scene controls were unavailable.");
    return;
  }

  tools[MODULE_ID] = {
    name: MODULE_ID,
    title: `${MODULE_TITLE} Panel`,
    icon: "fa-solid fa-wand-sparkles",
    order: Object.keys(tools).length,
    button: true,
    visible: true,
    onChange: () => {
      toggleAIDMPanel();
    },
  };
});
