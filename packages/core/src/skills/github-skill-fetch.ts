import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { NakamaApiError } from "../api-error";
import { withDisabledFetchIdle } from "../fetch-idle";
import { resolveGitHubSkillRawUrl } from "./github-skill-url";

const RAW_HOST = "raw.githubusercontent.com";
const MAX_SKILL_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

export async function fetchGitHubSkillMarkdown(url: string): Promise<string> {
  let rawUrl: string;
  try {
    rawUrl = resolveGitHubSkillRawUrl(url);
  } catch (error) {
    throw new NakamaApiError(
      error instanceof Error ? error.message : "Invalid GitHub skill URL.",
      400
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new NakamaApiError("Invalid GitHub skill URL.", 400);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.toLowerCase() !== RAW_HOST
  ) {
    throw new NakamaApiError(
      "Only public GitHub URLs are supported (github.com or raw.githubusercontent.com).",
      400
    );
  }

  let response: Response;
  try {
    response = await fetch(
      rawUrl,
      withDisabledFetchIdle({
        headers: {
          Accept: "text/plain, text/markdown;q=0.9, */*;q=0.1",
          "User-Agent": "nakama-skill-install",
        },
        redirect: "error",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
    );
  } catch (error) {
    throw new NakamaApiError(
      error instanceof Error
        ? `Failed to fetch skill from GitHub: ${error.message}`
        : "Failed to fetch skill from GitHub.",
      400
    );
  }

  if (!response.ok) {
    throw new NakamaApiError(
      `Failed to fetch skill from GitHub (HTTP ${response.status}).`,
      400
    );
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declaredSize = Number(contentLength);
    if (Number.isFinite(declaredSize) && declaredSize > MAX_SKILL_BYTES) {
      throw new NakamaApiError(
        `Skill file is too large (max ${MAX_SKILL_BYTES} bytes).`,
        400
      );
    }
  }

  const bytes = await readResponseBodyCapped(response, MAX_SKILL_BYTES);
  return new TextDecoder().decode(bytes);
}

export interface GitHubSkillBundle {
  content: string;
  files: { path: string; content: Uint8Array }[];
}

/** Fetch the complete skill directory before publishing any of it locally. */
export async function fetchGitHubSkillBundle(
  url: string
): Promise<GitHubSkillBundle> {
  try {
    return await downloadGitHubSkillBundle(url);
  } catch (error) {
    if (error instanceof NakamaApiError) {
      throw error;
    }
    throw new NakamaApiError(
      error instanceof Error
        ? error.message
        : "Failed to download GitHub skill.",
      400
    );
  }
}

async function downloadGitHubSkillBundle(
  url: string
): Promise<GitHubSkillBundle> {
  const input = new URL(url);
  const parts = input.pathname.split("/").filter(Boolean);
  if (
    ["github.com", "www.github.com"].includes(input.hostname) &&
    parts.length === 2
  ) {
    // HEAD follows the repository's default branch without a metadata API call.
    input.pathname += `${input.pathname.endsWith("/") ? "" : "/"}tree/HEAD`;
    url = input.href;
  }
  const raw = new URL(resolveGitHubSkillRawUrl(url));
  const [owner, repo, ref, ...fileParts] = raw.pathname.slice(1).split("/");
  const directory = fileParts.slice(0, -1).map(decodeURIComponent).join("/");
  const response = await fetch(
    `https://codeload.github.com/${owner}/${repo}/zip/${ref}`,
    withDisabledFetchIdle({
      headers: { "User-Agent": "nakama-skill-install" },
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    })
  );
  if (response.ok) {
    // Large repositories can still contain small skills. Only the archive
    // download cap falls back; invalid or oversized skill entries must fail.
    const archive = await readResponseBodyCapped(
      response,
      50 * 1024 * 1024
    ).catch((error) => {
      if (error instanceof NakamaApiError) {
        return null;
      }
      throw error;
    });
    const bundle = archive ? readSkillZip(archive, directory) : null;
    if (bundle) {
      return bundle;
    }
  } else {
    await response.body?.cancel();
    if (![401, 403, 404, 429].includes(response.status)) {
      throw new NakamaApiError(
        `Failed to download skill archive (HTTP ${response.status}).`,
        400
      );
    }
  }
  return downloadSkillWithGit(
    `https://github.com/${owner}/${repo}.git`,
    decodeURIComponent(ref!),
    directory
  );
}

function assertSkillPath(path: string): void {
  if (
    path
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          part.includes("\\") ||
          part.includes("\0")
      )
  ) {
    throw new NakamaApiError("Invalid skill file path.", 400);
  }
}

function checkSkillSize(
  path: string,
  size: number,
  total: number,
  count: number
): void {
  if (count > 500) {
    throw new NakamaApiError("Skill contains too many files (max 500).", 400);
  }
  const limit = path === "SKILL.md" ? MAX_SKILL_BYTES : 5 * 1024 * 1024;
  if (size > limit || total > 10 * 1024 * 1024) {
    throw new NakamaApiError("Skill file or directory is too large.", 400);
  }
}

function skillBundle(files: GitHubSkillBundle["files"]): GitHubSkillBundle {
  const markdown = files.find((file) => file.path === "SKILL.md");
  if (!markdown) {
    throw new NakamaApiError("Skill directory does not contain SKILL.md.", 400);
  }
  return {
    content: new TextDecoder().decode(markdown.content),
    files: files.filter((file) => file !== markdown),
  };
}

function readSkillZip(
  bytes: Uint8Array,
  directory?: string
): GitHubSkillBundle | null {
  // fflate does not expose Unix file modes. Inspect the central directory before
  // decompressing so symlinks cannot be installed as ordinary supporting files.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65_557)) {
    if (
      view.getUint32(end, true) === 0x06_05_4b_50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length
    ) {
      break;
    }
    end -= 1;
  }
  if (end < Math.max(0, bytes.length - 65_557)) {
    throw new Error("Invalid ZIP archive.");
  }
  const count = view.getUint16(end + 10, true);
  // ZIP64 and submodule metadata use Git, which can enumerate their real entries.
  if (count === 65_535) {
    return null;
  }
  if (
    view.getUint32(end + 4, true) !== 0 ||
    view.getUint16(end + 8, true) !== count
  ) {
    throw new Error("Invalid ZIP archive.");
  }
  let offset = view.getUint32(end + 16, true);
  if (offset + view.getUint32(end + 12, true) !== end) {
    throw new Error("Invalid ZIP archive.");
  }
  const selected = new Map<string, string>();
  const directories: string[] = [];
  let detectedDirectory = directory;
  let root: string | undefined = directory === undefined ? "" : undefined;
  let total = 0;
  let needsGit = false;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02_01_4b_50) {
      throw new Error("Invalid ZIP archive.");
    }
    const length = view.getUint16(offset + 28, true);
    const next =
      offset +
      46 +
      length +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    if (next > end) {
      throw new Error("Invalid ZIP archive.");
    }
    const name = new TextDecoder().decode(
      bytes.subarray(offset + 46, offset + 46 + length)
    );
    const fileType = Math.floor(view.getUint16(offset + 40, true) / 4096);
    const size = view.getUint32(offset + 24, true);
    offset = next;
    assertSkillPath(name.endsWith("/") ? name.slice(0, -1) : name);
    root ??= name.split("/")[0];
    if (root && !name.startsWith(`${root}/`)) {
      throw new Error("Invalid ZIP archive root.");
    }
    if (name.endsWith("/.gitmodules")) {
      needsGit = true;
    }
    if (!detectedDirectory && name.endsWith("/SKILL.md")) {
      detectedDirectory = name.slice(
        root ? root.length + 1 : 0,
        -"/SKILL.md".length
      );
    }
    const prefix = `${root ? `${root}/` : ""}${detectedDirectory ? `${detectedDirectory}/` : ""}`;
    if (!name.startsWith(prefix)) {
      // A symlink in place of the selected directory is also invalid.
      if (name === prefix.slice(0, -1)) {
        throw new Error("Skill directory is not a directory.");
      }
      continue;
    }
    if (![0, 4, 8].includes(fileType)) {
      throw new NakamaApiError(
        "Skill symlinks and special files are not supported.",
        400
      );
    }
    if (name.endsWith("/")) {
      directories.push(name);
      continue;
    }
    const path = name.slice(prefix.length);
    if (selected.has(name)) {
      throw new Error("Duplicate skill file in ZIP archive.");
    }
    total += size;
    checkSkillSize(path, size, total, selected.size + 1);
    selected.set(name, path);
  }
  if (offset !== end) {
    throw new Error("Invalid ZIP archive.");
  }
  // Git archives represent submodules as empty directories, even without
  // .gitmodules. Ask Git to identify them rather than silently omitting them.
  const names = [...selected.keys()];
  if (
    needsGit ||
    directories.some((dir) => !names.some((name) => name.startsWith(dir)))
  ) {
    return null;
  }
  const extracted = unzipSync(bytes, {
    filter: (file) => selected.has(file.name),
  });
  return skillBundle(
    Object.entries(extracted).map(([name, content]) => ({
      content,
      path: selected.get(name)!,
    }))
  );
}

