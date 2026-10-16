import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { OrgMemberSummary } from "@nakama/core/contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OrgMembersTable } from "./org-members-table";

const member = (
  userId: string,
  disabledAt: string | null
): OrgMemberSummary => ({
  createdAt: "2026-10-01T00:00:00Z",
  disabledAt,
  email: `${userId}@example.com`,
  name: userId,
  phone: null,
  role: "member",
  userId,
});

const active = member("active", null);

const locked = member("locked", "2026-10-15T00:00:00Z");

let container: HTMLDivElement;

let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(onToggleDisabled?: (entry: OrgMemberSummary) => void) {
  await act(async () =>
    root.render(
      <OrgMembersTable
        isLoading={false}
        members={[active, locked]}
        onEdit={() => {}}
        onRemove={() => {}}
        onToggleDisabled={onToggleDisabled}
        removePending={false}
        updatePending={false}
      />
    )
  );
}

async function openActions(name: string) {
  const trigger = container.querySelector<HTMLButtonElement>(
    `[aria-label="Actions for ${name}"]`
  );

  // Same opening sequence as OrganizationPanel.test.tsx: the menu mounts its
  // items in a portal after the click settles.
  await act(async () => {
    trigger?.focus();
    trigger?.click();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

const item = (label: string) =>
  document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`);

test("a platform admin can disable an active account and enable a disabled one", async () => {
  const onToggleDisabled = mock((_entry: OrgMemberSummary) => {});
  await render(onToggleDisabled);

  expect(container.textContent).toContain("Disabled");

  await openActions("active");
  expect(item("Disable active")?.textContent).toBe("Disable");

  await act(async () => item("Disable active")?.click());
  expect(onToggleDisabled).toHaveBeenCalledWith(active);

  await openActions("locked");
  expect(item("Enable locked")?.textContent).toBe("Enable");
});

test("without the handler there is no disable action", async () => {
  await render();

  await openActions("active");
  expect(item("Edit active")).not.toBeNull();
  expect(item("Disable active")).toBeNull();
});
