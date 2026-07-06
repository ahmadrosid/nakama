import type { ProfileRef } from "./contract";

export class NakamaApiError extends Error {
  readonly status: number;
  readonly path?: string;
  readonly profiles?: ProfileRef[];

  constructor(message: string, status: number, path?: string, profiles?: ProfileRef[]) {
    super(message);
    this.name = "NakamaApiError";
    this.status = status;
    this.path = path;
    this.profiles = profiles;
  }
}

export async function readApiErrorMessage(response: Response): Promise<string> {
  const status = response.status;
  let bodyText = "";

  try {
    bodyText = await response.text();
  } catch {
    return fallbackApiErrorMessage(status);
  }

  const trimmed = bodyText.trim();

  if (!trimmed) {
    return fallbackApiErrorMessage(status);
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const payload = JSON.parse(trimmed) as {
        error?: unknown;
        message?: unknown;
      };
      const message =
        extractErrorText(payload.error) ?? extractErrorText(payload.message);

      if (message) {
        return message;
      }
    } catch {
      // fall through to plain-text handling
    }
  }

  if (trimmed.startsWith("<")) {
    return fallbackApiErrorMessage(status);
  }

  return truncate(trimmed.replace(/\s+/g, " "), 240);
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

export function formatClientError(error: unknown): string {
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

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "Something went wrong.";
}

export function formatServerError(error: unknown): string {
  if (error instanceof SyntaxError) {
    return "Invalid JSON in request body.";
  }

  if (error instanceof Error) {
    const message = error.message.trim();

    if (message) {
      return message;
    }
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "An unexpected server error occurred.";
}

function extractErrorText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    return typeof message === "string" && message.trim() ? message.trim() : null;
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
