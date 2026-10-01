import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { getToolExecutionEnv } from "./ensure-process-path";

const saved = {
  BUN_INSTALL_BIN: process.env.BUN_INSTALL_BIN,
  NAKAMA_DISABLE_FIX_PATH: process.env.NAKAMA_DISABLE_FIX_PATH,
  PATH: process.env.PATH,
};

function restore(key: keyof typeof saved): void {
  const value = saved[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

function pathEntries(env: NodeJS.ProcessEnv): [string, string | undefined][] {
  return Object.entries(env).filter(([key]) => key.toUpperCase() === "PATH");
}

describe("getToolExecutionEnv with NAKAMA_DISABLE_FIX_PATH", () => {
  afterEach(() => {
    restore("BUN_INSTALL_BIN");
    restore("NAKAMA_DISABLE_FIX_PATH");
    restore("PATH");
  });

  const bunBin = path.join(path.parse(process.cwd()).root, "nakama", "bin");
  const systemBin = path.join(path.parse(process.cwd()).root, "system", "bin");

  test.skipIf(process.platform !== "win32")(
    "puts BUN_INSTALL_BIN first under the one PATH key on Windows",
    () => {
      process.env.NAKAMA_DISABLE_FIX_PATH = "1";
      process.env.BUN_INSTALL_BIN = bunBin;
      process.env.PATH = systemBin;

      expect(pathEntries(getToolExecutionEnv())).toEqual([
        ["PATH", `${bunBin}${path.delimiter}${systemBin}`],
      ]);
    }
  );

  test.skipIf(process.platform !== "win32")(
    "does not add BUN_INSTALL_BIN twice on Windows",
    () => {
      process.env.NAKAMA_DISABLE_FIX_PATH = "1";
      process.env.BUN_INSTALL_BIN = bunBin;
      process.env.PATH = `${systemBin}${path.delimiter}${bunBin.toUpperCase()}`;

      expect(pathEntries(getToolExecutionEnv())).toEqual([
        ["PATH", `${systemBin}${path.delimiter}${bunBin.toUpperCase()}`],
      ]);
    }
  );

  test.skipIf(process.platform === "win32")(
    "leaves PATH as the desktop app set it elsewhere",
    () => {
      process.env.NAKAMA_DISABLE_FIX_PATH = "1";
      process.env.BUN_INSTALL_BIN = bunBin;
      process.env.PATH = systemBin;

      expect(pathEntries(getToolExecutionEnv())).toEqual([["PATH", systemBin]]);
    }
  );
});
