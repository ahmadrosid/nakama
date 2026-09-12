export {
  type Connection,
  normalizeUrl,
  SupermemoryClient,
  SupermemoryError,
} from "@nakama/core/supermemory-client";

import { normalizeUrl } from "@nakama/core/supermemory-client";

export interface ExtractionConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  revision: string;
}

export async function validateExtraction(
  config: ExtractionConfig
): Promise<void> {
  if (
    !(config.apiKey?.trim() && config.model?.trim() && config.revision?.trim())
  ) {
    throw new Error(
      "Configure an extraction API key and model in Supermemory Settings"
    );
  }
  const response = await fetch(
    `${normalizeUrl(config.baseUrl)}/chat/completions`,
    {
      body: JSON.stringify({
        messages: [
          { content: "Return JSON with ok set to true.", role: "user" },
        ],
        model: config.model,
        response_format: {
          json_schema: {
            name: "connection_check",
            schema: {
              additionalProperties: false,
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
              type: "object",
            },
            strict: true,
          },
          type: "json_schema",
        },
      }),
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    }
  );
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const reason =
      typeof body?.error?.message === "string"
        ? body.error.message
        : `HTTP ${response.status}`;
    throw new Error(
      `Extraction provider rejected the check: ${reason
        .replaceAll(config.apiKey, "[REDACTED]")
        .replace(/Bearer\s+[^\s,"}]+/gi, "Bearer [REDACTED]")
        .slice(0, 300)}`
    );
  }
  const body = await response.json().catch(() => ({}));
  const content = body?.choices?.[0]?.message?.content;
  let valid = false;
  try {
    valid = typeof content === "string" && JSON.parse(content)?.ok === true;
  } catch {
    // Do not expose model output in validation errors.
  }
  if (!valid) {
    throw new Error(
      "Extraction model did not return the required structured response"
    );
  }
}
