import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { withDevSecretsKey } from "./dev-secrets-key";

const dirs: string[] = [];

function tempPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "nakama-dev-secrets-"));
  dirs.push(dir);

  return join(dir, "nested", "dev-secrets.env");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("withDevSecretsKey", () => {
  test("keeps a key the environment already sets", () => {
    const path = tempPath();
    const env = withDevSecretsKey({ NAKAMA_SECRETS_KEY: "set" }, path);

    expect(env.NAKAMA_SECRETS_KEY).toBe("set");
    expect(() => statSync(path)).toThrow();
  });

  test("creates one private key and reuses it on the next start", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const path = tempPath();

    const first = withDevSecretsKey({}, path).NAKAMA_SECRETS_KEY;
    const second = withDevSecretsKey({}, path).NAKAMA_SECRETS_KEY;

    expect(first).toBe(second);
    expect(Buffer.from(first ?? "", "base64")).toHaveLength(32);

    if (process.platform !== "win32") {
      expect(statSync(path).mode.toString(8).slice(-3)).toBe("600");
    }

    expect(readFileSync(path, "utf8")).toBe(`NAKAMA_SECRETS_KEY=${first}\n`);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test("reads a key file written by hand", () => {
    const path = tempPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "# local\nNAKAMA_SECRETS_KEY=handwritten\n");

    expect(withDevSecretsKey({}, path).NAKAMA_SECRETS_KEY).toBe("handwritten");
  });
});
