import { MODULE_ID, MODULE_TITLE } from "./constants.ts";
import { logger } from "./logger.ts";
import { OllamaClient } from "./ollama/client.ts";
import { runOllamaDiagnostics } from "./ollama/diagnostics.ts";
import { registerSettings, AIDMSettings } from "./settings.ts";

Hooks.once("init", () => {
  logger.info(`Initializing ${MODULE_TITLE}.`);
  registerSettings();

  const moduleData = game.modules.get(MODULE_ID);
  if (moduleData != null) {
    Object.assign(moduleData, {
      api: {
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
      },
    });
  }
});

Hooks.once("ready", () => {
  logger.info(`${MODULE_TITLE} is ready.`);

  if (!game.user?.isGM) {
    logger.debug("Skipping GM-only runtime initialization for non-GM user.");
    return;
  }

  logger.debug("Current AI DM settings snapshot.", AIDMSettings.getAllSettings());
});
