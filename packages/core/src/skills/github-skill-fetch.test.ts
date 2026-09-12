import { afterEach, describe, expect, mock, test } from "bun:test";
import { NakamaApiError } from "../api-error";
import {
  fetchGitHubSkillBundle,
  fetchGitHubSkillMarkdown,
} from "./github-skill-fetch";

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
    ) as unknown as typeof fetch;

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
    ) as unknown as typeof fetch;

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

describe("complete GitHub skill downloads", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  const sha = "a".repeat(40);
  const entries = [
    { mode: "100644", path: "skills/demo/SKILL.md", type: "blob" },
    {
      mode: "100644",
      path: "skills/demo/references/explainer.md",
      type: "blob",
    },
    { mode: "100644", path: "skills/demo/assets/image.png", type: "blob" },
    { mode: "100644", path: "skills/other/SKILL.md", type: "blob" },
  ];
  test("downloads nested references and binary assets from one commit, excluding sibling skills", async () => {
    const binary = new Uint8Array([0, 255, 128, 10]);
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/commits/")) {
        return Response.json({ sha });
      }
      if (url.includes("api.github.com")) {
        return Response.json({ sha: "b".repeat(40), tree: entries });
      }
      expect(url).toContain(`/${sha}/skills/demo/`);
      if (url.endsWith("image.png")) {
        return new Response(binary);
      }
      return new Response(url.endsWith("SKILL.md") ? "skill" : "reference");
    }) as unknown as typeof fetch;
    const bundle = await fetchGitHubSkillBundle(
      "https://github.com/acme/repo/tree/main/skills/demo"
    );
    expect(bundle.content).toBe("skill");
    expect(bundle.files.map((file) => file.path)).toEqual([
      "references/explainer.md",
      "assets/image.png",
    ]);
    expect(bundle.files[1]!.content).toEqual(binary);
  });
  test.each([
    { sha, tree: entries, truncated: true },
    {
      sha,
      tree: [{ mode: "120000", path: "skills/demo/escape", type: "blob" }],
    },
    {
      sha,
      tree: [{ mode: "100644", path: "skills/demo/../escape", type: "blob" }],
    },
  ])("rejects incomplete listings and unsafe entries", async (tree) => {
    globalThis.fetch = mock(async () =>
      Response.json(tree)
    ) as unknown as typeof fetch;
    await expect(
      fetchGitHubSkillBundle(
        "https://github.com/acme/repo/tree/main/skills/demo"
      )
    ).rejects.toThrow();
  });
  test("repository links use the default branch and include root supporting files", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://api.github.com/repos/acme/repo") {
        return Response.json({ default_branch: "master" });
      }
      if (url.includes("api.github.com")) {
        expect(
          url.includes("/commits/master") || url.includes(`/trees/${sha}?`)
        ).toBe(true);
        return Response.json({
          sha,
          tree: [
            { mode: "100644", path: "SKILL.md", type: "blob" },
            { mode: "100755", path: "scripts/run.py", type: "blob" },
          ],
        });
      }
      return new Response(url.endsWith("SKILL.md") ? "skill" : "print(1)");
    }) as unknown as typeof fetch;
    const bundle = await fetchGitHubSkillBundle("https://github.com/acme/repo");
    expect(bundle.files[0]!.path).toBe("scripts/run.py");
  });
  test("a missing supporting file fails the whole download", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      if (String(input).includes("api.github.com")) {
        return Response.json({ sha, tree: entries });
      }
      return String(input).endsWith("SKILL.md")
        ? new Response("skill")
        : new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
    await expect(
      fetchGitHubSkillBundle(
        "https://github.com/acme/repo/tree/main/skills/demo"
      )
    ).rejects.toThrow();
  });
});
