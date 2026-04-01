import { MODULE_ID, MODULE_TITLE } from "./constants.ts";

type LogMethod = "debug" | "info" | "warn" | "error";

function debugEnabled(): boolean {
  try {
    return game.settings.get(MODULE_ID, "debugLogging") as boolean;
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
  debug: (...args: unknown[]) => write("debug", ...args),
  info: (...args: unknown[]) => write("info", ...args),
  warn: (...args: unknown[]) => write("warn", ...args),
  error: (...args: unknown[]) => write("error", ...args),
};
