import { z } from "@hono/zod-openapi";
import { NakamaApiError, type ProviderChatOptions } from "@nakama/core";

/**
 * Guards for Nakama Desktop model calls: how much memory chat bodies may
 * hold, which errors and provider items cross to and from the desktop, and
 * how far a desktop may set thinking.
 */

export const jsonValueSchema = z.json();

/**
 * The largest /v1/llm/chat body: the largest request the model vendors take.
 * The desktop sends the whole chat, with images inline, on each call.
 */
export const DESKTOP_CHAT_BODY_LIMIT_BYTES = 32 * 1024 * 1024;

/**
 * Body bytes all desktop chats may hold at once. A call holds about 3x its
 * body (raw text, parsed copy, vendor request), so this keeps them near
 * 200 MB, under the 512 MB install ceiling. One member may use half of it,
 * across all their orgs and computers.
 */
const CHAT_MEMORY_BUDGET_BYTES = 2 * DESKTOP_CHAT_BODY_LIMIT_BYTES;

const MEMBER_CHAT_MEMORY_BYTES = DESKTOP_CHAT_BODY_LIMIT_BYTES;

/** How long a chat body may take to arrive; a slow upload holds memory. */
export const DESKTOP_CHAT_UPLOAD_MS = 60 * 1000;

/**
 * The longest one desktop chat call may run. Past it the call is stopped and
 * its memory freed, even when the provider does not end it.
 */
export const DESKTOP_CHAT_MAX_MS = 15 * 60 * 1000;

let chatBytesHeld = 0;

const memberChatBytesHeld = new Map<string, number>();

/** Holds room for one chat body; null when there is none now. */
export function holdChatMemory(
  userId: string,
  contentLength: string | undefined
): (() => void) | null {
  const declared = Number(contentLength);

  // No length (a chunked body) holds the most a body can be.
  const bytes =
    Number.isInteger(declared) && declared > 0
      ? Math.min(declared, DESKTOP_CHAT_BODY_LIMIT_BYTES)
      : DESKTOP_CHAT_BODY_LIMIT_BYTES;

  const memberBytes = memberChatBytesHeld.get(userId) ?? 0;

  if (
    chatBytesHeld + bytes > CHAT_MEMORY_BUDGET_BYTES ||
    memberBytes + bytes > MEMBER_CHAT_MEMORY_BYTES
  ) {
    return null;
  }

  chatBytesHeld += bytes;
  memberChatBytesHeld.set(userId, memberBytes + bytes);
  let held = true;

  return () => {
    if (!held) {
      return;
    }

    held = false;
    chatBytesHeld -= bytes;
    const left = (memberChatBytesHeld.get(userId) ?? bytes) - bytes;

    if (left > 0) {
      memberChatBytesHeld.set(userId, left);
    } else {
      memberChatBytesHeld.delete(userId);
    }
  };
}

/**
 * Reads a JSON body that must arrive within ms; null when it does not. The
 * read is cancelled at the deadline, so a late body stops filling memory,
 * and this returns only once the read has stopped.
 */
export async function readJsonWithin<T>(
  request: Request,
  schema: z.ZodType<T>,
  ms: number
): Promise<T | null> {
  const reader = request.body?.getReader();

  if (!reader) {
    throw new NakamaApiError("Invalid request.", 400);
  }

  const chunks: Uint8Array[] = [];
  let late = false;

  const timer = setTimeout(() => {
    late = true;
    reader.cancel().catch(() => undefined);
  }, ms);

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
  }

  if (late) {
    return null;
  }

  let checked: z.ZodSafeParseResult<T>;

  try {
    checked = schema.safeParse(
      JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)))
    );
  } catch {
    throw new NakamaApiError("Invalid request.", 400);
  }

  if (!checked.success) {
    throw new NakamaApiError("Invalid request.", 400);
  }

  return checked.data;
}

/** The promise's value, or null when it does not settle within ms. */
export async function withinTime<T>(
  promise: Promise<T>,
  ms: number
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });

  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Request errors the desktop can act on, such as a prompt that is too long.
 * Not 401 or 403: those mean "sign in again" to the desktop, and here they
 * would come from this server's own provider key.
 */
const PASSED_STATUSES = [400, 404, 408, 409, 413, 422] as const;

type PassedStatus = (typeof PASSED_STATUSES)[number];

interface Failure {
  message: string;
  status: PassedStatus | 429 | 502;
}

function isPassedStatus(status: number): status is PassedStatus {
  return PASSED_STATUSES.some((passed) => passed === status);
}

/**
 * A provider error can name this server's internal hosts or show part of
 * the org's key. Members see the reason without those.
 */
/**
 * What a provider or network error can carry about this server: URLs first
 * (they hold hosts), then credentials, then addresses and host names.
 */
