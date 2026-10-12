import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
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
