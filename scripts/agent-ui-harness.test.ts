import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const script = join(root, "scripts/agent-ui-harness.sh");
const prefix = join(tmpdir(), `nakama-agent-ui-test-${process.pid}`);
const latest = `${prefix}-latest`;
const homeProbe = mkdtempSync(join(tmpdir(), "nakama-home-probe-"));

function runHarness(verb: "start" | "stop") {
  return Bun.spawnSync(["bash", script, verb], {
    cwd: root,
    env: {
      ...process.env,
      HOME: homeProbe,
      NAKAMA_AGENT_UI_PREFIX: prefix,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
}

async function readHarnessEnv(): Promise<Record<string, string>> {
  const text = await Bun.file(join(latest, "harness.env")).text();
  const acc: Record<string, string> = {};
  for (const line of text.trim().split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      acc[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  return acc;
}

function portOpen(port: string | number): boolean {
  const result = Bun.spawnSync(
    ["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"],
    {
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  return result.exitCode === 0 && result.stdout.toString().trim().length > 0;
}

afterAll(() => {
  runHarness("stop");
});

describe("agent-ui-harness", () => {
  test("stop with no latest run exits nonzero and does not touch 4310", () => {
    const before = portOpen(4310);
    const result = runHarness("stop");
    expect(result.exitCode).not.toBe(0);
    expect(portOpen(4310)).toBe(before);
  });

  test(
    "start seeds chat, skips 4310, and stop frees ports",
    async () => {
      const dummy4310 = portOpen(4310)
        ? null
        : Bun.spawn(
            [
              "bun",
              "-e",
              "Bun.serve({ port: 4310, fetch() { return new Response('ok'); } }); await Bun.sleep(1 << 30)",
            ],
            {
              stderr: "pipe",
              stdout: "pipe",
            }
          );

      try {
        const start = runHarness("start");
        if (start.exitCode !== 0) {
          throw new Error(
            `start failed: ${start.stderr.toString()}\n${start.stdout.toString()}`
          );
        }

        expect(start.stdout.toString().includes("NAKAMA_CONFIG_DIR=")).toBe(
          false
        );
        const env = await readHarnessEnv();
        expect(env.BASE_URL?.startsWith("http://127.0.0.1:")).toBe(true);
        expect(env.API_URL?.startsWith("http://127.0.0.1:")).toBe(true);
        expect(env.BASE_URL).not.toBe(env.API_URL);
        expect(env.API_PORT).not.toBe("4310");
        expect(env.NAKAMA_CONFIG_DIR?.startsWith(prefix)).toBe(true);
        expect(env.NAKAMA_CONFIG_DIR?.includes(`${homeProbe}/.nakama`)).toBe(
          false
        );
        expect(existsSync(join(homeProbe, ".nakama"))).toBe(false);

        const health = await fetch(`${env.BASE_URL}/health`);
        expect(health.ok).toBe(true);
        const body = (await health.json()) as {
          providerConfigured?: boolean;
          userConfigured?: boolean;
        };
        expect(body.userConfigured).toBe(true);
        expect(body.providerConfigured).toBe(true);

        if (dummy4310) {
          expect(portOpen(4310)).toBe(true);
        }

        const stop = runHarness("stop");
        expect(stop.exitCode).toBe(0);
        expect(portOpen(env.API_PORT ?? "")).toBe(false);
        expect(portOpen(env.WEB_PORT ?? "")).toBe(false);
        expect(existsSync(env.NAKAMA_CONFIG_DIR ?? "")).toBe(false);
        expect(existsSync(latest)).toBe(false);
      } finally {
        dummy4310?.kill();
      }
    },
    { timeout: 180_000 }
  );
});
