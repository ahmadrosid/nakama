import { afterEach, expect, spyOn, test } from "bun:test";
import type { SkillSummary } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AddSkillDialog } from "@/components/SkillInstallDialog";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";

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

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider
          value={{ user: { isPlatformAdmin: true } } as AuthContextValue}
        >
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

test("BrowserOS Neo saves its CDP port without a port entry", async () => {
  using _profile = spyOn(client, "getProfile").mockResolvedValue({
    profile: { agentBrowserCdpPort: null, agentBrowserMode: "managed" },
  } as never);
  using _status = spyOn(client, "getAgentBrowserStatus").mockResolvedValue({
    installed: true,
    ready: true,
    version: "agent-browser 0.38.1",
  } as never);
  using _test = spyOn(client, "testAgentBrowserCdp").mockResolvedValue({
    message: "Browser connection works.",
    ok: true,
  });
  using save = spyOn(client, "updateProfile").mockResolvedValue({} as never);
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
        <AuthContext.Provider
          value={{ user: { isPlatformAdmin: true } } as AuthContextValue}
        >
          <AddSkillDialog
            assignedSkillIds={new Set()}
            bashAssigned
            busy={false}
            onAssign={async () => {}}
            onAssignBash={async () => {}}
            onInstall={async () => {}}
            onOpenChange={() => {}}
            open
            orgId="org-a"
            profileId="profile-a"
            skills={[{ ...skills[0], id: "browser", name: "agent-browser" }]}
            skillsError={null}
            skillsLoading={false}
          />
        </AuthContext.Provider>
      </QueryClientProvider>
    );
  });

  const connection = document.querySelector<HTMLElement>("#agent-browser-mode");
  expect(connection).not.toBeNull();
  await act(async () => {
    connection?.click();
  });
  await act(async () => {
    [...document.querySelectorAll<HTMLElement>("[role=option]")]
      .find((option) => option.textContent?.includes("BrowserOS Neo"))
      ?.click();
  });
  expect(document.querySelector("#agent-browser-port")).toBeNull();

  const button = (label: string) =>
    [...document.querySelectorAll("button")].find(
      (item) => item.textContent === label
    );
  await act(async () => button("Test connection")?.click());
  expect(_test).toHaveBeenCalledWith(49_337);
  await act(async () => button("Save connection")?.click());
  expect(save).toHaveBeenCalledWith("profile-a", {
    agentBrowserCdpPort: 49_337,
    agentBrowserMode: "local_cdp",
  });
});
