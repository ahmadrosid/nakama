import { createHash, timingSafeEqual } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { getToolExecutionEnv } from "../lib/ensure-process-path";

export const CLI_SIGTERM_GRACE_MS = 2000;

const CLI_INSTALL_TIMEOUT_MS = 120_000;

/**
 * Upper bound on waiting for a timed-out child to actually exit. The escalation
 * normally lands long before this; the bound only keeps a caller from waiting
 * forever on a process no signal can reach.
 */
const CLI_SETTLE_TIMEOUT_MS = 5000;

function readPositiveEnvMs(name: string): number | undefined {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export interface GlobalPackageInstallPlan {
  args: string[];
  command: string;
  displayCommand: string;
  /**
   * Child environment. Omitted means the shared tool-execution env, which is
   * the whole server env; set it when the child runs code from a package.
   */
  env?: NodeJS.ProcessEnv;
}

export function detectNpmOrBun(): "npm" | "bun" {
  if (Bun.which("npm")) {
    return "npm";
  }

  if (Bun.which("bun")) {
    return "bun";
  }

  return "npm";
}

export function buildGlobalPackageInstallPlan(
  packageName: string,
  packageManager: "npm" | "bun" = detectNpmOrBun()
): GlobalPackageInstallPlan {
  if (packageManager === "bun") {
    return {
      args: ["install", "-g", "--trust", packageName],
      command: "bun",
      displayCommand: `bun install -g --trust ${packageName}`,
    };
  }

  return {
    args: ["install", "-g", packageName],
    command: "npm",
    displayCommand: `npm install -g ${packageName}`,
  };
}

const NPM_REGISTRY_URL = "https://registry.npmjs.org";

/** An exact version. Ranges, dist-tags, and wildcards are refused. */
const EXACT_PACKAGE_VERSION =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Subresource Integrity with a hash length we accept (sha256 or stronger). */
const PACKAGE_INTEGRITY = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

/** A registry that answers with more than this is not the registry we asked. */
const MAX_PACKAGE_TARBALL_BYTES = 256 * 1024 * 1024;

/**
 * A package to install, named down to the exact version whose tarball hash we
 * reviewed and pinned here. Install runs third-party lifecycle scripts with the
 * server's privileges, so the artifact handed to the package manager is the one
 * we checked rather than whatever the registry currently serves under a name.
 */
export interface PinnedNpmPackage {
  /** `sha512-…` of the published tarball, as the registry reports it. */
  integrity: string;
  name: string;
  /** Exact version. `latest`, `^1.2.3`, and `1.x` are refused. */
  version: string;
}

export function assertPinnedNpmPackage(pkg: PinnedNpmPackage): void {
  if (!EXACT_PACKAGE_VERSION.test(pkg.version)) {
    throw new Error(
      `${pkg.name} must be pinned to an exact version; "${pkg.version}" is a range or a dist-tag.`
    );
  }

  if (!PACKAGE_INTEGRITY.test(pkg.integrity)) {
    throw new Error(
      `${pkg.name}@${pkg.version} is missing a sha256-or-stronger integrity hash.`
    );
  }
}

/**
 * Plain HTTP is only acceptable to a registry on this host: that is a mirror
 * the operator started, and it cannot be downgraded on the way there.
 */
function assertRegistryUrl(url: string, label: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Pinned install ${label} URL is not a URL: ${url}`);
  }

  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsed.hostname
  );

  if (parsed.protocol !== "https:" && !loopback) {
    throw new Error(
      `Pinned install ${label} must be served over https: ${url}`
    );
  }

  return parsed;
}

export function buildPinnedPackageMetadataUrl(
  pkg: PinnedNpmPackage,
  registry: string = NPM_REGISTRY_URL
): string {
  assertPinnedNpmPackage(pkg);

  const base = assertRegistryUrl(registry, "registry");
  base.pathname = `${base.pathname.replace(/\/+$/, "")}/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;

  return base.toString();
}

/**
 * Constant-time comparison: what the registry or the tarball actually produced
 * is checked against the expected hash in full, never short-circuited on the
 * first differing byte.
 */
function assertIntegrity(
  actual: string,
  expected: string,
  message: string
): void {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);

  if (
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    throw new Error(message);
  }
}

export interface PinnedPackageDist {
  integrity: string;
  tarball: string;
}

/**
 * Reads the tarball coordinates out of registry metadata, refusing anything
 * that is not the exact package and hash we pinned. A compromised or
 * misconfigured registry therefore cannot redirect the install to other code.
 */
