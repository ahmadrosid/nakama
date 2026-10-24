import { afterEach, expect, test } from "bun:test";
import type { AgentGroupMemoryChange } from "@nakama/core/agent-groups";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { queryKeys } from "@/lib/query-keys";
import { GroupMemoryPanel } from "./group-memory-panel";
import { GroupMessageMemoryChanges } from "./group-message-files";

const container = document.createElement("div");

const root = createRoot(container);

afterEach(async () => {
  await act(async () => root.render(null));
});

function NoticeAndPanel({ changes }: { changes?: AgentGroupMemoryChange[] }) {
  const [params] = useSearchParams();

  return (
    <>
      <GroupMessageMemoryChanges changes={changes} />
      {params.get("memory") === "1" ? (
        <GroupMemoryPanel
          group={{
            avatarVersion: null,
            brief: "",
            createdAt: "",
            id: "test-memory",
            lastMessage: null,
            memberIds: [],
            name: "Team",
          }}
          onClose={() => {}}
        />
      ) : null}
    </>
  );
}

test("ordered changes open memory and select only an entry that still exists", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY } },
  });

  const content = "- Keep this\n- New price";

  const changes = [
    { newEntry: "- Added then changed", oldEntry: null },
    { newEntry: "- New price", oldEntry: "- Old price" },
    { newEntry: null, oldEntry: "- Removed price" },
  ];

  client.setQueryData(queryKeys.agentGroups.memory("test-memory"), {
    content,
    limit: 4096,
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/?thread=9"]}>
          <NoticeAndPanel changes={changes} />
        </MemoryRouter>
      </QueryClientProvider>
    )
  );
  const notice = container.querySelector("details")!;
  expect(notice.open).toBe(false);
  notice.open = true;
  const rows = [...notice.querySelectorAll("li")];
  expect(rows).toHaveLength(3);
  expect(rows[0]?.textContent).toContain(changes[0]!.newEntry!);
  expect(rows[1]?.textContent).toContain(changes[1]!.oldEntry!);
  expect(rows[1]?.textContent).toContain(changes[1]!.newEntry!);
  expect(rows[2]?.textContent).toContain(changes[2]!.oldEntry!);
  await act(async () => rows[1]!.querySelector("button")!.click());
  const editor = container.querySelector("textarea")!;
  expect(editor.value).toBe(content);
  expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe(
    "- New price"
  );
  // An old or removed line must not replace current memory or throw.
  await act(async () => rows[0]!.querySelector("button")!.click());
  expect(editor.value).toBe(content);
  await act(async () => rows[2]!.querySelector("button")!.click());
  expect(editor.value).toBe(content);
  client.clear();
});

test("messages without changes have no notice", async () => {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <GroupMessageMemoryChanges />
      </MemoryRouter>
    )
  );
  expect(container.querySelector("details")).toBeNull();
});
