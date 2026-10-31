import { afterEach, expect, spyOn, test } from "bun:test";
import type { McpRegistryServer } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { McpServerDialog } from "@/components/soul-tools/mcp-tab/McpServerDialog";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const sampleServer: McpRegistryServer = {
  description: "Search and read GitHub repositories",
  name: "github-mcp",
  remotes: [
    {
      headers: [
        {
          description: "Personal Access Token",
          isRequired: true,
          isSecret: true,
          name: "Authorization",
          value: "Bearer {token}",
        },
        {
          isRequired: true,
          name: "X-Required-Header",
          value: "fixed-value",
        },
        {
          isRequired: false,
          isSecret: false,
          name: "X-Optional-Header",
          value: "optional-value",
        },
      ],
      type: "streamable-http",
      url: "https://server.smithery.ai/@example/github/mcp",
    },
  ],
  transport: "streamable-http",
};

test("searches official registry and displays results with name, description, and transport", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const searchSpy = spyOn(client, "searchMcpRegistry").mockResolvedValue({
    servers: [sampleServer],
  });

  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    searchSpy.mockRestore();
  });

  // SAFETY: McpServerDialog reads only activeOrg and user from this fixture.
  const auth = {
    activeOrg: { id: "org-test", role: "admin" },
    user: { id: "user-test", isPlatformAdmin: true },
  } as AuthContextValue;

  await act(async () => {
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <AuthContext.Provider value={auth}>
          <McpServerDialog
            availableServers={[]}
            busy={false}
            onOpenChange={() => {}}
            onSubmit={async () => {}}
            open
          />
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  });

  const searchInput = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search apps"]'
  )!;

  expect(searchInput).not.toBeNull();

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!.call(searchInput, "github");
    searchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
  });

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

  await settle();

  expect(searchSpy).toHaveBeenCalledWith("github");

  // Verify the registry server card button is rendered
  const serverButton = document.querySelector<HTMLButtonElement>(
    'button[aria-label="Add github-mcp from registry"]'
  );

  expect(serverButton).not.toBeNull();

  await act(async () => {
    serverButton?.click();
  });

  await settle();

  // Form should now be rendered with prefilled values
  const nameInput = document.querySelector<HTMLInputElement>(
    'input[placeholder="server name"]'
  );

  expect(nameInput?.value).toBe("github-mcp");

  const urlInput = document.querySelector<HTMLInputElement>(
    'input[placeholder="https://example.com/mcp"]'
  );

  expect(urlInput?.value).toBe(
    "https://server.smithery.ai/@example/github/mcp"
  );

  // Headers: Authorization (secret with Bearer template prefix), X-Required-Header (fixed value), no optional
  const headerKeyInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[placeholder="Authorization"], input[aria-label^="Header name"]'
    )
  );

  const headerKeys = headerKeyInputs.map((i) => i.value);

  expect(headerKeys).toContain("Authorization");
  expect(headerKeys).toContain("X-Required-Header");
  expect(headerKeys).not.toContain("X-Optional-Header");

  const headerValueInputs = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[placeholder="Bearer token"], input[placeholder="Header value"], input[aria-label^="Header value"]'
    )
  );

  const headerValues = headerValueInputs.map((i) => i.value);

  expect(headerValues).toContain("Bearer ");
  expect(headerValues).toContain("fixed-value");
});

test("when user is not a platform admin, registry search is not executed and alert is hidden", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const searchSpy = spyOn(client, "searchMcpRegistry").mockResolvedValue({
    servers: [sampleServer],
  });

  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    searchSpy.mockRestore();
  });

  // Org admin without platform admin privileges
  // SAFETY: McpServerDialog reads only activeOrg and user from this fixture.
  const auth = {
    activeOrg: { id: "org-test", role: "admin" },
    user: { id: "user-test", isPlatformAdmin: false },
  } as AuthContextValue;

  await act(async () => {
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <AuthContext.Provider value={auth}>
          <McpServerDialog
            availableServers={[]}
            busy={false}
            onOpenChange={() => {}}
            onSubmit={async () => {}}
            open
          />
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  });

  const searchInput = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search apps"]'
  )!;

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!.call(searchInput, "github");
    searchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
  });

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

  await settle();

  expect(searchSpy).not.toHaveBeenCalled();
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
});

test("when registry is down, error is displayed and manual form still works", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const searchSpy = spyOn(client, "searchMcpRegistry").mockRejectedValue(
    new Error(
      "MCP registry is unavailable. Enter configuration manually instead."
    )
  );

  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    searchSpy.mockRestore();
  });

  // SAFETY: McpServerDialog reads only activeOrg and user from this fixture.
  const auth = {
    activeOrg: { id: "org-test", role: "admin" },
    user: { id: "user-test", isPlatformAdmin: true },
  } as AuthContextValue;

  await act(async () => {
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <AuthContext.Provider value={auth}>
          <McpServerDialog
            availableServers={[]}
            busy={false}
            onOpenChange={() => {}}
            onSubmit={async () => {}}
            open
          />
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  });

  const searchInput = document.querySelector<HTMLInputElement>(
    'input[aria-label="Search apps"]'
  )!;

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    )!.set!.call(searchInput, "broken-upstream");
    searchInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 350));
  });

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

  await settle();

  // Error alert should be visible
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);

  // Manual connection button still works
  const customButton = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button")
  ).find((b) => b.textContent?.includes("Add a custom connection"));

  expect(customButton).toBeDefined();

  await act(async () => {
    customButton?.click();
  });

  await settle();

  // Manual form is opened and available
  expect(
    document.querySelector('input[placeholder="https://example.com/mcp"]')
  ).not.toBeNull();
});
