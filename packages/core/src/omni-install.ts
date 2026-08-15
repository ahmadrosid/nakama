/**
 * Fetching the optimiser binary at runtime, for instances already running.
 *
 * The image can carry it (`docker build --build-arg OMNI_VERSION=`), and by
 * default it does. An instance already deployed cannot be talked into a rebuild,
 * so the toggle in the dashboard would switch on something that is not there and
 * the panel would report it missing with no way forward. This closes that one
 * gap and does nothing else.
 *
 * What the checksum buys, stated plainly: SHA256SUMS is fetched from the same
 * release as the archive, so it catches a truncated or corrupted download. It is
 * not a defence against a compromised release, because an attacker who can
 * replace one asset can replace both. Operators who need more than that set
 * `NAKAMA_OMNI_AUTO_INSTALL=0` and build the image with the binary instead.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getUserConfigDir } from "./user-config";

/**
 * Pinned rather than resolved to "latest". An install that changes under a
 * restart is not reproducible, and the Dockerfile pins the same way, so the two
 * routes to the same binary agree.
 */
const DEFAULT_VERSION = "0.7.5";
const RELEASES = "https://github.com/fajarhide/omni/releases/download";
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Only the targets the project publishes a tarball for. Windows ships as a zip
 * and no deployment here runs on it, so it is reported unsupported rather than
 * half-handled. */
const TARGETS: Record<string, string> = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "linux-x64": "x86_64-unknown-linux-musl",
};

export type OmniInstallResult = { error?: string; installed: boolean };

export function omniTarget(
  platform: string = process.platform,
  arch: string = process.arch
): string | null {
  return TARGETS[`${platform}-${arch}`] ?? null;
}

export function omniVersion(): string {
  return process.env.OMNI_VERSION?.trim() || DEFAULT_VERSION;
}

/** Where a runtime-installed binary lives. Under the config dir because that is
 * the one path the container is guaranteed to be able to write to: it is the
 * mounted volume, owned by the same uid the server runs as. */
export function managedOmniPath(): string {
  return join(getUserConfigDir(), "bin", "omni");
}

/**
 * The command to spawn. The managed copy only when we put one there, so an
 * operator's own install on PATH stays authoritative and is never shadowed by a
 * version this code picked.
 */
export function omniCommand(): string {
  const managed = managedOmniPath();
  return existsSync(managed) ? managed : "omni";
}

export function isAutoInstallAllowed(): boolean {
  return process.env.NAKAMA_OMNI_AUTO_INSTALL?.trim() !== "0";
}

/**
 * The digest SHA256SUMS publishes for one archive, or null when it says nothing
 * about it. A missing or malformed line is a failure, never a pass: verifying
 * against nothing and verifying successfully must not look the same.
 */
export function digestFor(sums: string, archive: string): string | null {
  for (const line of sums.split("\n")) {
    const [digest, name] = line.trim().split(/\s+/);
    // `sha256sum` marks binary mode with a leading asterisk on the filename.
    if (name?.replace(/^\*/, "") === archive && /^[0-9a-f]{64}$/.test(digest)) {
      return digest;
    }
  }
  return null;
}

let inFlight: Promise<OmniInstallResult> | null = null;

/**
 * Download, verify and install, or say why not. Never throws: a failed install
 * leaves the optimiser off, which is the state the caller was already in.
 *
 * Concurrent callers share one attempt, so two operators toggling at once cannot
 * write the same file from two directions.
 */
export function installOmni(): Promise<OmniInstallResult> {
  inFlight ??= attempt().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function attempt(): Promise<OmniInstallResult> {
  if (!isAutoInstallAllowed()) {
    return {
      error: "Automatic install is off (NAKAMA_OMNI_AUTO_INSTALL=0).",
      installed: false,
    };
  }

  const target = omniTarget();
  if (!target) {
    return {
      error: `No omni release is published for ${process.platform}-${process.arch}.`,
      installed: false,
    };
  }

  const version = omniVersion();
  const archive = `omni-v${version}-${target}.tar.gz`;
  const base = `${RELEASES}/v${version}`;
  const dir = join(getUserConfigDir(), "bin");
  const staging = join(dir, `.omni-${process.pid}`);

  try {
    const [tarball, sums] = await Promise.all([
      fetchBytes(`${base}/${archive}`),
      fetchText(`${base}/SHA256SUMS`),
    ]);

    const expected = digestFor(sums, archive);
    if (!expected) {
      return {
        error: `SHA256SUMS for v${version} does not list ${archive}.`,
        installed: false,
      };
    }
    const actual = createHash("sha256").update(tarball).digest("hex");
    if (actual !== expected) {
      return { error: `Checksum mismatch for ${archive}.`, installed: false };
    }

    mkdirSync(staging, { recursive: true });
    const tarPath = join(staging, archive);
    writeFileSync(tarPath, tarball);

    const failure = await extract(tarPath, staging);
    if (failure) {
      return { error: failure, installed: false };
    }

    const binary = join(staging, "omni");
    if (!existsSync(binary)) {
      return {
        error: `${archive} did not contain an omni binary.`,
        installed: false,
      };
    }

    chmodSync(binary, 0o755);
    // Rename last and from the same filesystem, so the path the spawner reads
    // either holds nothing or holds a complete, verified, executable binary.
    renameSync(binary, managedOmniPath());
    return { installed: true };
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : String(cause),
      installed: false,
    };
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}

async function fetchBytes(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function fetchText(url: string): Promise<string> {
  return (await fetchBytes(url)).toString("utf8");
}

function extract(tarPath: string, into: string): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("tar", ["-xzf", tarPath, "-C", into], { stdio: "ignore" });
    } catch (cause) {
      resolve(`tar could not be started: ${String(cause)}`);
      return;
    }
    child.on("error", (cause) =>
      resolve(`tar could not be started: ${cause.message}`)
    );
    child.on("close", (code) =>
      resolve(code === 0 ? null : `tar exited with code ${code}.`)
    );
  });
}
