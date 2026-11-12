import { afterEach, expect, spyOn, test } from "bun:test";
import type { RegressionCase } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { client } from "@/lib/client";
import { RegressionCasesList } from "./regression-cases";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

function regressionCase(id: string): RegressionCase {
  return {
    createdAt: "2026-11-10T00:00:00.000Z",
    createdByUserId: "u",
    expectedResult: `Expected ${id}`,
    id,
    input: `Input ${id}`,
    profileId: "p",
    source: { automationId: null, id: "s", path: "/chat/p/s", type: "session" },
  };
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50 && !check(); attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }

  expect(check()).toBe(true);
}

async function renderList() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  await act(async () => {
    root.render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <RegressionCasesList profileId="p" />
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const loadMore = () =>
    [...container.querySelectorAll("button")].find((button) =>
      ["Load more", "Retry"].includes(button.textContent ?? "")
    );

  return { container, loadMore };
}

test("a page that filters to nothing still offers the next page", async () => {
  const list = spyOn(client, "listRegressionCases")
    .mockResolvedValueOnce({ cases: [], nextOffset: 50 })
    .mockResolvedValueOnce({ cases: [regressionCase("a")], nextOffset: null });

  cleanups.push(async () => list.mockRestore());

  const { container, loadMore } = await renderList();

  await waitFor(() => Boolean(loadMore()));
  // The list layout, not the empty state
  expect(container.querySelector("ul")).not.toBeNull();

  await act(async () => loadMore()!.click());
  await waitFor(() => container.textContent?.includes("Input a") ?? false);
});

test("a failed Load more keeps the loaded cases and drops a repeated row", async () => {
  const list = spyOn(client, "listRegressionCases")
    .mockResolvedValueOnce({
      cases: [regressionCase("a"), regressionCase("b")],
      nextOffset: 2,
    })
    .mockRejectedValueOnce(new Error("network down"))
    .mockResolvedValueOnce({
      cases: [regressionCase("b"), regressionCase("c")],
      nextOffset: null,
    });

  cleanups.push(async () => list.mockRestore());

  const { container, loadMore } = await renderList();

  await waitFor(() => Boolean(loadMore()));
  await act(async () => loadMore()!.click());
  await waitFor(() => container.textContent?.includes("network down") ?? false);
  expect(container.textContent).toContain("Input b");

  await act(async () => loadMore()!.click());
  await waitFor(() => container.textContent?.includes("Input c") ?? false);
  expect(container.querySelectorAll("li")).toHaveLength(3);
});
