import { expect, test } from "bun:test";
import type {
  CreateMcpServerRequest,
  McpServerDetail,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { mcpServerDetailQueryOptions } from "@/hooks/use-app-queries";
import { useMcpServerDialogState } from "./use-mcp-server-dialog-state";

test.each(["http", "stdio"] as const)(
  "editing %s sends explicit clears without dropping retained secret keys",
  async (transport) => {
    const server: McpServerDetail = {
      cachedTools: [],
      config:
        transport === "stdio"
          ? { args: ["--verbose"], command: "demo", env: { TOKEN: "••••••••" } }
          : {
              headers: { Authorization: "••••••••" },
              url: "https://example.com/mcp",
            },
      createdAt: "2026-01-01",
      enabled: true,
      id: "server",
      lastError: null,
      name: "Demo",
      status: "disconnected",
      toolCount: 0,
      transport,
      updatedAt: "2026-01-01",
      usesOAuth: false,
    };
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      mcpServerDetailQueryOptions(server.id).queryKey,
      server
    );
    const requests: CreateMcpServerRequest[] = [];
    let state: ReturnType<typeof useMcpServerDialogState>;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    function Probe({ open, editing }: { open: boolean; editing: boolean }) {
      state = useMcpServerDialogState({
        busy: false,
        onSubmit: async (request) => {
          requests.push(JSON.parse(JSON.stringify(request)));
        },
        open,
        server: editing ? server : null,
      });
      return <form onSubmit={state.handleSubmit} />;
    }
    const render = (open: boolean, editing = true) =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <Probe editing={editing} open={open} />
        </QueryClientProvider>
      );
    const submit = () =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new window.Event("submit", { bubbles: true, cancelable: true })
        );
    try {
      await act(async () => render(false));
      await act(async () => render(true));
      await act(async () => {
        submit();
      });
      expect(requests[0]?.config).toEqual(
        transport === "stdio"
          ? { args: ["--verbose"], command: "demo", env: { TOKEN: "" } }
          : { headers: { Authorization: "" }, url: "https://example.com/mcp" }
      );
      await act(async () => {
        state.setArgs([]);
        state.setEnv([{ key: " ", value: "" }]);
        state.setHeaders([{ key: " ", value: "" }]);
      });
      await act(async () => {
        submit();
      });
      expect(requests[1]?.config).toEqual(
        transport === "stdio"
          ? { args: [], command: "demo", env: {} }
          : { headers: {}, url: "https://example.com/mcp" }
      );
      if (transport === "http") {
        await act(async () => state.selectKind("signin"));
        await act(async () => {
          submit();
        });
        expect(requests.at(-1)?.config).toEqual({
          url: "https://example.com/mcp",
        });
      }
      // Creation still omits optional empty fields.
      await act(async () => render(false, false));
      await act(async () => render(true, false));
      await act(async () => {
        state.setName("New");
        state.selectKind(transport);
        if (transport === "stdio") {
          state.setCommand("new-command");
        } else {
          state.setUrl("https://example.com/new");
        }
      });
      await act(async () => {
        submit();
      });
      expect(requests.at(-1)?.config).toEqual(
        transport === "stdio"
          ? { command: "new-command" }
          : { url: "https://example.com/new" }
      );
      if (transport === "http") {
        await act(async () => {
          state.setHeaders([{ key: "Authorization", value: "unused" }]);
          state.selectKind("signin");
        });
        await act(async () => {
          submit();
        });
        expect(requests.at(-1)?.config).toEqual({
          url: "https://example.com/new",
        });
      }
      expect(requests).toHaveLength(transport === "http" ? 5 : 3);
    } finally {
      await act(async () => root.unmount());
      queryClient.clear();
      container.remove();
    }
  }
);
