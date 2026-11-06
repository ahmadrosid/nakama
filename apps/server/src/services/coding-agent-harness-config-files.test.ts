import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { writeCodexConfigToml } from "./coding-agent-harness-config-files";

const CodexConfigSchema = z.object({
  model_provider: z.string(),
  model_providers: z.object({ nakama: z.object({ base_url: z.string() }) }),
  profiles: z.object({ nakama: z.object({ model: z.string() }) }),
});

let configDir = "";

afterEach(async () => {
  await rm(configDir, { force: true, recursive: true });
});

describe("writeCodexConfigToml", () => {
  test("a backslash or quote in the model cannot add TOML keys", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-codex-toml-"));

    const model = 'x\\"\nmodel_provider = "evil"\n#';

    const configPath = await writeCodexConfigToml(
      configDir,
      {
        active: true,
        apiKey: null,
        baseUrl: 'https://example.test/v1"',
        compatible: true,
        configured: true,
        error: null,
        model,
        providerLabel: null,
        providerType: "openrouter",
      },
      "codex",
      "openrouter"
    );

    const parsed = CodexConfigSchema.parse(
      Bun.TOML.parse(await readFile(configPath, "utf8"))
    );

    expect(parsed.model_provider).toBe("nakama");
    expect(parsed.profiles.nakama.model).toBe(model.trim());
    expect(parsed.model_providers.nakama.base_url).toBe(
      'https://example.test/v1"'
    );
  });
});
