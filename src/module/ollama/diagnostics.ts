import { logger } from "../logger.ts";
import {
  OllamaClient,
  OllamaRequestError,
  type OllamaClientConfig,
  type OllamaModelSummary,
  type OllamaRunningModelSummary,
} from "./client.ts";

export interface OllamaDiagnosticsInput {
  client: OllamaClientConfig;
  expectedChatModel: string;
  expectedEmbeddingModel: string;
  browserOrigin?: string;
}

export interface OllamaDiagnosticsResult {
  status: "ok" | "warning" | "error";
  summary: string;
  configuredBaseUrl: string;
  browserOrigin: string;
  version?: string;
  availableModels: string[];
  runningModels: string[];
  missingModels: string[];
  details: string[];
  suggestedEnv?: string;
  troubleshooting: string[];
}

function normalizeModelNames(models: OllamaModelSummary[] | OllamaRunningModelSummary[]): string[] {
  return models
    .map((model) => model.name || model.model)
    .filter((name): name is string => name.trim().length > 0)
    .sort((left, right) => left.localeCompare(right));
}

function isLoopbackHost(hostName: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(hostName);
}

function buildSuggestedEnv(browserOrigin: string): string {
  return [
    "OLLAMA_HOST=0.0.0.0:11434",
    `OLLAMA_ORIGINS=${browserOrigin}`,
    "OLLAMA_NO_CLOUD=1",
  ].join("\n");
}

export async function runOllamaDiagnostics(
  input: OllamaDiagnosticsInput,
): Promise<OllamaDiagnosticsResult> {
  const browserOrigin = input.browserOrigin ?? window.location.origin;
  let parsedBaseUrl: URL;

  try {
    parsedBaseUrl = new URL(input.client.baseUrl);
  } catch {
    return {
      status: "error",
      summary: "The configured Ollama base URL is not a valid URL.",
      configuredBaseUrl: input.client.baseUrl,
      browserOrigin,
      availableModels: [],
      runningModels: [],
      missingModels: [input.expectedChatModel, input.expectedEmbeddingModel],
      details: ["Use a full URL such as http://192.168.0.190:11434 or http://localhost:11434."],
      troubleshooting: ["Open the module settings and correct the Ollama base URL."],
    };
  }

  const client = new OllamaClient(input.client);
  const suggestedEnv = buildSuggestedEnv(browserOrigin);
  const troubleshooting: string[] = [];

  try {
    const version = await client.getVersion();
    const modelList = await client.listModels();
    let runningModelList: string[] = [];

    try {
      runningModelList = normalizeModelNames((await client.listRunningModels()).models);
    } catch (error) {
      logger.warn("Unable to list running Ollama models.", error);
      troubleshooting.push("The /api/ps endpoint did not respond, so the running-model list is unavailable.");
    }

    const availableModels = normalizeModelNames(modelList.models);
    const missingModels = [input.expectedChatModel, input.expectedEmbeddingModel].filter(
      (modelName) => !availableModels.includes(modelName),
    );

    const details: string[] = [];
    if (runningModelList.length === 0) {
      details.push(
        "No models are currently loaded in memory. The first request may be slower while Ollama loads the model.",
      );
    }

    if (missingModels.length > 0) {
      details.push(`Missing configured models: ${missingModels.join(", ")}.`);
      troubleshooting.push(
        ...missingModels.map((modelName) => `Install ${modelName} with: ollama pull ${modelName}`),
      );
    }

    return {
      status: missingModels.length > 0 ? "warning" : "ok",
      summary:
        missingModels.length > 0
          ? "Ollama is reachable, but one or more configured models are not installed."
          : "Ollama is reachable and the configured models are installed.",
      configuredBaseUrl: input.client.baseUrl,
      browserOrigin,
      version: version.version,
      availableModels,
      runningModels: runningModelList,
      missingModels,
      details,
      suggestedEnv,
      troubleshooting,
    };
  } catch (error) {
    const details: string[] = [];

    if (error instanceof OllamaRequestError) {
      details.push(error.message);
      if (error.status != null) {
        details.push(`HTTP status: ${String(error.status)}`);
      }
    } else {
      details.push("The browser could not complete the request to Ollama.");
    }

    if (isLoopbackHost(parsedBaseUrl.hostname) && parsedBaseUrl.hostname !== window.location.hostname) {
      troubleshooting.push(
        "The configured Ollama URL points at browser-localhost. That only works when the GM browser is running on the same machine as Ollama.",
      );
    }

    if (window.location.protocol === "https:" && parsedBaseUrl.protocol !== "https:") {
      troubleshooting.push(
        "Your Foundry page is HTTPS while Ollama is HTTP. Browsers usually block that as mixed content unless both are served compatibly.",
      );
    }

    troubleshooting.push(
      "Confirm that Ollama is running and reachable from the GM browser.",
      `If Ollama is on another machine, allow the Foundry origin in OLLAMA_ORIGINS. Suggested values:\n${suggestedEnv}`,
      "If Ollama should be reachable over the LAN, confirm it is bound to 0.0.0.0:11434 instead of localhost only.",
    );

    return {
      status: "error",
      summary: "The browser could not reach the configured Ollama endpoint.",
      configuredBaseUrl: input.client.baseUrl,
      browserOrigin,
      availableModels: [],
      runningModels: [],
      missingModels: [input.expectedChatModel, input.expectedEmbeddingModel],
      details,
      suggestedEnv,
      troubleshooting,
    };
  }
}
