import { ExecTimeoutError, isInstalled, Sandbox } from "microsandbox";
import type {
  BashSandboxEnsureArgs,
  BashSandboxExecArgs,
  BashSandboxExecResult,
  BashSandboxRuntime,
} from "./profile-sandbox-manager";

const MAX_OUTPUT_CHARS = 32_000;

/**
 * Caps as it goes instead of truncating once at the end. The model saw the same
 * ceiling either way; the server held everything the command wrote.
 */
export function createBoundedOutput(limit: number = MAX_OUTPUT_CHARS) {
  let value = "";
  let truncated = false;
  return {
    append(chunk: string): void {
      if (truncated) {
        return;
      }
      const next = value + chunk;
      if (next.length > limit) {
        value = next.slice(0, limit);
        truncated = true;
        return;
      }
      value = next;
    },
    read(): string {
      return truncated ? `${value}\n...[truncated]` : value;
    },
  };
}

async function connectSandbox(name: string): Promise<Sandbox> {
  const handle = await Sandbox.get(name);
  if (handle.status === "running") {
    return handle.connect();
  }
  return handle.startDetached();
}

export class MicrosandboxBashRuntime implements BashSandboxRuntime {
  async ensure(args: BashSandboxEnsureArgs): Promise<void> {
    let installed = false;
    try {
      installed = isInstalled();
    } catch (error) {
      const message = error instanceof Error ? error.message : "probe failed";
      throw new Error(
        `MicroSandbox backend unavailable: ${message}. No host fallback.`
      );
    }

    if (!installed) {
      throw new Error(
        "MicroSandbox backend unavailable: runtime is not installed. Set NAKAMA_BASH_BACKEND=host or install MicroSandbox. No host fallback."
      );
    }

    let builder = Sandbox.builder(args.name)
      .image(args.image)
      .detached(true)
      .workdir(args.guestWorkspace)
      .shell("/bin/sh")
      .replace()
      .volume(args.guestWorkspace, (mount) => mount.bind(args.hostWorkspace));

    if (args.network === "off") {
      builder = builder.disableNetwork();
    }

    try {
      console.info(`[MicroSandbox] Starting ${args.name} (${args.image})`);
      const creation = await builder.createWithPullProgress();
      const reported = new Map<number, number>();
      for await (const event of creation.progress) {
        if (
          event.kind === "layerDownloadProgress" &&
          event.totalBytes &&
          event.downloadedBytes !== undefined &&
          event.layerIndex !== undefined
        ) {
          const percent = Math.floor(
            (event.downloadedBytes / event.totalBytes) * 100
          );
          const step = Math.floor(percent / 25) * 25;
          if (step > (reported.get(event.layerIndex) ?? 0)) {
            reported.set(event.layerIndex, step);
            console.info(
              `[MicroSandbox] ${args.image} layer ${event.layerIndex + 1}: ${step}% downloaded`
            );
          }
        }
      }
      await creation.awaitSandbox();
      console.info(`[MicroSandbox] ${args.name} ready`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "sandbox create failed";
      throw new Error(
        `MicroSandbox backend unavailable: ${message}. No host fallback.`
      );
    }
  }

  async exec(args: BashSandboxExecArgs): Promise<BashSandboxExecResult> {
    if (args.signal?.aborted) {
      throw new Error("The operation was aborted");
    }

    let sandbox: Sandbox;
    try {
      sandbox = await connectSandbox(args.name);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "sandbox connect failed";
      throw new Error(
        `MicroSandbox backend unavailable: ${message}. No host fallback.`
      );
    }

    const handle = await sandbox.execStreamWith("/bin/sh", (opts) =>
      opts
        .args(["-lc", args.command])
        .cwd(args.guestCwd)
        .envs(args.env)
        .timeout(args.timeoutMs)
    );

    const onAbort = () => {
      void handle.kill().catch(() => undefined);
    };
    args.signal?.addEventListener("abort", onAbort, { once: true });

    const stdout = createBoundedOutput();
    const stderr = createBoundedOutput();
    let exitCode: number | null = null;

    try {
      // Stream events so a timeout still returns output buffered before the deadline
      // (same I/O contract as host bash).
      for await (const event of handle) {
        if (event.kind === "stdout") {
          stdout.append(new TextDecoder().decode(event.data));
        } else if (event.kind === "stderr") {
          stderr.append(new TextDecoder().decode(event.data));
        } else if (event.kind === "exited") {
          exitCode = event.code;
        }
      }
      return {
        exitCode,
        stderr: stderr.read(),
        stdout: stdout.read(),
        timedOut: false,
      };
    } catch (error) {
      if (error instanceof ExecTimeoutError) {
        return {
          exitCode: null,
          stderr: stderr.read(),
          stdout: stdout.read(),
          timedOut: true,
        };
      }
      if (args.signal?.aborted) {
        throw new Error("The operation was aborted");
      }
      throw error;
    } finally {
      args.signal?.removeEventListener("abort", onAbort);
    }
  }
}
