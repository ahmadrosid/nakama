import { expect, mock, spyOn, test } from "bun:test";
import type { McpServerDetail } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { mcpServerDetailQueryOptions } from "@/hooks/use-app-queries";
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
