import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_NUM_CTX,
  DEFAULT_CHAT_TEMPERATURE,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_KEEP_ALIVE,
  DEFAULT_OLLAMA_BASE_URL,
  MODULE_ID,
} from "./constants.ts";
import { AIDMSettingsMenu } from "./settings-menu.ts";

export interface AIDMClientSettings {
  ollamaBaseUrl: string;
  chatModel: string;
  embeddingModel: string;
  requestTimeoutMs: number;
  keepAlive: string;
  chatTemperature: number;
  chatNumCtx: number;
  debugLogging: boolean;
  panelPosition: Record<string, number | null>;
  panelSize: Record<string, number | null>;
}

export interface AIDMWorldSettings {
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

const CLIENT_SETTING_KEYS = {
  ollamaBaseUrl: "ollamaBaseUrl",
  chatModel: "chatModel",
  embeddingModel: "embeddingModel",
  requestTimeoutMs: "requestTimeoutMs",
  keepAlive: "keepAlive",
  chatTemperature: "chatTemperature",
  chatNumCtx: "chatNumCtx",
  debugLogging: "debugLogging",
  panelPosition: "panelPosition",
  panelSize: "panelSize",
} as const;

const WORLD_SETTING_KEYS = {
  tonePreset: "tonePreset",
  confirmWrites: "confirmWrites",
  retrievalTopK: "retrievalTopK",
  chunkSize: "chunkSize",
  indexJournalEntries: "indexJournalEntries",
  indexScenes: "indexScenes",
  indexActors: "indexActors",
  indexItems: "indexItems",
  indexRollTables: "indexRollTables",
} as const;

function getSetting<T>(key: string): T {
  return game.settings.get(MODULE_ID, key) as T;
}

export function registerSettings(): void {
  game.settings.registerMenu(MODULE_ID, "configurationMenu", {
    name: "Foundry AI DM Configuration",
    label: "Configure",
    hint: "Configure the Ollama connection, indexing defaults, and development diagnostics.",
    icon: "fa-solid fa-wand-magic-sparkles",
    type: AIDMSettingsMenu,
    restricted: true,
  });

  game.settings.register(MODULE_ID, CLIENT_SETTING_KEYS.ollamaBaseUrl, {
    name: "Ollama Base URL",
    scope: "client",
    config: false,
    type: String,
    default: DEFAULT_OLLAMA_BASE_URL,
  });

  game.settings.register(MODULE_ID, CLIENT_SETTING_KEYS.chatModel, {
    name: "Chat Model",
    scope: "client",
    config: false,
    type: String,
    default: DEFAULT_CHAT_MODEL,
  });

  game.settings.register(MODULE_ID, CLIENT_SETTING_KEYS.embeddingModel, {
    name: "Embedding Model",
    scope: "client",
    config: false,
    type: String,
    default: DEFAULT_EMBEDDING_MODEL,
  });

  game.settings.register(MODULE_ID, CLIENT_SETTING_KEYS.requestTimeoutMs, {
    name: "Request Timeout (ms)",
    scope: "client",
    config: false,
    type: Number,
    default: 120000,
  });

  game.settings.register(MODULE_ID, CLIENT_SETTING_KEYS.keepAlive, {
    name: "Model Keep Alive",
    scope: "client",
    config: false,
    type: String,
    default: DEFAULT_KEEP_ALIVE,
  });

  game.settings.register(MODULE_ID, CLIENT_SETTING_KEYS.chatTemperature, {
    name: "Chat Temperature",
    scope: "client",
    config: false,
    type: Number,
    default: DEFAULT_CHAT_TEMPERATURE,
  });

  game.settings.register(MODULE_ID, CLIENT_SETTING_KEYS.chatNumCtx, {
    name: "Chat Context Window",
    scope: "client",
    config: false,
    type: Number,
    default: DEFAULT_CHAT_NUM_CTX,
  });

  game.settings.register(MODULE_ID, CLIENT_SETTING_KEYS.debugLogging, {
    name: "Debug Logging",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, CLIENT_SETTING_KEYS.panelPosition, {
    name: "Panel Position",
    scope: "client",
    config: false,
    type: Object,
    default: {
      left: null,
      top: null,
    },
  });

  game.settings.register(MODULE_ID, CLIENT_SETTING_KEYS.panelSize, {
    name: "Panel Size",
    scope: "client",
    config: false,
    type: Object,
    default: {
      width: null,
      height: null,
    },
  });

  game.settings.register(MODULE_ID, WORLD_SETTING_KEYS.tonePreset, {
    name: "Tone Preset",
    scope: "world",
    config: false,
    type: String,
    default: "classic-fantasy-dm",
  });

  game.settings.register(MODULE_ID, WORLD_SETTING_KEYS.confirmWrites, {
    name: "Confirm Writes",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, WORLD_SETTING_KEYS.retrievalTopK, {
    name: "Retrieval Top-K",
    scope: "world",
    config: false,
    type: Number,
    default: 8,
  });

  game.settings.register(MODULE_ID, WORLD_SETTING_KEYS.chunkSize, {
    name: "Chunk Size",
    scope: "world",
    config: false,
    type: Number,
    default: 1200,
  });

  for (const [key, name] of [
    [WORLD_SETTING_KEYS.indexJournalEntries, "Index Journal Entries"],
    [WORLD_SETTING_KEYS.indexScenes, "Index Scenes"],
    [WORLD_SETTING_KEYS.indexActors, "Index Actors"],
    [WORLD_SETTING_KEYS.indexItems, "Index World Items"],
    [WORLD_SETTING_KEYS.indexRollTables, "Index Roll Tables"],
  ] as const) {
    game.settings.register(MODULE_ID, key, {
      name,
      scope: "world",
      config: false,
      type: Boolean,
      default: true,
    });
  }
}

export class AIDMSettings {
  static getClientSettings(): AIDMClientSettings {
    return {
      ollamaBaseUrl: getSetting<string>(CLIENT_SETTING_KEYS.ollamaBaseUrl),
      chatModel: getSetting<string>(CLIENT_SETTING_KEYS.chatModel),
      embeddingModel: getSetting<string>(CLIENT_SETTING_KEYS.embeddingModel),
      requestTimeoutMs: getSetting<number>(CLIENT_SETTING_KEYS.requestTimeoutMs),
      keepAlive: getSetting<string>(CLIENT_SETTING_KEYS.keepAlive),
      chatTemperature: getSetting<number>(CLIENT_SETTING_KEYS.chatTemperature),
      chatNumCtx: getSetting<number>(CLIENT_SETTING_KEYS.chatNumCtx),
      debugLogging: getSetting<boolean>(CLIENT_SETTING_KEYS.debugLogging),
      panelPosition: getSetting<Record<string, number | null>>(CLIENT_SETTING_KEYS.panelPosition),
      panelSize: getSetting<Record<string, number | null>>(CLIENT_SETTING_KEYS.panelSize),
    };
  }

  static getWorldSettings(): AIDMWorldSettings {
    return {
      tonePreset: getSetting<string>(WORLD_SETTING_KEYS.tonePreset),
      confirmWrites: getSetting<boolean>(WORLD_SETTING_KEYS.confirmWrites),
      retrievalTopK: getSetting<number>(WORLD_SETTING_KEYS.retrievalTopK),
      chunkSize: getSetting<number>(WORLD_SETTING_KEYS.chunkSize),
      indexJournalEntries: getSetting<boolean>(WORLD_SETTING_KEYS.indexJournalEntries),
      indexScenes: getSetting<boolean>(WORLD_SETTING_KEYS.indexScenes),
      indexActors: getSetting<boolean>(WORLD_SETTING_KEYS.indexActors),
      indexItems: getSetting<boolean>(WORLD_SETTING_KEYS.indexItems),
      indexRollTables: getSetting<boolean>(WORLD_SETTING_KEYS.indexRollTables),
    };
  }

  static getAllSettings(): AIDMClientSettings & AIDMWorldSettings {
    return {
      ...this.getClientSettings(),
      ...this.getWorldSettings(),
    };
  }
}
