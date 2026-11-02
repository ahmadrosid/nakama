import { afterEach, expect, spyOn, test } from "bun:test";
import type { ComputerSummary } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { client } from "@/lib/client";
import { ComputersCard } from "./BrowserSessionsCard";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

test("lists this account's computers and removes one on click", async () => {
  let computers: ComputerSummary[] = [
    {
      createdAt: "2026-11-01T00:00:00.000Z",
      id: "computer_1",
      lastSeenAt: null,
      name: "Ada's MacBook",
    },
  ];

  const list = spyOn(client, "listComputers").mockImplementation(async () => ({
    computers,
  }));

  const remove = spyOn(client, "removeComputer").mockImplementation(
    async (computerId) => {
      computers = computers.filter((computer) => computer.id !== computerId);
    }
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => {
    list.mockRestore();
    remove.mockRestore();
    act(() => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <ComputersCard />
      </QueryClientProvider>
    );
  });
  await settle();

  expect(container.textContent).toContain("Ada's MacBook");

  await act(async () => {
    container
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Remove Ada\'s MacBook"]'
      )
      ?.click();
  });
  await settle();
  await settle();

  expect(remove).toHaveBeenCalledWith("computer_1");
  expect(container.textContent).not.toContain("Ada's MacBook");
  expect(container.textContent).toContain("No computers");
});
