import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  ProviderInstanceSummary,
  ProviderModelOption,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { client } from "@/lib/client";
import { IMAGE_GENERATION_SELECTION } from "@/lib/models";
import { ImageGenerationSettingsCard } from "./ImageGenerationSettingsCard";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function chatgpt(id: string, plan: string): ProviderInstanceSummary {
  return {
    chatgptPlanType: plan,
    createdAt: "2026-01-01T00:00:00Z",
    hasApiKey: true,
    id,
    label: id,
    modelCount: 1,
    type: "chatgpt",
  };
}

const providers: ProviderInstanceSummary[] = [
  chatgpt("chatgpt-free", "free"),
  chatgpt("chatgpt-free-2", "free"),
  chatgpt("chatgpt-plus", "plus"),
  {
    createdAt: "2026-01-01T00:00:00Z",
    hasApiKey: true,
    id: "openai",
    label: "OpenAI",
    modelCount: 1,
    type: "openai",
  },
];

const models: ProviderModelOption[] = [
  ...["chatgpt-free", "chatgpt-free-2", "chatgpt-plus"].map((providerId) => ({
    default: true,
    id: "gpt-5",
    name: "GPT-5",
    provider: "chatgpt" as const,
    providerId,
  })),
  { id: "gpt-5", name: "GPT-5", provider: "openai", providerId: "openai" },
];

async function renderCard(options: {
  currentProviderId: string | null;
  model: string | null;
  /** A saved-model request that never ends or fails. */
  request?: "pending" | "failed";
  providerIds: readonly string[];
}) {
  const shown = providers.filter((provider) =>
    options.providerIds.includes(provider.id)
  );

  const getModels = spyOn(client, "getModels").mockResolvedValue({
    currentProviderId: options.currentProviderId,
    displayName: null,
    models: models.filter((model) =>
      options.providerIds.includes(model.providerId ?? "")
    ),
    provider: null,
    providers: shown,
  });

  const getSettings = spyOn(
    client,
    "getImageGenerationSettings"
  ).mockImplementation(() => {
    if (options.request === "pending") {
      return new Promise<never>(() => undefined);
    }

    return options.request === "failed"
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({ model: options.model });
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    getModels.mockRestore();
    getSettings.mockRestore();
    act(() => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ImageGenerationSettingsCard />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return container.querySelector('[role="note"]') !== null;
}

test.each([
  {
    currentProviderId: null,
    model: null,
    name: "automatic pick on a Free account",
    note: true,
    providerIds: ["chatgpt-free"],
  },
  {
    currentProviderId: null,
    model: null,
    name: "automatic pick when every ChatGPT account is Free",
    note: true,
    providerIds: ["chatgpt-free", "chatgpt-free-2"],
  },
  {
    currentProviderId: null,
    model: null,
    name: "automatic pick on a Plus account",
    note: false,
    providerIds: ["chatgpt-plus"],
  },
  {
    currentProviderId: "chatgpt-free",
    model: null,
    name: "automatic pick skips a Free default when Plus is connected",
    note: false,
    providerIds: ["chatgpt-free", "chatgpt-plus"],
  },
  {
    currentProviderId: "chatgpt-free",
    model: "chatgpt-plus::gpt-5",
    name: "explicit Plus pick with a Free default",
    note: false,
    providerIds: ["chatgpt-free", "chatgpt-plus"],
  },
  {
    currentProviderId: "chatgpt-plus",
    model: "chatgpt-free::gpt-5",
    name: "explicit Free pick",
    note: true,
    providerIds: ["chatgpt-free", "chatgpt-plus"],
  },
  {
    currentProviderId: "chatgpt-free",
    model: IMAGE_GENERATION_SELECTION,
    name: "OpenAI pick with a Free account connected",
    note: false,
    providerIds: ["chatgpt-free", "openai"],
  },
  {
    currentProviderId: "chatgpt-free",
    model: "off",
    name: "image generation off with a Free account connected",
    note: false,
    providerIds: ["chatgpt-free"],
  },
  {
    currentProviderId: "chatgpt-free",
    model: "chatgpt-plus::gpt-5",
    name: "saved model still loading",
    note: false,
    providerIds: ["chatgpt-free"],
    request: "pending" as const,
  },
  {
    currentProviderId: "chatgpt-free",
    model: "chatgpt-plus::gpt-5",
    name: "saved model failed to load",
    note: false,
    providerIds: ["chatgpt-free"],
    request: "failed" as const,
  },
])("Free plan note: $name", async ({ note, ...options }) => {
  expect(await renderCard(options)).toBe(note);
});
