import { afterEach, expect, spyOn, test } from "bun:test";
import type { ToolDetail } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { ToolPlaygroundPage } from "./ToolPlaygroundPage";

function tool(id: string): ToolDetail {
  return {
    createdAt: "",
    description: id,
    handlerConfig: {},
    handlerType: "javascript",
    id,
    name: id,
    parameters: {
      properties: { [id]: { enum: [`${id}-value`], type: "string" } },
      type: "object",
    },
    updatedAt: "",
  };
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

async function mountPlayground() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.tools.detail("alpha"), tool("alpha"));
  queryClient.setQueryData(queryKeys.tools.detail("beta"), tool("beta"));
  queryClient.setQueryData(queryKeys.profiles.all, []);
  const auth: AuthContextValue = {
    activeOrg: {
      createdAt: "",
      id: "org-one",
      name: "One",
      role: "admin",
      slug: "one",
      updatedAt: "",
    },
    archiveOrg: async () => {},
    createOrg: async () => {},
    isAuthenticated: true,
    isLoading: false,
    login: async () => ({ email: "admin@example.com", id: "admin" }),
    logout: async () => {},
    orgs: [],
    refreshSession: async () => {},
    setup: async () => {},
    switchOrg: async () => {},
    updateOrg: async () => {},
    user: { email: "admin@example.com", id: "admin", isPlatformAdmin: true },
  };
  const router = createMemoryRouter(
    [{ element: <ToolPlaygroundPage />, path: "/system/playground/:toolId" }],
    { initialEntries: ["/system/playground/alpha"] }
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const run = spyOn(client, "runTool").mockResolvedValue({ ok: false });
  const suggest = spyOn(client, "suggestToolParams").mockResolvedValue({
    parameters: {},
  });
  cleanups.push(async () => {
    await act(async () => root.unmount());
    router.dispose();
    container.remove();
    queryClient.clear();
    run.mockRestore();
    suggest.mockRestore();
  });
  const render = async (value = auth) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={value}>
            <RouterProvider router={router} />
          </AuthContext.Provider>
        </QueryClientProvider>
      )
    );
  };
  await render();
  return {
    auth,
    container,
    navigate: async (id: string) => {
      await act(async () => {
        await router.navigate(`/system/playground/${id}`);
      });
    },
    queryClient,
    render,
    run,
    suggest,
  };
}

async function edit(container: HTMLElement, selector: string, value: string) {
  const input = container.querySelector(selector) as
    | HTMLInputElement
    | HTMLTextAreaElement;
  const prototype =
    input.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
      input,
      value
    );
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function click(container: HTMLElement, text: string) {
  const button = [...container.querySelectorAll("button")].find(
    (entry) => entry.textContent?.trim() === text
  )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}

function parameters(container: HTMLElement, id: string) {
  return JSON.parse(
    (container.querySelector(`#${id}-params`) as HTMLTextAreaElement).value
  );
}

test("cached tool navigation initializes and submits the destination parameters", async () => {
  const { container, navigate, run } = await mountPlayground();
  expect(parameters(container, "alpha")).toEqual({ alpha: "alpha-value" });
  await edit(container, "#alpha-assist", "alpha-only prompt");
  await navigate("beta");
  await click(container, "Run");
  expect(run).toHaveBeenCalledWith("beta", {
    parameters: { beta: "beta-value" },
  });
  expect(parameters(container, "beta")).toEqual({ beta: "beta-value" });
  expect(
    (container.querySelector("#beta-assist") as HTMLInputElement).value
  ).toBe("");
});

test("same-tool query refresh preserves edited parameters and assist prompt", async () => {
  const { container, queryClient } = await mountPlayground();
  await edit(container, "#alpha-params", '{"draft":"keep me"}');
  await edit(container, "#alpha-assist", "keep this prompt");
  await act(async () => {
    queryClient.setQueryData(queryKeys.tools.detail("alpha"), {
      ...tool("alpha"),
      description: "Refreshed description",
      parameters: tool("beta").parameters,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(parameters(container, "alpha")).toEqual({ draft: "keep me" });
  expect(
    (container.querySelector("#alpha-assist") as HTMLInputElement).value
  ).toBe("keep this prompt");
});

test("organization identity resets the same tool's draft", async () => {
  const { auth, container, render } = await mountPlayground();
  await edit(container, "#alpha-params", '{"private":"org-one"}');
  await render({ ...auth, activeOrg: { ...auth.activeOrg!, id: "org-two" } });
  expect(parameters(container, "alpha")).toEqual({ alpha: "alpha-value" });
});

test("late run and suggestion responses cannot update a new playground session", async () => {
  const { container, navigate, run, suggest } = await mountPlayground();
  const pendingRun =
    Promise.withResolvers<Awaited<ReturnType<typeof client.runTool>>>();
  const pendingSuggestion =
    Promise.withResolvers<
      Awaited<ReturnType<typeof client.suggestToolParams>>
    >();
  run.mockReturnValueOnce(pendingRun.promise);
  suggest.mockReturnValueOnce(pendingSuggestion.promise);
  await edit(container, "#alpha-assist", "suggest alpha parameters");
  await click(container, "Suggest params");
  await click(container, "Run");
  expect(suggest).toHaveBeenCalledWith("alpha", {
    prompt: "suggest alpha parameters",
  });
  await navigate("beta");
  expect(
    (container.querySelector("#beta-params") as HTMLTextAreaElement).disabled
  ).toBe(false);
  await act(async () => {
    pendingRun.resolve({ error: "late alpha failure", ok: false });
    pendingSuggestion.resolve({ parameters: { alpha: "late suggestion" } });
  });
  expect(parameters(container, "beta")).toEqual({ beta: "beta-value" });
  expect(container.querySelector("pre")).toBeNull();
  // Returning to the same ID must create a fresh session, not revive old state.
  await navigate("alpha");
  expect(parameters(container, "alpha")).toEqual({ alpha: "alpha-value" });
  expect(container.querySelector("pre")).toBeNull();
});
