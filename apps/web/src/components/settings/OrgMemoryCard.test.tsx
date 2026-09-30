import { expect, spyOn, test } from "bun:test";
import type { UserOrgSummary } from "@nakama/core/contract";
import { TooltipProvider } from "@nakama/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { OrgMemoryCard } from "./OrgMemoryCard";

const ORG_A = "org-a";
const ORG_B = "org-b";
const MEMORY_A = "## Org Memory\n\nSaved for A";
const MEMORY_B = "## Org Memory\n\nSaved for B";
const DRAFT_B = "## Org Memory\n\nDraft for B";

function organization(id: string, name: string): UserOrgSummary {
  return {
    createdAt: "2026-01-01T00:00:00Z",
    id,
    name,
    role: "admin",
    slug: id,
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function authFor(org: UserOrgSummary): AuthContextValue {
  return {
    activeOrg: org,
    archiveOrg: async () => {},
    createOrg: async () => {},
    isAuthenticated: true,
    isLoading: false,
    login: async () => {
      throw new Error("Not used");
    },
    logout: async () => {},
    orgs: [org],
    refreshSession: async () => {},
    setup: async () => {},
    switchOrg: async () => {},
    updateOrg: async () => {},
    user: { email: "admin@example.com", id: "admin", isPlatformAdmin: false },
  };
}

const settle = () => Bun.sleep(20);

async function renderOrg(
  root: Root,
  queryClient: QueryClient,
  org: UserOrgSummary
) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authFor(org)}>
          <MemoryRouter>
            <TooltipProvider>
              <OrgMemoryCard />
            </TooltipProvider>
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>
    );
    await settle();
  });
}

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const element = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text
  );
  if (!element) {
    throw new Error(`Missing button: ${text}`);
  }
  return element;
}

function textarea(): HTMLTextAreaElement {
  const element = document.querySelector<HTMLTextAreaElement>("textarea");
  if (!element) {
    throw new Error("Missing org memory editor");
  }
  return element;
}

async function edit(value: string) {
  const editor = textarea();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    )?.set?.call(editor, value);
    editor.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

test("an org A draft and error cannot be submitted after rerendering for org B", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(queryKeys.orgMemory(ORG_A), { content: MEMORY_A });
  queryClient.setQueryData(queryKeys.orgMemory(ORG_B), { content: MEMORY_B });
  for (const orgId of [ORG_A, ORG_B]) {
    queryClient.setQueryData(queryKeys.orgMemoryProposals(orgId, "pending"), {
      pendingCount: 0,
      proposals: [],
    });
  }

  const update = spyOn(client, "updateOrgMemory").mockResolvedValue({
    content: DRAFT_B,
  });
  const get = spyOn(client, "getOrgMemory").mockImplementation(
    async (orgId) => ({
      content: orgId === ORG_A ? MEMORY_A : MEMORY_B,
    })
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await renderOrg(root, queryClient, organization(ORG_A, "Org A"));

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Edit org memory"]')
        ?.click();
      await settle();
    });
    expect(textarea().value).toBe(MEMORY_A);
    await edit(`Org A draft ${"x".repeat(256_001)}`);
    await act(async () => {
      button(document.body, "Save").click();
    });
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    const staleSave = button(document.body, "Save");

    await renderOrg(root, queryClient, organization(ORG_B, "Org B"));

    expect(document.querySelector("textarea")).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(staleSave.isConnected).toBe(false);
    await act(async () => staleSave.click());
    expect(update).not.toHaveBeenCalled();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="Edit org memory"]')
        ?.click();
      await settle();
    });
    expect(textarea().value).toBe(MEMORY_B);
    await edit(DRAFT_B);
    await act(async () => {
      button(document.body, "Save").click();
      await settle();
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(ORG_B, { content: DRAFT_B });
  } finally {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    update.mockRestore();
    get.mockRestore();
  }
});
