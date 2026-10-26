import {
  fetchGitHubSkillBundle,
  NakamaApiError,
  parseSkillMarkdown,
  type SkillFrontmatter,
} from "@nakama/core";
import type {
  SkillInstallPreviewResponse,
  SkillsMarketplaceResponse,
} from "@nakama/core/contract";
import { z } from "zod";
import { resolveSkillsAddCommand } from "./skills-service";

// The skills CLI calls this endpoint without auth; the documented /api/v1 one needs Vercel OIDC.
const SKILLS_SEARCH_URL = "https://skills.sh/api/search";

const marketplaceSkillSchema = z.object({
  installs: z.number().catch(0),
  name: z.string(),
  skillId: z.string(),
  source: z.string(),
});

const SCRIPT_FILE =
  /\.(?:sh|bash|zsh|py|js|mjs|cjs|ts|rb|pl|php|ps1|bat|cmd)$/i;

export async function searchSkillsMarketplace(
  query: string
): Promise<SkillsMarketplaceResponse> {
  const q = query.trim();

  if (q.length < 2) {
    return { skills: [] };
  }

  let body: unknown;

  try {
    const response = await fetch(
      `${SKILLS_SEARCH_URL}?${new URLSearchParams({ limit: "20", q })}`,
      { signal: AbortSignal.timeout(10_000) }
    );

    if (!response.ok) {
      throw new Error(`skills.sh answered ${response.status}`);
    }

    body = await response.json();
  } catch {
    throw new NakamaApiError(
      "skills.sh is unavailable. Install from a GitHub URL instead.",
      502
    );
  }

  const items = z.object({ skills: z.array(z.unknown()) }).safeParse(body);

  return {
    skills: (items.success ? items.data.skills : []).flatMap((item) => {
      const skill = marketplaceSkillSchema.safeParse(item);

      return skill.success ? [skill.data] : [];
    }),
  };
}

export async function previewSkillInstall(
  command: string
): Promise<SkillInstallPreviewResponse> {
  const url = await resolveSkillsAddCommand(command);
  const bundle = await fetchGitHubSkillBundle(url);
  let frontmatter: SkillFrontmatter;

  try {
    ({ frontmatter } = parseSkillMarkdown(bundle.content, url));
  } catch (error) {
    throw new NakamaApiError(
      error instanceof Error
        ? error.message
        : "Skill file is missing or has invalid frontmatter.",
      400
    );
  }

  return {
    description: frontmatter.description,
    estimatedTokens: Math.ceil(bundle.content.length / 4),
    files: bundle.files.map((file) => ({
      executable:
        SCRIPT_FILE.test(file.path) ||
        (file.content[0] === 0x23 && file.content[1] === 0x21),
      path: file.path,
    })),
    name: frontmatter.name,
  };
}
