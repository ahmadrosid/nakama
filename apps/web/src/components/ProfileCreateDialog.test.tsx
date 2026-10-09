import { afterEach, expect, test } from "bun:test";
import type { ToolSummary } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ProfileCreateDialog } from "@/components/ProfileCreateDialog";

const tools: ToolSummary[] = ["read_file", "web_search", "bash"].map(
  (name, index) => ({
    description: index === 2 ? "" : `Tool ${name}`,
    handlerType: "builtin",
    id: name,
    name,
  })
);

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

test("Select all checks every tool, clears them, and marks a partial pick", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ProfileCreateDialog
          onCreated={() => {}}
          onOpenChange={() => {}}
          open
          tools={tools}
        />
      </QueryClientProvider>
    );
  });

  const trigger = () =>
    document.querySelector<HTMLButtonElement>("#btn-create-profile-tools");

  const boxes = () => [
    ...document.querySelectorAll<HTMLInputElement>(
      "#create-profile-tool-list input[type=checkbox]"
    ),
  ];

  const checkedTools = () =>
    boxes()
      .slice(1)
      .filter((box) => box.checked).length;

  const removeButtons = () =>
    document.querySelectorAll('button[aria-label^="Remove "]').length;

  expect(trigger()?.textContent).toBe("Choose tools…");

  await act(async () => {
    trigger()?.click();
  });
  expect(boxes()).toHaveLength(tools.length + 1);

  await act(async () => {
    boxes()[0]?.click();
  });
  expect(boxes()[0]?.checked).toBe(true);
  expect(checkedTools()).toBe(3);
  expect(removeButtons()).toBe(3);
  expect(trigger()?.textContent).toBe("3 of 3 tools selected");

  await act(async () => {
    boxes()[0]?.click();
  });
  expect(checkedTools()).toBe(0);
  expect(removeButtons()).toBe(0);
  expect(trigger()?.textContent).toBe("Choose tools…");

  await act(async () => {
    boxes()[2]?.click();
  });
  expect(boxes()[0]?.checked).toBe(false);
  expect(boxes()[0]?.indeterminate).toBe(true);
  expect(trigger()?.textContent).toBe("1 of 3 tools selected");
});
