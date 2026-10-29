import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/** A production dependency set baked into the image at build time. */
const DEPENDENCY_SETS = {
  meet: ".docker/meet-deps",
  runtime: ".docker/runtime-deps",
} as const;

type Manifest = { dependencies?: Record<string, string> };

type Lockfile = {
  workspaces: Record<string, Manifest>;
  packages: Record<string, string[]>;
};

async function readCommittedJsonc<T>(relativePath: string): Promise<T> {
  const path = join(REPO_ROOT, relativePath);
  const file = Bun.file(path);
  expect(
    await file.exists(),
    `${relativePath} must be committed for the image build to be reproducible`
  ).toBe(true);
  // bun.lock is JSONC: the same tree bun writes, minus its trailing commas.
  const text = await file.text();

  // SAFETY: Callers supply a type whose fields are checked against committed fixture data.
  return JSON.parse(text.replaceAll(/,(\s*[}\]])/g, "$1")) as T;
}

describe("production image dependency sets", () => {
  // `bun add` re-resolves whatever the registry serves that day, which is how a
  // rebuild of one commit could change the image without a repository change.
  // The frozen install only pins bytes if the manifest itself is exact, and the
  // image ships whatever the lockfile resolves — so the two have to agree.
  for (const [name, directory] of Object.entries(DEPENDENCY_SETS)) {
    test(`every ${name} dependency is exact and locked to the declared version`, async () => {
      const manifest = await readCommittedJsonc<Manifest>(
        `${directory}/package.json`
      );

      const lockfile = await readCommittedJsonc<Lockfile>(
        `${directory}/bun.lock`
      );

      const declared = manifest.dependencies ?? {};

      expect(Object.keys(declared).length).toBeGreaterThan(0);
      expect(lockfile.workspaces[""]?.dependencies ?? {}).toEqual(declared);

      for (const [dependency, version] of Object.entries(declared)) {
        expect(version).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/);
        expect(lockfile.packages[dependency]?.[0]).toStartWith(
          `${dependency}@${version}`
        );
      }
    });
  }
});
