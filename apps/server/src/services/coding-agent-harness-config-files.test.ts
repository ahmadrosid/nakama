import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  writeCodexConfigToml,
  writeOpenCodeConfig,
} from "./coding-agent-harness-config-files";

const CodexConfigSchema = z.object({
  model_provider: z.string(),
  model_providers: z.object({
    nakama: z.object({
      base_url: z.string(),
      http_headers: z.record(z.string()).optional(),
    }),
  }),
  profiles: z.object({ nakama: z.object({ model: z.string() }) }),
});

const OpenCodeConfigSchema = z.object({
  model: z.string().optional(),
  provider: z.record(
    z.object({
      models: z.record(z.object({ name: z.string() })).optional(),
      options: z.object({
        baseURL: z.string(),
        headers: z.record(z.string()).optional(),
      }),
    })
  ),
});

function routingFor(providerType: "opencode_go" | "openrouter") {
  return {
    active: true,
    apiKey: "test-key",
    baseUrl: "https://opencode.ai/zen/go/v1",
    compatible: true,
    configured: true,
    error: null,
    model: "opencode-go/kimi-k2.7-code",
    providerLabel: null,
    providerType,
  };
}

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

describe("OpenCode Go session header for CLI harnesses", () => {
  test("codex config sends x-opencode-session for an opencode_go provider", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-codex-session-"));

    const configPath = await writeCodexConfigToml(
      configDir,
      routingFor("opencode_go"),
      "codex",
      "opencode_go"
    );

    const parsed = CodexConfigSchema.parse(
      Bun.TOML.parse(await readFile(configPath, "utf8"))
    );

    expect(
      parsed.model_providers.nakama.http_headers?.["x-opencode-session"]
    ).toMatch(/^ses_[a-f0-9]{32}$/);
  });

  test("codex config sends no session header for another provider", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-codex-nosession-"));

    const configPath = await writeCodexConfigToml(
      configDir,
      routingFor("openrouter"),
      "codex",
      "openrouter"
    );

    const parsed = CodexConfigSchema.parse(
      Bun.TOML.parse(await readFile(configPath, "utf8"))
    );

    expect(parsed.model_providers.nakama.http_headers).toBeUndefined();
  });

  test("opencode config sends x-opencode-session for an opencode_go provider", async () => {
    configDir = await mkdtemp(path.join(tmpdir(), "nakama-opencode-session-"));

    const configPath = await writeOpenCodeConfig(
      configDir,
      routingFor("opencode_go"),
      "opencode",
      "opencode_go"
    );

    const parsed = OpenCodeConfigSchema.parse(
      JSON.parse(await readFile(configPath, "utf8"))
    );

    expect(
      parsed.provider["opencode-go"]?.options.headers?.["x-opencode-session"]
    ).toMatch(/^ses_[a-f0-9]{32}$/);
  });

  test("opencode config sends no session header for another provider", async () => {
    configDir = await mkdtemp(
      path.join(tmpdir(), "nakama-opencode-nosession-")
    );

    const configPath = await writeOpenCodeConfig(
      configDir,
      routingFor("openrouter"),
      "opencode",
      "openrouter"
    );

    const parsed = OpenCodeConfigSchema.parse(
      JSON.parse(await readFile(configPath, "utf8"))
    );

    expect(parsed.provider.openrouter?.options.headers).toBeUndefined();
  });
});