export function readPinnedPackageDist(
  payload: unknown,
  pkg: PinnedNpmPackage
): PinnedPackageDist {
  assertPinnedNpmPackage(pkg);

  const record = (payload ?? {}) as {
    dist?: { integrity?: unknown; tarball?: unknown };
    name?: unknown;
    version?: unknown;
  };

  if (record.name !== pkg.name || record.version !== pkg.version) {
    throw new Error(
      `Registry served ${String(record.name)}@${String(record.version)} for pinned ${pkg.name}@${pkg.version}.`
    );
  }

  const integrity = String(record.dist?.integrity);
  assertIntegrity(
    integrity,
    pkg.integrity,
    `${pkg.name}@${pkg.version} registry integrity does not match the pinned hash.`
  );

  const tarball = assertRegistryUrl(
    String(record.dist?.tarball ?? ""),
    "tarball"
  );

  return { integrity, tarball: tarball.toString() };
}

/**
 * Subresource Integrity check over the bytes we are about to install, so a
 * tampered or substituted tarball fails here instead of running.
 */
export function verifyPackageTarballIntegrity(
  bytes: Uint8Array,
  expectedIntegrity: string
): void {
  const separator = expectedIntegrity.indexOf("-");
  const algorithm = expectedIntegrity.slice(0, separator);
  const actual = `${algorithm}-${createHash(algorithm).update(bytes).digest("base64")}`;

  assertIntegrity(
    actual,
    expectedIntegrity,
    `Downloaded tarball failed its ${algorithm} integrity check.`
  );
}

export interface PinnedPackageTarball {
  /** Removes the temp copy. Safe to call more than once. */
  cleanup: () => Promise<void>;
  path: string;
}

/**
 * Downloads the pinned tarball and returns its path only after the bytes match
 * the pinned hash. Everything here runs before the package manager is invoked,
 * so a mismatch means nothing is installed at all.
 */
export async function downloadPinnedPackageTarball(
  pkg: PinnedNpmPackage,
  options: {
    onProgress?: (message: string) => void;
    registry?: string;
    signal?: AbortSignal;
  } = {}
): Promise<PinnedPackageTarball> {
  const metadataUrl = buildPinnedPackageMetadataUrl(pkg, options.registry);
  options.onProgress?.(`Resolving pinned ${pkg.name}@${pkg.version}.`);

  const metadataResponse = await fetch(metadataUrl, {
    headers: { accept: "application/json" },
    signal: options.signal,
  });

  if (!metadataResponse.ok) {
    throw new Error(
      `Registry metadata request for ${pkg.name}@${pkg.version} failed (${metadataResponse.status}).`
    );
  }

  const dist = readPinnedPackageDist(await metadataResponse.json(), pkg);
  options.onProgress?.(`Downloading ${pkg.name}@${pkg.version}.`);

  const tarballResponse = await fetch(dist.tarball, { signal: options.signal });
  if (!tarballResponse.ok) {
    throw new Error(
      `Tarball download for ${pkg.name}@${pkg.version} failed (${tarballResponse.status}).`
    );
  }

  const declaredLength = Number(tarballResponse.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PACKAGE_TARBALL_BYTES
  ) {
    throw new Error(
      `Tarball for ${pkg.name}@${pkg.version} is larger than the ${MAX_PACKAGE_TARBALL_BYTES}-byte install limit.`
    );
  }

  const bytes = new Uint8Array(await tarballResponse.arrayBuffer());
  if (bytes.byteLength > MAX_PACKAGE_TARBALL_BYTES) {
    throw new Error(
      `Tarball for ${pkg.name}@${pkg.version} is larger than the ${MAX_PACKAGE_TARBALL_BYTES}-byte install limit.`
    );
  }

  verifyPackageTarballIntegrity(bytes, dist.integrity);
  options.onProgress?.(
    `Verified ${pkg.name}@${pkg.version} against ${dist.integrity}.`
  );

  const dir = await mkdtemp(join(tmpdir(), "nakama-pinned-pkg-"));
  const file = join(
    dir,
    `${pkg.name.replace(/[^A-Za-z0-9.-]/g, "+")}-${pkg.version}.tgz`
  );
  await writeFile(file, bytes);

  return {
    cleanup: () => rm(dir, { force: true, recursive: true }),
    path: file,
  };
}

/**
 * The install child runs package lifecycle scripts, so it gets an environment
 * of what a package installer needs and nothing else — in particular none of
 * the server's provider keys, session secrets, or `npm_config_*` auth tokens.
 */
