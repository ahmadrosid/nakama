import { expect, spyOn, test } from "bun:test";
import type {
  CreateProviderRequest,
  CreateProviderResponse,
  ProfileDetail,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import * as providerForm from "@/components/ProviderSetupForm";
import { AppContext } from "@/context/app-context-shared";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { useProviderSetupForm } from "@/hooks/use-provider-setup-form";
import { client } from "@/lib/client";
import { SetupStepProvider } from "./SetupStepProvider";

const result: CreateProviderResponse = {
  defaultProviderId: "another-provider",
  initialModel: "chosen-model",
  provider: {
    createdAt: "2026-01-01",
    hasApiKey: true,
    id: "selected-provider",
    label: "OpenAI",
    modelCount: 1,
    type: "openai",
  },
};

function profile(
  id: string,
  isDefault: boolean,
  isSuper: boolean
): ProfileDetail {
  return {
    createdAt: "2026-01-01",
    hasAvatar: false,
    id,
    isDefault,
    isSuper,
    mcpServerCount: 0,
    mcpServers: [],
    model: null,
    name: id,
    skills: [],
    soulActive: false,
    systemPrompt: "",
    toolCount: 0,
    tools: [],
    updatedAt: "2026-01-01",
  };
}

test.each([false, true])(
  "setup assigns the selected model before advancing (update failure: %s)",
  async (fail) => {
    const profiles = [
      profile("org-default", true, false),
      profile("org-super", false, true),
      profile("other", false, false),
    ];
    let onSuccess: ((value: CreateProviderResponse) => void) | undefined;
    const form = spyOn(providerForm, "ProviderSetupForm").mockImplementation(
      (props) => {
        onSuccess = props.onSuccess;
        return <div />;
      }
    );
    const list = spyOn(client, "listProfiles").mockResolvedValue({ profiles });
    const updates: string[] = [];
    const update = spyOn(client, "updateProfile").mockImplementation(
      async (id, input) => {
        expect(input.model).toBe("selected-provider::chosen-model");
        updates.push(id);
        if (fail && id === "org-super") {
          throw new Error("Save failed");
        }
        return {
          profile: {
            ...profiles.find((entry) => entry.id === id)!,
            model: input.model ?? null,
          },
        };
      }
    );
    let advanced = false;
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    try {
      renderToString(
        <QueryClientProvider client={queryClient}>
          <SetupStepProvider
            onNext={() => {
              expect(updates).toEqual(["org-default", "org-super"]);
              advanced = true;
            }}
          />
        </QueryClientProvider>
      );
      expect(onSuccess).toBeDefined();
      onSuccess!(result);
      await new Promise((resolve) => setImmediate(resolve));
      expect(updates).toEqual(["org-default", "org-super"]);
      expect(advanced).toBe(!fail);
    } finally {
      form.mockRestore();
      list.mockRestore();
      update.mockRestore();
      queryClient.clear();
    }
  }
);

test("saving ChatGPT retains only the signed-in account's discovered models", async () => {
  const requests: CreateProviderRequest[] = [];
  const queryClient = new QueryClient();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let form: ReturnType<typeof useProviderSetupForm>;

  function Probe() {
    form = useProviderSetupForm();
    return (
      <form onSubmit={(event) => void form.handleSubmit(event)}>
        <output>{form.selectedModel}</output>
        <button type="submit">Save</button>
      </form>
    );
  }

  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider
            value={{ isAuthenticated: false } as AuthContextValue}
          >
            <AppContext.Provider
              value={{
                configureProvider: async () => {
                  throw new Error("Not used in this test");
                },
                createProvider: async (request) => {
                  requests.push(request);
                  return result;
                },
                error: null,
                health: null,
                loading: false,
                models: null,
              }}
            >
              <Probe />
            </AppContext.Provider>
          </AuthContext.Provider>
        </QueryClientProvider>
      )
    );
    await act(async () => {
      form.handleProviderSelect("chatgpt");
      form.setChatgptOAuth({
        accessToken: "access",
        accountId: "acct_1",
        expiresAt: "2026-01-01T01:00:00.000Z",
        refreshToken: "refresh",
      });
      form.handleSubscriptionModelsChange([
        { id: "gpt-6-sol", name: "GPT-6 Sol" },
        { id: "gpt-6-luna", name: "GPT-6 Luna" },
      ]);
    });
    await act(async () => form.setSelectedModel("gpt-6-luna"));
    expect(container.querySelector("output")?.textContent).toBe("gpt-6-luna");
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new window.Event("submit", { bubbles: true, cancelable: true })
        );
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.type).toBe("chatgpt");
    expect(requests[0]?.customModels).toEqual([
      {
        default: false,
        id: "gpt-6-sol",
        name: "GPT-6 Sol",
        supportsVision: true,
      },
      {
        default: true,
        id: "gpt-6-luna",
        name: "GPT-6 Luna",
        supportsVision: true,
      },
    ]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
  }
});
