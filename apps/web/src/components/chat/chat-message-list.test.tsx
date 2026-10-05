import { expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@/context/theme-context";
import type { ChatListItem } from "@/lib/chat-history";
import { type MessageTurn, turnKey } from "@/lib/chat-message-turns";

mock.module("react-virtuoso", () => ({
  Virtuoso: ({
    data,
    itemContent,
  }: {
    data: MessageTurn[];
    itemContent: (index: number, item: MessageTurn) => React.ReactNode;
  }) => (
    <div>
      {data.map((item, index) => (
        <div key={turnKey(item)}>{itemContent(index, item)}</div>
      ))}
    </div>
  ),
}));

const { ChatMessageList } = await import("./chat-message-list");

test("history loading keeps tool activity collapsed", async () => {
  const messages: ChatListItem[] = [
    { content: "Run a tool", id: "user", role: "user" },
    {
      content: "",
      id: "tool",
      role: "tool",
      tool: "bash",
      toolStatus: "done",
    },
    { content: "Done", id: "reply", role: "assistant" },
  ];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();
  const expanded = async (options: {
    key?: string;
    sessionId?: string;
    workStreamActive?: boolean;
  }) => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ChatMessageList
              key={options.key}
              messages={messages}
              sessionId={options.sessionId}
              streamActive
              workStreamActive={options.workStreamActive}
            />
          </ThemeProvider>
        </QueryClientProvider>
      );
    });
    return container
      .querySelector('[aria-label="Toggle activity"]')
      ?.getAttribute("aria-expanded");
  };

  try {
    expect(await expanded({})).toBe("false");
    expect(await expanded({ key: "history", workStreamActive: false })).toBe(
      "false"
    );
    expect(await expanded({ key: "history", workStreamActive: true })).toBe(
      "false"
    );
    expect(
      await expanded({
        key: "history",
        sessionId: "next-chat",
        workStreamActive: false,
      })
    ).toBe("false");
  } finally {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  }
});
