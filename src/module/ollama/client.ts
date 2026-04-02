export interface OllamaClientConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface OllamaVersionResponse {
  version: string;
}

export interface OllamaModelSummary {
  name: string;
  model: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: {
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface OllamaModelListResponse {
  models: OllamaModelSummary[];
}

export interface OllamaRunningModelSummary {
  name: string;
  model: string;
  size?: number;
  digest?: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
  expires_at?: string;
  size_vram?: number;
}

export interface OllamaRunningModelListResponse {
  models: OllamaRunningModelSummary[];
}

export type OllamaRole = "system" | "user" | "assistant" | "tool";

export interface OllamaChatMessage {
  role: OllamaRole;
  content: string;
  thinking?: string;
  images?: string[];
  tool_calls?: unknown[];
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  think?: boolean;
  format?: object | string;
  keep_alive?: string | number;
  options?: Record<string, unknown>;
  tools?: unknown[];
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaChatMessage;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaEmbedRequest {
  model: string;
  input: string | string[];
  truncate?: boolean;
  keep_alive?: string | number;
}

export interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
}

export type OllamaErrorCode = "network" | "timeout" | "http" | "parse" | "configuration";

export class OllamaRequestError extends Error {
  readonly code: OllamaErrorCode;
  readonly url: string;
  readonly status?: number;
  readonly causeValue?: unknown;

  constructor(options: {
    code: OllamaErrorCode;
    message: string;
    url: string;
    status?: number;
    cause?: unknown;
  }) {
    super(options.message);
    this.name = "OllamaRequestError";
    this.code = options.code;
    this.url = options.url;
    this.status = options.status;
    this.causeValue = options.cause;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function safeReadText(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
}

function normalizeUnknownError(error: unknown, url: string, timedOut: boolean): OllamaRequestError {
  if (error instanceof OllamaRequestError) {
    return error;
  }

  if (timedOut) {
    return new OllamaRequestError({
      code: "timeout",
      message: `Request to ${url} timed out.`,
      url,
      cause: error,
    });
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return new OllamaRequestError({
      code: "timeout",
      message: `Request to ${url} was aborted.`,
      url,
      cause: error,
    });
  }

  return new OllamaRequestError({
    code: "network",
    message: `Unable to reach ${url}.`,
    url,
    cause: error,
  });
}

export class OllamaClient {
  readonly #baseUrl: string;
  readonly #timeoutMs: number;

  constructor(config: OllamaClientConfig) {
    try {
      this.#baseUrl = normalizeBaseUrl(new URL(config.baseUrl).toString());
    } catch (error) {
      throw new OllamaRequestError({
        code: "configuration",
        message: `Invalid Ollama base URL: ${config.baseUrl}`,
        url: config.baseUrl,
        cause: error,
      });
    }

    this.#timeoutMs = config.timeoutMs;
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  async getVersion(): Promise<OllamaVersionResponse> {
    return this.#requestJson<OllamaVersionResponse>("/api/version", {
      method: "GET",
    });
  }

  async listModels(): Promise<OllamaModelListResponse> {
    return this.#requestJson<OllamaModelListResponse>("/api/tags", {
      method: "GET",
    });
  }

  async listRunningModels(): Promise<OllamaRunningModelListResponse> {
    return this.#requestJson<OllamaRunningModelListResponse>("/api/ps", {
      method: "GET",
    });
  }

  async chat(request: OllamaChatRequest): Promise<OllamaChatResponse> {
    return this.#requestJson<OllamaChatResponse>("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...request,
        stream: false,
      }),
    });
  }

  async chatStream(
    request: OllamaChatRequest,
    handlers: {
      onChunk?: (chunk: OllamaChatResponse) => void;
      onComplete?: (chunk: OllamaChatResponse) => void;
    } = {},
  ): Promise<OllamaChatResponse> {
    const url = new URL("/api/chat", this.#baseUrl).toString();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...request,
          stream: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new OllamaRequestError({
          code: "http",
          message: `Ollama returned HTTP ${response.status} for ${url}`,
          url,
          status: response.status,
          cause: await safeReadText(response),
        });
      }

      if (response.body == null) {
        throw new OllamaRequestError({
          code: "parse",
          message: `Ollama returned an empty streaming body for ${url}`,
          url,
        });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastChunk: OllamaChatResponse | undefined;

      let streamDone = false;
      while (!streamDone) {
        const { value, done } = await reader.read();
        streamDone = done;
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (line.length > 0) {
            lastChunk = this.#parseStreamChunk(line, url);
            handlers.onChunk?.(lastChunk);
          }

          newlineIndex = buffer.indexOf("\n");
        }
      }

      const remainder = buffer.trim();
      if (remainder.length > 0) {
        lastChunk = this.#parseStreamChunk(remainder, url);
        handlers.onChunk?.(lastChunk);
      }

      if (lastChunk == null) {
        throw new OllamaRequestError({
          code: "parse",
          message: `Ollama returned no streaming chunks for ${url}`,
          url,
        });
      }

      handlers.onComplete?.(lastChunk);
      return lastChunk;
    } catch (error) {
      throw normalizeUnknownError(error, url, timedOut);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async embed(request: OllamaEmbedRequest): Promise<OllamaEmbedResponse> {
    return this.#requestJson<OllamaEmbedResponse>("/api/embed", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });
  }

  async #requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const url = new URL(path, this.#baseUrl).toString();
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new OllamaRequestError({
          code: "http",
          message: `Ollama returned HTTP ${response.status} for ${url}`,
          url,
          status: response.status,
          cause: await safeReadText(response),
        });
      }

      try {
        return (await response.json()) as T;
      } catch (error) {
        throw new OllamaRequestError({
          code: "parse",
          message: `Ollama returned invalid JSON for ${url}`,
          url,
          cause: error,
        });
      }
    } catch (error) {
      throw normalizeUnknownError(error, url, timedOut);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  #parseStreamChunk(line: string, url: string): OllamaChatResponse {
    try {
      return JSON.parse(line) as OllamaChatResponse;
    } catch (error) {
      throw new OllamaRequestError({
        code: "parse",
        message: `Unable to parse Ollama streaming response from ${url}`,
        url,
        cause: error,
      });
    }
  }
}
