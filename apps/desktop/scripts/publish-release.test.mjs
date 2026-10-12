import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { publishRelease, updateManifest } from "./publish-release.mjs";

describe("desktop release metadata", () => {
  const manifest = {
    files: [
      { sha512: "checksum", size: 42, url: "Nakama-0.2.0-arm64-mac.zip" },
    ],
    path: "Nakama-0.2.0-arm64-mac.zip",
    sha512: "checksum",
    version: "0.2.0",
  };

  test("pins downloads to immutable version assets while preserving integrity fields", () => {
    const output = updateManifest(manifest, "desktop-v0.2.0");
    expect(output.files[0]).toEqual({
      sha512: "checksum",
      size: 42,
      url: "https://github.com/ahmadrosid/nakama/releases/download/desktop-v0.2.0/Nakama-0.2.0-arm64-mac.zip",
    });
    expect(output.path).toBe(output.files[0].url);
    expect(output.sha512).toBe("checksum");
    expect(manifest.files[0].url).toBe("Nakama-0.2.0-arm64-mac.zip");
  });
  test("preserves DMG entries alongside the required ZIP", () => {
    const files = [
      ...manifest.files,
      { sha512: "dmg-checksum", url: "Nakama-0.2.0-arm64.dmg" },
    ];

    expect(
      updateManifest({ ...manifest, files }, "desktop-v0.2.0").files[1]
    ).toEqual({
      sha512: "dmg-checksum",
      url: "https://github.com/ahmadrosid/nakama/releases/download/desktop-v0.2.0/Nakama-0.2.0-arm64.dmg",
    });
    expect(() =>
      updateManifest({ ...manifest, files: files.slice(1) }, "desktop-v0.2.0")
    ).toThrow();
  });
  test("rejects mismatched versions and unexpected download paths", () => {
    expect(() => updateManifest(manifest, "desktop-v0.3.0")).toThrow();
    expect(() =>
      updateManifest({ ...manifest, files: [] }, "desktop-v0.2.0")
    ).toThrow();
    expect(() =>
      updateManifest({ ...manifest, path: "../payload.zip" }, "desktop-v0.2.0")
    ).toThrow();
    expect(() =>
      updateManifest(
        { ...manifest, version: "0.2.0-beta.1" },
        "desktop-v0.2.0-beta.1"
      )
    ).toThrow();
  });
});

test("Windows metadata accepts only the exact versioned installer", () => {
  const manifest = {
    files: [
      { sha512: "checksum", size: 42, url: "Nakama-0.2.0-x64-Setup.exe" },
    ],
    path: "Nakama-0.2.0-x64-Setup.exe",
    sha512: "checksum",
    version: "0.2.0",
  };

  expect(updateManifest(manifest, "desktop-v0.2.0", "windows").path).toEndWith(
    "/Nakama-0.2.0-x64-Setup.exe"
  );

  for (const path of [
    "../payload.exe",
    "..\\payload.exe",
    "Nakama-0.3.0-x64-Setup.exe",
    "https://example.com/payload.exe",
    "Nakama-0.2.0-x64-Setup.exe?x",
    "Nakama-0.2.0-arm64-Setup.exe",
  ]) {
    expect(() =>
      updateManifest(
        { ...manifest, files: [{ ...manifest.files[0], url: path }], path },
        "desktop-v0.2.0",
        "windows"
      )
    ).toThrow();
  }

  expect(() =>
    updateManifest(
      { ...manifest, files: [...manifest.files, ...manifest.files] },
      "desktop-v0.2.0",
      "windows"
    )
  ).toThrow();
});

const temporary = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

async function releaseFixture() {
  const output = await mkdtemp(join(tmpdir(), "nakama-publish-test-"));
  temporary.push(output);
  const version = "0.2.0";
  const tag = `desktop-v${version}`;

  for (const [platform, name, suffixes] of [
    ["mac", "latest-mac.yml", ["arm64-mac.zip", "arm64.dmg"]],
    ["windows", "latest.yml", ["x64-Setup.exe"]],
  ]) {
    const files = [];

    for (const suffix of suffixes) {
      const filename = `Nakama-${version}-${suffix}`;
      const content = Buffer.from(filename);
      await Bun.write(join(output, platform, filename), content);
      await Bun.write(
        join(output, platform, `${filename}.blockmap`),
        "blockmap"
      );
      files.push({
        sha512: createHash("sha512").update(content).digest("base64"),
        size: content.length,
        url: filename,
      });
    }

    await Bun.write(
      join(output, platform, name),
      Bun.YAML.stringify({
        files,
        path: files[0].url,
        sha512: files[0].sha512,
        version,
      })
    );
  }

  const releases = new Map();
  const events = [];
  let fail;

  const run = async (_command, args) => {
    const [kind, action, name] = args;
    events.push(args);

    if (fail?.(args)) {
      throw new Error("Simulated GitHub failure");
    }

    if (kind === "api") {
      const release = releases.get(action.split("/").at(-1));

      if (!release) {
        throw Object.assign(new Error("Not found"), { stderr: "HTTP 404" });
      }

      return {
        stdout: JSON.stringify({
          assets: [...release.assets].map(([filename, content]) => ({
            digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
            name: filename,
            size: content.length,
          })),
          draft: release.draft,
        }),
      };
    }

    if (action === "create") {
      releases.set(name, {
        assets: new Map(),
        draft: args.includes("--draft"),
      });
    } else {
      const release = releases.get(name);

      if (action === "upload") {
        for (const path of args.slice(3, args.indexOf("--clobber"))) {
          release.assets.set(
            basename(path),
            Buffer.from(await Bun.file(path).arrayBuffer())
          );
        }
      } else if (action === "download") {
        const dir = args[args.indexOf("--dir") + 1];

        for (const [i, arg] of args.entries()) {
          if (arg === "--pattern") {
            const filename = args[i + 1];
            const content = release.assets.get(filename);

            if (!content) {
              throw new Error("Missing download");
            }

            await Bun.write(join(dir, filename), content);
          }
        }
      } else if (action === "edit") {
        release.draft = false;
      } else if (action === "delete-asset") {
        release.assets.delete(args[3]);
      } else {
        throw new Error(`Unexpected operation: ${args}`);
      }
    }

    return { stdout: "" };
  };

  return {
    events,
    output,
    publish: () => publishRelease({ output, run, sha: "commit", tag, version }),
    releases,
    setFailure: (fn) => {
      fail = fn;
    },
    tag,
  };
}

