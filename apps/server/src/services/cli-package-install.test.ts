import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPinnedNpmPackage,
  buildPinnedPackageInstallPlan,
  buildPinnedPackageMetadataUrl,
  buildRestrictedInstallEnv,
  downloadPinnedPackageTarball,
  type PinnedNpmPackage,
  readPinnedPackageDist,
  runTimedInstallCommand,
  verifyPackageTarballIntegrity,
} from "./cli-package-install";

const STALLING_PLAN = {
  args: ["-c", "printf partial; exec sleep 5"],
  command: "sh",
  displayCommand: "sh -c 'printf partial; exec sleep 5'",
};

/**
 * Exits on its own inside the window the late-progress test waits out, so that
 * test still sees the late flush if SIGTERM is ever lost or slow.
 */
const SELF_EXITING_PLAN = {
  args: ["-c", "printf partial; exec sleep 1"],
  command: "sh",
  displayCommand: "sh -c 'printf partial; exec sleep 1'",
};

/**
 * Ignores SIGTERM, so it only dies once the escalation lands. Exits on its own
 * after a second, which bounds every test that uses it and lets those tests put
 * an upper bound on the wait: passing late enough to be the self-exit is a
 * failure, not a pass.
 */
const SIGTERM_IGNORING_PLAN = {
  args: ["-c", "trap '' TERM; printf partial; sleep 1"],
  command: "sh",
  displayCommand: "sh -c \"trap '' TERM; printf partial; sleep 1\"",
};

/**
 * Exits at once but leaves something holding the stdout pipe, so `close` stays
 * outstanding long after the process itself is gone.
 */
const PIPE_HOLDING_PLAN = {
  args: ["-c", "sh -c 'sleep 3' & printf 'hi\\n'; exit 0"],
  command: "sh",
  displayCommand: "sh -c \"sh -c 'sleep 3' & printf 'hi\\n'; exit 0\"",
};

