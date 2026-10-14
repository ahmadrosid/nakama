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

for (const operation of ["create", "archive", "archive empty"] as const) {
  for (const stage of ["mutation", "list", "selection"] as const) {
    const modes =
      stage === "selection"
        ? (["logout", "switch", "account", "current", "failure"] as const)
        : (["logout", "switch", "account", "current"] as const);

    test.each([...modes])(
      `${operation} delayed at ${stage} preserves the latest identity after %s`,
      async (mode) => {
        const user: AuthUserResponse = {
          activeOrgId: ORG_A.id,
          email: "admin@example.com",
          id: "user-a",
          isPlatformAdmin: true,
        };

        const account = {
          ...user,
          activeOrgId: ORG_B.id,
          id: "user-b",
          isPlatformAdmin: false,
        };

        const orgs: UserOrgSummary[] = [ORG_A, ORG_B].map((org) => ({
          ...org,
          createdAt: "2026-10-12T00:00:00Z",
          role: org.id === ORG_B.id ? "member" : "admin",
          updatedAt: "2026-10-12T00:00:00Z",
        }));

        const created = {
          ...orgs[0]!,
          id: "org-c",
          name: "Org C",
          slug: "org-c",
        };

        const remaining =
          operation === "create"
            ? [...orgs, created]
            : operation === "archive"
              ? [orgs[1]!]
              : [];

        const selected = {
          ...user,
          activeOrgId:
            operation === "create"
              ? created.id
              : operation === "archive"
                ? ORG_B.id
                : null,
        };

        const pendingCreate =
          Promise.withResolvers<
            Awaited<ReturnType<typeof client.createUserOrganization>>
          >();

        const pendingArchive =
          Promise.withResolvers<
            Awaited<ReturnType<typeof client.archivePlatformOrganization>>
          >();

        const pendingList =
          Promise.withResolvers<
            Awaited<ReturnType<typeof client.listUserOrgs>>
          >();

        const pendingSelection = Promise.withResolvers<AuthUserResponse>();
        const getMe = spyOn(client, "getMe").mockResolvedValue(user);

        const listUserOrgs = spyOn(client, "listUserOrgs").mockResolvedValue({
          orgs,
        });

        const platform = spyOn(
          client,
          "listPlatformOrganizations"
        ).mockResolvedValue({ organizations: orgs });

        const create = spyOn(
          client,
          "createUserOrganization"
        ).mockResolvedValue({ organization: created });

        const archive = spyOn(
          client,
          "archivePlatformOrganization"
        ).mockResolvedValue({ organization: orgs[0]! });

        const logout = spyOn(client, "logout").mockResolvedValue(undefined);

        const switchOrg = spyOn(client, "setActiveOrg").mockImplementation(
          async (orgId) => ({ ...user, activeOrgId: orgId })
        );

        let auth!: ReturnType<typeof useAuth>;

        function Probe() {
          auth = useAuth();

          return null;
        }

        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);
        let previous: Promise<void> | undefined;
        const cacheKey = queryKeys.organizationOverview("parent", ORG_B.id);

        try {
          await act(async () =>
            root.render(
              <AuthProvider>
                <Probe />
              </AuthProvider>
            )
          );
          listUserOrgs.mockResolvedValue({ orgs: remaining });
          platform.mockResolvedValue({ organizations: remaining });

          if (operation === "archive empty") {
            getMe.mockResolvedValue(selected);
          }

          if (stage === "mutation") {
            if (operation === "create") {
              create.mockImplementationOnce(() => pendingCreate.promise);
            } else {
              archive.mockImplementationOnce(() => pendingArchive.promise);
            }
          } else if (stage === "list") {
            listUserOrgs.mockImplementationOnce(() => pendingList.promise);
          } else if (operation === "archive empty") {
            getMe.mockImplementationOnce(() => pendingSelection.promise);
          } else {
            switchOrg.mockImplementationOnce(() => pendingSelection.promise);
          }

          await act(async () => {
            previous =
              operation === "create"
                ? auth.createOrg({ name: created.name, slug: created.slug })
                : auth.archiveOrg(ORG_A.id);
          });

          if (stage === "selection") {
            expect(auth.orgs).toEqual(orgs);
          }

          if (mode === "logout") {
            await act(async () => {
              await auth.logout();
            });
          } else if (mode === "switch") {
            await act(async () => {
              await auth.switchOrg(ORG_B.id);
            });
          } else if (mode === "account") {
            getMe.mockResolvedValue(account);
            listUserOrgs.mockResolvedValue({ orgs: [orgs[1]!] });
            await act(async () => {
              await auth.refreshSession();
            });
          }

          queryClient.setQueryData(cacheKey, 2);
          pendingCreate.resolve({ organization: created });
          pendingArchive.resolve({ organization: orgs[0]! });
          pendingList.resolve({ orgs: remaining });

          if (mode === "failure") {
            const error = new Error("selection unavailable");
            await act(async () => {
              pendingSelection.reject(error);
              await expect(previous).rejects.toBe(error);
            });
          } else {
            pendingSelection.resolve(selected);
            await act(async () => {
              await previous;
            });
          }

          expect(auth.user?.id).toBe(
            mode === "logout"
              ? undefined
              : mode === "account"
                ? account.id
                : user.id
          );
          expect(auth.user?.activeOrgId).toBe(
            mode === "logout"
              ? undefined
              : mode === "current"
                ? selected.activeOrgId
                : mode === "failure"
                  ? ORG_A.id
                  : ORG_B.id
          );
          expect(auth.orgs).toEqual(
            mode === "logout"
              ? []
              : mode === "account"
                ? [orgs[1]!]
                : mode === "current"
                  ? remaining
                  : orgs
          );
          expect(auth.platformOrgs).toEqual(
            mode === "logout" || mode === "account"
              ? []
              : mode === "current"
                ? remaining
                : orgs
          );
          expect(auth.isLoading).toBe(false);
          expect(queryClient.getQueryData<number>(cacheKey)).toBe(
            mode === "current" ? undefined : 2
          );
          expect(listUserOrgs).toHaveBeenCalledTimes(
            mode !== "current" && stage === "mutation"
              ? mode === "account"
                ? 2
                : 1
              : mode === "account"
                ? 3
                : 2
          );

          const selectedDuringWait =
            stage === "selection" ||
            (operation === "create" && stage === "list");

          expect(switchOrg).toHaveBeenCalledTimes(
            (mode === "switch" ? 1 : 0) +
              (operation !== "archive empty" &&
              (mode === "current" || selectedDuringWait)
                ? 1
                : 0)
          );

          if (operation === "create") {
            expect(create).toHaveBeenCalledWith({
              name: created.name,
              slug: created.slug,
            });
            expect(archive).not.toHaveBeenCalled();
          } else {
            expect(archive).toHaveBeenCalledWith(ORG_A.id);
            expect(create).not.toHaveBeenCalled();
          }
        } finally {
          pendingCreate.resolve({ organization: created });
          pendingArchive.resolve({ organization: orgs[0]! });
          pendingList.resolve({ orgs: remaining });
          pendingSelection.resolve(selected);
          await previous?.catch(() => undefined);
          await act(async () => root.unmount());
          container.remove();

          for (const request of [
            getMe,
            listUserOrgs,
            platform,
            create,
            archive,
            logout,
            switchOrg,
          ]) {
            request.mockRestore();
          }

          queryClient.clear();
          client.setOrgId(null);
        }
      }
    );
  }
}