test("publishes all installers before independently promoting both feeds", async () => {
  const f = await releaseFixture();
  await f.publish();
  expect(f.releases.get(f.tag).draft).toBe(false);
  expect(f.releases.get(f.tag).assets.size).toBe(8);
  expect([...f.releases.get("desktop-updates").assets.keys()]).toEqual([
    "latest-mac.yml",
    "latest.yml",
  ]);
  const published = f.events.findIndex((args) => args[1] === "edit");

  const promoted = f.events.findIndex(
    (args) => args[1] === "upload" && args[2] === "desktop-updates"
  );

  expect(published).toBeLessThan(promoted);
});

for (const change of ["missing", "checksum"]) {
  test(`rejects ${change} Windows artifact without creating a release`, async () => {
    const f = await releaseFixture();
    const path = join(f.output, "windows/Nakama-0.2.0-x64-Setup.exe");

    if (change === "missing") {
      await rm(path);
    } else {
      await Bun.write(path, "corrupt");
    }

    await expect(f.publish()).rejects.toThrow();
    expect(f.releases.size).toBe(0);
  });
}

test("failed draft upload leaves feeds untouched and can be retried", async () => {
  const f = await releaseFixture();
  f.setFailure((args) => args[1] === "upload" && args[2] === f.tag);
  await expect(f.publish()).rejects.toThrow();
  expect(f.releases.get(f.tag).draft).toBe(true);
  expect(f.releases.has("desktop-updates")).toBe(false);
  f.releases.get(f.tag).assets.set("stale.exe", Buffer.from("stale"));
  f.setFailure(undefined);
  await f.publish();
  expect(f.releases.get(f.tag).assets.has("stale.exe")).toBe(false);
  expect(f.releases.get(f.tag).draft).toBe(false);
});

test("retry repairs partial promotion using public bytes even when local artifacts change", async () => {
  const f = await releaseFixture();
  f.setFailure(
    (args) =>
      args[1] === "upload" &&
      args[2] === "desktop-updates" &&
      args[3].endsWith("/latest.yml")
  );
  await expect(f.publish()).rejects.toThrow();
  expect(f.releases.get("desktop-updates").assets.has("latest-mac.yml")).toBe(
    true
  );
  const exe = f.releases.get(f.tag).assets.get("Nakama-0.2.0-x64-Setup.exe");
  await Bun.write(
    join(f.output, "windows/Nakama-0.2.0-x64-Setup.exe"),
    "rebuilt"
  );
  f.events.length = 0;
  f.setFailure(undefined);
  await f.publish();
  expect(
    f.releases.get(f.tag).assets.get("Nakama-0.2.0-x64-Setup.exe")
  ).toEqual(exe);
  expect(f.releases.get("desktop-updates").assets.has("latest.yml")).toBe(true);
  expect(f.events.filter((args) => args[1] === "upload").length).toBe(1);
});

test("a newer macOS channel does not block an older Windows channel", async () => {
  const f = await releaseFixture();
  await f.publish();
  const assets = f.releases.get("desktop-updates").assets;

  const current = (name, version) =>
    Buffer.from(
      Bun.YAML.stringify({
        ...Bun.YAML.parse(assets.get(name).toString()),
        version,
      })
    );

  assets.set("latest-mac.yml", current("latest-mac.yml", "0.3.0"));
  assets.set("latest.yml", current("latest.yml", "0.1.0"));
  await f.publish();
  expect(Bun.YAML.parse(assets.get("latest-mac.yml").toString()).version).toBe(
    "0.3.0"
  );
  expect(Bun.YAML.parse(assets.get("latest.yml").toString()).version).toBe(
    "0.2.0"
  );
});

test("refuses incomplete public releases and inconsistent same-version feeds", async () => {
  const f = await releaseFixture();
  await f.publish();
  const feeds = f.releases.get("desktop-updates").assets;
  feeds.set(
    "latest.yml",
    Buffer.from(Bun.YAML.stringify({ version: "0.2.0" }))
  );
  await expect(f.publish()).rejects.toThrow();
  f.releases.get(f.tag).assets.delete("Nakama-0.2.0-x64-Setup.exe");
  await expect(f.publish()).rejects.toThrow();
  expect(f.releases.get(f.tag).draft).toBe(false);
});

test("uploaded bytes must match before a draft becomes public", async () => {
  const f = await releaseFixture();
  f.setFailure((args) => {
    const release = f.releases.get(f.tag);

    if (args[0] === "api" && release?.assets.size === 8) {
      release.assets.set(
        "Nakama-0.2.0-x64-Setup.exe",
        Buffer.from("damaged upload")
      );
    }

    return false;
  });
  await expect(f.publish()).rejects.toThrow();
  expect(f.releases.get(f.tag).draft).toBe(true);
  expect(f.releases.has("desktop-updates")).toBe(false);
});
