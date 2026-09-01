import { describe, expect, test } from "bun:test";
import { createMinimalHonoApp } from "../test-app-helpers";
import { setupFreshInstallSession } from "../test-session-helpers";

describe("session routes error formatting", () => {
  test("send message does not leak an unexpected error's message", async () => {
    const { app, databaseAdapter } = createMinimalHonoApp({
      agent: {
        beginSessionTurn: async () => true,
        resolveSession: async () => ({
          send: async () => {
            throw new Error(
              "ENOSPC: no space left on device, write /home/nakama/.config/nakama/nakama.db"
            );
          },
        }),
      },
    });
    const session = await setupFreshInstallSession(app, databaseAdapter);

    const response = await app.fetch(
      new Request("http://localhost:4310/v1/sessions/session_1/messages", {
        body: JSON.stringify({ message: "hi" }),
        headers: session.headers({
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrfToken,
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "An unexpected server error occurred.",
    });
  });
});
