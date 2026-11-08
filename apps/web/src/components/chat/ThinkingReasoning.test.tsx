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

test("one finished tool call names its target in the activity header", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <AssistantTurnSegmentView
          segment={{
            active: false,
            kind: "work",
            tools: [
              {
                content: "",
                id: "tool",
                role: "tool",
                tool: "read_file",
                toolInput: { path: "uploads/verify-bs-inventory.xls" },
                toolStatus: "done",
              },
            ],
          }}
        />
      )
    );

    const header = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle activity"]'
    );

    expect(header?.textContent).toContain("verify-bs-inventory.xls");
  } finally {
    await act(async () => root.unmount());
  }
});

test("an opened one-step header shows the tool output without a second tool row", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <AssistantTurnSegmentView
          segment={{
            active: false,
            kind: "work",
            tools: [
              {
                content: "",
                id: "tool",
                role: "tool",
                tool: "bash",
                toolInput: { command: "date" },
                toolResult: { exitCode: 0, stdout: "Sun Nov 8 2026" },
                toolStatus: "done",
              },
            ],
          }}
        />
      )
    );

    const header = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle activity"]'
    );

    await act(async () => header?.click());

    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Sun Nov 8 2026");
    expect(container.querySelectorAll("button[aria-expanded]").length).toBe(1);
  } finally {
    await act(async () => root.unmount());
  }
});

test("a one-step document read names the file from the tool result", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <AssistantTurnSegmentView
          segment={{
            active: false,
            kind: "work",
            tools: [
              {
                content: "",
                id: "tool",
                role: "tool",
                tool: "extract_document_text",
                toolInput: { attachmentId: "att_123" },
                toolResult: { filename: "inventory.csv", text: "rows" },
                toolStatus: "done",
              },
            ],
          }}
        />
      )
    );

    const header = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle activity"]'
    );

    expect(header?.textContent).toContain("inventory.csv");
    expect(header?.textContent).not.toContain("att_123");
  } finally {
    await act(async () => root.unmount());
  }
});
