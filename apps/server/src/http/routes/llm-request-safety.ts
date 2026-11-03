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
 * 200 MB, under the 512 MB install ceiling. One org may use half of it.
 */
const CHAT_MEMORY_BUDGET_BYTES = 2 * DESKTOP_CHAT_BODY_LIMIT_BYTES;

const ORG_CHAT_MEMORY_BYTES = DESKTOP_CHAT_BODY_LIMIT_BYTES;

let chatBytesHeld = 0;

const orgChatBytesHeld = new Map<string, number>();

/** Holds room for one chat body; null when there is none now. */
export function holdChatMemory(
  orgId: string,
  contentLength: string | undefined
): (() => void) | null {
  const declared = Number(contentLength);

  // No length (a chunked body) holds the most a body can be.
  const bytes =
    Number.isInteger(declared) && declared > 0
      ? Math.min(declared, DESKTOP_CHAT_BODY_LIMIT_BYTES)
      : DESKTOP_CHAT_BODY_LIMIT_BYTES;

  const orgBytes = orgChatBytesHeld.get(orgId) ?? 0;

  if (
    chatBytesHeld + bytes > CHAT_MEMORY_BUDGET_BYTES ||
    orgBytes + bytes > ORG_CHAT_MEMORY_BYTES
  ) {
    return null;
  }

  chatBytesHeld += bytes;
  orgChatBytesHeld.set(orgId, orgBytes + bytes);
  let held = true;

  return () => {
    if (!held) {
      return;
    }

    held = false;
    chatBytesHeld -= bytes;
    const left = (orgChatBytesHeld.get(orgId) ?? bytes) - bytes;

    if (left > 0) {
      orgChatBytesHeld.set(orgId, left);
    } else {
      orgChatBytesHeld.delete(orgId);
    }
  };
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
function withoutInternals(message: string): string {
  return message
    .replace(/\b(?:sk|rk|pk|xai|gsk|AIza)[\w*.…-]{6,}/g, "[hidden]")
    .replace(/\bhttps?:\/\/[^\s"'<>)]+/g, "[hidden]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, "[hidden]");
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

/** Keys that make the vendor read a stored file of the org's account. */
const FILE_REFERENCE_KEYS: ReadonlySet<string> = new Set([
  "fileData",
  "fileUri",
  "file_id",
]);

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

    if (type.success) {
      return REPLAY_TYPES.has(type.data) || type.data.startsWith("reasoning.");
    }

    return Object.keys(record.data).every((key) => GEMINI_PART_KEYS.has(key));
  });
}