const INSTALL_ENV_PASSTHROUGH: Record<string, true> = {
  all_proxy: true,
  bun_install: true,
  bun_install_bin: true,
  bun_install_global_dir: true,
  home: true,
  http_proxy: true,
  https_proxy: true,
  lang: true,
  lc_all: true,
  no_proxy: true,
  node_extra_ca_certs: true,
  npm_config_cache: true,
  npm_config_cafile: true,
  npm_config_prefix: true,
  npm_config_registry: true,
  npm_config_userconfig: true,
  path: true,
  shell: true,
  ssl_cert_dir: true,
  ssl_cert_file: true,
  temp: true,
  tmp: true,
  tmpdir: true,
  userprofile: true,
  xdg_cache_home: true,
  xdg_config_home: true,
  xdg_data_home: true,
};

export function buildRestrictedInstallEnv(
  env: NodeJS.ProcessEnv = getToolExecutionEnv()
): NodeJS.ProcessEnv {
  const restricted: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && INSTALL_ENV_PASSTHROUGH[key.toLowerCase()]) {
      restricted[key] = value;
    }
  }

  return restricted;
}

/**
 * Installs an already-verified tarball rather than a registry spec, so the
 * package manager resolves nothing of its own. `bun` still needs `--trust` for
 * this package's `postinstall` (it fetches the native launcher); trust here is
 * scoped to the hash-checked tarball rather than to a name.
 */
export function buildPinnedPackageInstallPlan(
  tarballPath: string,
  packageManager: "npm" | "bun" = detectNpmOrBun()
): GlobalPackageInstallPlan {
  const tarball = basename(tarballPath);

  if (packageManager === "bun") {
    return {
      args: ["install", "-g", "--trust", tarballPath],
      command: "bun",
      displayCommand: `bun install -g --trust ${tarball}`,
      env: buildRestrictedInstallEnv(),
    };
  }

  return {
    args: ["install", "-g", tarballPath],
    command: "npm",
    displayCommand: `npm install -g ${tarball}`,
    env: buildRestrictedInstallEnv(),
  };
}

function extractCliVersion(stdout: string, stderr: string): string | null {
  const output = `${stdout}\n${stderr}`.trim();
  if (!output) {
    return null;
  }

  return output.split(/\r?\n/, 1)[0]?.trim() || null;
}

export function summarizeInstallOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const meaningful =
    lines.find((line) => /^error:/i.test(line)) ??
    lines.find((line) =>
      /(?:EACCES|ENOENT|EPERM|failed|permission denied)/i.test(line)
    ) ??
    lines.find((line) => !/^bun (?:add|install) v/i.test(line)) ??
    lines[0] ??
    output.trim();
  return meaningful.length > 180
    ? `${meaningful.slice(0, 177)}...`
    : meaningful;
}