for (const operation of [
  "platform",
  "platform failure",
  "platform update mutation",
  "platform update list",
  "platform update refresh",
  "team update mutation",
  "team update list",
] as const) {
  const modes = operation.includes("update")
    ? (["logout", "switch", "account", "current"] as const)
    : (["logout", "switch", "account", "current", "refresh"] as const);

  test.each([...modes])(
    `${operation} retains the current authentication lists after %s`,
    async (mode) => {
      const user: AuthUserResponse = {
        activeOrgId: ORG_A.id,
        email: "admin@example.com",
        id: "user-a",
        isPlatformAdmin: !operation.startsWith("team"),
      };

      const newest = {
        ...user,
        activeOrgId: ORG_B.id,
        id: "user-b",
        isPlatformAdmin: false,
      };

      const orgs: UserOrgSummary[] = [ORG_A, ORG_B].map((org) => ({
        ...org,
        createdAt: "2026-10-12T00:00:00Z",
        role: org.id === ORG_B.id ? "member" : "admin",
        updatedAt: "2026-10-12T00:00:00Z",
      }));

      const renamed = { ...orgs[0]!, name: "Updated" };
      const updatedOrgs = [renamed, orgs[1]!];

      const pendingMutation =
        Promise.withResolvers<
          Awaited<ReturnType<typeof client.updateOrganization>>
        >();

      const pendingList =
        Promise.withResolvers<
          Awaited<ReturnType<typeof client.listUserOrgs>>
        >();

      const pendingPlatform =
        Promise.withResolvers<
          Awaited<ReturnType<typeof client.listPlatformOrganizations>>
        >();

      const getMe = spyOn(client, "getMe").mockResolvedValue(user);

      const listUserOrgs = spyOn(client, "listUserOrgs").mockResolvedValue({
        orgs,
      });

      const platform = spyOn(
        client,
        "listPlatformOrganizations"
      ).mockResolvedValue({ organizations: [orgs[0]!] });

      const update = spyOn(client, "updateOrganization").mockResolvedValue({
        organization: renamed,
      });

      const platformUpdate = spyOn(
        client,
        "updatePlatformOrganization"
      ).mockResolvedValue({ organization: renamed });

      const logout = spyOn(client, "logout").mockResolvedValue(undefined);
      const switchOrg = spyOn(client, "setActiveOrg").mockResolvedValue(newest);
      let auth!: ReturnType<typeof useAuth>;

      function Probe() {
        auth = useAuth();

        return null;
      }

      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      let previous: Promise<void> | undefined;
      const error = new Error("platform unavailable");
      const cacheKey = queryKeys.organizationOverview("parent", ORG_B.id);

      try {
        await act(async () =>
          root.render(
            <AuthProvider>
              <Probe />
            </AuthProvider>
          )
        );

        if (operation.endsWith("refresh")) {
          listUserOrgs.mockResolvedValue({ orgs: updatedOrgs });
        }

        if (operation.endsWith("mutation")) {
          (user.isPlatformAdmin
            ? platformUpdate
            : update
          ).mockImplementationOnce(() => pendingMutation.promise);
        } else if (operation.endsWith("list")) {
          listUserOrgs.mockImplementationOnce(() => pendingList.promise);
        } else {
          platform.mockImplementationOnce(() => pendingPlatform.promise);
        }

        await act(async () => {
          previous = operation.includes("update")
            ? auth.updateOrg(ORG_A.id, { name: renamed.name })
            : auth.refreshPlatformOrgs();
        });

        if (mode === "logout") {
          await act(async () => {
            await auth.logout();
          });
        } else if (mode === "switch") {
          await act(async () => {
            await auth.switchOrg(ORG_B.id);
          });
        } else if (mode === "account") {
          getMe.mockResolvedValue(newest);
          listUserOrgs.mockResolvedValue({ orgs: [orgs[1]!] });
          await act(async () => {
            await auth.refreshSession();
          });
        } else if (mode === "refresh") {
          platform.mockResolvedValue({ organizations: updatedOrgs });
          await act(async () => {
            await auth.refreshPlatformOrgs();
          });
        }

        queryClient.setQueryData(cacheKey, 2);

        if (mode === "current") {
          listUserOrgs.mockResolvedValue({ orgs: updatedOrgs });
          platform.mockResolvedValue({ organizations: updatedOrgs });
        }

        pendingMutation.resolve({ organization: renamed });
        pendingList.resolve({ orgs: updatedOrgs });

        if (operation === "platform failure") {
          await act(async () => {
            pendingPlatform.reject(error);
            await expect(previous).rejects.toBe(error);
          });
        } else {
          pendingPlatform.resolve({
            organizations: mode === "refresh" ? [orgs[0]!] : updatedOrgs,
          });
          await act(async () => {
            await previous;
          });
        }

        const expectedOrgs =
          mode === "logout"
            ? []
            : mode === "account"
              ? [orgs[1]!]
              : (mode === "current" && operation.includes("update")) ||
                  operation.endsWith("refresh")
                ? updatedOrgs
                : orgs;

        expect(auth.orgs).toEqual(expectedOrgs);
        expect(auth.platformOrgs).toEqual(
          mode === "logout" || mode === "account" || !user.isPlatformAdmin
            ? []
            : mode === "refresh" ||
                (mode === "current" && operation !== "platform failure")
              ? updatedOrgs
              : [orgs[0]!]
        );
        expect(auth.platformOrgsError).toBe(
          mode === "current" && operation === "platform failure"
        );
        expect(auth.user?.id).toBe(
          mode === "logout"
            ? undefined
            : mode === "current" || mode === "refresh"
              ? user.id
              : newest.id
        );
        expect(auth.activeOrg?.id).toBe(
          mode === "logout"
            ? undefined
            : mode === "current" || mode === "refresh"
              ? ORG_A.id
              : ORG_B.id
        );
        expect(queryClient.getQueryData<number>(cacheKey)).toBe(2);

        if (operation.includes("update")) {
          expect(
            user.isPlatformAdmin ? platformUpdate : update
          ).toHaveBeenCalledWith(ORG_A.id, { name: renamed.name });
          expect(
            user.isPlatformAdmin ? update : platformUpdate
          ).not.toHaveBeenCalled();
          expect(listUserOrgs).toHaveBeenCalledTimes(
            operation.endsWith("mutation") && mode !== "current"
              ? mode === "account"
                ? 2
                : 1
              : mode === "account"
                ? 3
                : 2
          );
        }
      } finally {
        pendingMutation.resolve({ organization: renamed });
        pendingList.resolve({ orgs });
        pendingPlatform.resolve({ organizations: [] });
        await previous?.catch(() => undefined);
        await act(async () => root.unmount());
        container.remove();

        for (const request of [
          getMe,
          listUserOrgs,
          platform,
          update,
          platformUpdate,
          logout,
          switchOrg,
        ]) {
          request.mockRestore();
        }

        queryClient.clear();
        client.setOrgId(null);
      }
    }
  );
}

