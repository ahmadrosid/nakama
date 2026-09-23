import { expect, mock, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ComposerSlashSuggestion } from "@/lib/chat-composer-skills";
import { ChatSkillPicker } from "./chat-skill-picker";

test("keeps the active command visible when navigating a long list", async () => {
  const suggestions: ComposerSlashSuggestion[] = Array.from(
    { length: 20 },
    (_, index) => ({
      command: { description: "Command description", name: `command-${index}` },
      kind: "command",
    })
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onSelect = mock();
  const render = (activeIndex: number) =>
    root.render(
      <ChatSkillPicker
        activeIndex={activeIndex}
        onSelect={onSelect}
        suggestions={suggestions}
      />
    );
  const scroll = spyOn(HTMLElement.prototype, "scrollIntoView");
  try {
    await act(async () => render(0));
    scroll.mockClear();
    await act(async () => render(19));
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(scroll.mock.contexts[0]).toBe(
      container.querySelector('[aria-selected="true"]')
    );
    expect(
      container.querySelector('[aria-selected="true"]')?.textContent
    ).toContain("/command-19");
    expect(onSelect).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    scroll.mockRestore();
    container.remove();
  }
});
