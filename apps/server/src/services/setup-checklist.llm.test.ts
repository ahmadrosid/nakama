/**
 * Live LLM cassette test for the setup checklist (#2004).
 *
 * Record (uses the active DeepSeek provider saved in NAKAMA_CONFIG_DIR):
 *   LLM_VCR_MODE=record bun test apps/server/src/services/setup-checklist.llm.test.ts
 *
 * Replay (default when the cassette exists; CI-safe):
 *   bun test apps/server/src/services/setup-checklist.llm.test.ts
 */
import { expect, test } from "bun:test";
import {
  buildSetupChecklist,
  listSetupChecklistCandidates,
} from "@nakama/agent";
import {
  getActiveProviderInstance,
  loadUserConfig,
  type ProviderInstance,
} from "@nakama/core";
import { createProviderForInstance } from "../providers/create";
import {
  cassetteFilePath,
  loadCassette,
  withMswCassette,
} from "../testing/llm-msw-cassette";

const cassetteName = "setup-checklist-deepseek";

const MODEL = "deepseek-chat";

async function providerInstance(): Promise<ProviderInstance | null> {
  if (await loadCassette(cassetteFilePath(cassetteName))) {
    return {
      apiKey: "cassette-replay-key",
      createdAt: new Date().toISOString(),
      id: "inst_deepseek_cassette",
      label: "DeepSeek",
      type: "deepseek",
    };
  }

  const active = getActiveProviderInstance(await loadUserConfig());

  return active?.type === "deepseek" ? active : null;
}

test("an imported memory with no goal still gets the Meta Ads step", async () => {
  const instance = await providerInstance();

  if (!instance) {
    console.warn(
      `Skipping ${cassetteName}: no cassette and no active DeepSeek provider.`
    );

    return;
  }

  const candidates = listSetupChecklistCandidates({
    assignedSkillIds: [],
    catalog: [
      {
        description: "Ad campaigns on Facebook and Instagram",
        logoUrl: null,
        name: "Meta Ads",
        slug: "metaads",
      },
      { description: "Email", logoUrl: null, name: "Gmail", slug: "gmail" },
      {
        description: "Code hosting",
        logoUrl: null,
        name: "GitHub",
        slug: "github",
      },
    ],
    orgMemory: "# Org Memory\n\n## Pinned\n",
    skills: [],
    userConnections: [],
  });

  const result = await withMswCassette(
    cassetteName,
    () =>
      buildSetupChecklist(
        {
          candidates,
          userContext:
            "# About Me\n\n- What you do: I run Facebook and Instagram ads for my online coffee shop\n",
        },
        { provider: createProviderForInstance(instance, MODEL) }
      ),
    { url: "https://api.deepseek.com/chat/completions" }
  );

  expect(result.goal).not.toBeNull();
  expect(result.items).toContainEqual({
    kind: "connect_toolkit",
    title: "Connect Meta Ads",
    toolkitSlug: "metaads",
  });
  expect(result.items).not.toContainEqual(
    expect.objectContaining({ toolkitSlug: "github" })
  );
});
