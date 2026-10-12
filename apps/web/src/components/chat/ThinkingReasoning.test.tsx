import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AssistantTurnSegmentView } from "./assistant-tool-group";
import { ThinkingReasoning } from "./ThinkingReasoning";

test("activity opens when tools arrive and keeps the user's later choice", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  const render = (toolCount: number) => (
    <ThinkingReasoning
      isThinkingStreaming={false}
      isWorkActive
      text="Planning the work"
      toolCount={toolCount}
    >
      {toolCount > 0 ? <div>Read file</div> : null}
    </ThinkingReasoning>
  );

  try {
    await act(async () => root.render(render(0)));

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle activity"]'
    );

    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => toggle?.click());
    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => root.render(render(1)));
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => root.render(render(2)));
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  } finally {
    await act(async () => root.unmount());
  }
});

for (const withThinking of [false, true]) {
  test(`tool activity follows streaming with reasoning ${withThinking}`, async () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    const render = (active: boolean) => (
      <AssistantTurnSegmentView
        segment={{
          active,
          kind: "work",
          thinking: withThinking
            ? {
                content: "",
                id: "thinking",
                role: "assistant",
                thinking: "Planning the work",
              }
            : undefined,
          tools: [
            {
              content: "",
              id: "tool",
              role: "tool",
              tool: "read_file",
              toolStatus: active ? "running" : "done",
            },
          ],
        }}
      />
    );

    const toggle = () =>
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Toggle activity"]'
      );

    try {
      await act(async () => root.render(render(false)));
      expect(toggle()?.getAttribute("aria-expanded")).toBe("false");

      await act(async () => root.render(render(true)));
      expect(toggle()?.getAttribute("aria-expanded")).toBe("true");

      await act(async () => toggle()?.click());
      await act(async () => root.render(render(true)));
      expect(toggle()?.getAttribute("aria-expanded")).toBe("false");

      await act(async () => toggle()?.click());
      expect(toggle()?.getAttribute("aria-expanded")).toBe("true");

      await act(async () => root.render(render(false)));
      expect(toggle()?.getAttribute("aria-expanded")).toBe("false");

      await act(async () => toggle()?.click());
      await act(async () => root.render(render(false)));
      expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    } finally {
      await act(async () => root.unmount());
    }
  });
}
