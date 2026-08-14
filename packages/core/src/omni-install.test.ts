import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  digestFor,
  installOmni,
  isAutoInstallAllowed,
  managedOmniPath,
  omniCommand,
  omniTarget,
  omniVersion,
} from "./omni-install";

const ORIGINAL_CONFIG_DIR = process.env.NAKAMA_CONFIG_DIR;
const ORIGINAL_AUTO = process.env.NAKAMA_OMNI_AUTO_INSTALL;
const ORIGINAL_VERSION = process.env.OMNI_VERSION;

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restore("NAKAMA_CONFIG_DIR", ORIGINAL_CONFIG_DIR);
  restore("NAKAMA_OMNI_AUTO_INSTALL", ORIGINAL_AUTO);
  restore("OMNI_VERSION", ORIGINAL_VERSION);
});

describe("release target", () => {
  test("maps the platforms a tarball is published for", () => {
    expect(omniTarget("linux", "x64")).toBe("x86_64-unknown-linux-musl");
    expect(omniTarget("linux", "arm64")).toBe("aarch64-unknown-linux-musl");
    expect(omniTarget("darwin", "arm64")).toBe("aarch64-apple-darwin");
  });

  test("returns null rather than guessing for the rest", () => {
    expect(omniTarget("win32", "x64")).toBeNull();
    expect(omniTarget("linux", "s390x")).toBeNull();
  });
});

describe("checksum lookup", () => {
  const archive = "omni-v0.7.3-x86_64-unknown-linux-musl.tar.gz";
  const digest = "a".repeat(64);
  const sums = [
    `${"b".repeat(64)}  omni-v0.7.3-aarch64-apple-darwin.tar.gz`,
    `${digest}  ${archive}`,
    "",
  ].join("\n");

  test("finds the line for this archive", () => {
    expect(digestFor(sums, archive)).toBe(digest);
  });

  test("accepts the binary-mode asterisk", () => {
    expect(digestFor(`${digest} *${archive}`, archive)).toBe(digest);
  });

  // A missing entry must not read as a pass: verifying against nothing and
  // verifying successfully have to be distinguishable at the call site.
  test("returns null when the archive is not listed", () => {
    expect(
      digestFor(sums, "omni-v9.9.9-x86_64-apple-darwin.tar.gz")
    ).toBeNull();
  });

  test("returns null for a malformed digest", () => {
    expect(digestFor(`not-a-digest  ${archive}`, archive)).toBeNull();
  });
});

describe("binary resolution", () => {
  test("falls back to PATH when nothing was installed here", () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-install-"));
    process.env.NAKAMA_CONFIG_DIR = dir;
    try {
      expect(omniCommand()).toBe("omni");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("prefers the managed copy once it exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "omni-install-"));
    process.env.NAKAMA_CONFIG_DIR = dir;
    try {
      const path = managedOmniPath();
      mkdirSync(join(dir, "bin"), { recursive: true });
      writeFileSync(path, "#!/bin/sh\n");
      expect(omniCommand()).toBe(path);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe("auto install switch", () => {
  test("on unless explicitly set to 0", () => {
    delete process.env.NAKAMA_OMNI_AUTO_INSTALL;
    expect(isAutoInstallAllowed()).toBe(true);
    process.env.NAKAMA_OMNI_AUTO_INSTALL = "1";
    expect(isAutoInstallAllowed()).toBe(true);
    process.env.NAKAMA_OMNI_AUTO_INSTALL = "0";
    expect(isAutoInstallAllowed()).toBe(false);
  });

  // Reaches no network: the switch is checked before anything is fetched.
  test("refuses and says why when it is off", async () => {
    process.env.NAKAMA_OMNI_AUTO_INSTALL = "0";
    const result = await installOmni();
    expect(result.installed).toBe(false);
    expect(result.error).toContain("NAKAMA_OMNI_AUTO_INSTALL=0");
  });
});

describe("version", () => {
  test("pinned by default and overridable", () => {
    delete process.env.OMNI_VERSION;
    expect(omniVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    process.env.OMNI_VERSION = "9.9.9";
    expect(omniVersion()).toBe("9.9.9");
  });

  // The image bakes the binary in at build time and the server fetches it at
  // runtime when it is missing. Two pins, one binary, and nothing stopped them
  // drifting: an image built with the default arg would carry one version while
  // a fetch on the same image pulled another, silently and only on the hosts
  // that took the fetch path.
  test("the Dockerfile pin matches the runtime default", async () => {
    delete process.env.OMNI_VERSION;
    const dockerfile = await Bun.file(
      join(import.meta.dir, "..", "..", "..", "Dockerfile")
    ).text();
    const pinned = dockerfile.match(/^ARG OMNI_VERSION="([^"]+)"/m)?.[1];

    expect(
      pinned,
      "Dockerfile no longer declares ARG OMNI_VERSION"
    ).toBeTruthy();
    expect(pinned).toBe(omniVersion());
  });
});
