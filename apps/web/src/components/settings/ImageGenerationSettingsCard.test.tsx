import { expect, spyOn, test } from "bun:test";
import type {
  ImageGenerationSettings,
  ModelsResponse,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const { createRoot } = await import("react-dom/client");
const { ImageGenerationSettingsCard } = await import(
  "./ImageGenerationSettingsCard"
);

const gatewayOnly: ModelsResponse = {
  currentProviderId: "p-gateway",
  displayName: null,
  models: [
    {
      id: "cb/gpt-image-2",
      name: "GPT Image 2 (gateway)",
      provider: "openai_compatible",
      providerId: "p-gateway",
      providerLabel: "Gateway",
    },
  ],
  provider: "openai_compatible",
  providers: [],
};

async function mountCard(models: ModelsResponse) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(queryKeys.models, models);
  queryClient.setQueryData<ImageGenerationSettings>(
    queryKeys.imageGenerationSettings,
    { model: null }
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ImageGenerationSettingsCard />
      </QueryClientProvider>
    );
  });
  return async () => {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
  };
}

function trigger() {
  const element = document.querySelector<HTMLButtonElement>(
    '[aria-label="Image generation model"]'
  );
  if (!element) {
    throw new Error("Missing image generation model select");
  }
  return element;
}

test("a custom model on an OpenAI-compatible provider is listed and saved as <providerId>::<modelId>", async () => {
  const save = spyOn(client, "setImageGenerationSettings").mockResolvedValue({
    model: "p-gateway::cb/gpt-image-2",
  });
  const cleanup = await mountCard(gatewayOnly);
  try {
    expect(trigger().disabled).toBe(false);
    await act(async () => trigger().click());
    const option = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((element) =>
      element.textContent?.includes("Gateway: GPT Image 2 (gateway)")
    );
    if (!option) {
      throw new Error("Missing gateway image model option");
    }
    await act(async () => option.click());
    await act(async () => {
      await Bun.sleep(10);
    });
    expect(save).toHaveBeenCalledWith("p-gateway::cb/gpt-image-2");
    expect(trigger().textContent).toContain("GPT Image 2 (gateway)");
  } finally {
    save.mockRestore();
    await cleanup();
  }
});

test("without an OpenAI or OpenAI-compatible provider the select stays disabled", async () => {
  const cleanup = await mountCard({
    ...gatewayOnly,
    models: [
      {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        provider: "anthropic",
        providerId: "p-anthropic",
      },
    ],
  });
  try {
    expect(trigger().disabled).toBe(true);
    expect(trigger().textContent).toContain("No image provider");
  } finally {
    await cleanup();
  }
});
