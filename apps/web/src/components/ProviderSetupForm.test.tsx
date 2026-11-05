import { afterEach, beforeEach, expect, test } from "bun:test";
import type { CreateProviderRequest } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppContext } from "@/context/app-context-shared";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { useProviderSetupForm } from "@/hooks/use-provider-setup-form";
import { PROVIDER_OPTIONS } from "@/lib/models";
import { queryKeys } from "@/lib/query-keys";
import { ProviderSelect } from "./ProviderSelect";
import { ProviderSetupForm } from "./ProviderSetupForm";

let container: HTMLDivElement;

let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

async function renderForm(showModelPicker?: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={
            /* SAFETY: The form reads only isAuthenticated before anything is submitted. */
            { isAuthenticated: false } as AuthContextValue
          }
        >
          <AppContext.Provider
            value={
              /* SAFETY: createProvider is only called on submit, which this test never does. */
              {
                createProvider: () => Promise.reject(new Error("unused")),
              } as never
            }
          >
            <ProviderSetupForm showModelPicker={showModelPicker} />
          </AppContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
  );
}

// Setup keeps the provider's default model: a first-time user cannot judge
// one model name against another. Settings still lets an admin choose.
test("setup hides the model picker and Settings keeps it", async () => {
  await renderForm();
  expect(container.querySelector("#model")).not.toBeNull();

  await renderForm(false);
  expect(container.querySelector("#model")).toBeNull();
  expect(container.querySelector("#provider")).not.toBeNull();
});

test("switching to a provider with no models does not save the last provider's model", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });

  queryClient.setQueryData(queryKeys.models, {
    catalog: [
      {
        default: true,
        id: "opencode-go/kimi-k2.7-code",
        name: "Kimi",
        provider: "opencode_go",
      },
    ],
  });
  queryClient.setQueryData(queryKeys.providers, { providers: [] });

  const requests: CreateProviderRequest[] = [];
  let form: ReturnType<typeof useProviderSetupForm> | undefined;

  function Harness() {
    form = useProviderSetupForm();

    return null;
  }

  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={
            /* SAFETY: The hook reads only isAuthenticated from auth. */
            { isAuthenticated: true } as AuthContextValue
          }
        >
          <AppContext.Provider
            value={
              /* SAFETY: The hook reads only createProvider from the app context. */
              {
                createProvider: (request: CreateProviderRequest) => {
                  requests.push(request);

                  return Promise.reject(new Error("stop after capture"));
                },
              } as never
            }
          >
            <Harness />
          </AppContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
  );

  await act(async () => form?.handleProviderSelect("opencode_go"));
  expect(form?.selectedModel).toBe("opencode-go/kimi-k2.7-code");

  await act(async () => form?.handleProviderSelect("minimax"));
  await act(async () => form?.handleApiKeyChange("test-key"));
  await act(async () =>
    form?.handleSubmit(
      /* SAFETY: handleSubmit calls only preventDefault on the event. */
      { preventDefault: () => undefined } as never
    )
  );

  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ type: "minimax" });
  expect(requests[0]).not.toHaveProperty("model");

  queryClient.clear();
});

test("the provider picker lists only providers", async () => {
  await act(async () =>
    root.render(
      <ProviderSelect onValueChange={() => undefined} value="openai" />
    )
  );

  const trigger = container.querySelector("button");

  await act(async () => trigger?.click());

  expect(document.body.querySelectorAll("[cmdk-item]")).toHaveLength(
    PROVIDER_OPTIONS.length
  );
});
