import { expect, spyOn, test } from "bun:test";
import type {
  CreateProviderResponse,
  ProfileDetail,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import * as providerForm from "@/components/ProviderSetupForm";
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
