import { expect, mock, test } from "bun:test";
import type { SessionSummary } from "@nakama/core/contract";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { RecentChatRow } from "@/components/SidebarRecentChatRow";

test("right click on a chat opens the chat actions in place of the browser menu", async () => {
  const onTogglePin = mock(() => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter>
        <RecentChatRow
          onDelete={() => {}}
          onRename={() => {}}
          onTogglePin={onTogglePin}
          profileId="profile-1"
          // SAFETY: The row reads only these session fields.
          session={{ id: "session-1", title: "Trip plan" } as SessionSummary}
        />
      </MemoryRouter>
    );
  });

  const link = container.querySelector("a");

  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 10,
    clientY: 10,
  });

  await act(async () => {
    link?.dispatchEvent(event);
  });

  expect(event.defaultPrevented).toBe(true);

  const items = [...document.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent
  );

  expect(items).toEqual([
    "Open in new tab",
    "Copy link",
    "Rename",
    "Pin",
    "Delete",
  ]);

  const pin = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
  ].find((item) => item.textContent === "Pin");

  await act(async () => {
    pin?.click();
  });

  expect(onTogglePin).toHaveBeenCalledTimes(1);

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
