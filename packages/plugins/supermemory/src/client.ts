export {
  type Connection,
  normalizeUrl,
  SupermemoryClient,
  SupermemoryError,
} from "@nakama/core/supermemory-client";

import { normalizeUrl } from "@nakama/core/supermemory-client";

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonRecord = { [key: string]: JsonValue };

function asJsonRecord(value: JsonValue): JsonRecord | null {
  return value instanceof Object && !Array.isArray(value) ? value : null;
}

function readString(value: JsonValue | undefined): string | null {
  return value === String(value) ? value : null;
}

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
    const body: JsonValue = await response.json().catch(() => ({}));
    const bodyRecord = asJsonRecord(body);

    const errorRecord = bodyRecord?.error
      ? asJsonRecord(bodyRecord.error)
      : null;

    const message = errorRecord && readString(errorRecord.message);

    const reason = message ?? `HTTP ${response.status}`;

    throw new Error(
      `Extraction provider rejected the check: ${reason
        .replaceAll(config.apiKey, "[REDACTED]")
        .replace(/Bearer\s+[^\s,"}]+/gi, "Bearer [REDACTED]")
        .slice(0, 300)}`
    );
  }

  const body: JsonValue = await response.json().catch(() => ({}));
  const bodyRecord = asJsonRecord(body);
  const choices = bodyRecord?.choices;
  const firstChoice = Array.isArray(choices) ? choices[0] : undefined;
  const choiceRecord = firstChoice ? asJsonRecord(firstChoice) : null;

  const messageRecord = choiceRecord?.message
    ? asJsonRecord(choiceRecord.message)
    : null;

  const content = messageRecord && readString(messageRecord.content);
  let valid = false;

  try {
    const parsed: JsonValue = JSON.parse(content ?? "");
    const parsedRecord = asJsonRecord(parsed);
    valid = parsedRecord?.ok === true;
  } catch {
    // Do not expose model output in validation errors.
  }

  if (!valid) {
    throw new Error(
      "Extraction model did not return the required structured response"
    );
  }
}
