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

test("does not pass the master key to child processes", () => {
  const previous = process.env.NAKAMA_SECRETS_KEY;
  const previousProvider = process.env.OPENAI_API_KEY;
  process.env.NAKAMA_SECRETS_KEY = "private";
  process.env.OPENAI_API_KEY = "provider-private";

  try {
    expect(getToolExecutionEnv().NAKAMA_SECRETS_KEY).toBeUndefined();
    expect(getToolExecutionEnv().OPENAI_API_KEY).toBeUndefined();
  } finally {
    if (previous === undefined) {
      delete process.env.NAKAMA_SECRETS_KEY;
    } else {
      process.env.NAKAMA_SECRETS_KEY = previous;
    }

    if (previousProvider === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previousProvider;
    }
  }
});

describe("getToolExecutionEnv keeps Nakama credentials out of tools", () => {
  const LEAKED = [
    "NAKAMA_LOCAL_AUTH_TOKEN",
    "NAKAMA_PLUGIN_NPM_TOKEN",
    "NAKAMA_EMAIL_ATTACHMENT_SECRET",
    "NAKAMA_TELEGRAM_MANAGER_BOT_TOKEN",
    "TELEGRAM_MANAGER_WEBHOOK_SECRET",
    "NAKAMA_WHATSAPP_CONTEXT_TOKEN",
    "NAKAMA_SEED_ADMIN_PASSWORD",
  ];

  afterEach(() => {
    for (const key of [...LEAKED, "GITHUB_TOKEN", "NAKAMA_PORT"]) {
      delete process.env[key];
    }
  });

  test("strips Nakama's own tokens and secrets", () => {
    for (const key of LEAKED) {
      process.env[key] = "secret-value";
    }

    const env = getToolExecutionEnv();

    for (const key of LEAKED) {
      expect({ key, value: env[key] }).toEqual({ key, value: undefined });
    }
  });

  test("keeps a user's own token and ordinary Nakama settings", () => {
    process.env.GITHUB_TOKEN = "user-token";
    process.env.NAKAMA_PORT = "4310";

    const env = getToolExecutionEnv();

    expect(env.GITHUB_TOKEN).toBe("user-token");
    expect(env.NAKAMA_PORT).toBe("4310");
  });
});
