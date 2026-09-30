import { expect, mock, spyOn, test } from "bun:test";
import type { McpServerDetail, McpServerResponse } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { McpServerAssignList } from "@/components/McpServerAssignList";
import {
  mcpServerDetailQueryOptions,
  mcpServersQueryOptions,
  useMcpServersQuery,
} from "@/hooks/use-app-queries";
import { client } from "@/lib/client";
import { McpServersSection } from "./McpServersSection";

test("server rows reveal tools and actions inline and respect deletion and busy guards", async () => {
  const server: McpServerDetail = {
    cachedTools: [
      { description: "Search the web", inputSchema: {}, name: "web_search" },
    ],
    config: { url: "https://example.com/mcp" },
    createdAt: "2026-01-01",
    enabled: true,
    id: "search",
    lastError: null,
    name: "Search server",
    status: "connected",
    toolCount: 1,
    transport: "http",
    updatedAt: "2026-01-01",
    usesOAuth: false,
  };
  const assigned: McpServerDetail = {
    ...server,
    assignedProfileCount: 1,
    id: "assigned",
    name: "Assigned server",
    status: "needs_auth",
  };
  const queryClient = new QueryClient();
  for (const item of [server, assigned]) {
    queryClient.setQueryData(
      mcpServerDetailQueryOptions(item.id).queryKey,
      item
    );
  }
  const onEdit = mock();
  const onSync = mock();
  const onConnect = mock();
  const onDelete = mock();
  const onTestConnection = mock();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Probe({
    busy,
    syncingServerId,
  }: {
    busy: boolean;
    syncingServerId: string | null;
  }) {
    const [expandedServerId, onToggleServer] = useState<string | null>(null);
    return (
      <McpServersSection
        busy={busy}
        expandedServerId={expandedServerId}
        onAddServer={mock()}
        onConnect={onConnect}
        onDelete={onDelete}
        onEdit={onEdit}
        onSync={onSync}
        onTestConnection={onTestConnection}
        onToggleServer={onToggleServer}
        servers={[server, assigned]}
        syncingServerId={syncingServerId}
      />
    );
  }
  const render = (busy = false, syncingServerId: string | null = null) =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe busy={busy} syncingServerId={syncingServerId} />
      </QueryClientProvider>
    );
  const button = (label: string) => {
    const found = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find((item) => item.textContent?.trim() === label);
    expect(found).toBeDefined();
    return found!;
  };
  try {
    await act(async () => render());
    const rows = container.querySelectorAll<HTMLButtonElement>(
      "button[aria-expanded]"
    );
    const panel = container.querySelector<HTMLElement>("#mcp-tools-search")!;
    expect(panel.hidden).toBe(true);
    expect(container.textContent).not.toContain("web_search");
    await act(async () => rows[0]!.click());
    expect(rows[0]!.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("web_search");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    for (const [label, callback] of [
      ["Edit", onEdit],
      ["Sync tools", onSync],
      ["Test connection", onTestConnection],
    ] as const) {
      await act(async () => button(label).click());
      expect(callback).toHaveBeenCalledWith(server.id);
      expect(panel.hidden).toBe(false);
    }
    await act(async () => button("Delete").click());
    expect(onDelete).toHaveBeenCalledWith(server);
    await act(async () => render(true, server.id));
    expect(button("Syncing…").getAttribute("aria-busy")).toBe("true");
    expect(button("Syncing…").disabled).toBe(true);
    await act(async () => render(true, assigned.id));
    expect(button("Sync tools").getAttribute("aria-busy")).toBe("false");
    await act(async () => render(true));
    for (const label of ["Edit", "Sync tools", "Test connection", "Delete"]) {
      expect(button(label).disabled).toBe(true);
    }
    await act(async () => render());
    await act(async () => rows[1]!.click());
    expect(panel.hidden).toBe(true);
    expect(button("Delete").getAttribute("aria-disabled")).toBe("true");
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    const blockedDelete = button("Delete");
    const matches = blockedDelete.matches.bind(blockedDelete);
    // Happy DOM does not track keyboard :focus-visible like a browser.
    const focusVisible = spyOn(blockedDelete, "matches").mockImplementation(
      (selector) =>
        selector === ":focus-visible"
          ? document.activeElement === blockedDelete
          : matches(selector)
    );
    try {
      await act(async () => blockedDelete.focus());
    } finally {
      focusVisible.mockRestore();
    }
    expect(document.activeElement).toBe(button("Delete"));
    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(button("Delete").getAttribute("aria-describedby")).toBe(tooltip!.id);
    await act(async () => button("Delete").click());
    expect(onDelete).toHaveBeenCalledTimes(1);
    await act(async () => button("Sign in").click());
    expect(onConnect).toHaveBeenCalledWith(assigned.id);
    await act(async () => rows[1]!.click());
    expect(rows[1]!.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("web_search");
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  }
});

test("syncs an assignable server without assigning it and refreshes its tool count", async () => {
  const server: McpServerDetail = {
    cachedTools: [],
    config: { url: "https://example.com/mcp" },
    createdAt: "2026-01-01",
    enabled: true,
    id: "search",
    lastError: null,
    name: "Search server",
    status: "connected",
    toolCount: 0,
    transport: "http",
    updatedAt: "2026-01-01",
    usesOAuth: false,
  };
  const refreshed = {
    ...server,
    cachedTools: [
      { description: "New tool", inputSchema: {}, name: "new_tool" },
    ],
    toolCount: 1,
  };
  const request = Promise.withResolvers<McpServerResponse>();
  const sync = spyOn(client, "syncMcpServer").mockReturnValueOnce(
    request.promise
  );
  const list = spyOn(client, "listMcpServers").mockResolvedValue({
    servers: [refreshed],
  });
  const queryClient = new QueryClient();
  queryClient.setQueryData(mcpServersQueryOptions.queryKey, [server]);
  const onAssign = mock();
  function Probe() {
    const { data = [] } = useMcpServersQuery();
    return <McpServerAssignList onAssign={onAssign} servers={data} />;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      )
    );
    const button = container.querySelector<HTMLButtonElement>(
      '[aria-label="More actions for Search server"]'
    )!;
    await act(async () => {
      button.click();
    });
    const syncItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).find((item) => item.textContent?.includes("Sync tools"))!;
    await act(async () => {
      syncItem.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(sync).toHaveBeenCalledWith(server.id);
    expect(onAssign).not.toHaveBeenCalled();
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      request.resolve({ server: refreshed });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.textContent).toContain("http · 1 tool");
    expect(button.disabled).toBe(false);
    sync.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      button.click();
    });
    const retryItem = Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).find((item) => item.textContent?.includes("Sync tools"))!;
    await act(async () => {
      retryItem.click();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(button.disabled).toBe(false);
    expect(onAssign).not.toHaveBeenCalled();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((item) => item.textContent === "Add")!
        .click();
    });
    expect(onAssign).toHaveBeenCalledWith(server.id);
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    sync.mockRestore();
    list.mockRestore();
  }
});
