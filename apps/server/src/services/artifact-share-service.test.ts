import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveArtifactShareBaseUrl } from "./artifact-share-service";

const SHARE_PUBLISH_URL =
  "http://127.0.0.1:4310/v1/profiles/p1/artifacts/shares";

function sharePublishRequest(init?: RequestInit): Request {
  return new Request(SHARE_PUBLISH_URL, { method: "POST", ...init });
}

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  run: () => T | Promise<T>
): Promise<T> {
  const previous = new Map(
    Object.keys(vars).map((key) => [key, process.env[key]] as const)
  );
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function withFreshConfigDir<T>(run: () => T | Promise<T>): Promise<T> {
  const configDir = join(tmpdir(), `nakama-artifact-share-base-${Date.now()}`);
  mkdirSync(configDir, { recursive: true });
  try {
    return await withEnv(
      {
        NAKAMA_CONFIG_DIR: configDir,
        NAKAMA_PUBLIC_URL: undefined,
        NAKAMA_WEB_PUBLIC_URL: undefined,
      },
      run
    );
  } finally {
    rmSync(configDir, { force: true, recursive: true });
  }
}

describe("resolveArtifactShareBaseUrl", () => {
  test("prefers explicit clientOrigin over loopback request URL", () => {
    expect(
      resolveArtifactShareBaseUrl({
        clientOrigin: "https://nakama.example.com/",
        request: sharePublishRequest(),
      })
    ).toBe("https://nakama.example.com");
  });

  test("prefers configured web public URL when request host is loopback", async () => {
    await withEnv(
      { NAKAMA_WEB_PUBLIC_URL: "https://deployed.example.com/" },
      () => {
        expect(
          resolveArtifactShareBaseUrl({ request: sharePublishRequest() })
        ).toBe("https://deployed.example.com");
      }
    );
  });

  test("keeps loopback when no configured web public URL exists", async () => {
    await withFreshConfigDir(() => {
      expect(
        resolveArtifactShareBaseUrl({ request: sharePublishRequest() })
      ).toBe("http://127.0.0.1:4310");
    });
  });

  test("reads Origin header from request when clientOrigin is absent", () => {
    expect(
      resolveArtifactShareBaseUrl({
        request: sharePublishRequest({
          headers: { Origin: "https://app.example.com" },
        }),
      })
    ).toBe("https://app.example.com");
  });
});
