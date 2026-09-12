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
  if (!["http:", "https:"].includes(input.protocol)) {
    throw new Error("GitHub skill URL must use http or https.");
  }
  const parts = input.pathname.split("/").filter(Boolean);
  if (
    ["github.com", "www.github.com"].includes(input.hostname) &&
    parts.length === 2
  ) {
    const repo = (await fetchGitHubJson(
      `https://api.github.com/repos/${parts.join("/")}`
    )) as { default_branch: string };
    url = `https://github.com/${parts.join("/")}/blob/${encodeURIComponent(repo.default_branch)}/SKILL.md`;
  }
  const raw = new URL(resolveGitHubSkillRawUrl(url));
  const [owner, repo, ref, ...fileParts] = raw.pathname.slice(1).split("/");
  const commit = (await fetchGitHubJson(
    `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`
  )) as { sha: string };
  if (!/^[a-f0-9]{40}$/.test(commit.sha)) {
    throw new NakamaApiError("GitHub returned an invalid commit.", 400);
  }
  const tree = (await fetchGitHubJson(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${commit.sha}?recursive=1`
  )) as {
    sha: string;
    truncated?: boolean;
    tree: { path: string; type: string; mode: string }[];
  };
  if (
    tree.truncated ||
    !Array.isArray(tree.tree) ||
    !/^[a-f0-9]{40}$/.test(tree.sha)
  ) {
    throw new NakamaApiError(
      "GitHub returned an incomplete skill file listing.",
      400
    );
  }
  const directory = fileParts.slice(0, -1).map(decodeURIComponent).join("/");
  const prefix = directory ? `${directory}/` : "";
  const entries = tree.tree.filter(
    (entry) => entry.path.startsWith(prefix) && entry.type !== "tree"
  );
  if (entries.length > 500) {
    throw new NakamaApiError("Skill contains too many files (max 500).", 400);
  }
  const files: GitHubSkillBundle["files"] = [];
  let content: string | undefined;
  let total = 0;
  for (const entry of entries) {
    const relativePath = entry.path.slice(prefix.length);
    if (
      relativePath
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
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) {
      throw new NakamaApiError(
        "Skill symlinks and submodules are not supported.",
        400
      );
    }
    const downloadUrl = `https://${RAW_HOST}/${owner}/${repo}/${commit.sha}/${entry.path.split("/").map(encodeURIComponent).join("/")}`;
    if (relativePath === "SKILL.md") {
      content = await fetchGitHubSkillMarkdown(downloadUrl);
      total += new TextEncoder().encode(content).byteLength;
      if (total > 10 * 1024 * 1024) {
        throw new NakamaApiError("Skill is too large.", 400);
      }
      continue;
    }
    const response = await fetchGitHubResponse(downloadUrl);
    const bytes = await readResponseBodyCapped(
      response,
      Math.min(10 * 1024 * 1024 - total, 5 * 1024 * 1024)
    );
    total += bytes.byteLength;
    files.push({ content: bytes, path: relativePath });
  }
  if (content === undefined) {
    throw new NakamaApiError("Skill directory does not contain SKILL.md.", 400);
  }
  return { content, files };
}

async function fetchGitHubResponse(url: string): Promise<Response> {
  const response = await fetch(
    url,
    withDisabledFetchIdle({
      headers: { "User-Agent": "nakama-skill-install" },
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  );
  if (!response.ok) {
    throw new NakamaApiError(
      `Failed to fetch skill from GitHub (HTTP ${response.status}).`,
      400
    );
  }
  return response;
}

async function fetchGitHubJson(url: string): Promise<unknown> {
  const response = await fetchGitHubResponse(url);
  return JSON.parse(
    new TextDecoder().decode(
      await readResponseBodyCapped(response, 10 * 1024 * 1024)
    )
  );
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
