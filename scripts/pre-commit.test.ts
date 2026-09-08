import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

test.each(["staged file.ts", "notes.mdx"])(
  "pre-commit formats only staged files when committing %s",
  async (stagedFile) => {
    const cwd = await mkdtemp(join(tmpdir(), "nakama-hook-"));
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      return result.stdout.toString();
    };
    try {
      git("init");
      git("config", "core.autocrlf", "false");
      git("config", "core.hooksPath", ".git/hooks");
      git("config", "commit.gpgSign", "false");
      git("config", "user.name", "Hook Test");
      git("config", "user.email", "hook@example.invalid");
      await Bun.write(
        join(cwd, "untouched.ts"),
        "export const untouched = 1;\n"
      );
      git("add", "untouched.ts");
      git("commit", "-m", "baseline");

      await symlink(
        join(root, "node_modules"),
        join(cwd, "node_modules"),
        "junction"
      );
      await Bun.write(
        join(cwd, "biome.jsonc"),
        Bun.file(join(root, "biome.jsonc"))
      );
      const hook = join(cwd, ".git/hooks/pre-commit");
      await Bun.write(
        hook,
        // Husky supplies the shell entry point in the real checkout.
        "#!/bin/sh\n" +
          (await Bun.file(join(root, ".husky/pre-commit")).text()).replaceAll(
            "\r\n",
            "\n"
          )
      );
      await chmod(hook, 0o755);

      const unformatted = "export const untouched={value:2}\n";
      await Bun.write(join(cwd, "untouched.ts"), unformatted);
      await Bun.write(join(cwd, "untracked.ts"), unformatted);
      const staged = stagedFile.endsWith(".ts")
        ? "export const staged={value:1}\n"
        : "# Notes\n";
      await Bun.write(join(cwd, stagedFile), staged);
      git("add", "--", stagedFile);
      git("commit", "-m", "exercise hook");

      expect(await Bun.file(join(cwd, "untouched.ts")).text()).toBe(
        unformatted
      );
      expect(await Bun.file(join(cwd, "untracked.ts")).text()).toBe(
        unformatted
      );
      const committed = git("show", `HEAD:${stagedFile}`);
      expect(committed).toBe(await Bun.file(join(cwd, stagedFile)).text());
      if (stagedFile.endsWith(".ts")) {
        expect(committed).not.toBe(staged);
      }
      expect(
        git("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim()
      ).toBe(stagedFile);
    } finally {
      await rm(cwd, { force: true, recursive: true });
    }
  },
  30_000
);
