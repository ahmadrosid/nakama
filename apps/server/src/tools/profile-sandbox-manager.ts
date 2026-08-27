import type { BashSandboxNetwork } from "./bash-config";

export const BASH_SANDBOX_GUEST_WORKSPACE = "/workspace";

export interface BashSandboxExecResult {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

export interface BashSandboxEnsureArgs {
  guestWorkspace: string;
  hostWorkspace: string;
  image: string;
  name: string;
  network: BashSandboxNetwork;
}

export interface BashSandboxExecArgs {
  command: string;
  env: Record<string, string>;
  guestCwd: string;
  name: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

/** Narrow port so unit tests inject a fake without live microVMs. */
export interface BashSandboxRuntime {
  ensure(args: BashSandboxEnsureArgs): Promise<void>;
  exec(args: BashSandboxExecArgs): Promise<BashSandboxExecResult>;
}

export function profileSandboxName(orgId: string, profileId: string): string {
  const raw = `nakama-${orgId}-${profileId}`
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const truncated = raw.slice(0, 128);
  return truncated || "nakama-profile";
}

export function toGuestCwd(args: {
  guestWorkspace: string;
  hostCwd: string;
  hostWorkspace: string;
}): string {
  const { guestWorkspace, hostCwd, hostWorkspace } = args;
  if (hostCwd === hostWorkspace) {
    return guestWorkspace;
  }

  const prefix = hostWorkspace.endsWith("/")
    ? hostWorkspace
    : `${hostWorkspace}/`;
  if (!hostCwd.startsWith(prefix)) {
    throw new Error("cwd must resolve under the profile workspace.");
  }

  const relative = hostCwd.slice(prefix.length);
  return relative
    ? `${guestWorkspace.replace(/\/$/, "")}/${relative}`
    : guestWorkspace;
}

export class ProfileSandboxManager {
  private readonly ensured = new Map<string, string>();

  constructor(private readonly runtime: BashSandboxRuntime) {}

  async run(args: {
    command: string;
    env: Record<string, string>;
    hostCwd: string;
    hostWorkspace: string;
    image: string;
    network: BashSandboxNetwork;
    orgId: string;
    profileId: string;
    signal?: AbortSignal;
    timeoutMs: number;
  }): Promise<BashSandboxExecResult> {
    const name = profileSandboxName(args.orgId, args.profileId);
    const guestWorkspace = BASH_SANDBOX_GUEST_WORKSPACE;
    const fingerprint = `${args.hostWorkspace}|${args.network}|${args.image}|${guestWorkspace}`;

    if (this.ensured.get(name) !== fingerprint) {
      await this.runtime.ensure({
        guestWorkspace,
        hostWorkspace: args.hostWorkspace,
        image: args.image,
        name,
        network: args.network,
      });
      this.ensured.set(name, fingerprint);
    }

    const guestCwd = toGuestCwd({
      guestWorkspace,
      hostCwd: args.hostCwd,
      hostWorkspace: args.hostWorkspace,
    });

    return this.runtime.exec({
      command: args.command,
      env: args.env,
      guestCwd,
      name,
      signal: args.signal,
      timeoutMs: args.timeoutMs,
    });
  }

  /** Test helper — does not destroy sandboxes, only clears create-once cache. */
  resetEnsuredForTests(): void {
    this.ensured.clear();
  }

  ensuredNamesForTests(): string[] {
    return [...this.ensured.keys()];
  }
}
