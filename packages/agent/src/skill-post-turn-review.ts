import {
  BUNDLED_SKILL_NAMES,
  type ChatMessage,
  getUserMessageText,
  type ProviderClient,
} from "@nakama/core";

const TURN_SNIPPET_MAX = 4000;
const TOOL_RESULT_MAX = 400;
const bundledNames = new Set<string>(BUNDLED_SKILL_NAMES);

export type SkillPostTurnReviewOutcome =
  | { action: "noop"; reason?: string }
  | { action: "create"; name: string; content: string }
  | { action: "patch"; name: string; oldString: string; newString: string };

export interface SkillCatalogEntry {
  description: string;
  name: string;
}

const REVIEW_SYSTEM = [
  "You review a completed agent chat turn and decide whether a reusable profile skill should be created or patched.",
  "Return ONLY compact JSON with one of these shapes:",
  '{"action":"noop","reason":"..."}',
  '{"action":"create","name":"kebab-case-name","content":"full SKILL.md with YAML frontmatter"}',
  '{"action":"patch","name":"existing-skill","oldString":"exact excerpt","newString":"replacement"}',
  "",
  "Rules:",
  "- Prefer patch over create when an existing profile skill clearly matches",
  "- Prefer noop when the turn is routine, already covered, or low confidence",
  "- Never delete skills; never target bundled/global system skills",
  "- create name must match ^[a-z0-9-]{1,64}$",
  "- create content must include frontmatter with name and description",
  "- patch oldString must be unique in the current skill body you would expect",
  "- Do not wrap JSON in markdown fences",
].join("\n");

function truncate(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

export function buildSkillPostTurnReviewPrompt(input: {
  turnMessages: ChatMessage[];
  catalog: SkillCatalogEntry[];
}): string {
  const lines: string[] = ["## Assigned profile skills", ""];

  if (input.catalog.length === 0) {
    lines.push("(none)");
  } else {
    for (const skill of input.catalog) {
      lines.push(`- ${skill.name}: ${truncate(skill.description, 200)}`);
    }
  }

  lines.push("", "## Latest turn", "");

  for (const message of input.turnMessages) {
    if (message.role === "user") {
      lines.push(`User: ${truncate(getUserMessageText(message.content), 800)}`);
      continue;
    }
    if (message.role === "assistant") {
      const tools =
        message.toolCalls?.map((call) => call.name).join(", ") ?? "";
      lines.push(
        `Assistant: ${truncate(message.content || "(tool calls)", 800)}${tools ? ` [tools: ${tools}]` : ""}`
      );
      continue;
    }
    if (message.role === "tool") {
      lines.push(
        `Tool ${message.name}: ${truncate(message.content, TOOL_RESULT_MAX)}`
      );
    }
  }

  return truncate(lines.join("\n"), TURN_SNIPPET_MAX);
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

function isValidSkillName(name: string): boolean {
  return /^[a-z0-9-]{1,64}$/.test(name);
}

export function parseSkillPostTurnReviewResponse(
  raw: string,
  options: { catalogNames: Set<string> }
): SkillPostTurnReviewOutcome {
  const parsed = extractJsonObject(raw);
  if (typeof parsed !== "object" || parsed === null) {
    return { action: "noop", reason: "malformed_json" };
  }

  const record = parsed as Record<string, unknown>;
  const action = record.action;

  if (action === "noop") {
    return {
      action: "noop",
      reason: typeof record.reason === "string" ? record.reason : undefined,
    };
  }

  if (action === "delete") {
    return { action: "noop", reason: "delete_forbidden" };
  }

  if (action === "create") {
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const content = typeof record.content === "string" ? record.content : "";
    if (!(isValidSkillName(name) && content.trim())) {
      return { action: "noop", reason: "invalid_create" };
    }
    if (bundledNames.has(name)) {
      return { action: "noop", reason: "bundled_forbidden" };
    }
    if (options.catalogNames.has(name)) {
      return { action: "noop", reason: "create_collides_with_existing" };
    }
    return { action: "create", content, name };
  }

  if (action === "patch") {
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const oldString =
      typeof record.oldString === "string" ? record.oldString : "";
    const newString =
      typeof record.newString === "string" ? record.newString : "";
    if (!(isValidSkillName(name) && oldString) || newString === undefined) {
      return { action: "noop", reason: "invalid_patch" };
    }
    if (bundledNames.has(name)) {
      return { action: "noop", reason: "bundled_forbidden" };
    }
    if (!options.catalogNames.has(name)) {
      return { action: "noop", reason: "patch_unknown_skill" };
    }
    return { action: "patch", name, newString, oldString };
  }

  return { action: "noop", reason: "unknown_action" };
}

export async function generateSkillPostTurnReview(input: {
  turnMessages: ChatMessage[];
  catalog: SkillCatalogEntry[];
  provider: ProviderClient;
}): Promise<SkillPostTurnReviewOutcome> {
  const prompt = buildSkillPostTurnReviewPrompt({
    catalog: input.catalog,
    turnMessages: input.turnMessages,
  });
  const catalogNames = new Set(input.catalog.map((skill) => skill.name));

  try {
    const result = await input.provider.generateText({
      format: "text",
      prompt,
      system: REVIEW_SYSTEM,
    });
    return parseSkillPostTurnReviewResponse(result.content, { catalogNames });
  } catch (error) {
    console.error("Failed post-turn skill review LLM call:", error);
    return { action: "noop", reason: "provider_error" };
  }
}
