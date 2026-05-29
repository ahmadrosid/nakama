function stripMarkdownFences(text: string): string {
  let result = text.trim();

  if (result.startsWith("```")) {
    result = result.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
  }

  return result;
}

function stripWrappingQuotes(text: string): string {
  let result = text.trim();

  while (
    (result.startsWith('"') && result.endsWith('"')) ||
    (result.startsWith("'") && result.endsWith("'"))
  ) {
    result = result.slice(1, -1).trim();
  }

  return result;
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();

  return fenced ?? trimmed;
}

function tryParseJson(raw: string): unknown {
  const candidate = extractJsonCandidate(raw);

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }

    throw new Error("Response did not contain valid JSON.");
  }
}

function unwrapPayload(payload: unknown): string | null {
  if (typeof payload === "string") {
    const trimmed = payload.trim();

    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return unwrapPayload(tryParseJson(trimmed));
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;

  for (const key of ["prompt", "text", "content", "message", "instruction", "instructions"]) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const stringValues = Object.values(record).filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );

  if (stringValues.length === 1) {
    return stringValues[0]!.trim();
  }

  return null;
}

function maybeUnwrapPayload(raw: string): string | null {
  for (const candidate of [raw, stripWrappingQuotes(raw)]) {
    if (!candidate) {
      continue;
    }

    try {
      const unwrapped = unwrapPayload(tryParseJson(candidate));

      if (unwrapped) {
        return unwrapped;
      }
    } catch {
      // Keep trying other candidates.
    }
  }

  return null;
}

/** Turn model output into plain prompt text for task textareas. */
export function normalizeTaskPrompt(raw: string): string {
  let text = stripMarkdownFences(raw);
  const direct = maybeUnwrapPayload(text);

  if (direct) {
    text = direct;
  }

  text = stripMarkdownFences(text);
  const nested = maybeUnwrapPayload(text);

  if (nested) {
    text = nested;
  }

  return stripWrappingQuotes(text).trim();
}
