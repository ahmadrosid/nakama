import { describe, expect, test } from "bun:test";
import {
  formatAutomationRunError,
  formatServerError,
  NakamaApiError,
  readApiErrorMessage,
} from "./api-error";

describe("readApiErrorMessage", () => {
  test("reads JSON error payloads", async () => {
    const response = new Response(
      JSON.stringify({ error: "Profile not found." }),
      {
        headers: { "Content-Type": "application/json" },
        status: 404,
      }
    );

    await expect(readApiErrorMessage(response)).resolves.toBe(
      "Profile not found."
    );
  });

  test("falls back when the body is empty", async () => {
    const response = new Response("", { status: 500 });

    await expect(readApiErrorMessage(response)).resolves.toBe(
      "The server encountered an error. Try again or restart the Nakama server."
    );
  });

  test("ignores HTML error pages from proxies", async () => {
    const response = new Response("<html><body>Bad Gateway</body></html>", {
      headers: { "Content-Type": "text/html" },
      status: 502,
    });

    await expect(readApiErrorMessage(response)).resolves.toBe(
      "The Nakama server is unavailable. Make sure it is running."
    );
  });
});

describe("formatAutomationRunError", () => {
  test("maps fetch deadline aborts without the raw abort text", () => {
    const error = new Error("The operation was aborted.");
    error.name = "TimeoutError";
    const formatted = formatAutomationRunError(error);

    expect(formatted).not.toBe(error.message);
    expect(formatted).toContain("10");
  });
});

describe("formatServerError", () => {
  test("returns a NakamaApiError's own message unchanged", () => {
    const error = new NakamaApiError("Profile not found.", 404);
    expect(formatServerError(error)).toBe("Profile not found.");
  });

  test("never leaks a plain Error's message", () => {
    const error = new Error(
      "SQLITE_CONSTRAINT: UNIQUE constraint failed at /home/nakama/.config/nakama/nakama.db"
    );
    expect(formatServerError(error)).toBe(
      "An unexpected server error occurred."
    );
  });

  test("still returns the friendly JSON message for SyntaxError", () => {
    const error = new SyntaxError("Unexpected token < in JSON at position 0");
    expect(formatServerError(error)).toBe("Invalid JSON in request body.");
  });
});
