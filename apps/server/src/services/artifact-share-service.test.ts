import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveArtifactShareBaseUrl } from "./artifact-share-service";

describe("resolveArtifactShareBaseUrl", () => {
  test("prefers explicit clientOrigin over loopback request URL", () => {
    const request = new Request(
      "http://127.0.0.1:4310/v1/profiles/p1/artifacts/shares",
      { method: "POST" }
    );

    expect(
      resolveArtifactShareBaseUrl({
        clientOrigin: "https://nakama.example.com/",
        request,
      })
    ).toBe("https://nakama.example.com");
  });

  test("prefers configured web public URL when request host is loopback", () => {
    const previous = process.env.NAKAMA_WEB_PUBLIC_URL;
    process.env.NAKAMA_WEB_PUBLIC_URL = "https://deployed.example.com/";

    try {
      const request = new Request(
        "http://127.0.0.1:4310/v1/profiles/p1/artifacts/shares",
        { method: "POST" }
      );

      expect(resolveArtifactShareBaseUrl({ request })).toBe(
        "https://deployed.example.com"
      );
    } finally {
      if (previous === undefined) {
        delete process.env.NAKAMA_WEB_PUBLIC_URL;
      } else {
        process.env.NAKAMA_WEB_PUBLIC_URL = previous;
      }
    }
  });

  test("keeps loopback when no configured web public URL exists", () => {
    const configDir = join(
      tmpdir(),
      `nakama-artifact-share-base-${Date.now()}`
    );
    mkdirSync(configDir, { recursive: true });

    const previousConfigDir = process.env.NAKAMA_CONFIG_DIR;
    const previousWeb = process.env.NAKAMA_WEB_PUBLIC_URL;
    const previousPublic = process.env.NAKAMA_PUBLIC_URL;
    process.env.NAKAMA_CONFIG_DIR = configDir;
    delete process.env.NAKAMA_WEB_PUBLIC_URL;
    delete process.env.NAKAMA_PUBLIC_URL;

    try {
      const request = new Request(
        "http://127.0.0.1:4310/v1/profiles/p1/artifacts/shares",
        { method: "POST" }
      );

      expect(resolveArtifactShareBaseUrl({ request })).toBe(
        "http://127.0.0.1:4310"
      );
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previousConfigDir;
      }
      if (previousWeb === undefined) {
        delete process.env.NAKAMA_WEB_PUBLIC_URL;
      } else {
        process.env.NAKAMA_WEB_PUBLIC_URL = previousWeb;
      }
      if (previousPublic === undefined) {
        delete process.env.NAKAMA_PUBLIC_URL;
      } else {
        process.env.NAKAMA_PUBLIC_URL = previousPublic;
      }
      rmSync(configDir, { force: true, recursive: true });
    }
  });

  test("reads Origin header from request when clientOrigin is absent", () => {
    const request = new Request(
      "http://127.0.0.1:4310/v1/profiles/p1/artifacts/shares",
      {
        headers: { Origin: "https://app.example.com" },
        method: "POST",
      }
    );

    expect(resolveArtifactShareBaseUrl({ request })).toBe(
      "https://app.example.com"
    );
  });
});
