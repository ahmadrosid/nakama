import { describe, expect, test } from "bun:test";
import {
  fallbackApiErrorMessage,
  formatClientError,
  formatServerError,
  readApiErrorMessage,
  TinyClawApiError,
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
      "The server encountered an error. Try again or restart the TinyClaw server.",
    );
  });

  test("ignores HTML error pages from proxies", async () => {
    const response = new Response("<html><body>Bad Gateway</body></html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });

    await expect(readApiErrorMessage(response)).resolves.toBe(
      "The TinyClaw server is unavailable. Make sure it is running.",
    );
  });
});

describe("formatClientError", () => {
  test("returns API error messages directly", () => {
    expect(formatClientError(new TinyClawApiError("Invalid timezone.", 400))).toBe(
      "Invalid timezone.",
    );
  });

  test("maps network failures to a helpful message", () => {
    expect(formatClientError(new TypeError("Failed to fetch"))).toBe(
      "Could not reach the TinyClaw server. Make sure it is running.",
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
      "The server encountered an error. Try again or restart the TinyClaw server.",
    );
  });
});
