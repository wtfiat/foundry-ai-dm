import { MODULE_ID, MODULE_TITLE } from "./constants.ts";

type LogMethod = "debug" | "info" | "warn" | "error";

type GameSettingsReader = {
  get: (namespace: string, key: string) => unknown;
};

function debugEnabled(): boolean {
  try {
    const settings = game.settings as unknown as GameSettingsReader | undefined;
    if (settings == null) {
      return true;
    }

    return Boolean(settings.get(MODULE_ID, "debugLogging"));
  } catch {
    return true;
  }
}

function write(method: LogMethod, ...args: unknown[]): void {
  if (method === "debug" && !debugEnabled()) {
    return;
  }

  console[method](`[${MODULE_TITLE}]`, ...args);
}

export const logger = {
  debug: (...args: unknown[]): void => {
    write("debug", ...args);
  },
  info: (...args: unknown[]): void => {
    write("info", ...args);
  },
  warn: (...args: unknown[]): void => {
    write("warn", ...args);
  },
  error: (...args: unknown[]): void => {
    write("error", ...args);
  },
};
