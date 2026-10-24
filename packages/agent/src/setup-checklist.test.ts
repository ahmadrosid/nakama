import { describe, expect, test } from "bun:test";
import type { SkillSummary } from "@nakama/core";
import {
  buildSetupChecklist,
  listSetupChecklistCandidates,
  parseSetupChecklistReply,
  type SetupChecklistSources,
} from "./setup-checklist";

function skill(id: string, name: string, enabled = true): SkillSummary {
  return {
    createdAt: "2026-10-24T00:00:00.000Z",
    createdBy: "human",
    description: `${name} skill`,
    disableModelInvocation: false,
    enabled,
    hasTool: false,
    id,
    name,
    sourcePath: `skills/${id}`,
    updatedAt: "2026-10-24T00:00:00.000Z",
  };
}

const sources: SetupChecklistSources = {
  assignedSkillIds: ["skill-assigned"],
  catalog: [
    {
      description: "Ads manager",
      logoUrl: null,
      name: "Meta Ads",
      slug: "metaads",
    },
    { description: null, logoUrl: null, name: "Gmail", slug: "gmail" },
  ],
  orgMemory: "# Org Memory\n\n## Pinned\n",
  skills: [
    skill("skill-report", "Ads report"),
    skill("skill-assigned", "Already on"),
    skill("skill-off", "Disabled", false),
  ],
  userConnections: [
    {
      id: "c1",
      lastError: null,
      status: "connected",
      toolkitId: "t1",
      toolkitSlug: "gmail",
      updatedAt: "2026-10-24T00:00:00.000Z",
    },
  ],
};

const candidates = listSetupChecklistCandidates(sources);

function providerReplying(reply: string) {
  // SAFETY: This test double only calls generateText, and this is its complete implementation.
  return { generateText: async () => reply } as never;
}

describe("listSetupChecklistCandidates", () => {
  test("leaves out what is already done", () => {
    expect(candidates.map((candidate) => candidate.id)).toEqual([
      "toolkit:metaads",
      "skill:skill-report",
      "context:org",
    ]);
  });

  test("leaves out business context once org memory has a fact", () => {
    const ids = listSetupChecklistCandidates({
      ...sources,
      orgMemory: "# Org Memory\n\n## Pinned\n- We sell coffee beans online\n",
    }).map((candidate) => candidate.id);

    expect(ids).not.toContain("context:org");
  });

  test("keeps a toolkit whose connection is not finished", () => {
    const ids = listSetupChecklistCandidates({
      ...sources,
      userConnections: [{ ...sources.userConnections[0]!, status: "error" }],
    }).map((candidate) => candidate.id);

    expect(ids).toContain("toolkit:gmail");
  });
});

describe("parseSetupChecklistReply", () => {
  test("maps ids to items in reply order", () => {
    expect(
      parseSetupChecklistReply(
        '```json\n{"goal":"Run ads","items":["context:org","toolkit:metaads"]}\n```',
        candidates
      )
    ).toEqual({
      goal: "Run ads",
      items: [
        {
          kind: "write_context",
          scope: "org",
          title: "Tell the agent about your business",
        },
        {
          kind: "connect_toolkit",
          title: "Connect Meta Ads",
          toolkitSlug: "metaads",
        },
      ],
    });
  });

  test("drops unknown and repeated ids", () => {
    expect(
      parseSetupChecklistReply(
        '{"items":["toolkit:shopify","toolkit:metaads","toolkit:metaads"]}',
        candidates
      )?.items.map((item) => item.kind)
    ).toEqual(["connect_toolkit"]);
  });

  test("returns null for a reply that is not JSON", () => {
    expect(parseSetupChecklistReply("Connect Meta Ads", candidates)).toBeNull();
  });
});

describe("buildSetupChecklist", () => {
  const userContext = "# About Me\n\n- Help with: Manage my Meta Ads\n";

  test("returns no items without a provider", async () => {
    expect(await buildSetupChecklist({ candidates, userContext }, {})).toEqual({
      goal: "Manage my Meta Ads",
      items: [],
    });
  });

  test("returns no items for an empty USER.md", async () => {
    const result = await buildSetupChecklist(
      { candidates, userContext: "" },
      { provider: providerReplying('{"items":["toolkit:metaads"]}') }
    );

    expect(result).toEqual({ goal: null, items: [] });
  });

  test("keeps the saved goal over the model's goal", async () => {
    const result = await buildSetupChecklist(
      { candidates, userContext },
      {
        provider: providerReplying(
          '{"goal":"Ads","items":["toolkit:metaads"]}'
        ),
      }
    );

    expect(result.goal).toBe("Manage my Meta Ads");
    expect(result.items).toHaveLength(1);
  });

  test("reads the goal from an import with no Help with", async () => {
    const result = await buildSetupChecklist(
      {
        candidates,
        userContext:
          "# About Me\n\n- What you do: I run Facebook ads for a shop\n",
      },
      {
        provider: providerReplying(
          '{"goal":"Run Meta ads for my shop","items":["toolkit:metaads"]}'
        ),
      }
    );

    expect(result.goal).toBe("Run Meta ads for my shop");
    expect(result.items[0]).toMatchObject({ toolkitSlug: "metaads" });
  });

  test("returns no items when the provider fails", async () => {
    const result = await buildSetupChecklist(
      { candidates, userContext },
      {
        // SAFETY: This test double only calls generateText, and this is its complete implementation.
        provider: {
          generateText: async () => {
            throw new Error("rate limited");
          },
        } as never,
      }
    );

    expect(result).toEqual({ goal: "Manage my Meta Ads", items: [] });
  });
});