/** Read a user-uploaded ZIP containing one skill directory. */
export function readUploadedSkillBundle(bytes: Uint8Array): GitHubSkillBundle {
  const bundle = readSkillZip(bytes);
  if (!bundle) {
    throw new NakamaApiError("Could not read the uploaded skill ZIP.", 400);
  }
  return bundle;
}

async function downloadSkillWithGit(
  url: string,
  ref: string,
  directory: string
): Promise<GitHubSkillBundle> {
  const temp = await mkdtemp(join(tmpdir(), "nakama-skill-"));
  const signal = AbortSignal.timeout(60_000);
  const run = async (
    args: string[],
    maxBuffer = 512 * 1024
  ): Promise<Buffer> => {
    try {
      return await new Promise<Buffer>((resolve, reject) =>
        execFile(
          "git",
          ["-C", temp, ...args],
          {
            encoding: null,
            env: {
              GIT_ALLOW_PROTOCOL: "https",
              GIT_CONFIG_GLOBAL: devNull,
              GIT_CONFIG_NOSYSTEM: "1",
              GIT_LITERAL_PATHSPECS: "1",
              GIT_TERMINAL_PROMPT: "0",
              HOME: temp,
              NODE_ENV: process.env.NODE_ENV,
              PATH: process.env.PATH,
            },
            maxBuffer,
            signal,
          },
          (error, stdout) => (error ? reject(error) : resolve(stdout))
        )
      );
    } catch {
      throw new NakamaApiError(
        "Git skill download failed. Check that Git is installed and the public repository and ref are accessible.",
        400
      );
    }
  };
  try {
    // Read blobs without checkout: no hooks, filters, or downloaded scripts run.
    await run(["init", "--bare", "--template="]);
    await run(["remote", "add", "origin", url]);
    await run(["config", "remote.origin.promisor", "true"]);
    await run(["config", "remote.origin.partialclonefilter", "blob:none"]);
    await run([
      "fetch",
      "--depth=1",
      "--filter=blob:none",
      "--",
      "origin",
      ref,
    ]);
    const listing = await run([
      "ls-tree",
      "-r",
      "-z",
      "-l",
      "FETCH_HEAD",
      "--",
      directory || ".",
    ]);
    const files: GitHubSkillBundle["files"] = [];
    const prefix = directory ? `${directory}/` : "";
    let total = 0;
    for (const entry of listing.toString("utf8").split("\0").filter(Boolean)) {
      const match = /^(\d+) (\w+) ([a-f0-9]{40}) +([\d-]+)\t([\s\S]+)$/.exec(
        entry
      );
      if (
        !(match && ["100644", "100755"].includes(match[1]!)) ||
        match[2] !== "blob"
      ) {
        throw new NakamaApiError(
          "Skill symlinks and submodules are not supported.",
          400
        );
      }
      const path = match[5]!;
      if (!path.startsWith(prefix)) {
        throw new Error("Invalid skill file path.");
      }
      const relativePath = path.slice(prefix.length);
      assertSkillPath(relativePath);
      const size = Number(match[4]);
      total += size;
      checkSkillSize(relativePath, size, total, files.length + 1);
      const content = await run(
        ["cat-file", "blob", match[3]!],
        Math.max(size, 64 * 1024)
      );
      if (content.length !== size) {
        throw new Error("Incomplete Git skill file.");
      }
      files.push({ content, path: relativePath });
    }
    return skillBundle(files);
  } finally {
    await rm(temp, { force: true, recursive: true });
  }
}

async function readResponseBodyCapped(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new NakamaApiError(
        `Skill file is too large (max ${maxBytes} bytes).`,
        400
      );
    }
    return new Uint8Array(buffer);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value || value.byteLength === 0) {
      continue;
    }

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new NakamaApiError(
        `Skill file is too large (max ${maxBytes} bytes).`,
        400
      );
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
