import { expect, test } from "bun:test";
import type {
  UpdateOrganizationRequest,
  UserOrgSummary,
} from "@nakama/core/contract";
import { TooltipProvider } from "@nakama/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { queryKeys } from "@/lib/query-keys";
import { OrgMembersCard } from "./OrgMembersCard";

function organization(id: string, domains: string[]): UserOrgSummary {
  return {
    allowedInviteDomains: domains,
    createdAt: "2026-09-28T00:00:00Z",
    id,
    name: id,
    role: "admin",
    slug: id,
    updatedAt: "2026-09-28T00:00:00Z",
  };
}

test("admin sees saved, refreshed, and switched invite-domain policies", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  const saved: Array<{ orgId: string; request: UpdateOrganizationRequest }> =
    [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const renderOrg = async (org: UserOrgSummary) => {
    queryClient.setQueryData(queryKeys.orgMembers(org.id), { members: [] });
    const auth = {
      activeOrg: org,
      isAuthenticated: true,
      isLoading: false,
      orgs: [org],
      updateOrg: async (orgId: string, request: UpdateOrganizationRequest) => {
        saved.push({ orgId, request });
      },
      user: { email: "admin@example.com", id: "admin", isPlatformAdmin: false },
    } as AuthContextValue;
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <MemoryRouter>
              <TooltipProvider>
                <OrgMembersCard />
              </TooltipProvider>
            </MemoryRouter>
          </AuthContext.Provider>
        </QueryClientProvider>
      );
    });
  };

  try {
    await renderOrg(organization("org-a", ["acme.com"]));
    const input = container.querySelector<HTMLInputElement>(
      "#allowed-invite-domains"
    );
    expect(input?.value).toBe("acme.com");
    expect(
      container.querySelector('label[for="allowed-invite-domains"]')
        ?.textContent
    ).toBe("Allowed invite domains");

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      )?.set?.call(input, "acme.com, partner.example");
      input?.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const save = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Save domains"
    );
    await act(async () => save?.click());
    expect(saved).toEqual([
      {
        orgId: "org-a",
        request: { allowedInviteDomains: ["acme.com", "partner.example"] },
      },
    ]);

    await renderOrg(organization("org-a", ["acme.com", "partner.example"]));
    expect(
      container.querySelector<HTMLInputElement>("#allowed-invite-domains")
        ?.value
    ).toBe("acme.com, partner.example");

    await renderOrg(organization("org-a", ["new.example"]));
    expect(
      container.querySelector<HTMLInputElement>("#allowed-invite-domains")
        ?.value
    ).toBe("new.example");

    await renderOrg(organization("org-b", ["beta.example"]));
    expect(
      container.querySelector<HTMLInputElement>("#allowed-invite-domains")
        ?.value
    ).toBe("beta.example");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
  }
});
