import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { bypass, http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

export type LlmCassetteMode = "auto" | "record" | "replay";

export type LlmCassette = {
  version: 1;
  name: string;
  recordedAt: string;
  request: {
    method: string;
    url: string;
  };
  response: {
    status: number;
    body: unknown;
  };
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
 * - replay: serve cassette (no network)
 * - record: hit the real API with `bypass()`, then save cassette
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

  let recorded: LlmCassette | null = null;

  server.use(
    http.post(url, async ({ request }) => {
      if (shouldReplay && existing) {
        return HttpResponse.json(existing.response.body, {
          status: existing.response.status,
        });
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

      recorded = {
        version: 1,
        name,
        recordedAt: new Date().toISOString(),
        request: {
          method: "POST",
          url: request.url,
        },
        response: {
          status: response.status,
          body,
        },
      };

      return HttpResponse.json(body, { status: response.status });
    }),
  );

  server.listen({ onUnhandledRequest: "bypass" });

  try {
    const result = await fn();

    if (recorded) {
      await saveCassette(filePath, recorded);
    }

    return result;
  } finally {
    server.resetHandlers();
    server.close();
  }
}
