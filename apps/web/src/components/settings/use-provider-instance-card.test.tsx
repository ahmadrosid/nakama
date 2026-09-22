import { describe, expect, test } from "bun:test";
import type {
  ProviderInstanceSummary,
  ProviderModelOption,
  UpdateProviderRequest,
} from "@nakama/core/contract";
import { DISCOVERY_MODEL_PROVIDERS } from "@nakama/core/discovery-providers";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { CATALOG_SHORTLIST_PROVIDERS } from "@/components/catalog-provider-model-fields.shared";
import { ModelListEditor } from "@/components/ModelListEditor";
import { normalizeModelListRows } from "@/components/model-list-editor.shared";
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
  test("Edit keeps the last model removed until a replacement is added", async () => {
    let card: ReturnType<typeof useProviderInstanceCard>;
    const updates: UpdateProviderRequest[] = [];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Probe() {
      card = useProviderInstanceCard({
        catalog: [],
        instance: {
          ...instance,
          customModels: [{ id: "old" }],
          type: "ollama",
        },
        onDelete: async () => {},
        onError: () => {},
        onUpdate: async (_, request) => {
          updates.push(request);
        },
      });
      return (
        <ModelListEditor
          models={card.editManageModels}
          onChange={card.handleManageModelsChange}
        />
      );
    }
    try {
      await act(async () => root.render(<Probe />));
      await act(async () => card.openEdit());
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            'button[aria-label="Remove model"]'
          )!
          .click()
      );
      expect(
        container.querySelectorAll('input[placeholder="llama3.2"]')
      ).toHaveLength(0);
      await act(async () => card.saveCompatible());
      expect(updates).toEqual([]);
      expect(card!.dialogError).not.toBeNull();
      await act(async () =>
        card.handleManageModelsChange([{ id: "replacement" }])
      );
      await act(async () => card.saveCompatible());
      expect(updates).toHaveLength(1);
      expect(updates[0]?.customModels).toEqual([{ id: "replacement" }]);
      expect(card!.editOpen).toBe(false);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

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
          cachedInputPerMillionUsd: 0,
          contextWindow: 32_768,
          default: true,
          id: "model-b",
          inputPerMillionUsd: 0.25,
          maxOutputTokens: 4096,
          name: "My model",
          outputPerMillionUsd: 1.75,
          supportsThinking: true,
          supportsVision: false,
        },
      ],
    });
    expect(normalizeModelListRows(rows)).toEqual([
      {
        cachedInputPerMillionUsd: 0,
        contextWindow: 32_768,
        default: true,
        id: "model-b",
        inputPerMillionUsd: 0.25,
        maxOutputTokens: 4096,
        name: "My model",
        outputPerMillionUsd: 1.75,
        supportsThinking: true,
        supportsVision: false,
      },
    ]);
  });
});
