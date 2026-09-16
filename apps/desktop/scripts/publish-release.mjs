import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = "ahmadrosid/nakama";
const gh = async (...args) =>
  (await execute("gh", [...args, "--repo", repository])).stdout;

export function updateManifest(manifest, tag) {
  if (
    tag !== `desktop-v${manifest.version}` ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version)
  ) {
    throw new Error("Release tag and manifest version must match");
  }
  if (!manifest.files?.some((file) => file.url.endsWith(".zip"))) {
    throw new Error("Missing update files");
  }
  const url = (file) => {
    if (basename(file) !== file || !/\.(zip|dmg)$/.test(file)) {
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

async function release(tag) {
  try {
    return JSON.parse(
      (await execute("gh", ["api", `repos/${repository}/releases/tags/${tag}`]))
        .stdout
    );
  } catch (error) {
    if (error.stderr?.includes("HTTP 404")) {
      return null;
    }
    throw error;
  }
}

async function publish() {
  const tag = process.env.RELEASE_TAG;
  const version = (await Bun.file("apps/desktop/package.json").json()).version;
  if (
    process.env.GITHUB_REPOSITORY !== repository ||
    tag !== `desktop-v${version}` ||
    !/^\d+\.\d+\.\d+$/.test(version)
  ) {
    throw new Error("Unexpected repository or release tag");
  }
  const output = "apps/desktop/dist/electron";
  const manifest = Bun.YAML.parse(
    await Bun.file(join(output, "latest-mac.yml")).text()
  );
  updateManifest(manifest, tag);
  const files = (await readdir(output)).filter((file) =>
    /\.(dmg|zip|blockmap)$/.test(file)
  );
  if (
    !(
      files.some((file) => file.endsWith(".dmg")) &&
      files.some((file) => file.endsWith(".zip"))
    )
  ) {
    throw new Error("Missing release artifacts");
  }
  let existing = await release(tag);
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
      "Self-contained macOS desktop release.",
      "--latest=false"
    );
    existing = { draft: true };
  }
  if (existing.draft) {
    await gh(
      "release",
      "upload",
      tag,
      ...files.map((file) => join(output, file)),
      join(output, "latest-mac.yml"),
      "--clobber"
    );
    await gh("release", "edit", tag, "--draft=false", "--latest=false");
  }
  // On retries, use the published manifest: rebuilt ZIPs can have different hashes.
  const temp = await mkdtemp(join(tmpdir(), "nakama-release-"));
  try {
    await gh(
      "release",
      "download",
      tag,
      "--pattern",
      "latest-mac.yml",
      "--dir",
      temp
    );
    const published = Bun.YAML.parse(
      await Bun.file(join(temp, "latest-mac.yml")).text()
    );
    const channel = await release("desktop-updates");
    if (channel?.assets.some((asset) => asset.name === "latest-mac.yml")) {
      await gh(
        "release",
        "download",
        "desktop-updates",
        "--pattern",
        "latest-mac.yml",
        "--dir",
        join(temp, "current")
      );
      const current = Bun.YAML.parse(
        await Bun.file(join(temp, "current/latest-mac.yml")).text()
      );
      if (Bun.semver.order(current.version, version) >= 0) {
        console.log(
          "Update channel already has this version or a newer release"
        );
        return;
      }
    }
    if (!channel) {
      await gh(
        "release",
        "create",
        "desktop-updates",
        "--target",
        process.env.GITHUB_SHA,
        "--title",
        "Desktop update channel",
        "--notes",
        "Update metadata only. Installers are in the versioned desktop releases.",
        "--latest=false"
      );
    }
    await Bun.write(
      join(temp, "latest-mac.yml"),
      Bun.YAML.stringify(updateManifest(published, tag))
    );
    await gh(
      "release",
      "upload",
      "desktop-updates",
      join(temp, "latest-mac.yml"),
      "--clobber"
    );
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  await publish();
}
