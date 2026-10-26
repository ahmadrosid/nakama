import { expect, test } from "bun:test";
import type { SessionSummary } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { useRecentChatTree } from "@/components/SidebarRecentChatTree";

function Tree({ sessions }: { sessions: SessionSummary[] }) {
  const { renderTree } = useRecentChatTree(
    "profile-1",
    sessions,
    () => {},
    () => {}
  );

  return <>{renderTree(null)}</>;
}

test("a chat nested two levels deep shows beside its parent, not under it", async () => {
  // SAFETY: The tree reads only these session fields.
  const sessions = [
    { id: "root", parentSessionId: null, sortPosition: 0, title: "Root" },
    { id: "child", parentSessionId: "root", sortPosition: 1, title: "Child" },
    {
      id: "grandchild",
      parentSessionId: "child",
      sortPosition: 2,
      title: "Grandchild",
    },
  ] as SessionSummary[];

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Tree sessions={sessions} />
        </MemoryRouter>
      </QueryClientProvider>
    );
  });

  const branchOf = (title: string) =>
    [...container.querySelectorAll("a")]
      .find((link) => link.textContent === title)
      ?.closest(".group\\/branch");

  const rootBranch = branchOf("Root");
  const childBranch = branchOf("Child");
  const grandchildBranch = branchOf("Grandchild");

  expect(rootBranch?.contains(grandchildBranch ?? null)).toBe(true);
  expect(childBranch?.contains(grandchildBranch ?? null)).toBe(false);
  expect(grandchildBranch?.parentElement).toBe(
    childBranch?.parentElement ?? null
  );

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
