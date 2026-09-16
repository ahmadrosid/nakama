import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import { existsSync } from "node:fs";
import { zipSync } from "fflate";
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
  const url = "https://github.com/acme/repo/tree/main/skills/demo";
  const encode = (text: string) => new TextEncoder().encode(text);
  const files = {
    "repo-main/skills/demo/assets/image.png": new Uint8Array([0, 255, 128]),
    "repo-main/skills/demo/references/info.md": encode("reference"),
    "repo-main/skills/demo/SKILL.md": encode("skill"),
    "repo-main/skills/other/SKILL.md": encode("other"),
  };

  test("installs a complete skill without calling the rate-limited GitHub API", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) =>
      String(input) === "https://codeload.github.com/acme/repo/zip/main"
        ? new Response(zipSync(files))
        : new Response(null, { status: 403 })
    ) as unknown as typeof fetch;
    const bundle = await fetchGitHubSkillBundle(url);
    expect(bundle.content).toBe("skill");
    expect(bundle.files.map((file) => file.path).sort()).toEqual([
      "assets/image.png",
      "references/info.md",
    ]);
    expect(
      bundle.files.find((file) => file.path === "assets/image.png")!.content
    ).toEqual(new Uint8Array([0, 255, 128]));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  test("repository links follow HEAD and include root supporting files", async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "https://codeload.github.com/acme/repo/zip/HEAD"
      );
      return new Response(
        zipSync({
          "repo-master/SKILL.md": encode("skill"),
          "repo-master/scripts/run.py": encode("print(1)"),
        })
      );
    }) as unknown as typeof fetch;
    const bundle = await fetchGitHubSkillBundle(
      "https://github.com/acme/repo/"
    );
    expect(bundle.content).toBe("skill");
    expect(bundle.files[0]!.path).toBe("scripts/run.py");
  });

  test.each([
    {
      extra: {
        "repo-main/skills/demo/link": [
          encode("../outside"),
          { attrs: 0xa1_ff_00_00, os: 3 },
        ],
      },
      label: "symlink",
    },
    {
      extra: { "repo-main/skills/demo/../escape": encode("bad") },
      label: "path traversal",
    },
    {
      extra: { "repo-main/skills/demo/SKILL.md": new Uint8Array(513 * 1024) },
      label: "oversized markdown",
    },
    {
      extra: {
        "repo-main/skills/demo/large": new Uint8Array(5 * 1024 * 1024 + 1),
      },
      label: "oversized supporting file",
    },
    {
      extra: Object.fromEntries(
        Array.from({ length: 501 }, (_, i) => [
          `repo-main/skills/demo/${i}`,
          encode("x"),
        ])
      ),
      label: "too many files",
    },
    {
      extra: Object.fromEntries(
        Array.from({ length: 3 }, (_, i) => [
          `repo-main/skills/demo/${i}`,
          new Uint8Array(4 * 1024 * 1024),
        ])
      ),
      label: "oversized bundle",
    },
  ])("rejects $label without falling back to Git", async ({ extra }) => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          zipSync({ ...files, ...extra } as Parameters<typeof zipSync>[0])
        )
    ) as unknown as typeof fetch;
    const git = spyOn(childProcess, "execFile");
    try {
      await expect(fetchGitHubSkillBundle(url)).rejects.toThrow();
      expect(git).not.toHaveBeenCalled();
    } finally {
      git.mockRestore();
    }
  });

  test.each([
    new Uint8Array(),
    encode("not a zip"),
    zipSync({ "repo-main/README.md": encode("no skill") }),
  ])("rejects invalid or missing skill archives", async (archive) => {
    globalThis.fetch = mock(
      async () => new Response(archive)
    ) as unknown as typeof fetch;
    await expect(fetchGitHubSkillBundle(url)).rejects.toThrow();
  });

  test.each([
    401,
    403,
    404,
    429,
    "large archive",
    "submodule metadata",
    "empty directory",
  ])("falls back to Git for %s and removes temporary files", async (status) => {
    globalThis.fetch = mock(async () => {
      if (status === "large archive") {
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1024 * 1024));
            },
          })
        );
      }
      if (status === "submodule metadata") {
        return new Response(
          zipSync({
            ...files,
            "repo-main/.gitmodules": encode("[submodule]"),
          })
        );
      }
      if (status === "empty directory") {
        return new Response(
          zipSync({
            ...files,
            "repo-main/skills/demo/submodule/": new Uint8Array(),
          })
        );
      }
      return new Response(null, { status: Number(status) });
    }) as unknown as typeof fetch;
    const commands: string[][] = [];
    const git = spyOn(childProcess, "execFile").mockImplementation(((
      ...args: unknown[]
    ) => {
      const command = args[1] as string[];
      commands.push(command);
      const callback = args.at(-1) as (
        error: Error | null,
        stdout: Buffer,
        stderr: Buffer
      ) => void;
      let output = "";
      if (command.includes("ls-tree")) {
        output =
          `100644 blob ${"a".repeat(40)} 5\tskills/demo/SKILL.md\0` +
          `100755 blob ${"b".repeat(40)} 9\tskills/demo/scripts/run.py\0`;
      }
      if (command.includes("cat-file")) {
        output = command.at(-1) === "a".repeat(40) ? "skill" : "print(1)\n";
      }
      callback(null, Buffer.from(output), Buffer.alloc(0));
      return {};
    }) as typeof childProcess.execFile);
    try {
      const bundle = await fetchGitHubSkillBundle(url);
      expect(bundle.content).toBe("skill");
      expect(bundle.files[0]!.path).toBe("scripts/run.py");
      expect(new TextDecoder().decode(bundle.files[0]!.content)).toBe(
        "print(1)\n"
      );
      expect(
        commands.some((command) => command.includes("--filter=blob:none"))
      ).toBe(true);
      expect(commands.some((command) => command.includes("checkout"))).toBe(
        false
      );
      expect(existsSync(commands[0]![1]!)).toBe(false);
    } finally {
      git.mockRestore();
    }
  });

  test.each(["120000 blob", "160000 commit"])(
    "Git rejects %s entries and cleans up",
    async (entryType) => {
      globalThis.fetch = mock(
        async () => new Response(null, { status: 403 })
      ) as unknown as typeof fetch;
      let temp = "";
      const git = spyOn(childProcess, "execFile").mockImplementation(((
        ...args: unknown[]
      ) => {
        const command = args[1] as string[];
        temp = command[1]!;
        const callback = args.at(-1) as (
          error: Error | null,
          stdout: Buffer,
          stderr: Buffer
        ) => void;
        callback(
          null,
          Buffer.from(
            command.includes("ls-tree")
              ? `${entryType} ${"a".repeat(40)} 1\tskills/demo/link\0`
              : ""
          ),
          Buffer.alloc(0)
        );
        return {};
      }) as typeof childProcess.execFile);
      try {
        await expect(fetchGitHubSkillBundle(url)).rejects.toThrow();
        expect(existsSync(temp)).toBe(false);
      } finally {
        git.mockRestore();
      }
    }
  );
});
