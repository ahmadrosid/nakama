const RAW_HOST = "raw.githubusercontent.com";
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const SKILL_FILE_NAME = "SKILL.md";

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

  const filePath = segments.slice(3).join("/");
  const withSkillFile = ensureSkillFilePath(filePath, "file");
  const owner = segments[0]!;
  const repo = segments[1]!;
  const ref = segments[2]!;

  return `https://${RAW_HOST}/${owner}/${repo}/${ref}/${withSkillFile}`;
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

  return `https://${RAW_HOST}/${owner}/${repo}/${ref}/${filePath}`;
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

  const base = normalized.split("/").at(-1) ?? "";
  if (base === SKILL_FILE_NAME) {
    return normalized;
  }

  if (mode === "tree") {
    return `${normalized}/${SKILL_FILE_NAME}`;
  }

  throw new Error("GitHub URL must point to a SKILL.md file.");
}

function splitPath(pathname: string): string[] {
  return pathname
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .filter((segment) => segment.length > 0);
}
