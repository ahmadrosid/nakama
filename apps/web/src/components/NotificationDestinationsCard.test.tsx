import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  ListNotificationDestinationsResponse,
  NotificationDestinationSummary,
  NotificationDestinationWithSecret,
  UserOrgSummary,
} from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NotificationDestinationsCard } from "@/components/NotificationDestinationsCard";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";

const ORG_A = "org-a";
const ORG_B = "org-b";

const destinationA: NotificationDestinationSummary = {
  channel: "telegram",
  createdAt: "2026-09-25T00:00:00Z",
  id: "destination-a",
  name: "Org A destination",
  telegram: { chatId: 1001, topicId: 42 },
  updatedAt: "2026-09-25T00:00:00Z",
  webhookPath: "/hooks/org-a",
};

const destinationB: NotificationDestinationSummary = {
  ...destinationA,
  id: "destination-b",
  name: "Org B destination",
  webhookPath: "/hooks/org-b",
};

const secretA: NotificationDestinationWithSecret = {
  apiKey: "org-a-secret",
  destination: destinationA,
};

function org(id: string, name: string): UserOrgSummary {
  return {
    createdAt: "2026-09-25T00:00:00Z",
    id,
    name,
    role: "admin",
    slug: id,
    updatedAt: "2026-09-25T00:00:00Z",
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

const settle = () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 20);
  return promise;
};

test("clears a one-time secret while the next organization's destinations load", async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
    },
  });
  queryClient.setQueryData(queryKeys.profiles.all, []);
  queryClient.setQueryData(queryKeys.notificationDestinations(ORG_A), {
    destinations: [destinationA],
  });

  const clientA = client.forOrg(ORG_A);
  const clientB = client.forOrg(ORG_B);
  const nextOrgDestinations =
    Promise.withResolvers<ListNotificationDestinationsResponse>();
  const listA = spyOn(
    clientA,
    "listNotificationDestinations"
  ).mockResolvedValue({
    destinations: [destinationA],
  });
  const listB = spyOn(clientB, "listNotificationDestinations").mockReturnValue(
    nextOrgDestinations.promise
  );
  const rotate = spyOn(
    clientA,
    "regenerateNotificationDestinationKey"
  ).mockResolvedValue(secretA);
  const forOrg = spyOn(client, "forOrg").mockImplementation((orgId) =>
    orgId === ORG_A ? clientA : clientB
  );

  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    forOrg.mockRestore();
    listA.mockRestore();
    listB.mockRestore();
    rotate.mockRestore();
  });

  let activeOrg = org(ORG_A, "Org A");

  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider
            value={{ activeOrg } as unknown as AuthContextValue}
          >
            <NotificationDestinationsCard />
          </AuthContext.Provider>
        </QueryClientProvider>
      );
      await settle();
    });

    const rotateButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Rotate key")
    );
    expect(rotateButton).toBeDefined();
    await act(async () => {
      rotateButton?.click();
      await settle();
    });
    expect(container.textContent).toContain("Latest webhook credentials ready");
    expect(container.textContent).toContain("Org A destination");

    activeOrg = org(ORG_B, "Org B");
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider
            value={{ activeOrg } as unknown as AuthContextValue}
          >
            <NotificationDestinationsCard />
          </AuthContext.Provider>
        </QueryClientProvider>
      );
      await settle();
    });

    expect(listB).toHaveBeenCalled();
    expect(container.textContent).not.toContain(
      "Latest webhook credentials ready"
    );
    expect(container.textContent).not.toContain("Org A destination");

    await act(async () => {
      nextOrgDestinations.resolve({ destinations: [destinationB] });
      await settle();
    });
    expect(container.textContent).toContain("Org B destination");
    expect(container.textContent).not.toContain(
      "Latest webhook credentials ready"
    );
  } finally {
    nextOrgDestinations.resolve({ destinations: [] });
  }
});
