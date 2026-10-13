import { afterEach, expect, test } from "bun:test";
import type { SkillSummary } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AddSkillDialog } from "@/components/SkillInstallDialog";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";

const now = "2026-10-04T00:00:00Z";

const skills: SkillSummary[] = ["One", "Two", "Three"].map((name) => ({
  createdAt: now,
  createdBy: "human",
  description: `Skill ${name}`,
  disableModelInvocation: false,
  enabled: true,
  hasTool: false,
  id: name.toLowerCase(),
  name,
  orgId: "org-a",
  sourcePath: `/tmp/${name}`,
  updatedAt: now,
}));

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

test("keeps only unadded skills selected after a partial failure", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const assigned: string[] = [];
  let failSecond = true;
  let open = true;
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });

  // SAFETY: AddSkillDialog reads only user.isPlatformAdmin from this fixture.
  const auth = { user: { isPlatformAdmin: true } } as AuthContextValue;

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider value={auth}>
          <AddSkillDialog
            assignedSkillIds={new Set()}
            bashAssigned
            busy={false}
            onAssign={async (id) => {
              if (id === "two" && failSecond) {
                throw new Error("Assignment failed");
              }

              assigned.push(id);
            }}
            onAssignBash={async () => {}}
            onInstall={async () => {}}
            onOpenChange={(value) => {
              open = value;
            }}
            open
            orgId="org-a"
            profileId="profile-a"
            skills={skills}
            skillsError={null}
            skillsLoading={false}
          />
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  });

  const checkbox = (name: string) =>
    document.querySelector<HTMLInputElement>(`input[aria-label="Add ${name}"]`);

  await act(async () => {
    for (const name of ["One", "Two", "Three"]) {
      checkbox(name)?.click();
    }
  });

  const addButton = () =>
    [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add 3 skills")
    );

  await act(async () => {
    addButton()?.click();
  });

  expect(assigned).toEqual(["one"]);
  expect(open).toBe(true);
  expect(checkbox("One")?.disabled).toBe(true);
  expect(checkbox("Two")?.checked).toBe(true);
  expect(checkbox("Three")?.checked).toBe(true);
  expect(document.body.textContent).toContain("Assignment failed");

  failSecond = false;
  await act(async () => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Add 2 skills"))
      ?.click();
  });
  expect(assigned).toEqual(["one", "two", "three"]);
  expect(open).toBe(false);
});
