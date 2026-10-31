import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ChatMessageQueuePanel } from "@/components/chat/ChatMessageQueuePanel";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

const messages = [
  { attachmentCount: 0, id: "a", text: "use canva" },
  { attachmentCount: 2, id: "b", text: "" },
];

test("each queued message removes and sends by its id", () => {
  const removed: string[] = [];
  const sent: string[] = [];
  const container = render(
    <ChatMessageQueuePanel
      messages={messages}
      onRemove={(id) => removed.push(id)}
      onSendNow={(id) => sent.push(id)}
    />
  );

  expect(container.querySelectorAll("li")).toHaveLength(2);

  const removeButtons = container.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="Remove queued message"]'
  );
  const sendButtons = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].filter((button) => !button.hasAttribute("aria-label"));

  act(() => removeButtons[1]?.click());
  act(() => sendButtons[0]?.click());

  expect(removed).toEqual(["b"]);
  expect(sent).toEqual(["a"]);
});

test("an empty queue renders nothing", () => {
  const container = render(<ChatMessageQueuePanel messages={[]} />);

  expect(container.childElementCount).toBe(0);
});
