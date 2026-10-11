import { expect, spyOn, test } from "bun:test";
import type { AuthUserResponse, UserOrgSummary } from "@nakama/core/contract";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "@/context/auth-context";
import { useAuth } from "@/context/use-auth";
import { client } from "@/lib/client";
import { queryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

const ORG_A = { id: "org-a", name: "Org A", role: "admin", slug: "org-a" };

const ORG_B = { id: "org-b", name: "Org B", role: "admin", slug: "org-b" };

test.each([
  "initial logout",
  "initial refresh",
  "refresh logout",
  "refresh switch",
  "refresh refresh",
  "switch logout",
  "switch older first",
  "switch newer first",
  "read during switch",
] as const)(
  "authentication state keeps the latest identity: %s",
  async (mode) => {
    const user: AuthUserResponse = {
      activeOrgId: ORG_A.id,
      email: "admin@example.com",
      id: "user-a",
      isPlatformAdmin: false,
    };

    const switched = { ...user, activeOrgId: ORG_B.id };
    const newest = { ...user, activeOrgId: "team-c", id: "user-c" };

    const orgs: UserOrgSummary[] = [
      ORG_A,
      ORG_B,
      { id: "team-c", name: "Team C", slug: "team-c" },
    ].map((org) => ({
      ...org,
      createdAt: "2026-10-12T00:00:00Z",
      role: org.id === "team-c" ? "viewer" : "admin",
      updatedAt: "2026-10-12T00:00:00Z",
    }));

    const pending = Promise.withResolvers<AuthUserResponse>();
    const latest = Promise.withResolvers<AuthUserResponse>();
    const getMe = spyOn(client, "getMe").mockResolvedValue(user);

    const listUserOrgs = spyOn(client, "listUserOrgs").mockResolvedValue({
      orgs,
    });

    const logout = spyOn(client, "logout").mockResolvedValue(undefined);
    const switchOrg = spyOn(client, "setActiveOrg").mockResolvedValue(newest);

    if (mode.startsWith("initial")) {
      getMe.mockImplementationOnce(() => pending.promise);
    }

    let auth!: ReturnType<typeof useAuth>;

    function Probe() {
      auth = useAuth();

      return null;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let previous: Promise<void> | undefined;
    let next: Promise<void> | undefined;
    const cacheKey = queryKeys.organizationOverview("parent", "team-c");

    try {
      await act(async () =>
        root.render(
          <AuthProvider>
            <Probe />
          </AuthProvider>
        )
      );

      if (mode.startsWith("refresh")) {
        getMe.mockImplementationOnce(() => pending.promise);
        await act(async () => {
          previous = auth.refreshSession();
        });
      } else if (mode.startsWith("switch") || mode === "read during switch") {
        switchOrg.mockImplementationOnce(() => pending.promise);
        await act(async () => {
          previous = auth.switchOrg(ORG_B.id);
        });
      }

      if (mode.endsWith("logout")) {
        await act(async () => {
          await auth.logout();
        });
      } else if (mode.endsWith("refresh")) {
        getMe.mockResolvedValue(newest);
        await act(async () => {
          await auth.refreshSession();
        });
      } else if (mode === "refresh switch") {
        await act(async () => {
          await auth.switchOrg("team-c");
        });
      } else if (mode === "read during switch") {
        await act(async () => {
          await auth.refreshSession();
        });
        expect(auth.activeOrg?.id).toBe(ORG_A.id);
      } else {
        switchOrg.mockImplementationOnce(() => latest.promise);
        await act(async () => {
          next = auth.switchOrg("team-c");
        });

        if (mode === "switch older first") {
          pending.resolve(switched);
          await act(async () => {
            await previous;
          });
        }

        latest.resolve(newest);
        await act(async () => {
          await next;
        });
      }

      if (!mode.endsWith("logout")) {
        queryClient.setQueryData(cacheKey, 2);
      }

      pending.resolve(
        mode.startsWith("switch") || mode === "read during switch"
          ? switched
          : user
      );
      await act(async () => {
        await pending.promise;
        await previous;
      });

      const expected = mode.endsWith("logout")
        ? null
        : mode === "read during switch"
          ? switched
          : newest;

      expect(auth.user?.id).toBe(expected?.id);
      expect(auth.user?.activeOrgId).toBe(expected?.activeOrgId);
      expect(auth.isAuthenticated).toBe(Boolean(expected));
      expect(auth.isLoading).toBe(false);
      expect(queryClient.getQueryData<number>(cacheKey)).toBe(
        mode.endsWith("logout") || mode === "read during switch" ? undefined : 2
      );

      if (expected) {
        expect(auth.activeOrg?.id).toBe(expected.activeOrgId);
        expect(auth.activeOrg?.role).toBe(
          mode === "read during switch" ? "admin" : "viewer"
        );
      } else {
        expect(auth.orgs).toEqual([]);
        expect(auth.platformOrgs).toEqual([]);
      }
    } finally {
      pending.resolve(user);
      latest.resolve(newest);
      await previous;
      await next;
      await act(async () => root.unmount());
      container.remove();

      for (const request of [getMe, listUserOrgs, logout, switchOrg]) {
        request.mockRestore();
      }

      queryClient.clear();
      client.setOrgId(null);
    }
  }
);

test.each(["logout", "revoked logout", "switch", "account"] as const)(
  "%s clears shared and private queries and rejects late cache writes",
  async (mode) => {
    const user: AuthUserResponse = {
      activeOrgId: ORG_A.id,
      email: "admin@org-a.test",
      id: "user-a",
      isPlatformAdmin: false,
      orgId: ORG_A.id,
    };

    const nextUser = {
      ...user,
      activeOrgId: mode === "account" ? ORG_A.id : ORG_B.id,
      id: mode === "account" ? "user-b" : user.id,
    };

    const orgs: UserOrgSummary[] = [ORG_A, ORG_B].map((org) => ({
      ...org,
      createdAt: "2026-10-12T00:00:00Z",
      role: "admin",
      updatedAt: "2026-10-12T00:00:00Z",
    }));

    const getMe = spyOn(client, "getMe").mockResolvedValue(user);

    const listUserOrgs = spyOn(client, "listUserOrgs").mockResolvedValue({
      orgs,
    });

    const logout = spyOn(client, "logout").mockResolvedValue(undefined);
    const switchOrg = spyOn(client, "setActiveOrg").mockResolvedValue(nextUser);

    if (mode === "revoked logout") {
      logout.mockRejectedValue(new Error("Session revoked"));
    }

    let auth!: ReturnType<typeof useAuth>;

    function Probe() {
      auth = useAuth();

      return null;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    const keys = [
      queryKeys.organizationOverview("parent", ORG_A.id),
      queryKeys.organizationPublicationCatalog("parent", "agent"),
      queryKeys.orgMemory(ORG_A.id),
      queryKeys.profiles.all,
      queryKeys.notificationDestinations(ORG_A.id),
    ];

    const pending = Promise.withResolvers<number>();
    let lateRead: Promise<unknown> | undefined;

    try {
      await act(async () =>
        root.render(
          <AuthProvider>
            <Probe />
          </AuthProvider>
        )
      );
      expect(auth.user?.id).toBe(user.id);

      for (const key of keys) {
        queryClient.setQueryData(key, 1);
      }

      lateRead = queryClient
        .fetchQuery({
          queryFn: () => pending.promise,
          queryKey: keys[0],
          staleTime: 0,
        })
        .catch(() => undefined);
      expect(queryClient.getQueryState(keys[0])?.fetchStatus).toBe("fetching");

      await act(async () => {
        if (mode === "switch") {
          await auth.switchOrg(ORG_B.id);
        } else if (mode === "account") {
          getMe.mockResolvedValue(nextUser);
          await auth.refreshSession();
        } else {
          await auth.logout();
        }
      });
      expect(keys.map((key) => queryClient.getQueryData(key))).toEqual(
        keys.map(() => undefined)
      );
      expect(auth.user?.id).toBe(
        mode === "logout" || mode === "revoked logout" ? undefined : nextUser.id
      );

      if (mode === "switch" || mode === "account") {
        expect(auth.activeOrg?.id).toBe(nextUser.activeOrgId);
        queryClient.setQueryData(keys[0], 2);
      }

      pending.resolve(99);
      await act(async () => {
        await lateRead;
        await pending.promise;
      });
      expect(queryClient.getQueryData<number>(keys[0])).toBe(
        mode === "switch" || mode === "account" ? 2 : undefined
      );

      for (const key of keys.slice(1)) {
        expect(queryClient.getQueryData(key)).toBeUndefined();
      }

      if (mode === "switch") {
        expect(switchOrg).toHaveBeenCalledWith(ORG_B.id);
      } else if (mode === "account") {
        expect(getMe).toHaveBeenCalledTimes(2);
      } else {
        expect(logout).toHaveBeenCalledTimes(1);
        expect(auth.isAuthenticated).toBe(false);
      }
    } finally {
      pending.resolve(99);
      await lateRead;
      await act(async () => root.unmount());
      container.remove();

      for (const request of [getMe, listUserOrgs, logout, switchOrg]) {
        request.mockRestore();
      }

      queryClient.clear();
      client.setOrgId(null);
    }
  }
);

test("a tenant's cached data does not survive logout or an org switch", async () => {
  // SAFETY: The test controls this fixture or mock and asserts the resulting behavior.
  const getMe = spyOn(client, "getMe").mockResolvedValue({
    activeOrgId: ORG_A.id,
    email: "admin@org-a.test",
    id: "user-a",
    isPlatformAdmin: false,
    orgId: ORG_A.id,
  } as never);

  // SAFETY: The test controls this fixture or mock and asserts the resulting behavior.
  const listUserOrgs = spyOn(client, "listUserOrgs").mockResolvedValue({
    orgs: [ORG_A, ORG_B],
  } as never);

  // SAFETY: The test controls this fixture or mock and asserts the resulting behavior.
  const logout = spyOn(client, "logout").mockResolvedValue(undefined as never);

  // SAFETY: The test controls this fixture or mock and asserts the resulting behavior.
  const setActiveOrg = spyOn(client, "setActiveOrg").mockResolvedValue({
    activeOrgId: ORG_B.id,
    email: "admin@org-a.test",
    id: "user-a",
    isPlatformAdmin: false,
    orgId: ORG_A.id,
  } as never);

  let auth: ReturnType<typeof useAuth> | null = null;

  function Probe() {
    auth = useAuth();

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  // Org A's destination list: Telegram chat ids and webhook paths that org B
  // must never see, under Org A's scoped query key.
  const seedOrgA = () =>
    queryClient.setQueryData(queryKeys.notificationDestinations(ORG_A.id), [
      { id: "dest-a", name: "Org A ops", telegramChatId: "-100123" },
    ]);

  try {
    await act(async () =>
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      )
    );

    seedOrgA();
    await act(async () => {
      await auth?.logout();
    });
    expect(
      queryClient.getQueryData(queryKeys.notificationDestinations(ORG_A.id))
    ).toBeUndefined();

    seedOrgA();
    await act(async () => {
      await auth?.switchOrg(ORG_B.id);
    });
    expect(
      queryClient.getQueryData(queryKeys.notificationDestinations(ORG_A.id))
    ).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    container.remove();

    for (const spy of [getMe, listUserOrgs, logout, setActiveOrg]) {
      spy.mockRestore();
    }

    queryClient.clear();
  }
});

test("a platform admin resolves an active organization without membership", async () => {
  // SAFETY: The test controls this fixture or mock and asserts the resulting behavior.
  const getMe = spyOn(client, "getMe").mockResolvedValue({
    activeOrgId: ORG_B.id,
    email: "platform@example.com",
    id: "user-platform",
    isPlatformAdmin: true,
    orgId: ORG_B.id,
  } as never);

  // SAFETY: The test controls this fixture or mock and asserts the resulting behavior.
  const listUserOrgs = spyOn(client, "listUserOrgs").mockResolvedValue({
    orgs: [],
  } as never);

  // SAFETY: The test mock returns the organization fields used by this hook.
  const listPlatformOrganizations = spyOn(
    client,
    "listPlatformOrganizations"
  ).mockResolvedValue({
    organizations: [{ id: ORG_B.id, name: ORG_B.name, slug: ORG_B.slug }],
  } as never);

  let auth: ReturnType<typeof useAuth> | null = null;

  function Probe() {
    auth = useAuth();

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      )
    );

    const currentAuth = (): ReturnType<typeof useAuth> => {
      if (!auth) {
        throw new Error("Auth state did not load");
      }

      return auth;
    };

    expect(currentAuth().activeOrg?.id).toBe(ORG_B.id);
    expect(currentAuth().activeOrg?.role).toBeUndefined();
    expect(currentAuth().orgs).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    container.remove();

    for (const spy of [getMe, listUserOrgs, listPlatformOrganizations]) {
      spy.mockRestore();
    }
  }
});

test("required MFA does not request the protected platform list", async () => {
  // SAFETY: The test controls this fixture or mock and asserts the resulting behavior.
  const getMe = spyOn(client, "getMe").mockResolvedValue({
    activeOrgId: ORG_A.id,
    email: "platform@example.com",
    id: "user-platform",
    isPlatformAdmin: true,
    mfaEnrolled: false,
    mfaRequired: true,
  } as never);

  // SAFETY: The test controls this fixture or mock and asserts the resulting behavior.
  const listUserOrgs = spyOn(client, "listUserOrgs").mockResolvedValue({
    orgs: [ORG_A],
  } as never);

  const listPlatformOrganizations = spyOn(client, "listPlatformOrganizations");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  function Probe() {
    const auth = useAuth();

    return <span>{auth.user?.id}</span>;
  }

  try {
    await act(async () =>
      root.render(
        <AuthProvider>
          <Probe />
        </AuthProvider>
      )
    );
    expect(container.textContent).toBe("user-platform");
    expect(listPlatformOrganizations).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    container.remove();

    for (const spy of [getMe, listUserOrgs, listPlatformOrganizations]) {
      spy.mockRestore();
    }
  }
});
