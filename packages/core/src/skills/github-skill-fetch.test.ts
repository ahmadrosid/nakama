import { afterEach, describe, expect, mock, test } from "bun:test";
import { NakamaApiError } from "../api-error";
import { fetchGitHubSkillMarkdown } from "./github-skill-fetch";

describe("fetchGitHubSkillMarkdown size limits", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("rejects oversized Content-Length before reading the body", async () => {
    globalThis.fetch = mock(
      async () =>
        new Response("ignored", {
          headers: { "Content-Length": String(600 * 1024) },
          status: 200,
        })
    ) as typeof fetch;

    await expect(
      fetchGitHubSkillMarkdown(
        "https://raw.githubusercontent.com/acme/skills/main/weather/SKILL.md"
      )
    ).rejects.toBeInstanceOf(NakamaApiError);

    try {
      await fetchGitHubSkillMarkdown(
        "https://raw.githubusercontent.com/acme/skills/main/weather/SKILL.md"
      );
    } catch (error) {
      expect(error).toBeInstanceOf(NakamaApiError);
      expect((error as NakamaApiError).status).toBe(400);
      expect((error as NakamaApiError).message).toMatch(/too large/i);
    }
  });

  test("aborts while streaming once the body exceeds the cap", async () => {
    const oversized = "x".repeat(513 * 1024);
    globalThis.fetch = mock(
      async () =>
        new Response(oversized, {
          headers: { "Content-Type": "text/plain" },
          status: 200,
        })
    ) as typeof fetch;

    try {
      await fetchGitHubSkillMarkdown(
        "https://raw.githubusercontent.com/acme/skills/main/weather/SKILL.md"
      );
      throw new Error("expected fetchGitHubSkillMarkdown to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(NakamaApiError);
      expect((error as NakamaApiError).status).toBe(400);
      expect((error as NakamaApiError).message).toMatch(/too large/i);
    }
  });
});
