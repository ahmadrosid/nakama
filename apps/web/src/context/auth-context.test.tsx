import { expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "@/context/auth-context";
import { useAuth } from "@/context/use-auth";
import { client } from "@/lib/client";
import { queryClient } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

const ORG_A = { id: "org-a", name: "Org A", role: "admin", slug: "org-a" };

const ORG_B = { id: "org-b", name: "Org B", role: "admin", slug: "org-b" };

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
