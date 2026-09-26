import { expect, spyOn, test } from "bun:test";
import type { OrgLlmQuotaStatusResponse } from "@nakama/core/contract";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { OrgLlmQuotaCard } from "./OrgLlmQuotaCard";

const quotaA: OrgLlmQuotaStatusResponse = {
  month: "org-a-month",
  status: "ok",
  tokenLimit: 10_000,
  tokens: 100,
  turnLimit: 1000,
  turns: 10,
  warningPercent: 80,
};

const auth = {
  activeOrg: {
    createdAt: "2026-09-25T00:00:00Z",
    id: "org-a",
    name: "Org A",
    role: "admin",
    slug: "org-a",
    updatedAt: "2026-09-25T00:00:00Z",
  },
  isAuthenticated: true,
  isLoading: false,
  orgs: [],
  user: { email: "admin@example.com", id: "admin", isPlatformAdmin: false },
} as unknown as AuthContextValue;

test("switching orgs removes old usage and ignores its deferred response", async () => {
  let resolveLateA: ((quota: OrgLlmQuotaStatusResponse) => void) | undefined;
  const lateA = new Promise<OrgLlmQuotaStatusResponse>((resolve) => {
    resolveLateA = resolve;
  });
  let rejectB: ((reason: unknown) => void) | undefined;
  const pendingB = new Promise<OrgLlmQuotaStatusResponse>((_, reject) => {
    rejectB = reject;
  });
  let requestsA = 0;
  const getQuota = spyOn(
    client,
    "getOrganizationLlmQuotaStatus"
  ).mockImplementation(async (orgId) => {
    if (orgId === "org-a") {
      requestsA += 1;
      return requestsA === 1 ? quotaA : lateA;
    }
    return pendingB;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const renderOrg = async (id: string) => {
    await act(async () => {
      root.render(
        <AuthContext.Provider
          value={{
            ...auth,
            activeOrg: { ...auth.activeOrg!, id, name: id },
          }}
        >
          <OrgLlmQuotaCard />
        </AuthContext.Provider>
      );
      await Bun.sleep(0);
    });
  };

  try {
    await act(async () => {
      root.render(
        <AuthContext.Provider value={{ ...auth, activeOrg: null }}>
          <OrgLlmQuotaCard />
        </AuthContext.Provider>
      );
    });
    expect(container.childElementCount).toBe(0);
    expect(getQuota).not.toHaveBeenCalled();

    await renderOrg("org-a");
    expect(container.textContent).toContain(quotaA.month);

    // A new provider value for the same org starts another request. Its deferred
    // response must not become visible after switching to org B.
    await renderOrg("org-a");
    await renderOrg("org-b");
    expect(requestsA).toBe(2);
    expect(getQuota).toHaveBeenCalledWith("org-b");
    expect(container.textContent).toContain("Loading usage…");
    expect(container.textContent).not.toContain(quotaA.month);

    await act(async () => {
      rejectB?.(new Error("Org B quota unavailable"));
      await pendingB.catch(() => undefined);
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Org B quota unavailable"
    );
    expect(container.textContent).not.toContain(quotaA.month);

    await act(async () => {
      resolveLateA?.({ ...quotaA, month: "late-org-a-month" });
      await lateA;
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Org B quota unavailable"
    );
    expect(container.textContent).not.toContain("late-org-a-month");
  } finally {
    resolveLateA?.(quotaA);
    rejectB?.(new Error("cleanup"));
    await act(async () => root.unmount());
    container.remove();
    getQuota.mockRestore();
  }
});
