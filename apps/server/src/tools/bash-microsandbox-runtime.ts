import {
  ExecTimeoutError,
  isInstalled,
  Sandbox,
  SandboxNotFoundError,
} from "microsandbox";
import type {
  BashSandboxEnsureArgs,
  BashSandboxExecArgs,
  BashSandboxExecResult,
  BashSandboxRuntime,
} from "./profile-sandbox-manager";

const MAX_OUTPUT_CHARS = 32_000;

function truncateOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) {
    return value;
  }
  return value.slice(0, MAX_OUTPUT_CHARS) + "\n...[truncated]";
}

async function connectSandbox(name: string): Promise<Sandbox> {
  try {
    const handle = await Sandbox.get(name);
    if (handle.status === "running") {
      return handle.connect();
    }
    return handle.startDetached();
  } catch (error) {
    if (error instanceof SandboxNotFoundError) {
      throw error;
    }
    try {
      return await Sandbox.startDetached(name);
    } catch {
      throw error;
    }
  }
}

export class MicrosandboxBashRuntime implements BashSandboxRuntime {
  async probe(): Promise<void> {
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
  }

  async ensure(args: BashSandboxEnsureArgs): Promise<void> {
    await this.probe();

    try {
      await connectSandbox(args.name);
      return;
    } catch (error) {
      if (!(error instanceof SandboxNotFoundError)) {
        // Missing sandbox → create below; other errors still try create with replace.
      }
    }

    let builder = Sandbox.builder(args.name)
      .image(args.image)
      .detached(true)
      .workdir(args.guestWorkspace)
      .shell("/bin/sh")
      .volume(args.guestWorkspace, (mount) => mount.bind(args.hostWorkspace));

    if (args.network === "off") {
      builder = builder.disableNetwork();
    }

    try {
      await builder.create();
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

    try {
      const result = await handle.collect();
      return {
        exitCode: result.code,
        stderr: truncateOutput(result.stderr()),
        stdout: truncateOutput(result.stdout()),
        timedOut: false,
      };
    } catch (error) {
      if (error instanceof ExecTimeoutError) {
        return {
          exitCode: null,
          stderr: "",
          stdout: "",
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

export function createDefaultMicrosandboxRuntime(): BashSandboxRuntime {
  return new MicrosandboxBashRuntime();
}