describe("runTimedInstallCommand", () => {
  test("preserves UTF-8 characters split across stdout and stderr chunks", async () => {
    const progress: string[] = [];
    const result = await runTimedInstallCommand(
      {
        args: [
          "-e",
          `
          process.stdout.write(Buffer.from([0xf0, 0x9f]));
          process.stderr.write(Buffer.from([0xe2]));
          await Bun.sleep(100);
          process.stdout.write(Buffer.from([0x9a, 0x80, 0x0a]));
          process.stderr.write(Buffer.from([0x82, 0xac]));
          `,
        ],
        command: process.execPath,
        displayCommand: "split UTF-8 output",
      },
      (message) => progress.push(message)
    );

    expect(result).toEqual({
      exitCode: 0,
      stderr: "\u20ac",
      stdout: "\ud83d\ude80",
      timedOut: false,
    });
    expect(progress).toEqual(["stdout: \ud83d\ude80", "stderr: \u20ac"]);
  });

  test("gives up on an installer that outlives the timeout", async () => {
    const result = await runTimedInstallCommand(STALLING_PLAN, undefined, {
      timeoutMs: 50,
    });

    expect(result.timedOut).toBe(true);
  });

  test("stops reporting progress once the timeout has resolved", async () => {
    const late: string[] = [];
    let settled = false;

    await runTimedInstallCommand(
      SELF_EXITING_PLAN,
      (message) => {
        if (settled) {
          late.push(message);
        }
      },
      { timeoutMs: 50 }
    );
    settled = true;

    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(late).toEqual([]);
  });

  test("reports every progress line from an installer that finishes in time", async () => {
    const progress: string[] = [];

    const result = await runTimedInstallCommand(
      {
        args: ["-c", "printf 'one\\ntwo'"],
        command: "sh",
        displayCommand: "sh -c \"printf 'one\\ntwo'\"",
      },
      (message) => progress.push(message),
      { timeoutMs: 5000 }
    );

    expect({
      exitCode: result.exitCode,
      progress,
      timedOut: result.timedOut,
    }).toEqual({
      exitCode: 0,
      progress: ["stdout: one", "stdout: two"],
      timedOut: false,
    });
  });
  test("settles only once the timed-out installer has actually exited", async () => {
    const startedAt = performance.now();

    const result = await runTimedInstallCommand(
      SIGTERM_IGNORING_PLAN,
      undefined,
      {
        sigtermGraceMs: 200,
        timeoutMs: 50,
      }
    );
    const elapsedMs = performance.now() - startedAt;

    expect({
      settledAfterTheEscalation: elapsedMs >= 250,
      settledBeforeTheSelfExit: elapsedMs < 800,
      timedOut: result.timedOut,
    }).toEqual({
      settledAfterTheEscalation: true,
      settledBeforeTheSelfExit: true,
      timedOut: true,
    });
  });

  test("gives up waiting when the kill escalation has not landed yet", async () => {
    const startedAt = performance.now();

    const result = await runTimedInstallCommand(
      SIGTERM_IGNORING_PLAN,
      undefined,
      {
        settleTimeoutMs: 150,
        sigtermGraceMs: 10_000,
        timeoutMs: 50,
      }
    );
    const elapsedMs = performance.now() - startedAt;

    expect({
      settledAfterTheSettleBound: elapsedMs >= 200,
      settledBeforeTheSelfExit: elapsedMs < 800,
      timedOut: result.timedOut,
    }).toEqual({
      settledAfterTheSettleBound: true,
      settledBeforeTheSelfExit: true,
      timedOut: true,
    });
  });
  test("does not wait out the settle bound for a process that already exited", async () => {
    const startedAt = performance.now();

    const result = await runTimedInstallCommand(PIPE_HOLDING_PLAN, undefined, {
      timeoutMs: 200,
    });
    const elapsedMs = performance.now() - startedAt;

    expect({
      settledAtTheDeadline: elapsedMs >= 200 && elapsedMs < 1200,
      timedOut: result.timedOut,
    }).toEqual({
      settledAtTheDeadline: true,
      timedOut: true,
    });
  });

  /**
   * The installer shells out and the grandchild outlives its parent. A kill
   * aimed at the direct child leaves that grandchild running, which is what
   * "the timeout does not cancel the install" meant in practice.
   */
  test("a timed-out install stops the processes it started, not just the one it spawned", async () => {
    const marker = join(tmpdir(), `nakama-install-grandchild-${Date.now()}`);
    rmSync(marker, { force: true });

    const result = await runTimedInstallCommand(
      {
        args: [
          "-c",
          `sh -c 'sleep 1.2; echo alive > ${marker}' & echo started; wait`,
        ],
        command: "sh",
        displayCommand: "sh -c 'grandchild'",
      },
      undefined,
      { settleTimeoutMs: 1000, sigtermGraceMs: 100, timeoutMs: 200 }
    );

    expect(result.timedOut).toBe(true);

    // Past the grandchild's own sleep: if the group was signalled it never
    // wrote, and if only the direct child was signalled it has by now.
    await Bun.sleep(1600);
    const survived = existsSync(marker);
    rmSync(marker, { force: true });
    expect(survived).toBe(false);
  }, 15_000);

  test("an aborted signal ends the install without waiting for the deadline", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const startedAt = Date.now();
    const result = await runTimedInstallCommand(STALLING_PLAN, undefined, {
      settleTimeoutMs: 1000,
      signal: controller.signal,
      sigtermGraceMs: 100,
      timeoutMs: 60_000,
    });

    // The 60s deadline never fired, so finishing at all is the abort working.
    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 15_000);
});

/** NIST SHA-512("abc"), so the digest itself is checked, not just its shape. */
const SHA512_OF_ABC =
  "sha512-3a81oZNherrMQXNJriBBMRLm+k6JqX6iCp7u5ktV05ohkpkqJ0/BqDa6PCOj/uu9RU1EI2Q86A4qmslPpUyknw==";

