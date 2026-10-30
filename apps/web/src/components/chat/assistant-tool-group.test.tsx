import { afterEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { client } from "@/lib/client";
import { AssistantTurnSegmentView } from "./assistant-tool-group";

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of spies.splice(0)) {
    spy.mockRestore();
  }
});

test("a background sub_agent row links its chat and shows when it finished", async () => {
  const statusSpy = spyOn(client, "getSessionStatus").mockResolvedValue({
    active: false,
  });

  spies.push(statusSpy);

  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <AssistantTurnSegmentView
              profileId="p1"
              segment={{
                active: false,
                kind: "work",
                tools: [
                  {
                    content: "",
                    id: "tool",
                    role: "tool",
                    tool: "sub_agent",
                    toolInput: { background: true, task: "Research pricing" },
                    toolResult: {
                      output: "Started in a new chat.",
                      sessionId: "child-1",
                      status: "success",
                      summary: "Started in a new chat.",
                    },
                    toolStatus: "done",
                  },
                ],
              }}
            />
          </MemoryRouter>
        </QueryClientProvider>
      )
    );

    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="/chat/p1/child-1"]'
    );

    expect(link?.textContent).toContain("Open chat");
    expect(statusSpy).toHaveBeenCalledWith("child-1");

    // The status query resolves after the first render.
    for (
      let i = 0;
      i < 20 && !container.textContent?.includes("Finished");
      i++
    ) {
      await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
    }

    expect(container.textContent).toContain("Finished");
  } finally {
    await act(async () => root.unmount());
  }
});
