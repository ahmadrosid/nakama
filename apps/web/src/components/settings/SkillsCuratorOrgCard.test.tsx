import { expect, spyOn, test } from "bun:test";
import type {
  SkillCuratorLatestResponse,
  SkillCuratorRunResult,
  UserOrgSummary,
} from "@nakama/core/contract";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { SkillsCuratorOrgCard } from "./SkillsCuratorOrgCard";

const orgA = "org-a";
const orgB = "org-b";

const latestA = Promise.withResolvers<SkillCuratorLatestResponse>();
const latestB = Promise.withResolvers<SkillCuratorLatestResponse>();
const pollingB = Promise.withResolvers<{ pollIntervalMinutes: number }>();

const resultA: SkillCuratorRunResult = {
  archived: 23,
  consolidateApplied: 8,
  consolidateDeslopified: 7,
  consolidateMerged: 6,
  consolidateStaged: 5,
  dryRun: false,
  finishedAt: "2026-09-24T12:00:00.000Z",
  orgId: orgA,
  restoreMisses: [],
  scanned: 101,
  skippedAutomation: 4,
  skippedBundled: 3,
  skippedError: 2,
  skippedTooNew: 1,
  stale: 17,
  startedAt: "2026-09-24T11:59:00.000Z",
  status: "completed",
  trigger: "manual",
};

function organization(id: string): UserOrgSummary {
  return {
    createdAt: "2026-09-01T00:00:00.000Z",
    id,
    name: id,
    role: "admin",
    slug: id,
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

function auth(orgId: string): AuthContextValue {
  return {
    activeOrg: organization(orgId),
    archiveOrg: async () => undefined,
    createOrg: async () => undefined,
    isAuthenticated: true,
    isLoading: false,
    login: async () => {
      throw new Error("Not implemented");
    },
    logout: async () => undefined,
    orgs: [organization(orgA), organization(orgB)],
    refreshSession: async () => undefined,
    setup: async () => undefined,
    switchOrg: async () => undefined,
    updateOrg: async () => undefined,
    user: {
      email: "admin@example.com",
      id: "admin",
      isPlatformAdmin: true,
    },
  };
}

test("late org A details cannot render under org B after org B loading fails", async () => {
  const loadLatest = spyOn(client, "getOrgSkillCuratorLatest");
  loadLatest.mockImplementation((orgId) =>
    orgId === orgA ? latestA.promise : latestB.promise
  );
  const loadPolling = spyOn(client, "getAutomationWorkerSettings");
  loadPolling
    .mockResolvedValueOnce({ pollIntervalMinutes: 11 })
    .mockReturnValueOnce(pollingB.promise);

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const renderOrg = async (orgId: string) => {
    await act(async () => {
      root.render(
        <AuthContext.Provider value={auth(orgId)}>
          <SkillsCuratorOrgCard />
        </AuthContext.Provider>
      );
      await Bun.sleep(10);
    });
  };

  try {
    await renderOrg(orgA);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Automation worker poll interval minutes"]'
      )?.value
    ).toBe("11");

    await renderOrg(orgB);
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Automation worker poll interval minutes"]'
      )?.value
    ).toBe("5");

    await act(async () => {
      latestB.reject(new Error("Org B latest failed"));
      pollingB.reject(new Error("Org B polling failed"));
      await Bun.sleep(10);
    });
    expect(
      container.querySelector<HTMLInputElement>(
        '[aria-label="Automation worker poll interval minutes"]'
      )?.value
    ).toBe("5");

    await act(async () => {
      latestA.resolve({ lastRunAt: resultA.finishedAt, result: resultA });
      await Bun.sleep(10);
    });
    expect(container.textContent).not.toContain("Stale 17 · Archived 23");
    expect(container.textContent).toContain("Last run Never");
    expect(loadLatest).toHaveBeenCalledWith(orgA);
    expect(loadLatest).toHaveBeenCalledWith(orgB);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    loadLatest.mockRestore();
    loadPolling.mockRestore();
  }
});