const TARBALL_BYTES = Buffer.from("nakama pinned tarball fixture");
const PINNED_FIXTURE: PinnedNpmPackage = {
  integrity: `sha512-${createHash("sha512").update(TARBALL_BYTES).digest("base64")}`,
  name: "pinned-probe",
  version: "1.2.3",
};

interface FakeRegistry {
  stop: () => void;
  url: string;
}

function startFakeRegistry(
  metadataFor: (request: {
    name: string;
    origin: string;
    version: string;
  }) => unknown,
  body: Uint8Array
): FakeRegistry {
  const server = Bun.serve({
    fetch(request) {
      const url = new URL(request.url);

      if (url.pathname === "/tarball.tgz") {
        return new Response(body);
      }

      const [, name, version] = url.pathname.split("/");

      return Response.json(
        metadataFor({
          name: name ?? "",
          origin: url.origin,
          version: version ?? "",
        })
      );
    },
    port: 0,
  });

  return {
    stop: () => {
      server.stop(true);
    },
    url: `http://localhost:${server.port}`,
  };
}

function servingPinnedHash({
  name,
  origin,
  version,
}: {
  name: string;
  origin: string;
  version: string;
}) {
  return {
    dist: {
      integrity: PINNED_FIXTURE.integrity,
      tarball: `${origin}/tarball.tgz`,
    },
    name,
    version,
  };
}

