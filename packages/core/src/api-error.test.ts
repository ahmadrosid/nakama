import { describe, expect, test } from "bun:test";
import { formatAutomationRunError, readApiErrorMessage } from "./api-error";

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
