import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { removeTestDir } from "./test-config-dir";

const startupCases = [
  {
    env: {
      NAKAMA_PUBLIC_URL: "https://alias.example.com",
      NAKAMA_TRUST_PROXY: "true",
      NAKAMA_WEB_PUBLIC_URL: " https://web.example.com/base/// ",
    },
    name: "logs the selected environment variable over the alias and saved URL",
    saved: "https://saved.example.com",
    source: "NAKAMA_WEB_PUBLIC_URL",
    trustProxy: true,
    url: "https://web.example.com/base",
    warning: false,
  },
  {
    env: { NAKAMA_TRUST_PROXY: "false", NODE_ENV: "development" },
    name: "warns about a saved HTTP loopback outside desktop in development",
    saved: "http://127.0.0.1:4310",
    source: "config.ini",
    trustProxy: false,
    url: "http://127.0.0.1:4310/",
    warning: true,
  },
  {
    env: { NAKAMA_WEB_PUBLIC_URL: "https://localhost:4310" },
    name: "does not warn about an HTTPS loopback",
    source: "NAKAMA_WEB_PUBLIC_URL",
    trustProxy: false,
    url: "https://localhost:4310/",
    warning: false,
  },
  {
    env: { NAKAMA_DESKTOP: "1" },
    name: "keeps a saved loopback on desktop without warning",
    saved: "http://127.0.0.1:4310",
    source: "config.ini",
    trustProxy: false,
    url: "http://127.0.0.1:4310/",
    warning: false,
  },
  {
    env: {
      NAKAMA_WEB_PUBLIC_URL:
        "https://private-user:private-password@web.example.com/base?token=private-query#private-fragment",
    },
    name: "omits credentials and query secrets from startup logs",
    source: "NAKAMA_WEB_PUBLIC_URL",
    trustProxy: false,
    url: "https://web.example.com/base",
    warning: false,
  },
];

const configLogSchema = z.object({
  code: z.string().optional(),
  level: z.string(),
  publicWebUrl: z.string(),
  source: z.string(),
  trustProxy: z.boolean(),
});

/** PM2 and its workers stay alive after the server. Without this they pile up. */
async function stopPm2(pm2Home: string): Promise<void> {
  // The daemon goes first, or it starts its workers again.
  for (const pattern of ["pm2.pid", "pids/*.pid"]) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: pm2Home })) {
      const pid = Number(await readFile(join(pm2Home, file), "utf8"));

      if (!(Number.isInteger(pid) && pid > 0)) {
        continue;
      }

      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        // SAFETY: process.kill throws Node's errno error.
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
          throw error;
        }
      }
    }
  }
}

test.each(startupCases)(
  "startup $name",
  async ({ env, saved, source, url, trustProxy, warning }) => {
    const configDir = await mkdtemp(
      join(tmpdir(), "nakama-startup-public-url-")
    );

    // The server starts a PM2 daemon and workers that stay alive after it. A
    // private home keeps them away from other tests and a developer's own PM2.
    const pm2Home = join(configDir, "pm2");

    await mkdir(pm2Home);
    await writeFile(
      join(configDir, "config.ini"),
      saved ? `web_public_url=${saved}\n` : ""
    );

    const child = Bun.spawn(
      [process.execPath, join(import.meta.dir, "index.ts")],
      {
        env: {
          NAKAMA_CONFIG_DIR: configDir,
          NAKAMA_ERROR_TRACKING_DSN: "",
          NAKAMA_HOST: "127.0.0.1",
          NAKAMA_LOG_FORMAT: "json",
          NAKAMA_PORT: "0",
          NAKAMA_SECRETS_KEY: Buffer.alloc(32, 1).toString("base64"),
          PATH: process.env.PATH,
          PM2_HOME: pm2Home,
          ...env,
        },
        ipc() {},
        stderr: "pipe",
        stdout: "pipe",
      }
    );

    // Longer than the PM2 connect deadline: a daemon that does not answer
    // delays startup, but the server must listen after it.
    const deadline = setTimeout(() => child.kill("SIGKILL"), 45_000);
    const errors = new Response(child.stderr).text();
    let output = "";

    try {
      const decoder = new TextDecoder();

      for await (const chunk of child.stdout) {
        output += decoder.decode(chunk, { stream: true });

        if (
          output.includes("Nakama database ready at") ||
          output.length > 65_536
        ) {
          break;
        }
      }

      const serverUrl = await readFile(
        join(configDir, "runtime", "server-url.txt"),
        "utf8"
      );

      const health = await fetch(new URL("/health", serverUrl.trim()), {
        signal: AbortSignal.timeout(2000),
      });

      expect(health.status).toBe(200);

      const logs = output
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .flatMap((line) => {
          const parsed = configLogSchema.safeParse(JSON.parse(line));

          return parsed.success ? [parsed.data] : [];
        });

      expect(logs.filter((entry) => entry.level === "info")).toEqual([
        expect.objectContaining({ publicWebUrl: url, source, trustProxy }),
      ]);
      expect(
        logs.filter(
          (entry) =>
            entry.code === "loopback_public_url" && entry.level === "warn"
        )
      ).toHaveLength(warning ? 1 : 0);
      expect(output).not.toMatch(
        /private-user|private-password|private-query|private-fragment/
      );
    } finally {
      child.kill("SIGKILL");
      await child.exited;
      clearTimeout(deadline);
      const stderr = await errors;

      await stopPm2(pm2Home);
      await removeTestDir(configDir);

      if (!output.includes("Nakama database ready at")) {
        console.error(`Server stdout:\n${output}\nServer stderr:\n${stderr}`);
      }
    }
  },
  50_000
);
