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

export interface PanelPosition {
  left: number | null;
  top: number | null;
}

export interface PanelSize {
  width: number | null;
  height: number | null;
}

export interface AIDMClientSettings {
  ollamaBaseUrl: string;
  chatModel: string;
  embeddingModel: string;
  requestTimeoutMs: number;
  keepAlive: string;
  chatTemperature: number;
  chatNumCtx: number;
  debugLogging: boolean;
  panelPosition: PanelPosition;
  panelSize: PanelSize;
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

type SettingValue = string | number | boolean | PanelPosition | PanelSize;

type GameSettingsApi = {
  registerMenu: (namespace: string, key: string, data: Record<string, unknown>) => void;
  register: (namespace: string, key: string, data: Record<string, unknown>) => void;
  get: (namespace: string, key: string) => unknown;
  set: (namespace: string, key: string, value: SettingValue) => Promise<unknown>;
};

export const CLIENT_SETTING_KEYS = {
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

export const WORLD_SETTING_KEYS = {
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

function getGameSettings(): GameSettingsApi {
  if (game.settings == null) {
    throw new Error("Foundry game settings are not available yet.");
  }

  return game.settings as unknown as GameSettingsApi;
}

function getSetting(key: string): unknown {
  return getGameSettings().get(MODULE_ID, key);
}

async function setManySettings(values: Record<string, SettingValue>): Promise<void> {
  const settings = getGameSettings();
  await Promise.all(
    Object.entries(values).map(([key, value]) => settings.set(MODULE_ID, key, value)),
  );
}

export function registerSettings(): void {
  const settings = getGameSettings();

  settings.registerMenu(MODULE_ID, "configurationMenu", {
    name: "Foundry AI DM Configuration",
    label: "Configure",
    hint: "Configure the Ollama connection, indexing defaults, and development diagnostics.",
    icon: "fa-solid fa-wand-magic-sparkles",
    type: AIDMSettingsMenu as unknown as { new (): object },
    restricted: true,
  });

  settings.register(MODULE_ID, CLIENT_SETTING_KEYS.ollamaBaseUrl, {
    name: "Ollama Base URL",
    scope: "client",
    config: false,
    type: String,
    default: DEFAULT_OLLAMA_BASE_URL,
  });

  settings.register(MODULE_ID, CLIENT_SETTING_KEYS.chatModel, {
    name: "Chat Model",
    scope: "client",
    config: false,
    type: String,
    default: DEFAULT_CHAT_MODEL,
  });

  settings.register(MODULE_ID, CLIENT_SETTING_KEYS.embeddingModel, {
    name: "Embedding Model",
    scope: "client",
    config: false,
    type: String,
    default: DEFAULT_EMBEDDING_MODEL,
  });

  settings.register(MODULE_ID, CLIENT_SETTING_KEYS.requestTimeoutMs, {
    name: "Request Timeout (ms)",
    scope: "client",
    config: false,
    type: Number,
    default: 120000,
  });

  settings.register(MODULE_ID, CLIENT_SETTING_KEYS.keepAlive, {
    name: "Model Keep Alive",
    scope: "client",
    config: false,
    type: String,
    default: DEFAULT_KEEP_ALIVE,
  });

  settings.register(MODULE_ID, CLIENT_SETTING_KEYS.chatTemperature, {
    name: "Chat Temperature",
    scope: "client",
    config: false,
    type: Number,
    default: DEFAULT_CHAT_TEMPERATURE,
  });

  settings.register(MODULE_ID, CLIENT_SETTING_KEYS.chatNumCtx, {
    name: "Chat Context Window",
    scope: "client",
    config: false,
    type: Number,
    default: DEFAULT_CHAT_NUM_CTX,
  });

  settings.register(MODULE_ID, CLIENT_SETTING_KEYS.debugLogging, {
    name: "Debug Logging",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
  });

  settings.register(MODULE_ID, CLIENT_SETTING_KEYS.panelPosition, {
    name: "Panel Position",
    scope: "client",
    config: false,
    type: Object,
    default: {
      left: null,
      top: null,
    },
  });

  settings.register(MODULE_ID, CLIENT_SETTING_KEYS.panelSize, {
    name: "Panel Size",
    scope: "client",
    config: false,
    type: Object,
    default: {
      width: null,
      height: null,
    },
  });

  settings.register(MODULE_ID, WORLD_SETTING_KEYS.tonePreset, {
    name: "Tone Preset",
    scope: "world",
    config: false,
    type: String,
    default: "classic-fantasy-dm",
  });

  settings.register(MODULE_ID, WORLD_SETTING_KEYS.confirmWrites, {
    name: "Confirm Writes",
    scope: "world",
    config: false,
    type: Boolean,
    default: true,
  });

  settings.register(MODULE_ID, WORLD_SETTING_KEYS.retrievalTopK, {
    name: "Retrieval Top-K",
    scope: "world",
    config: false,
    type: Number,
    default: 8,
  });

  settings.register(MODULE_ID, WORLD_SETTING_KEYS.chunkSize, {
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
    settings.register(MODULE_ID, key, {
      name,
      scope: "world",
      config: false,
      type: Boolean,
      default: true,
    });
  }
}

export const AIDMSettings = {
  getClientSettings(): AIDMClientSettings {
    return {
      ollamaBaseUrl: getSetting(CLIENT_SETTING_KEYS.ollamaBaseUrl) as string,
      chatModel: getSetting(CLIENT_SETTING_KEYS.chatModel) as string,
      embeddingModel: getSetting(CLIENT_SETTING_KEYS.embeddingModel) as string,
      requestTimeoutMs: getSetting(CLIENT_SETTING_KEYS.requestTimeoutMs) as number,
      keepAlive: getSetting(CLIENT_SETTING_KEYS.keepAlive) as string,
      chatTemperature: getSetting(CLIENT_SETTING_KEYS.chatTemperature) as number,
      chatNumCtx: getSetting(CLIENT_SETTING_KEYS.chatNumCtx) as number,
      debugLogging: getSetting(CLIENT_SETTING_KEYS.debugLogging) as boolean,
      panelPosition: getSetting(CLIENT_SETTING_KEYS.panelPosition) as PanelPosition,
      panelSize: getSetting(CLIENT_SETTING_KEYS.panelSize) as PanelSize,
    };
  },

  getWorldSettings(): AIDMWorldSettings {
    return {
      tonePreset: getSetting(WORLD_SETTING_KEYS.tonePreset) as string,
      confirmWrites: getSetting(WORLD_SETTING_KEYS.confirmWrites) as boolean,
      retrievalTopK: getSetting(WORLD_SETTING_KEYS.retrievalTopK) as number,
      chunkSize: getSetting(WORLD_SETTING_KEYS.chunkSize) as number,
      indexJournalEntries: getSetting(WORLD_SETTING_KEYS.indexJournalEntries) as boolean,
      indexScenes: getSetting(WORLD_SETTING_KEYS.indexScenes) as boolean,
      indexActors: getSetting(WORLD_SETTING_KEYS.indexActors) as boolean,
      indexItems: getSetting(WORLD_SETTING_KEYS.indexItems) as boolean,
      indexRollTables: getSetting(WORLD_SETTING_KEYS.indexRollTables) as boolean,
    };
  },

  getAllSettings(): AIDMClientSettings & AIDMWorldSettings {
    return {
      ...this.getClientSettings(),
      ...this.getWorldSettings(),
    };
  },

  async setAll(values: Record<string, SettingValue>): Promise<void> {
    await setManySettings(values);
  },
};
