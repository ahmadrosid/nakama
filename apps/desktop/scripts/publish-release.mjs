import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";

const execute = promisify(execFile);

const repository = "ahmadrosid/nakama";

const platforms = {
  mac: { manifest: "latest-mac.yml", suffixes: ["arm64-mac.zip", "arm64.dmg"] },
  windows: { manifest: "latest.yml", suffixes: ["x64-Setup.exe"] },
};

export function updateManifest(manifest, tag, platform = "mac") {
  const config = platforms[platform];

  if (
    !(config && /^\d+\.\d+\.\d+$/.test(manifest.version)) ||
    tag !== `desktop-v${manifest.version}`
  ) {
    throw new Error("Release tag and manifest version must match");
  }

  const names = config.suffixes.map(
    (suffix) => `Nakama-${manifest.version}-${suffix}`
  );

  if (
    !Array.isArray(manifest.files) ||
    manifest.files.length === 0 ||
    manifest.path !== names[0] ||
    !manifest.files.some((file) => file.url === names[0]) ||
    new Set(manifest.files.map((file) => file.url)).size !==
      manifest.files.length
  ) {
    throw new Error("Missing or duplicate update files");
  }

  const url = (file) => {
    if (!names.includes(file)) {
      throw new Error("Unexpected update artifact");
    }

    return `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(file)}`;
  };

  return {
    ...manifest,
    files: manifest.files.map((file) => ({ ...file, url: url(file.url) })),
    path: url(manifest.path),
  };
}

async function inspectArtifacts(directory, version, tag) {
  const assets = [];
  const manifests = [];

  for (const [platform, config] of Object.entries(platforms)) {
    const folder = join(directory, platform);

    const manifest = Bun.YAML.parse(
      await Bun.file(join(folder, config.manifest)).text()
    );

    const canonical = updateManifest(manifest, tag, platform);

    const names = config.suffixes.map(
      (suffix) => `Nakama-${version}-${suffix}`
    );

    const files = [
      ...names.flatMap((name) => [name, `${name}.blockmap`]),
      config.manifest,
    ];

    for (const name of files) {
      const path = join(folder, name);
      const sha256 = createHash("sha256");
      const sha512 = createHash("sha512");
      let size = 0;

      for await (const chunk of createReadStream(path)) {
        sha256.update(chunk);
        sha512.update(chunk);
        size += chunk.length;
      }

      if (size === 0) {
        throw new Error(`Empty artifact: ${name}`);
      }

      const checksum = sha512.digest("base64");
      const entry = manifest.files.find((file) => file.url === name);

      if (entry && (entry.sha512 !== checksum || entry.size !== size)) {
        throw new Error(`Artifact checksum or size mismatch: ${name}`);
      }

      if (manifest.path === name && manifest.sha512 !== checksum) {
        throw new Error(`Primary artifact checksum mismatch: ${name}`);
      }

      assets.push({
        digest: `sha256:${sha256.digest("hex")}`,
        name,
        path,
        size,
      });
    }

    manifests.push({ canonical, name: config.manifest });
  }

  return { assets, manifests };
}

