import { afterEach, expect, spyOn, test } from "bun:test";
import type { AgentGroupMemoryChange } from "@nakama/core/agent-groups";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { client as apiClient } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { GroupMemoryPanel } from "./group-memory-panel";
import { GroupMessageMemoryChanges } from "./group-message-files";

const container = document.createElement("div");

const root = createRoot(container);

afterEach(async () => {
  await act(async () => root.render(null));
});

function NoticeAndPanel({
  changes,
  groupId = "test-memory",
}: {
  changes?: AgentGroupMemoryChange[];
  groupId?: string;
}) {
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
            handles: {},
            id: groupId,
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

  const read = spyOn(apiClient, "getAgentGroupMemory").mockResolvedValue({
    content,
    limit: 4096,
  });

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
        <MemoryRouter initialEntries={["/groups/test-memory?thread=9"]}>
          <Routes>
            <Route
              element={<NoticeAndPanel changes={changes} />}
              path="/groups/:groupId"
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  );
  expect(container.querySelectorAll("li")).toHaveLength(1);

  const toggle = container.querySelector<HTMLButtonElement>(
    "button[aria-expanded]"
  )!;

  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const rows = [...container.querySelectorAll("li")];
  expect(rows).toHaveLength(3);
  // Rows show each line without its markdown list marker.
  const text = (entry: string | null) => entry!.replace(/^- /, "");
  expect(rows[0]?.textContent).toContain(text(changes[0]!.newEntry));
  expect(rows[0]?.textContent).not.toContain(changes[0]!.newEntry!);
  expect(rows[1]?.textContent).toContain(text(changes[1]!.oldEntry));
  expect(rows[1]?.textContent).toContain(text(changes[1]!.newEntry));
  expect(rows[2]?.textContent).toContain(text(changes[2]!.oldEntry));
  await act(async () => rows[1]!.querySelector("button")!.click());
  const editor = container.querySelector("textarea")!;
  expect(editor.value).toBe(content);
  expect(editor.value.slice(editor.selectionStart, editor.selectionEnd)).toBe(
    "- New price"
  );

  // Missing and removed entries must clear a previous entry's selection.
  for (const index of [0, 2]) {
    await act(async () => rows[1]!.querySelector("button")!.click());
    await act(async () => rows[index]!.querySelector("button")!.click());
    expect(editor.value).toBe(content);
    expect(editor.selectionStart).toBe(editor.selectionEnd);
  }

  const setValue = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value"
  )?.set;

  await act(async () => {
    setValue?.call(editor, "- Unsaved draft");
    editor.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  expect(
    container.querySelector<HTMLButtonElement>("#btn-save-group-memory")
      ?.disabled
  ).toBe(false);
  editor.setSelectionRange(2, 9);
  read.mockResolvedValue({ content: "- Agent changed memory", limit: 4096 });

  for (const index of [1, 0, 2]) {
    await act(async () => rows[index]!.querySelector("button")!.click());
    await act(async () => {
      await Bun.sleep(20);
    });
    expect(editor.value).toBe("- Unsaved draft");
    expect(editor.selectionStart).toBe(2);
    expect(editor.selectionEnd).toBe(9);
  }

  client.clear();
  read.mockRestore();
});

test("opening a notice refreshes an open panel, including repeated clicks", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  let content = "- Original fact";

  const read = spyOn(apiClient, "getAgentGroupMemory").mockImplementation(
    async () => ({ content, limit: 4096 })
  );

  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/groups/refresh-memory?memory=1"]}>
            <Routes>
              <Route
                element={
                  <NoticeAndPanel
                    changes={[{ newEntry: "- Added fact", oldEntry: null }]}
                    groupId="refresh-memory"
                  />
                }
                path="/groups/:groupId"
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      )
    );
    await act(async () => {
      await Bun.sleep(20);
    });
    const editor = container.querySelector("textarea")!;
    expect(editor.value).toBe(content);

    for (const next of [
      "- Original fact\n- Added fact",
      "- Original fact",
      "- Added fact",
    ]) {
      content = next;
      await act(async () =>
        container.querySelector<HTMLButtonElement>("li button")!.click()
      );
      await act(async () => {
        await Bun.sleep(20);
      });
      expect(editor.value).toBe(content);
      expect(
        editor.value.slice(editor.selectionStart, editor.selectionEnd)
      ).toBe(content.includes("- Added fact") ? "- Added fact" : "");
    }
  } finally {
    await act(async () => root.render(null));
    client.clear();
    read.mockRestore();
  }
});

test("messages without changes have no notice", async () => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <GroupMessageMemoryChanges />
        </MemoryRouter>
      </QueryClientProvider>
    )
  );
  expect(container.innerHTML).toBe("");
});
