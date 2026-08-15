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

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_SKILL_BYTES) {
    throw new NakamaApiError(
      `Skill file is too large (max ${MAX_SKILL_BYTES} bytes).`,
      400
    );
  }

  return new TextDecoder().decode(buffer);
}
