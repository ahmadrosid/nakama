import { describe, expect, test } from "bun:test";
import {
  fallbackApiErrorMessage,
  formatClientError,
  formatServerError,
  readApiErrorMessage,
  NakamaApiError,
} from "./api-error";

describe("readApiErrorMessage", () => {
  test("reads JSON error payloads", async () => {
    const response = new Response(JSON.stringify({ error: "Profile not found." }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });

    await expect(readApiErrorMessage(response)).resolves.toBe("Profile not found.");
  });

  test("falls back when the body is empty", async () => {
    const response = new Response("", { status: 500 });

    await expect(readApiErrorMessage(response)).resolves.toBe(
      "The server encountered an error. Try again or restart the Nakama server.",
    );
  });

  test("ignores HTML error pages from proxies", async () => {
    const response = new Response("<html><body>Bad Gateway</body></html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });

    await expect(readApiErrorMessage(response)).resolves.toBe(
      "The Nakama server is unavailable. Make sure it is running.",
    );
  });
});

describe("formatClientError", () => {
  test("returns API error messages directly", () => {
    expect(formatClientError(new NakamaApiError("Invalid timezone.", 400))).toBe(
      "Invalid timezone.",
    );
  });

  test("maps network failures to a helpful message", () => {
    expect(formatClientError(new TypeError("Failed to fetch"))).toBe(
      "Could not reach the Nakama server. Make sure it is running.",
    );
  });

  test("maps stream disconnects to a helpful message", () => {
    expect(
      formatClientError(
        new Error(
          "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
        ),
      ),
    ).toBe(
      "The connection closed before the agent finished. Restart the Nakama server, then try again. Long automations can take a minute or more.",
    );
  });
});

describe("formatServerError", () => {
  test("maps invalid JSON to a clear message", () => {
    expect(formatServerError(new SyntaxError("Unexpected token"))).toBe(
      "Invalid JSON in request body.",
    );
  });

  test("uses fallback for unknown errors", () => {
    expect(formatServerError({})).toBe("An unexpected server error occurred.");
  });
});

describe("fallbackApiErrorMessage", () => {
  test("uses friendly defaults by status", () => {
    expect(fallbackApiErrorMessage(404)).toBe("The requested resource was not found.");
    expect(fallbackApiErrorMessage(500)).toBe(
      "The server encountered an error. Try again or restart the Nakama server.",
    );
  });
});
