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

test("reads or writes in a row collapse into one row that opens to the file names", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  const file = (tool: string, id: string, path: string) => ({
    content: "",
    id,
    role: "tool" as const,
    tool,
    toolInput: { path },
    toolResult: { output: "ok" },
    toolStatus: "done" as const,
  });

  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <AssistantTurnSegmentView
              segment={{
                active: true,
                kind: "work",
                tools: [
                  file("read_file", "r1", "plugin/ui.jsx"),
                  file("read_file", "r2", "plugin/ui.css"),
                  {
                    content: "",
                    id: "b1",
                    role: "tool",
                    tool: "bash",
                    toolInput: { command: "ls" },
                    toolResult: { output: "ok" },
                    toolStatus: "done",
                  },
                  file("read_file", "r3", "BUILD.md"),
                  file("write_file", "w1", "plugin/001.sql"),
                  file("write_file", "w2", "plugin/ui.css"),
                ],
              }}
            />
          </MemoryRouter>
        </QueryClientProvider>
      )
    );

    const buttons = () =>
      [...container.querySelectorAll("button")].map((b) => b.textContent);

    expect(buttons()).toContain("Read 2 files");
    expect(buttons()).toContain("Read BUILD.md");
    expect(buttons()).toContain("Wrote 2 files");
    expect(buttons()).not.toContain("ui.jsx");

    const group = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Read 2 files"
    );

    await act(async () => group?.click());

    expect(buttons()).toContain("ui.jsx");
    expect(buttons()).toContain("ui.css");
  } finally {
    act(() => root.unmount());
  }
});