export async function probeCliVersion(command: string): Promise<{
  installed: boolean;
  version: string | null;
  missing: boolean;
}> {
  const { spawn } = await import("node:child_process");
  const timeoutMs = readPositiveEnvMs("NAKAMA_CLI_PROBE_TIMEOUT_MS") ?? 5000;
  const sigtermGraceMs =
    readPositiveEnvMs("NAKAMA_CLI_SIGTERM_GRACE_MS") ?? CLI_SIGTERM_GRACE_MS;

  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;

    try {
      child = spawn(command, ["--version"], {
        env: getToolExecutionEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve({
        installed: false,
        missing: true,
        version: null,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      killTimeoutId = setTimeout(() => child.kill("SIGKILL"), sigtermGraceMs);
      resolve({ installed: false, missing: false, version: null });
    }, timeoutMs);

    child.stdout?.setEncoding("utf8").on("data", (text: string) => {
      stdout += text;
    });
    child.stderr?.setEncoding("utf8").on("data", (text: string) => {
      stderr += text;
    });
    child.once("error", (error) => {
      clearTimeout(timeoutId);
      clearTimeout(killTimeoutId);
      resolve({
        installed: false,
        missing: (error as NodeJS.ErrnoException).code === "ENOENT",
        version: null,
      });
    });
    child.once("close", (code) => {
      clearTimeout(timeoutId);
      clearTimeout(killTimeoutId);
      resolve({
        installed: code === 0,
        missing: false,
        version: code === 0 ? extractCliVersion(stdout, stderr) : null,
      });
    });
  });
}

export async function runTimedInstallCommand(
  plan: GlobalPackageInstallPlan,
  onProgress?: (message: string) => void,
  options: {
    settleTimeoutMs?: number;
    sigtermGraceMs?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {}
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const { spawn } = await import("node:child_process");
  const timeoutMs = options.timeoutMs ?? CLI_INSTALL_TIMEOUT_MS;
  const sigtermGraceMs = options.sigtermGraceMs ?? CLI_SIGTERM_GRACE_MS;
  const settleTimeoutMs = options.settleTimeoutMs ?? CLI_SETTLE_TIMEOUT_MS;
  const signal = options.signal;

  return new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, {
      // Its own process group, so a deadline can signal the whole install
      // rather than only the command we spawned. Installers shell out, and
      // those grandchildren outlive a kill aimed at the direct child.
      detached: true,
      // A plan that runs package code carries its own allowlisted env; every
      // other plan keeps the shared tool-execution env.
      env: plan.env ?? getToolExecutionEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let exited = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let settleTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = () => {
      clearTimeout(timeoutId);
      clearTimeout(killTimeoutId);
      clearTimeout(settleTimeoutId);
      signal?.removeEventListener("abort", terminate);
    };

    /**
     * Resolving here means the deadline passed, so the exit code is not the
     * installer's own. Waiting for the child's `exit` first is what makes the
     * result honest: it is reported once the process is gone, not once the
     * signal was sent.
     */
    const settleAsTimedOut = () => {
      clearTimers();
      resolve({
        exitCode: null,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
        timedOut,
      });
    };

    /**
     * Signals the whole process group. The `detached` above is what makes the
     * negative pid mean the group rather than the one child; the fallback
     * covers a group that is already gone while the child is not.
     */
    const killTree = (killSignal: "SIGTERM" | "SIGKILL") => {
      if (child.pid) {
        try {
          process.kill(-child.pid, killSignal);
          return;
        } catch {
          // Group already reaped, fall through to the direct child.
        }
      }

      try {
        child.kill(killSignal);
      } catch {
        // Already gone.
      }
    };

    const terminate = () => {
      timedOut = true;

      // The process can already be gone with `close` still outstanding, held by
      // whatever the installer left running. There is nothing left to wait for.
      if (exited) {
        settleAsTimedOut();
        return;
      }

      killTree("SIGTERM");
      killTimeoutId = setTimeout(() => killTree("SIGKILL"), sigtermGraceMs);
      settleTimeoutId = setTimeout(settleAsTimedOut, settleTimeoutMs);
    };

    const timeoutId = setTimeout(terminate, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        terminate();
      } else {
        signal.addEventListener("abort", terminate, { once: true });
      }
    }

    const emitLine = (prefix: "stdout" | "stderr", line: string) => {
      if (timedOut) {
        return;
      }

      onProgress?.(`${prefix}: ${line}`);
    };

    const flushBuffer = (buffer: string, prefix: "stdout" | "stderr") => {
      let nextBuffer = buffer;

      while (true) {
        const newlineIndex = nextBuffer.search(/\r?\n/);

        if (newlineIndex < 0) {
          break;
        }

        const newlineLength = nextBuffer[newlineIndex] === "\r" ? 2 : 1;
        const line = nextBuffer.slice(0, newlineIndex).trim();
        nextBuffer = nextBuffer.slice(newlineIndex + newlineLength);

        if (line) {
          emitLine(prefix, line);
        }
      }

      return nextBuffer;
    };

    child.stdout?.setEncoding("utf8").on("data", (text: string) => {
      stdout += text;
      stdoutBuffer += text;
      stdoutBuffer = flushBuffer(stdoutBuffer, "stdout");
    });
    child.stderr?.setEncoding("utf8").on("data", (text: string) => {
      stderr += text;
      stderrBuffer += text;
      stderrBuffer = flushBuffer(stderrBuffer, "stderr");
    });

    /**
     * `close` waits for the stdio pipes, which anything the installer left
     * running can hold open indefinitely, so it is not a usable signal for a
     * run that has already timed out. `exit` fires when the process itself is
     * gone, which is the question the timeout path is asking.
     */
    child.once("exit", () => {
      exited = true;

      if (timedOut) {
        settleAsTimedOut();
      }
    });

    child.once("error", (error) => {
      clearTimers();

      if (stdoutBuffer.trim()) {
        emitLine("stdout", stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        emitLine("stderr", stderrBuffer.trim());
      }

      resolve({
        exitCode: null,
        stderr: `${stderr}\n${String(error)}`.trim(),
        stdout,
        timedOut,
      });
    });

    child.once("close", (exitCode) => {
      clearTimers();

      if (stdoutBuffer.trim()) {
        emitLine("stdout", stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        emitLine("stderr", stderrBuffer.trim());
      }

      resolve({
        exitCode,
        stderr: stderr.trim(),
        stdout: stdout.trim(),
        timedOut,
      });
    });
  });
}
