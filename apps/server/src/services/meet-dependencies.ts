import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginDependencyStatus } from "@nakama/core/contract";

const INSTALLER = "/usr/local/sbin/nakama-install-meet-deps";
const STEPS = [
  [
    "system",
    "Linux packages: FFmpeg, PulseAudio, Xvfb, fonts and browser libraries",
  ],
  ["runtime", "BetterWright 2.8.1 and CloakBrowser SDK 0.5.10"],
  ["browser", "CloakBrowser Chromium download"],
  ["verify", "Check browser and audio runtime"],
] as const;
type StepId = (typeof STEPS)[number][0];
interface SetupOperations {
  check(id: StepId): Promise<boolean>;
  install(id: StepId): Promise<void>;
  supported: boolean;
}

/** One host-owned setup job; never execute dependency commands from plugin manifests. */
export class MeetDependencies {
  private job?: Promise<void>;
  private result?: PluginDependencyStatus;
  private readonly operations: SetupOperations;

  constructor(configDir: string, operations?: SetupOperations) {
    this.operations = operations ?? runtimeOperations(configDir);
  }

  async status(): Promise<PluginDependencyStatus> {
    if (this.result && this.result.state !== "ready") {
      return structuredClone(this.result);
    }
    const steps = await Promise.all(
      STEPS.map(async ([id, label]) => ({
        id,
        label,
        state: (await this.operations.check(id))
          ? ("ready" as const)
          : ("pending" as const),
      }))
    );
    return {
      state: this.operations.supported
        ? steps.every((step) => step.state === "ready")
          ? "ready"
          : "pending"
        : "unsupported",
      ...(this.operations.supported
        ? {}
        : {
            error:
              "Automatic Google Meet setup requires the current Nakama Linux Docker image (amd64 or arm64).",
          }),
      steps,
    };
  }

  async start() {
    if (!this.operations.supported) {
      throw new Error(
        "Automatic Google Meet setup is unavailable on this host"
      );
    }
    if (!this.job) {
      this.result = {
        state: "installing",
        steps: STEPS.map(([id, label]) => ({ id, label, state: "pending" })),
      };
      this.job = this.run().finally(() => {
        this.job = undefined;
      });
    }
    return this.status();
  }

  async wait() {
    await this.job;
  }

  private async run() {
    const result = this.result!;
    for (const step of result.steps) {
      try {
        step.state = "installing";
        const id = step.id as StepId;
        if (!(await this.operations.check(id))) {
          await this.operations.install(id);
          if (!(await this.operations.check(id))) {
            throw new Error("Dependency verification failed");
          }
        }
        step.state = "ready";
      } catch {
        step.state = "failed";
        result.state = "failed";
        result.error = `Could not complete: ${step.label}. Check network access, free disk space and Docker configuration, then retry.`;
        return;
      }
    }
    result.state = "ready";
  }
}

function runtimeOperations(configDir: string): SetupOperations {
  const root = join(configDir, "runtimes", "google-meet");
  const runtime = join(root, "sdk-2.8.1-0.5.10");
  const browserFile = join(root, "browser.json");
  const env = {
    CLOAKBROWSER_AUTO_UPDATE: "false",
    CLOAKBROWSER_CACHE_DIR: join(root, "browser-cache"),
    HOME: root,
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  };
  async function run(args: string[], cwd = root, timeout = 900_000) {
    const child = Bun.spawn(args, {
      cwd,
      env,
      stderr: "ignore",
      stdin: "ignore",
      stdout: "ignore",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    try {
      if ((await child.exited) !== 0) {
        throw new Error("Dependency command failed");
      }
    } finally {
      clearTimeout(timer);
    }
  }
  async function browserPath() {
    try {
      const saved = JSON.parse(await readFile(browserFile, "utf8"));
      return typeof saved.path === "string" && existsSync(saved.path)
        ? (saved.path as string)
        : undefined;
    } catch {}
  }
  async function check(id: StepId): Promise<boolean> {
    if (id === "system") {
      return ["ffmpeg", "pulseaudio", "pactl", "Xvfb"].every((name) =>
        Boolean(Bun.which(name))
      );
    }
    if (id === "runtime") {
      if (!existsSync(join(runtime, "ready"))) {
        return false;
      }
      try {
        await run(
          [
            process.execPath,
            "-e",
            "const m = await import('./node_modules/betterwright/dist/src/index.js'); const c = await import('cloakbrowser'); if (typeof m.BetterWright !== 'function' || typeof c.ensureBinary !== 'function') process.exit(1)",
          ],
          runtime,
          15_000
        );
        return true;
      } catch {
        return false;
      }
    }
    if (id === "browser") {
      return Boolean(await browserPath());
    }
    const binary = await browserPath();
    if (!(binary && (await check("system")) && (await check("runtime")))) {
      return false;
    }
    try {
      await run([binary, "--version"], root, 15_000);
      await run(["ffmpeg", "-version"], root, 15_000);
      await run(["pulseaudio", "--version"], root, 15_000);
      return true;
    } catch {
      return false;
    }
  }
  return {
    check,
    async install(id) {
      await mkdir(root, { mode: 0o700, recursive: true });
      if (id === "system") {
        await run(["sudo", "-n", INSTALLER]);
      } else if (id === "runtime") {
        const staging = `${runtime}.staging`;
        await rm(staging, { force: true, recursive: true });
        await mkdir(staging, { mode: 0o700 });
        await writeFile(
          join(staging, "package.json"),
          JSON.stringify({
            dependencies: { betterwright: "2.8.1", cloakbrowser: "0.5.10" },
            private: true,
          })
        );
        await run(
          [
            process.execPath,
            "install",
            "--production",
            "--ignore-scripts",
            "--registry=https://registry.npmjs.org",
          ],
          staging
        );
        await writeFile(join(staging, "ready"), "1");
        await rm(runtime, { force: true, recursive: true });
        await rename(staging, runtime);
      } else if (id === "browser") {
        await run(
          [
            process.execPath,
            "-e",
            "import {ensureBinary} from 'cloakbrowser'; const path = await ensureBinary(); await Bun.write(process.argv[1] + '.tmp', JSON.stringify({path}));",
            browserFile,
          ],
          runtime
        );
        await rename(`${browserFile}.tmp`, browserFile);
      } else {
        // Retry also repairs missing shared libraries on an upgraded container.
        await run(["sudo", "-n", INSTALLER]);
      }
    },
    supported:
      process.platform === "linux" &&
      ["arm64", "x64"].includes(process.arch) &&
      existsSync(INSTALLER),
  };
}