// The command boundary also lets release failure/retry behavior run offline in tests.
export async function publishRelease({
  tag,
  version,
  output,
  sha,
  run = execute,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `desktop-v${version}`) {
    throw new Error("Unexpected release tag");
  }

  const gh = async (...args) =>
    (await run("gh", [...args, "--repo", repository])).stdout;

  const release = async (name) => {
    try {
      return JSON.parse(
        (await run("gh", ["api", `repos/${repository}/releases/tags/${name}`]))
          .stdout
      );
    } catch (error) {
      if (error.stderr?.includes("HTTP 404")) {
        return null;
      }

      throw error;
    }
  };

  const temp = await mkdtemp(join(tmpdir(), "nakama-release-"));

  try {
    let existing = await release(tag);
    let directory = output;

    if (existing && !existing.draft) {
      // Never compare rebuilt bytes with public assets: signing changes checksums.
      directory = join(temp, "published");

      for (const [platform, config] of Object.entries(platforms)) {
        const names = config.suffixes.map(
          (suffix) => `Nakama-${version}-${suffix}`
        );

        const files = [
          ...names.flatMap((name) => [name, `${name}.blockmap`]),
          config.manifest,
        ];

        if (
          files.some(
            (name) => !existing.assets.some((asset) => asset.name === name)
          )
        ) {
          throw new Error(
            "Public release is incomplete; publish a new version"
          );
        }

        await gh(
          "release",
          "download",
          tag,
          "--dir",
          join(directory, platform),
          ...files.flatMap((name) => ["--pattern", name])
        );
      }
    }

    const { assets, manifests } = await inspectArtifacts(
      directory,
      version,
      tag
    );

    if (!existing) {
      await gh(
        "release",
        "create",
        tag,
        "--verify-tag",
        "--draft",
        "--title",
        `Nakama Desktop ${version}`,
        "--notes",
        "Self-contained desktop installers: macOS 15+ Apple Silicon (DMG) and Windows 10 19041+ / Windows 11 x64 (Setup.exe).\n\nDownload the installer for your operating system below. The unsigned MSIX is a workflow artifact for Microsoft Store submission only, not an installer download.",
        "--latest=false"
      );
      existing = await release(tag);
    }

    if (existing.draft) {
      for (const asset of existing.assets) {
        if (!assets.some((expected) => expected.name === asset.name)) {
          await gh("release", "delete-asset", tag, asset.name, "--yes");
        }
      }

      await gh(
        "release",
        "upload",
        tag,
        ...assets.map((asset) => asset.path),
        "--clobber"
      );
      existing = await release(tag);
    }

    // GitHub computes the upload digest: verify it without downloading installers twice.
    for (const expected of assets) {
      const uploaded = existing.assets.find(
        (asset) => asset.name === expected.name
      );

      if (
        !uploaded ||
        uploaded.size !== expected.size ||
        uploaded.digest !== expected.digest
      ) {
        throw new Error(
          `Uploaded artifact integrity mismatch: ${expected.name}`
        );
      }
    }

    if (existing.draft) {
      await gh("release", "edit", tag, "--draft=false", "--latest=false");
    }

    let channel = await release("desktop-updates");

    if (!channel) {
      await gh(
        "release",
        "create",
        "desktop-updates",
        "--target",
        sha,
        "--title",
        "Desktop update channel",
        "--notes",
        "Update metadata only. Installers are in the versioned desktop releases.",
        "--latest=false"
      );
      channel = { assets: [] };
    }

    for (const { name, canonical } of manifests) {
      if (channel.assets.some((asset) => asset.name === name)) {
        await gh(
          "release",
          "download",
          "desktop-updates",
          "--pattern",
          name,
          "--dir",
          join(temp, "current")
        );

        const current = Bun.YAML.parse(
          await Bun.file(join(temp, "current", name)).text()
        );

        if (!/^\d+\.\d+\.\d+$/.test(current.version)) {
          throw new Error("Invalid channel version");
        }

        const order = Bun.semver.order(current.version, version);

        if (order > 0) {
          continue;
        }

        if (order === 0) {
          if (!isDeepStrictEqual(current, canonical)) {
            throw new Error(`Inconsistent channel: ${name}`);
          }

          continue;
        }
      }

      const path = join(temp, name);
      await Bun.write(path, Bun.YAML.stringify(canonical));
      await gh("release", "upload", "desktop-updates", path, "--clobber");
    }
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  if (process.env.GITHUB_REPOSITORY !== repository) {
    throw new Error("Unexpected repository");
  }

  await publishRelease({
    output: "apps/desktop/dist/release",
    sha: process.env.GITHUB_SHA,
    tag: process.env.RELEASE_TAG,
    version: (await Bun.file("apps/desktop/package.json").json()).version,
  });
}
