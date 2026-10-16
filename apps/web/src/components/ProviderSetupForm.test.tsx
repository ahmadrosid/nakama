import { afterEach, beforeEach, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppContext } from "@/context/app-context-shared";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
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
