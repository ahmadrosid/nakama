import type {
  ComposioCatalogToolkitSummary,
  ComposioUserConnectionSummary,
  ProviderClient,
  SetupChecklistItem,
  SetupChecklistResponse,
  SkillSummary,
} from "@nakama/core";
import { parseUserContext } from "@nakama/core/user-context";
import { z } from "zod";

/** A checklist is a short list; more than this is a setup chore, not a start. */
const MAX_ITEMS = 5;

const MAX_GOAL_LENGTH = 120;

const ORG_CONTEXT_ID = "context:org";

const GenerateTextContentSchema = z.union([
  z.string(),
  z.object({ content: z.string() }).transform(({ content }) => content),
]);

const ChecklistReplySchema = z.object({
  goal: z.string().nullish(),
  items: z.array(z.string()),
});

export interface SetupChecklistCandidate {
  id: string;
  item: SetupChecklistItem;
  label: string;
}

export interface SetupChecklistSources {
  assignedSkillIds: readonly string[];
  catalog: readonly ComposioCatalogToolkitSummary[];
  orgMemory: string;
  skills: readonly SkillSummary[];
  userConnections: readonly ComposioUserConnectionSummary[];
}

/**
 * Everything the user could still do, minus what is already done: a toolkit
 * they connected, a skill the agent already has, or business context the org
 * already wrote. The model only picks from this list, so it cannot invent a
 * step the server has no screen for.
 */
export function listSetupChecklistCandidates(
  sources: SetupChecklistSources
): SetupChecklistCandidate[] {
  const connected = new Set(
    sources.userConnections
      .filter((connection) => connection.status === "connected")
      .map((connection) => connection.toolkitSlug)
  );

  const assigned = new Set(sources.assignedSkillIds);
  const candidates: SetupChecklistCandidate[] = [];

  for (const toolkit of sources.catalog) {
    if (!connected.has(toolkit.slug)) {
      candidates.push({
        id: `toolkit:${toolkit.slug}`,
        item: {
          kind: "connect_toolkit",
          title: `Connect ${toolkit.name}`,
          toolkitSlug: toolkit.slug,
        },
        label: toolkit.description
          ? `${toolkit.name}: ${toolkit.description}`
          : toolkit.name,
      });
    }
  }

  for (const skill of sources.skills) {
    if (skill.enabled && !assigned.has(skill.id)) {
      candidates.push({
        id: `skill:${skill.id}`,
        item: {
          kind: "enable_skill",
          skillId: skill.id,
          title: `Turn on the ${skill.name} skill`,
        },
        label: `${skill.name}: ${skill.description}`,
      });
    }
  }

  if (!hasOrgFacts(sources.orgMemory)) {
    candidates.push({
      id: ORG_CONTEXT_ID,
      item: {
        kind: "write_context",
        scope: "org",
        title: "Tell the agent about your business",
      },
      label: "Write what the business sells, to whom, and how it works",
    });
  }

  return candidates;
}

/** Org memory starts as headings only; a bullet is the first real fact. */
function hasOrgFacts(orgMemory: string): boolean {
  return orgMemory.split("\n").some((line) => /^\s*[-*]\s+\S/.test(line));
}

const SETUP_CHECKLIST_SYSTEM = [
  "You help a new user get their AI agent ready for their goal.",
  "Read what the user wrote about themselves, then pick the setup steps from the candidate list that this goal needs.",
  `Pick at most ${MAX_ITEMS}, most important first. Pick none when nothing fits.`,
  "Use candidate ids exactly as written. Never invent an id.",
  'Reply with only a JSON object: {"goal": "<the goal in one short line>", "items": ["<id>", ...]}.',
  "Do not use markdown fences, labels, or surrounding prose.",
].join("\n");

function buildSetupChecklistPrompt(
  userContext: string,
  candidates: readonly SetupChecklistCandidate[]
): string {
  return [
    "About the user (USER.md):",
    userContext.trim(),
    "",
    "Candidates:",
    ...candidates.map((candidate) => `- ${candidate.id} | ${candidate.label}`),
  ].join("\n");
}

/**
 * Map the model's reply onto the candidates. Unknown ids and repeats are
 * dropped, so a confused model makes the list shorter, never wrong.
 */
export function parseSetupChecklistReply(
  raw: string,
  candidates: readonly SetupChecklistCandidate[]
): { goal: string | null; items: SetupChecklistItem[] } | null {
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: z.infer<typeof ChecklistReplySchema>;

  try {
    const result = ChecklistReplySchema.safeParse(JSON.parse(unfenced));

    if (!result.success) {
      return null;
    }

    parsed = result.data;
  } catch {
    return null;
  }

  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate.item] as const)
  );

  const ids = [...new Set(parsed.items)].filter((id) => byId.has(id));
  const goal = parsed.goal?.trim().slice(0, MAX_GOAL_LENGTH) || null;

  return {
    goal,
    items: ids.slice(0, MAX_ITEMS).map((id) => byId.get(id)!),
  };
}

/**
 * Turn what the user told Nakama into a short setup checklist. Never throws:
 * no provider, an empty USER.md or a bad reply all give an empty list.
 */
export async function buildSetupChecklist(
  input: {
    candidates: readonly SetupChecklistCandidate[];
    userContext: string | null | undefined;
  },
  options: { provider?: ProviderClient | null }
): Promise<SetupChecklistResponse> {
  const { answers, extra } = parseUserContext(input.userContext);
  const savedGoal = answers.help?.trim() || null;

  const hasContext =
    extra.trim() !== "" ||
    Object.values(answers).some((answer) => answer.trim() !== "");

  if (!(options.provider && hasContext && input.candidates.length > 0)) {
    return { goal: savedGoal, items: [] };
  }

  try {
    const result = await options.provider.generateText({
      format: "text",
      prompt: buildSetupChecklistPrompt(
        input.userContext ?? "",
        input.candidates
      ),
      system: SETUP_CHECKLIST_SYSTEM,
    });

    const reply = parseSetupChecklistReply(
      GenerateTextContentSchema.parse(result),
      input.candidates
    );

    return {
      goal: savedGoal ?? reply?.goal ?? null,
      items: reply?.items ?? [],
    };
  } catch {
    return { goal: savedGoal, items: [] };
  }
}
