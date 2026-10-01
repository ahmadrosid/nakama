import { expect, test } from "bun:test";
import type { AutomationRunRecord } from "@nakama/core/contract";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RunHistoryList } from "./automations-components";

test("keeps the run conversation mounted until the drawer finishes closing", async () => {
  const run: AutomationRunRecord = {
    automationId: "automation",
    completedAt: "2026-10-01T00:01:00Z",
    error: null,
    id: "run",
    output: null,
    startedAt: "2026-10-01T00:00:00Z",
    status: "completed",
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const original = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "getAnimations"
  );
  const closing = Promise.withResolvers<void>();
  let animating = false;
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => (animating ? [{ finished: closing.promise }] : []),
  });
  try {
    await act(async () => {
      root.render(
        <RunHistoryList
          busy={false}
          onDeleteRun={() => {}}
          onRerun={() => {}}
          profileId="profile"
          running={false}
          runs={[run]}
        />
      );
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-haspopup="dialog"]'
    )!;
    await act(async () => {
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const conversation = document.querySelector('[role="dialog"] [role="log"]');
    expect(conversation).not.toBeNull();
    animating = true;
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Close run conversation"]'
        )!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(document.querySelector('[role="dialog"] [role="log"]')).toBe(
      conversation
    );
    await act(async () => {
      animating = false;
      closing.resolve();
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => {
      trigger.click();
    });
    expect(
      document.querySelector('[role="dialog"] [role="log"]')
    ).not.toBeNull();
  } finally {
    closing.resolve();
    await act(async () => root.unmount());
    container.remove();
    if (original) {
      Object.defineProperty(Element.prototype, "getAnimations", original);
    } else {
      Reflect.deleteProperty(Element.prototype, "getAnimations");
    }
  }
});