for (const action of ["login", "setup"] as const) {
  test.each(["logout", "switch", "login", "current"] as const)(
    `${action} cannot replace a newer authentication action: %s`,
    async (mode) => {
      const user: AuthUserResponse = {
        activeOrgId: ORG_A.id,
        email: "admin@example.com",
        id: "user-a",
        isPlatformAdmin: false,
      };

      const newest = { ...user, activeOrgId: ORG_B.id, id: "user-b" };

      const orgs: UserOrgSummary[] = [ORG_A, ORG_B].map((org) => ({
        ...org,
        createdAt: "2026-10-12T00:00:00Z",
        role: org.id === ORG_B.id ? "member" : "admin",
        updatedAt: "2026-10-12T00:00:00Z",
      }));

      const pending = Promise.withResolvers<AuthUserResponse>();
      const getMe = spyOn(client, "getMe").mockResolvedValue(user);

      const listUserOrgs = spyOn(client, "listUserOrgs").mockResolvedValue({
        orgs,
      });

      const logout = spyOn(client, "logout").mockResolvedValue(undefined);
      const switchOrg = spyOn(client, "setActiveOrg").mockResolvedValue(newest);
      const login = spyOn(client, "login").mockResolvedValue(newest);

      const setup = spyOn(client, "setupUser").mockImplementation(
        () => pending.promise
      );

      if (action === "login") {
        login.mockImplementationOnce(() => pending.promise);
      }

      let auth!: ReturnType<typeof useAuth>;

      function Probe() {
        auth = useAuth();

        return null;
      }

      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      let previous: Promise<void | AuthUserResponse> | undefined;
      const cacheKey = queryKeys.organizationOverview("parent", ORG_B.id);

      const setupRequest = {
        admin: {
          email: "admin@example.com",
          name: "Admin",
          password: "password",
        },
        organization: { name: "Org A", slug: "org-a" },
        webPublicUrl: "https://nakama.example.com",
      };

      try {
        await act(async () =>
          root.render(
            <AuthProvider>
              <Probe />
            </AuthProvider>
          )
        );
        await act(async () => {
          previous =
            action === "login"
              ? auth.login(user.email, "password", { mfaCode: "123456" })
              : auth.setup(setupRequest);
        });

        if (action === "login") {
          expect(login).toHaveBeenCalledWith(user.email, "password", {
            mfaCode: "123456",
          });
        } else {
          expect(setup).toHaveBeenCalledWith(setupRequest);
        }

        if (mode === "logout") {
          await act(async () => {
            await auth.logout();
          });
        } else if (mode === "switch") {
          await act(async () => {
            await auth.switchOrg(ORG_B.id);
          });
        } else {
          getMe.mockResolvedValue(newest);

          if (mode === "login") {
            await act(async () => {
              await auth.login(newest.email, "new-password");
            });
            getMe.mockResolvedValue(user);
          }
        }

        queryClient.setQueryData(cacheKey, 2);
        pending.resolve(user);
        await act(async () => {
          await previous;
        });

        if (action === "login") {
          expect(await previous).toEqual(user);
        }

        expect(auth.user?.id).toBe(mode === "logout" ? undefined : newest.id);
        expect(auth.activeOrg?.id).toBe(
          mode === "logout" ? undefined : ORG_B.id
        );
        expect(auth.activeOrg?.role).toBe(
          mode === "logout" ? undefined : "member"
        );
        expect(auth.isLoading).toBe(false);
        expect(getMe).toHaveBeenCalledTimes(
          mode === "current" || mode === "login" ? 2 : 1
        );
        expect(queryClient.getQueryData<number>(cacheKey)).toBe(
          mode === "current" ? undefined : 2
        );

        if (mode === "logout") {
          expect(auth.orgs).toEqual([]);
          expect(auth.platformOrgs).toEqual([]);
        }
      } finally {
        pending.resolve(user);
        await previous;
        await act(async () => root.unmount());
        container.remove();

        for (const request of [
          getMe,
          listUserOrgs,
          logout,
          switchOrg,
          login,
          setup,
        ]) {
          request.mockRestore();
        }

        queryClient.clear();
        client.setOrgId(null);
      }
    }
  );
}

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
      role: org.id === "team-c" ? "member" : "admin",
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
          mode === "read during switch" ? "admin" : "member"
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
