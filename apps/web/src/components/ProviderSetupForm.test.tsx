import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppContext } from "@/context/app-context-shared";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { useProviderSetupForm } from "@/hooks/use-provider-setup-form";
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
