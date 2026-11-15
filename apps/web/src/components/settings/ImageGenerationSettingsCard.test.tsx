import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  CreateProviderRequest,
  CreateProviderResponse,
  ProviderInstanceSummary,
  ProviderModelOption,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AppContext } from "@/context/app-context-shared";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
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
  {
    createdAt: "2026-01-01T00:00:00Z",
    hasApiKey: true,
    id: "minimax",
    label: "MiniMax",
    modelCount: 1,
    type: "minimax",
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
  createProvider?: (
    request: CreateProviderRequest
  ) => Promise<CreateProviderResponse>;
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
        <AuthContext.Provider
          value={
            /* SAFETY: The add form reads only isAuthenticated from auth. */
            { isAuthenticated: false } as AuthContextValue
          }
        >
          <AppContext.Provider
            value={
              /* SAFETY: The add form reads only createProvider from the app context. */
              {
                createProvider:
                  options.createProvider ??
                  (() => Promise.reject(new Error("unused"))),
              } as never
            }
          >
            <ImageGenerationSettingsCard />
          </AppContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return container;
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
  const container = await renderCard(options);

  expect(container.querySelector('[role="note"]') !== null).toBe(note);
});

// The MiniMax provider has no saved chat models here.
test("a saved MiniMax image model shows under the MiniMax provider", async () => {
  const container = await renderCard({
    currentProviderId: "minimax",
    model: "minimax::MiniMax-H3-Image",
    providerIds: ["minimax"],
  });

  const provider = container.querySelector(
    '[aria-label="Image generation model provider"]'
  );

  const model = container.querySelector(
    '[aria-label="Image generation model model"]'
  );

  expect(provider?.textContent).toBe("MiniMax");
  expect(model?.textContent).toBe("MiniMax H3 Image");
  expect(model?.hasAttribute("disabled")).toBe(false);
});

test("picking MiniMax with no MiniMax provider adds one and saves its image model", async () => {
  const created: CreateProviderRequest[] = [];

  const container = await renderCard({
    createProvider: (request) => {
      created.push(request);

      return Promise.resolve({
        defaultProviderId: "chatgpt-plus",
        initialModel: "MiniMax-M3",
        provider: {
          createdAt: "2026-01-01T00:00:00Z",
          hasApiKey: true,
          id: "minimax-1",
          label: "MiniMax",
          modelCount: 0,
          type: "minimax",
        },
      });
    },
    currentProviderId: "chatgpt-plus",
    model: null,
    providerIds: ["chatgpt-plus"],
  });

  const save = spyOn(client, "setImageGenerationSettings").mockImplementation(
    (model) => Promise.resolve({ model })
  );

  cleanups.push(() => save.mockRestore());

  const discover = spyOn(client, "discoverModels").mockResolvedValue(
    /* SAFETY: The browse list reads only customModels from the response. */
    { customModels: [] } as never
  );

  cleanups.push(() => discover.mockRestore());

  const type = async (input: HTMLInputElement | null, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        "value"
      )?.set?.call(input, value);
      const view = input?.ownerDocument.defaultView;

      if (view) {
        input?.dispatchEvent(new view.Event("input", { bubbles: true }));
      }
    });
  };

  const trigger = container.querySelector<HTMLButtonElement>(
    '[aria-label="Image generation model provider"]'
  );

  await act(async () => trigger?.click());

  const minimax = [
    ...document.body.querySelectorAll<HTMLElement>("[cmdk-item]"),
  ].find((item) => item.textContent === "MiniMax");

  await act(async () => minimax?.click());

  const apiKey = document.body.querySelector<HTMLInputElement>("#api-key");
  expect(apiKey).not.toBeNull();

  await type(apiKey, "test-key");

  // Add needs one model for a discovery provider such as MiniMax.
  await act(async () =>
    document.body.querySelector<HTMLButtonElement>("[data-models-add]")?.click()
  );
  await type(
    document.body.querySelector<HTMLInputElement>('[aria-label="Model ID 1"]'),
    "MiniMax-M3"
  );

  await act(async () => apiKey?.form?.requestSubmit());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(created).toEqual([
    expect.objectContaining({
      apiKey: "test-key",
      model: "MiniMax-M3",
      type: "minimax",
    }),
  ]);
  expect(save).toHaveBeenCalledWith("minimax-1::MiniMax-H3-Image");
});