const INTERNAL_DETAILS: readonly RegExp[] = [
  /\bhttps?:\/\/[^\s"'<>)]+/g,
  /\bBearer\s+\S+/gi,
  /\b(?:sk|rk|pk|xai|gsk|AIza)[\w*.…-]{6,}/g,
  // AWS access key IDs (Bedrock).
  /\b(?:AKIA|ASIA)[A-Z0-9]{12,}\b/g,
  // IPv6, bracketed or as a whole token of hex groups. Not "provider::model".
  /\[[0-9a-f:]+\](?::\d+)?/gi,
  /(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi,
  /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g,
  // Host names: dotted names ending in a letters-only label, or "host:port".
  // Model names such as "gpt-4.1" end in digits and stay.
  /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\b/gi,
  /\b[a-z][\w.-]*:\d{2,5}\b/gi,
  // Long opaque tokens, such as an Azure key.
  /\b[A-Za-z0-9_-]{32,}\b/g,
];

function withoutInternals(message: string): string {
  return INTERNAL_DETAILS.reduce(
    (text, pattern) => text.replace(pattern, "[hidden]"),
    message
  );
}

export function failureOf(error: Error): Failure {
  // Network errors name hosts and ports only: there is no reason to show.
  if (!(error instanceof NakamaApiError)) {
    return { message: "The model call failed. Try again.", status: 502 };
  }

  if (error.status === 429) {
    return { message: "Your team's monthly limit is reached.", status: 429 };
  }

  return {
    message: withoutInternals(error.message || "The model call failed."),
    status: isPassedStatus(error.status) ? error.status : 502,
  };
}

const EFFORTS = ["low", "medium", "high"] as const;

type Thinking = NonNullable<ProviderChatOptions["thinking"]>;

/**
 * The desktop may turn thinking off or lower it, never raise it above the
 * workspace setting: thinking costs the org's tokens.
 */
export function capThinking(
  requested: Thinking | undefined,
  allowed: Thinking | undefined
): Thinking | undefined {
  if (!requested) {
    return allowed;
  }

  if (!(requested.enabled && allowed?.enabled)) {
    return;
  }

  const wanted = requested.effort ?? allowed.effort;

  const effort =
    wanted && allowed.effort
      ? EFFORTS[
          Math.min(EFFORTS.indexOf(wanted), EFFORTS.indexOf(allowed.effort))
        ]
      : allowed.effort;

  return effort ? { effort, enabled: true } : { enabled: true };
}

/**
 * Provider items this server makes and replays: Anthropic blocks, OpenAI
 * Responses items, and reasoning_details ("reasoning.*").
 */
const REPLAY_TYPES: ReadonlySet<string> = new Set([
  "function_call",
  "message",
  "reasoning",
  "redacted_thinking",
  "server_tool_use",
  "text",
  "thinking",
  "tool_use",
  "web_search_call",
  "web_search_tool_result",
]);

/** Gemini parts carry no type; these are the ones it sends back. */
const GEMINI_PART_KEYS: ReadonlySet<string> = new Set([
  "functionCall",
  "functionResponse",
  "text",
  "thought",
  "thoughtSignature",
]);

/**
 * Keys that make the vendor read a stored file of the org's account, or
 * fetch a URL on its behalf.
 */
const FILE_REFERENCE_KEYS: ReadonlySet<string> = new Set([
  "fileData",
  "fileUri",
  "file_id",
  "file_url",
  "image_url",
]);

/** The parts of a Responses message the model itself writes. */
const ASSISTANT_MESSAGE_PART_TYPES: ReadonlySet<string> = new Set([
  "output_text",
  "refusal",
]);

const responsesMessageSchema = z.object({
  content: z.array(z.object({ type: z.string() }).loose()),
  role: z.literal("assistant"),
  type: z.literal("message"),
});

/**
 * A Responses message is replayed only as the assistant's own output. A
 * user, system or developer message, or an input part, would be text the
 * server never produced, with that role's authority.
 */
function isAssistantMessage(item: z.infer<typeof jsonValueSchema>): boolean {
  const message = responsesMessageSchema.safeParse(item);

  return (
    message.success &&
    message.data.content.every((part) =>
      ASSISTANT_MESSAGE_PART_TYPES.has(part.type)
    )
  );
}

const jsonRecordSchema = z.record(z.string(), jsonValueSchema);

const jsonListSchema = z.array(jsonValueSchema);

function holdsFileReference(value: z.infer<typeof jsonValueSchema>): boolean {
  const list = jsonListSchema.safeParse(value);

  if (list.success) {
    return list.data.some(holdsFileReference);
  }

  const record = jsonRecordSchema.safeParse(value);

  return (
    record.success &&
    Object.entries(record.data).some(
      ([key, item]) => FILE_REFERENCE_KEYS.has(key) || holdsFileReference(item)
    )
  );
}

/**
 * Only the cloud's own providers make providerContent, but the desktop sends
 * it back. Keep the items a provider replays as it made them; drop any other
 * item, such as an item_reference to another member's stored response, or a
 * block that makes the vendor read the org's files.
 */
export function replaySafe(
  items: z.infer<typeof jsonValueSchema>[]
): z.infer<typeof jsonValueSchema>[] {
  return items.filter((item) => {
    const record = jsonRecordSchema.safeParse(item);

    if (!record.success || holdsFileReference(record.data)) {
      return false;
    }

    const type = z.string().safeParse(record.data.type);

    if (type.success && type.data === "message") {
      return isAssistantMessage(record.data);
    }

    if (type.success) {
      return REPLAY_TYPES.has(type.data) || type.data.startsWith("reasoning.");
    }

    return Object.keys(record.data).every((key) => GEMINI_PART_KEYS.has(key));
  });
}
