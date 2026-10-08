import type { ProviderClient } from "@nakama/core";

const PROMPT_CHAR_MAX = 24_000;

export type SkillConsolidateMode = "merge" | "deslopify";

export interface SkillConsolidateBodyInput {
  body: string;
  description: string;
  name: string;
}

const MERGE_SYSTEM = [
  "You merge overlapping agent profile skills into one SKILL.md.",
  "Return ONLY the full SKILL.md markdown (YAML frontmatter + body). No fences, no commentary.",
  "Frontmatter must include name and description.",
  "Keep the winner skill name exactly as provided.",
  "Merge useful instructions; remove duplication and low-signal filler.",
  "Never invent tools or capabilities not present in the inputs.",
].join("\n");

const DESLOP_SYSTEM = [
  "You tighten a verbose agent profile skill SKILL.md without changing its purpose.",
  "Return ONLY the full SKILL.md markdown (YAML frontmatter + body). No fences, no commentary.",
  "Keep the skill name exactly as provided.",
  "Preserve must-follow rules; cut redundancy and fluff.",
].join("\n");

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max).trimEnd()}\n…`;
}

function buildSkillConsolidatePrompt(input: {
  losers?: SkillConsolidateBodyInput[];
  mode: SkillConsolidateMode;
  winner: SkillConsolidateBodyInput;
}): string {
  const lines: string[] = [];

  if (input.mode === "merge") {
    lines.push("## Winner skill (keep this name)", "");
    lines.push(`name: ${input.winner.name}`);
    lines.push(`description: ${input.winner.description}`);
    lines.push("", "### Body", "", input.winner.body);

    for (const loser of input.losers ?? []) {
      lines.push("", `## Duplicate to merge (${loser.name})`, "");
      lines.push(`description: ${loser.description}`);
      lines.push("", "### Body", "", loser.body);
    }
  } else {
    lines.push("## Skill to deslopify", "");
    lines.push(`name: ${input.winner.name}`);
    lines.push(`description: ${input.winner.description}`);
    lines.push("", "### Body", "", input.winner.body);
  }

  return truncate(lines.join("\n"), PROMPT_CHAR_MAX);
}

export async function generateSkillConsolidateMarkdown(input: {
  losers?: SkillConsolidateBodyInput[];
  mode: SkillConsolidateMode;
  provider: ProviderClient;
  winner: SkillConsolidateBodyInput;
}): Promise<string | null> {
  const prompt = buildSkillConsolidatePrompt(input);

  const result = await input.provider.generateText({
    format: "text",
    prompt,
    system: input.mode === "merge" ? MERGE_SYSTEM : DESLOP_SYSTEM,
  });

  const markdown = result.text
    .trim()
    .replace(/^```(?:markdown|md)?\s*/i, "")
    .replace(/\s*```$/, "");

  return markdown || null;
}
