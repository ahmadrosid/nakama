import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const WORKFLOWS_DIR = join(REPO_ROOT, ".github/workflows");

// Scopes that publish or sign artifacts, as opposed to reporting status.
const PUBLICATION_SCOPES = ["contents", "packages", "pages", "id-token"];

type Env = Record<string, string | undefined>;

type Step = { name?: string; run?: string; env?: Env };

type Job = { permissions?: Record<string, string>; env?: Env; steps?: Step[] };

type Workflow = {
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
};

async function workflows(): Promise<[string, Workflow][]> {
  const files = (await readdir(WORKFLOWS_DIR)).filter((file) =>
    file.endsWith(".yml")
  );
  return await Promise.all(
    files.map(async (file) => [
      file,
      Bun.YAML.parse(
        await Bun.file(join(WORKFLOWS_DIR, file)).text()
      ) as Workflow,
    ])
  );
}

const installCommands = (script: string) =>
  [...script.matchAll(/bun\s+install\b[^\n;&|]*/g)].map(([command]) =>
    command.trim()
  );

// A dependency install may not run lifecycle scripts, and it may not resolve a
// lockfile it is free to rewrite.
const unsafeInstalls = (label: string, script: string) =>
  installCommands(script)
    .filter(
      (command) =>
        !(
          command.includes("--ignore-scripts") &&
          command.includes("--frozen-lockfile")
        )
    )
    .map((command) => `${label}: ${command}`);

const publishPermissions = (workflow: Workflow, job: Job) =>
  PUBLICATION_SCOPES.filter(
    (scope) => (job.permissions ?? workflow.permissions)?.[scope] === "write"
  );

describe("dependency installs in CI", () => {
  test("never run lifecycle scripts and stay lockfile pinned", async () => {
    const unsafe = (await workflows()).flatMap(([file, workflow]) =>
      Object.entries(workflow.jobs ?? {}).flatMap(([name, job]) =>
        (job.steps ?? []).flatMap((step) =>
          unsafeInstalls(
            `${file} ${name} (${step.name ?? "run"})`,
            step.run ?? ""
          )
        )
      )
    );

    expect(unsafe).toEqual([]);
  });

  test("never share a job with artifact publication permissions", async () => {
    const privileged = (await workflows()).flatMap(([file, workflow]) =>
      Object.entries(workflow.jobs ?? {})
        .filter(([, job]) =>
          (job.steps ?? []).some(
            (step) => installCommands(step.run ?? "").length > 0
          )
        )
        .flatMap(([name, job]) =>
          publishPermissions(workflow, job).map(
            (scope) => `${file} ${name} installs with ${scope}: write`
          )
        )
    );

    expect(privileged).toEqual([]);
  });

  test("never run in a job that exposes credentials to every step", async () => {
    const exposed = (await workflows()).flatMap(([file, workflow]) =>
      Object.entries(workflow.jobs ?? {})
        .filter(
          ([, job]) =>
            (job.steps ?? []).some(
              (step) => installCommands(step.run ?? "").length > 0
            ) &&
            Object.values(job.env ?? {}).some((value) =>
              value?.includes("secrets.")
            )
        )
        .map(([name]) => `${file} ${name} exports secrets to its install step`)
    );

    expect(exposed).toEqual([]);
  });
});

describe("nested installs declared by the repository", () => {
  test("install the docs workspace frozen and without scripts", async () => {
    const manifest = (await Bun.file(
      join(REPO_ROOT, "package.json")
    ).json()) as {
      scripts: Record<string, string>;
    };
    const unsafe = Object.entries(manifest.scripts).flatMap(([name, script]) =>
      unsafeInstalls(`package.json ${name}`, script)
    );

    expect(unsafe).toEqual([]);
  });
});
