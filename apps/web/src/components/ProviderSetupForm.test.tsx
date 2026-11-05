import { afterEach, beforeEach, expect, test } from "bun:test";
import type { CreateProviderRequest } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps } from "react";
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

async function renderForm(
  showModelPicker?: boolean,
  extra: Partial<ComponentProps<typeof ProviderSetupForm>> = {}
) {
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
            <ProviderSetupForm showModelPicker={showModelPicker} {...extra} />
          </AppContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
  );
}

// Setup keeps the provider's default model: a first-time user cannot judge
// one model name against another. Settings still lets an admin choose.
test("setup hides the model picker and Settings keeps it", async () => {
  // OpenAI shows its model list as one line until the user opens it.
  const modelsField = 'label[for="catalog-models-summary"]';

  await renderForm();
  expect(container.querySelector(modelsField)).not.toBeNull();

  await renderForm(false);
  expect(container.querySelector(modelsField)).toBeNull();
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

async function renderSetupHook() {
  let form!: ReturnType<typeof useProviderSetupForm>;

  function Probe() {
    form = useProviderSetupForm();

    return null;
  }

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
              /* SAFETY: Validation fails before createProvider runs. */
              {
                createProvider: () => Promise.reject(new Error("unused")),
              } as never
            }
          >
            <Probe />
          </AppContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>
    )
  );

  return () => form;
}

// SAFETY: handleSubmit reads only preventDefault from the event.
const submitEvent = { preventDefault() {} } as React.FormEvent;

test("a field error clears when the user types in that field", async () => {
  const form = await renderSetupHook();
  await act(async () => form().handleProviderSelect("openai_compatible"));
  await act(async () => form().handleSubmit(submitEvent));
  expect(form().displayNameError).not.toBeNull();
  expect(form().baseUrlError).not.toBeNull();

  await act(async () => form().handleDisplayNameChange("verify-bs"));
  await act(async () => form().handleBaseUrlChange("https://example.test/v1"));
  expect(form().displayNameError).toBeNull();
  expect(form().baseUrlError).toBeNull();
});

test("a provider change drops the last provider's model and errors", async () => {
  const form = await renderSetupHook();
  await act(async () => form().handleProviderSelect("openai_compatible"));
  await act(async () => form().handleSubmit(submitEvent));
  await act(async () => form().handleDisplayNameChange("verify-bs custom"));
  await act(async () => form().handleApiKeyChange("sk-test-invalid"));
  await act(async () => form().setSelectedModel("gemini-2.5-flash"));

  await act(async () => form().handleProviderSelect("xai_oauth"));
  expect(form().selectedModel).toBe("");
  expect(form().displayName).toBe("");
  expect(form().apiKey).toBe("");
  expect(form().modelsError).toBeNull();
  expect(form().formError).toBeNull();
});

test("submit stays on and says what is missing", async () => {
  await renderForm();

  const submit = container.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  );

  expect(submit?.disabled).toBe(false);

  const form = await renderSetupHook();
  await act(async () => form().handleSubmit(submitEvent));
  expect(form().apiKeyError).not.toBeNull();
});

test("typed work marks the form dirty", async () => {
  const form = await renderSetupHook();
  expect(form().dirty).toBe(false);

  await act(async () => form().handleApiKeyChange("sk-test"));
  expect(form().dirty).toBe(true);
});

test("the discard step replaces the footer buttons", async () => {
  let discarded = false;

  await renderForm(false, {
    discardPrompt: {
      onDiscard: () => {
        discarded = true;
      },
      onKeep: () => undefined,
    },
    onCancel: () => undefined,
  });

  const discard = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Discard"
  );

  await act(async () => discard?.click());
  expect(discarded).toBe(true);
});

test("Edit models opens the same model list as Manage", async () => {
  await renderForm();

  const edit = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === "Edit models"
  );

  await act(async () => edit?.click());
  expect(
    container.querySelector('label[for="openai-provider-models"]')
  ).not.toBeNull();
});