describe("pinned package verification", () => {
  test("accepts bytes that match the hash and rejects tampered ones", () => {
    expect(() =>
      verifyPackageTarballIntegrity(Buffer.from("abc"), SHA512_OF_ABC)
    ).not.toThrow();

    expect(() =>
      verifyPackageTarballIntegrity(Buffer.from("abcd"), SHA512_OF_ABC)
    ).toThrow("integrity check");
  });

  test("refuses a pin that is a range, a dist-tag, or unhashed", () => {
    for (const version of ["latest", "^1.2.3", "1.x", "1.2"]) {
      expect(() =>
        assertPinnedNpmPackage({ ...PINNED_FIXTURE, version })
      ).toThrow("exact version");
    }

    expect(() =>
      assertPinnedNpmPackage({ ...PINNED_FIXTURE, integrity: "md5-abc" })
    ).toThrow("integrity hash");
  });

  test("addresses the exact version and refuses a plaintext off-host tarball", () => {
    expect(buildPinnedPackageMetadataUrl(PINNED_FIXTURE)).toBe(
      "https://registry.npmjs.org/pinned-probe/1.2.3"
    );

    expect(() =>
      readPinnedPackageDist(
        {
          dist: {
            integrity: PINNED_FIXTURE.integrity,
            tarball: "http://evil.test/pkg.tgz",
          },
          name: "pinned-probe",
          version: "1.2.3",
        },
        PINNED_FIXTURE
      )
    ).toThrow("https");
  });

  test("refuses registry metadata for another version or another hash", () => {
    expect(() =>
      readPinnedPackageDist(
        {
          dist: {
            integrity: PINNED_FIXTURE.integrity,
            tarball: "https://registry.test/p.tgz",
          },
          name: "pinned-probe",
          version: "1.2.4",
        },
        PINNED_FIXTURE
      )
    ).toThrow("Registry served");

    expect(() =>
      readPinnedPackageDist(
        {
          dist: {
            integrity: SHA512_OF_ABC,
            tarball: "https://registry.test/p.tgz",
          },
          name: "pinned-probe",
          version: "1.2.3",
        },
        PINNED_FIXTURE
      )
    ).toThrow("registry integrity does not match");
  });

  test("downloads nothing when the registry reports another hash", async () => {
    const registry = startFakeRegistry(
      ({ name, origin, version }) => ({
        dist: {
          integrity: SHA512_OF_ABC,
          tarball: `${origin}/tarball.tgz`,
        },
        name,
        version,
      }),
      TARBALL_BYTES
    );

    try {
      await expect(
        downloadPinnedPackageTarball(PINNED_FIXTURE, { registry: registry.url })
      ).rejects.toThrow("registry integrity does not match");
    } finally {
      registry.stop();
    }
  });

  test("never writes a tampered tarball to the installer", async () => {
    // The metadata still claims the pinned hash, so only a byte-level check
    // over the download can catch this.
    const registry = startFakeRegistry(
      servingPinnedHash,
      Buffer.from("tampered payload")
    );

    try {
      await expect(
        downloadPinnedPackageTarball(PINNED_FIXTURE, { registry: registry.url })
      ).rejects.toThrow("integrity check");
    } finally {
      registry.stop();
    }
  });

  test("keeps installer plumbing and drops server secrets from the env", () => {
    const restricted = buildRestrictedInstallEnv({
      AWS_SECRET_ACCESS_KEY: "super-secret",
      HOME: "/home/nakama",
      HTTPS_PROXY: "http://proxy.test",
      NAKAMA_SESSION_SECRET: "super-secret",
      "npm_config_//registry.test/:_authToken": "super-secret",
      npm_config_registry: "https://registry.test",
      PATH: "/usr/bin",
    });

    expect(restricted).toEqual({
      HOME: "/home/nakama",
      HTTPS_PROXY: "http://proxy.test",
      npm_config_registry: "https://registry.test",
      PATH: "/usr/bin",
    });
  });

  test("installs the verified tarball under a restricted env", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "nakama-pinned-bin-"));
    const argsLog = join(binDir, "install.args");
    const envLog = join(binDir, "install.env");
    const originalDisableFixPath = process.env.NAKAMA_DISABLE_FIX_PATH;
    const originalPath = process.env.PATH;
    const originalSecret = process.env.NAKAMA_TEST_PROVIDER_KEY;

    await writeFile(
      join(binDir, "npm"),
      `#!/bin/sh\nprintf '%s' "$*" > ${argsLog}\nenv > ${envLog}\n`
    );
    await chmod(join(binDir, "npm"), 0o755);
    process.env.NAKAMA_DISABLE_FIX_PATH = "1";
    process.env.NAKAMA_TEST_PROVIDER_KEY = "super-secret";
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;

    const registry = startFakeRegistry(servingPinnedHash, TARBALL_BYTES);

    try {
      const tarball = await downloadPinnedPackageTarball(PINNED_FIXTURE, {
        registry: registry.url,
      });
      const result = await runTimedInstallCommand(
        buildPinnedPackageInstallPlan(tarball.path, "npm")
      );

      expect(result.exitCode).toBe(0);
      expect(readFileSync(tarball.path).equals(TARBALL_BYTES)).toBe(true);
      // A local tarball, not a spec: the installer resolves nothing itself.
      expect(readFileSync(argsLog, "utf8")).toBe(`install -g ${tarball.path}`);
      expect(readFileSync(envLog, "utf8")).not.toContain(
        "NAKAMA_TEST_PROVIDER_KEY"
      );

      await tarball.cleanup();
      expect(existsSync(tarball.path)).toBe(false);
    } finally {
      registry.stop();
      process.env.PATH = originalPath;
      if (originalDisableFixPath === undefined) {
        delete process.env.NAKAMA_DISABLE_FIX_PATH;
      } else {
        process.env.NAKAMA_DISABLE_FIX_PATH = originalDisableFixPath;
      }
      if (originalSecret === undefined) {
        delete process.env.NAKAMA_TEST_PROVIDER_KEY;
      } else {
        process.env.NAKAMA_TEST_PROVIDER_KEY = originalSecret;
      }
      await rm(binDir, { force: true, recursive: true });
    }
  }, 20_000);
});
