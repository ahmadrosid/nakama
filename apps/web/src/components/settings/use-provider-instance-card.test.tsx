import { describe, expect, test } from "bun:test";
import type {
  ProviderInstanceSummary,
  ProviderModelOption,
} from "@nakama/core/contract";
import { DISCOVERY_MODEL_PROVIDERS } from "@nakama/core/discovery-providers";
import { renderToString } from "react-dom/server";
import { CATALOG_SHORTLIST_PROVIDERS } from "@/components/catalog-provider-model-fields.shared";
import { useProviderInstanceCard } from "./use-provider-instance-card";

const instance: ProviderInstanceSummary = {
  createdAt: "2026-01-01T00:00:00Z",
  hasApiKey: true,
  id: "chatgpt-personal",
  label: "ChatGPT",
  modelCount: 2,
  type: "chatgpt",
};

const catalog: ProviderModelOption[] = [
  {
    default: true,
    id: "model-a",
    inputPerMillionUsd: 2,
    name: "Model A",
    outputPerMillionUsd: 8,
    provider: "chatgpt",
    providerId: instance.id,
    supportsThinking: true,
    supportsVision: false,
  },
  {
    id: "model-b",
    name: "Model B",
    provider: "chatgpt",
    providerId: instance.id,
  },
  {
    id: "other-model",
    name: "Other model",
    provider: "chatgpt",
    providerId: "other-account",
  },
];

function openManage(provider: ProviderInstanceSummary) {
  let rows: ReturnType<typeof useProviderInstanceCard>["manageModels"] = [];
  function Probe() {
    const card = useProviderInstanceCard({
      catalog: catalog.map((model) => ({ ...model, provider: provider.type })),
      instance: provider,
      onDelete: async () => {},
      onError: () => {},
      onUpdate: async () => {},
    });
    if (!card.manageOpen) {
      card.openManage();
    }
    rows = card.manageModels;
    return null;
  }
  renderToString(<Probe />);
  return rows;
}

describe("provider model management", () => {
  test.each([
    ...CATALOG_SHORTLIST_PROVIDERS,
    "openrouter",
    "cerebras",
    "fireworks",
    "ollama",
    ...DISCOVERY_MODEL_PROVIDERS,
  ] as const)(
    "opens %s with its active models when no custom shortlist is saved",
    (type) => {
      const rows = openManage({ ...instance, type });
      expect(rows.map((row) => row.id)).toEqual(["model-a", "model-b"]);
      expect(rows[0]?.default).toBe(true);
      expect(rows[0]?.supportsVision).toBe(false);
      expect(rows[0]?.supportsThinking).toBe(true);
      expect(rows[0]?.inputPerMillionUsd).toBe(2);
      expect(rows[0]?.outputPerMillionUsd).toBe(8);
    }
  );

  test("keeps a saved shortlist instead of adding other catalog models", () => {
    const rows = openManage({
      ...instance,
      customModels: [
        {
          default: true,
          id: "model-b",
          name: "My model",
          supportsVision: false,
        },
      ],
    });
    expect(rows.map((row) => row.id)).toEqual(["model-b"]);
    expect(rows[0]?.name).toBe("My model");
    expect(rows[0]?.default).toBe(true);
    expect(rows[0]?.supportsVision).toBe(false);
  });
});
