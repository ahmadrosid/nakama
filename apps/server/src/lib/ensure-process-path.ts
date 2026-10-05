import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

let ensured = false;

/** GUI apps on macOS inherit a stripped PATH. Copy the login-shell PATH once. */
function applyLoginShellPath(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const shell = process.env.SHELL?.trim() || "/bin/zsh";
  const result = spawnSync(shell, ["-l", "-c", 'printf %s "$PATH"'], {
    encoding: "utf8",
    timeout: 3000,
  });
  const shellPath = result.stdout?.trim();

  if (result.status === 0 && shellPath) {
    process.env.PATH = shellPath;
  }
}

export function ensureProcessPath(): void {
  if (ensured || process.env.NAKAMA_DISABLE_FIX_PATH === "1") {
    return;
  }

  applyLoginShellPath();
  ensured = true;
}

function getBunGlobalPaths(home = homedir()): {
  binDir: string;
  globalDir: string;
} {
  return {
    binDir: path.join(home, ".bun", "bin"),
    globalDir: path.join(home, ".bun", "install", "global"),
  };
}

export function ensureBunGlobalInstallDirs(home = homedir()): void {
  const { binDir, globalDir } = getBunGlobalPaths(home);
  mkdirSync(binDir, { recursive: true });
  mkdirSync(globalDir, { recursive: true });
}

/**
 * Windows env names are case-insensitive, and Bun reports this one as `PATH`.
 * Writing `Path` beside it would hand the child two spellings of one variable.
 */
function getPathKey(): string {
  if (process.platform !== "win32") {
    return "PATH";
  }

  return (
    Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ??
    "Path"
  );
}

/**
 * The desktop app installs CLIs with `bun install -g` into its own
 * BUN_INSTALL_BIN, which is not on the PATH it hands the server.
 */
function withBunInstallBin(current: string): string {
  const bunBin = process.env.BUN_INSTALL_BIN;

  if (
    process.platform !== "win32" ||
    !bunBin ||
    current
      .split(path.delimiter)
      .some((entry) => entry.toLowerCase() === bunBin.toLowerCase())
  ) {
    return current;
  }

  return current ? `${bunBin}${path.delimiter}${current}` : bunBin;
}

export function getToolExecutionEnv(): NodeJS.ProcessEnv {
  ensureProcessPath();

  const baseEnv = { ...process.env };
  for (const key of Object.keys(baseEnv)) {
    if (
      key === "NAKAMA_SECRETS_KEY" ||
      key === "NAKAMA_SECRETS_KEY_NEXT" ||
      key === "NAKAMA_EMAIL_PASSWORD" ||
      key === "NAKAMA_EMAIL_PASSWORD_FILE" ||
      key.startsWith("NAKAMA_PROVIDER_API_KEY_") ||
      key.startsWith("NAKAMA_TOOL_API_KEY_") ||
      /(?:^|_)API_KEY(?:_FILE)?$/.test(key)
    ) {
      delete baseEnv[key];
    }
  }

  const home = homedir();
  const { binDir, globalDir } = getBunGlobalPaths(home);
  const pathKey = getPathKey();

  if (process.env.NAKAMA_DISABLE_FIX_PATH === "1") {
    return {
      ...baseEnv,
      BUN_INSTALL_BIN: process.env.BUN_INSTALL_BIN ?? binDir,
      BUN_INSTALL_GLOBAL_DIR: process.env.BUN_INSTALL_GLOBAL_DIR ?? globalDir,
      [pathKey]: withBunInstallBin(process.env[pathKey] ?? ""),
    };
  }

  const extras = [binDir, path.join(home, ".local", "bin"), "/usr/local/bin"];
  const current = process.env[pathKey] ?? "";
  const prefix = extras.join(path.delimiter);

  return {
    ...baseEnv,
    BUN_INSTALL_BIN: process.env.BUN_INSTALL_BIN ?? binDir,
    BUN_INSTALL_GLOBAL_DIR: process.env.BUN_INSTALL_GLOBAL_DIR ?? globalDir,
    [pathKey]: prefix ? `${prefix}${path.delimiter}${current}` : current,
  };
}
