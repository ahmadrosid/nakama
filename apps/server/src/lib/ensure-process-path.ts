import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import fixPath from "fix-path";

let ensured = false;

export function ensureProcessPath(): void {
  if (ensured || process.env.NAKAMA_DISABLE_FIX_PATH === "1") {
    return;
  }

  fixPath();
  ensured = true;
}

function getBunGlobalPaths(home = homedir()): { binDir: string; globalDir: string } {
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

export function getToolExecutionEnv(): NodeJS.ProcessEnv {
  ensureProcessPath();

  const home = homedir();
  const { binDir, globalDir } = getBunGlobalPaths(home);
  const pathKey = process.platform === "win32" ? "Path" : "PATH";

  if (process.env.NAKAMA_DISABLE_FIX_PATH === "1") {
    return {
      ...process.env,
      BUN_INSTALL_BIN: process.env.BUN_INSTALL_BIN ?? binDir,
      BUN_INSTALL_GLOBAL_DIR: process.env.BUN_INSTALL_GLOBAL_DIR ?? globalDir,
      [pathKey]: process.env[pathKey] ?? "",
    };
  }

  const extras = [binDir, path.join(home, ".local", "bin"), "/usr/local/bin"];
  const current = process.env[pathKey] ?? "";
  const prefix = extras.join(path.delimiter);

  return {
    ...process.env,
    BUN_INSTALL_BIN: process.env.BUN_INSTALL_BIN ?? binDir,
    BUN_INSTALL_GLOBAL_DIR: process.env.BUN_INSTALL_GLOBAL_DIR ?? globalDir,
    [pathKey]: prefix ? `${prefix}${path.delimiter}${current}` : current,
  };
}

export function resetProcessPathState(): void {
  ensured = false;
}
