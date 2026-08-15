const RAW_HOST = "raw.githubusercontent.com";
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const SKILL_FILE_NAME = "SKILL.md";
/** Encoded path/query/fragment separators that must not become real separators after decode. */
const ENCODED_SEPARATOR_PATTERN = /%(?:2[fF]|5[cC]|23|3[fF])/;

export function resolveGitHubSkillRawUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("GitHub skill URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid GitHub skill URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("GitHub skill URL must use http or https.");
  }

  const host = parsed.hostname.toLowerCase();

  if (host === RAW_HOST) {
    return normalizeRawUrl(parsed);
  }

  if (!GITHUB_HOSTS.has(host)) {
    throw new Error(
      "Only public GitHub URLs are supported (github.com or raw.githubusercontent.com)."
    );
  }

  return githubHtmlUrlToRaw(parsed);
}

function normalizeRawUrl(parsed: URL): string {
  const segments = splitPath(parsed.pathname);
  if (segments.length < 4) {
    throw new Error(
      "raw.githubusercontent.com URL must be /{owner}/{repo}/{ref}/…/SKILL.md."
    );
  }

  const owner = segments[0]!;
  const repo = segments[1]!;
  const ref = segments[2]!;
  const filePath = ensureSkillFilePath(segments.slice(3).join("/"), "file");

  return buildRawUrl(owner, repo, ref, filePath);
}

function githubHtmlUrlToRaw(parsed: URL): string {
  const segments = splitPath(parsed.pathname);
  if (segments.length < 4) {
    throw new Error(
      "GitHub URL must point to a SKILL.md blob/raw path or a tree folder that contains SKILL.md."
    );
  }

  const owner = segments[0]!;
  const repo = segments[1]!;
  const kind = segments[2]!;

  if (kind !== "blob" && kind !== "tree" && kind !== "raw") {
    throw new Error(
      "GitHub URL must use /blob/, /tree/, or /raw/ (or a raw.githubusercontent.com URL)."
    );
  }

  if (segments.length < 5) {
    throw new Error(
      "GitHub URL must include a ref and path to SKILL.md or a skill folder."
    );
  }

  const ref = segments[3]!;
  const rest = segments.slice(4).join("/");
  const mode = kind === "tree" ? "tree" : "file";
  const filePath = ensureSkillFilePath(rest, mode);

  return buildRawUrl(owner, repo, ref, filePath);
}

function buildRawUrl(
  owner: string,
  repo: string,
  ref: string,
  filePath: string
): string {
  const pathSegments = [
    owner,
    repo,
    ref,
    ...filePath.split("/").filter((segment) => segment.length > 0),
  ];

  for (const segment of pathSegments) {
    assertSafePathSegment(segment);
  }

  return `https://${RAW_HOST}/${pathSegments.map(encodeURIComponent).join("/")}`;
}

function ensureSkillFilePath(pathPart: string, mode: "file" | "tree"): string {
  let normalized = pathPart;
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  if (!normalized) {
    throw new Error(
      mode === "tree"
        ? "GitHub tree URL must include a folder path that contains SKILL.md."
        : "GitHub URL must point to a SKILL.md file."
    );
  }

  const parts = normalized.split("/").filter((segment) => segment.length > 0);
  for (const part of parts) {
    assertSafePathSegment(part);
  }

  const base = parts.at(-1) ?? "";
  if (base === SKILL_FILE_NAME) {
    return parts.join("/");
  }

  if (mode === "tree") {
    return [...parts, SKILL_FILE_NAME].join("/");
  }

  throw new Error("GitHub URL must point to a SKILL.md file.");
}

function splitPath(pathname: string): string[] {
  const decoded: string[] = [];

  for (const segment of pathname.split("/")) {
    if (segment.length === 0) {
      continue;
    }

    if (ENCODED_SEPARATOR_PATTERN.test(segment)) {
      throw new Error(
        "GitHub skill URL path cannot contain encoded path separators."
      );
    }

    let value: string;
    try {
      value = decodeURIComponent(segment);
    } catch {
      throw new Error("GitHub skill URL path is invalid.");
    }

    assertSafePathSegment(value);
    decoded.push(value);
  }

  return decoded;
}

function assertSafePathSegment(segment: string): void {
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("#") ||
    segment.includes("?")
  ) {
    throw new Error("GitHub skill URL path is invalid.");
  }
}
