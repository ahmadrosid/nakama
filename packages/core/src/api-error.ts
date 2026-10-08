import { z } from "zod";
import type { ApiErrorResponse, ProfileRef } from "./contract";
import { LLM_FETCH_TIMEOUT_MS } from "./fetch-idle";

const ApiErrorPayloadSchema = z.object({
  error: z.json().optional(),
  message: z.json().optional(),
  totpEnabled: z.boolean().optional(),
});

const ErrorMessageSchema = z.object({ message: z.string() });

export class NakamaApiError extends Error {
  readonly status: number;
  readonly path?: string;
  readonly profiles?: ProfileRef[];
  readonly totpEnabled?: boolean;

  constructor(
    message: string,
    status: number,
    path?: string,
    profiles?: ProfileRef[],
    options?: Pick<ApiErrorResponse, "totpEnabled">
  ) {
    super(message);
    this.name = "NakamaApiError";
    this.status = status;
    this.path = path;
    this.profiles = profiles;
    this.totpEnabled = options?.totpEnabled;
  }
}

/** 401 after local-token reload did not yield a different token (or file missing). */
export class NakamaAuthExpiredError extends NakamaApiError {
  constructor(message: string, path?: string) {
    super(message, 401, path);
    this.name = "NakamaAuthExpiredError";
  }
}

export async function readApiErrorDetails(response: Response): Promise<{
  message: string;
  totpEnabled?: boolean;
}> {
  const status = response.status;
  let bodyText = "";

  try {
    bodyText = await response.text();
  } catch {
    return { message: fallbackApiErrorMessage(status) };
  }

  const trimmed = bodyText.trim();

  if (!trimmed) {
    return { message: fallbackApiErrorMessage(status) };
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const payload = ApiErrorPayloadSchema.safeParse(JSON.parse(trimmed));

      if (!payload.success) {
        throw new Error("Invalid API error payload.");
      }

      const message =
        extractErrorText(payload.data.error) ??
        extractErrorText(payload.data.message);

      if (message) {
        return {
          message,
          totpEnabled: payload.data.totpEnabled,
        };
      }
    } catch {
      // fall through to plain-text handling
    }
  }

  if (trimmed.startsWith("<")) {
    return { message: fallbackApiErrorMessage(status) };
  }

  return { message: truncate(trimmed.replace(/\s+/g, " "), 240) };
}

export async function readApiErrorMessage(response: Response): Promise<string> {
  return (await readApiErrorDetails(response)).message;
}

export function fallbackApiErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return "Invalid request.";
    case 401:
      return "Authentication required.";
    case 403:
      return "You do not have permission to do that.";
    case 404:
      return "The requested resource was not found.";
    case 409:
      return "The request could not be completed because of a conflict.";
    case 502:
    case 503:
    case 504:
      return "The Nakama server is unavailable. Make sure it is running.";
    default:
      if (status >= 500) {
        return "The server encountered an error. Try again or restart the Nakama server.";
      }

      return `Request failed (${status}).`;
  }
}

export function formatClientError<ErrorValue>(error: ErrorValue): string {
  if (error instanceof NakamaApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    if (isNetworkError(error)) {
      return "Could not reach the Nakama server. Make sure it is running.";
    }

    if (isStreamDisconnectError(error)) {
      return "The connection closed before the agent finished. Restart the Nakama server, then try again. Long automations can take a minute or more.";
    }

    const message = error.message.trim();

    if (message) {
      return message;
    }
  }

  const stringError = z.string().safeParse(error);

  if (stringError.success && stringError.data.trim()) {
    return stringError.data.trim();
  }

  return "Something went wrong.";
}

export function formatAutomationRunError<ErrorValue>(
  error: ErrorValue
): string {
  if (error instanceof Error && isFetchDeadlineError(error)) {
    return `The model request timed out after ${Math.round(LLM_FETCH_TIMEOUT_MS / 60_000)} minutes.`;
  }

  if (error instanceof Error && isStreamDisconnectError(error)) {
    return "The model connection closed before the agent finished. Try again. Long automations can take a minute or more.";
  }

  if (error instanceof Error) {
    const message = error.message.trim();

    if (message) {
      return message;
    }
  }

  const stringError = z.string().safeParse(error);

  if (stringError.success && stringError.data.trim()) {
    return stringError.data.trim();
  }

  return formatServerError(error);
}

export function formatServerError<ErrorValue>(error: ErrorValue): string {
  if (error instanceof NakamaApiError) {
    return error.message;
  }

  if (error instanceof SyntaxError) {
    return "Invalid JSON in request body.";
  }

  console.error(error);

  return "An unexpected server error occurred.";
}

function extractErrorText<Value>(value: Value): string | null {
  const stringValue = z.string().safeParse(value);

  if (stringValue.success) {
    const trimmed = stringValue.data.trim();

    return trimmed || null;
  }

  const objectValue = ErrorMessageSchema.safeParse(value);

  if (objectValue.success) {
    const message = objectValue.data.message.trim();

    return message || null;
  }

  return null;
}

function isNetworkError(error: Error): boolean {
  const message = error.message.trim();

  return (
    message === "Failed to fetch" ||
    message === "NetworkError when attempting to fetch resource." ||
    message === "Load failed"
  );
}

function isFetchDeadlineError(error: Error): boolean {
  const message = error.message.trim();

  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    message.includes("timed out") ||
    message.includes("Timeout") ||
    message.includes("aborted")
  );
}

function isStreamDisconnectError(error: Error): boolean {
  const message = error.message.trim();

  return (
    message.includes("socket connection was closed unexpectedly") ||
    message === "Stream ended without a response."
  );
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}
