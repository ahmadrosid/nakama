import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { bypass, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export type LlmCassetteMode = "auto" | "record" | "replay";

export type LlmCassetteExchange = {
  request: {
    method: string;
    url: string;
    /** Chat completions JSON body (messages, tools, model, …). */
    body?: unknown;
  };
  response: {
    status: number;
    body: unknown;
  };
};

export type LlmCassette = {
  version: 1 | 2;
  name: string;
  recordedAt: string;
  /** @deprecated Prefer `exchanges`. Kept for v1 cassettes. */
  request?: LlmCassetteExchange["request"];
  /** @deprecated Prefer `exchanges`. Kept for v1 cassettes. */
  response?: LlmCassetteExchange["response"];
  exchanges?: LlmCassetteExchange[];
};

/** Shared cassette root for all server LLM live tests. */
export const LLM_CASSETTES_DIR = join(import.meta.dir, "cassettes");

const server = setupServer();

function resolveMode(explicit?: LlmCassetteMode): LlmCassetteMode {
  if (explicit) {
    return explicit;
  }

  const fromEnv = process.env.LLM_VCR_MODE?.trim().toLowerCase();
  if (fromEnv === "record" || fromEnv === "replay" || fromEnv === "auto") {
    return fromEnv;
  }

  return process.env.CI ? "replay" : "auto";
}

export function cassetteFilePath(
  name: string,
  cassettesDir: string = LLM_CASSETTES_DIR,
): string {
  return join(cassettesDir, `${name.replaceAll("/", "-")}.json`);
}

export function normalizeCassetteExchanges(cassette: LlmCassette): LlmCassetteExchange[] {
  if (cassette.exchanges?.length) {
    return cassette.exchanges;
  }

  if (cassette.request && cassette.response) {
    return [
      {
        request: cassette.request,
        response: cassette.response,
      },
    ];
  }

  return [];
}

export async function loadCassette(filePath: string): Promise<LlmCassette | null> {
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return null;
  }

  return (await file.json()) as LlmCassette;
}

export async function saveCassette(filePath: string, cassette: LlmCassette): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await Bun.write(filePath, `${JSON.stringify(cassette, null, 2)}\n`);
}

/**
 * Record/replay LLM HTTP via MSW.
 *
 * Supports multiple exchanges per cassette (multi-turn chats).
 * v1 single request/response cassettes still replay.
 *
 * - replay: serve cassette exchanges in order (no network)
 * - record: hit the real API with `bypass()`, then save all exchanges
 * - auto: replay if cassette exists, otherwise record
 */
export async function withMswCassette<T>(
  name: string,
  fn: () => Promise<T>,
  options: {
    cassettesDir?: string;
    mode?: LlmCassetteMode;
    /** URL pattern for MSW. Defaults to OpenAI chat completions. */
    url?: string | RegExp;
  } = {},
): Promise<T> {
  const mode = resolveMode(options.mode);
  const cassettesDir = options.cassettesDir ?? LLM_CASSETTES_DIR;
  const filePath = cassetteFilePath(name, cassettesDir);
  const existing = await loadCassette(filePath);
  const url = options.url ?? "https://api.openai.com/v1/chat/completions";

  const shouldReplay = mode === "replay" || (mode === "auto" && existing !== null);
  if (shouldReplay && !existing) {
    throw new Error(
      `MSW cassette missing: ${filePath}. Record with LLM_VCR_MODE=record.`,
    );
  }

  const replayExchanges = existing ? normalizeCassetteExchanges(existing) : [];
  let replayIndex = 0;
  const recordedExchanges: LlmCassetteExchange[] = [];

  server.use(
    http.post(url, async ({ request }) => {
      if (shouldReplay) {
        const exchange = replayExchanges[replayIndex];
        if (!exchange) {
          throw new Error(
            `MSW cassette ${name} ran out of exchanges at index ${replayIndex}. Re-record with LLM_VCR_MODE=record.`,
          );
        }
        replayIndex += 1;
        return HttpResponse.json(exchange.response.body, {
          status: exchange.response.status,
        });
      }

      const requestBodyText = await request.clone().text();
      let requestBody: unknown = requestBodyText;
      try {
        requestBody = JSON.parse(requestBodyText);
      } catch {
        // keep raw text
      }

      const response = await fetch(bypass(request));
      const contentType = response.headers.get("content-type") ?? "";
      const body = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

      if (!response.ok) {
        const detail = typeof body === "string" ? body : JSON.stringify(body);
        throw new Error(`LLM request failed (${response.status}): ${detail}`);
      }

      recordedExchanges.push({
        request: {
          method: "POST",
          url: request.url,
          body: requestBody,
        },
        response: {
          status: response.status,
          body,
        },
      });

      return HttpResponse.json(body, { status: response.status });
    }),
  );

  server.listen({ onUnhandledRequest: "bypass" });

  try {
    const result = await fn();

    if (recordedExchanges.length > 0) {
      const first = recordedExchanges[0]!;
      await saveCassette(filePath, {
        version: recordedExchanges.length > 1 ? 2 : 1,
        name,
        recordedAt: new Date().toISOString(),
        request: first.request,
        response: first.response,
        ...(recordedExchanges.length > 1 ? { exchanges: recordedExchanges } : {}),
      });
    }

    return result;
  } finally {
    server.resetHandlers();
    server.close();
  }
}
