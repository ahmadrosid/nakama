import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { client } from "@/lib/client";
import { queryClient } from "@/lib/query-client";
import type { SetupAuthRequest, UserOrgSummary, AuthUserResponse } from "@nakama/core/contract";
import { AuthContext, type AuthContextValue } from "@/context/auth-context-shared";

function refreshAuthenticatedQueries(): void {
  void queryClient.invalidateQueries();
}

async function loadSessionState(): Promise<{
  user: AuthUserResponse;
  orgs: UserOrgSummary[];
}> {
  const [user, { orgs }] = await Promise.all([client.getMe(), client.listUserOrgs()]);
  return { user, orgs };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserResponse | null>(null);
  const [orgs, setOrgs] = useState<UserOrgSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    const session = await loadSessionState();
    setUser(session.user);
    setOrgs(session.orgs);
    refreshAuthenticatedQueries();
  }, []);

  useEffect(() => {
    loadSessionState()
      .then((session) => {
        setUser(session.user);
        setOrgs(session.orgs);
        refreshAuthenticatedQueries();
      })
      .catch(() => {
        setUser(null);
        setOrgs([]);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const activeOrg = useMemo(() => {
    const activeOrgId = user?.activeOrgId ?? user?.orgId ?? null;
    if (!activeOrgId) {
      return null;
    }

    return orgs.find((org) => org.id === activeOrgId) ?? null;
  }, [orgs, user]);

  const setup = useCallback(async (request: SetupAuthRequest) => {
    const webPublicUrl =
      request.webPublicUrl ??
      (typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : undefined);

    await client.setupUser({
      ...request,
      ...(webPublicUrl ? { webPublicUrl } : {}),
    });
    await refreshSession();
  }, [refreshSession]);

  const login = useCallback(async (email: string, password: string) => {
    await client.login(email, password);
    await refreshSession();
  }, [refreshSession]);

  const logout = useCallback(async () => {
    await client.logout();
    client.setOrgId(null);
    setUser(null);
    setOrgs([]);
  }, []);

  const switchOrg = useCallback(async (orgId: string) => {
    const nextUser = await client.setActiveOrg(orgId);
    setUser(nextUser);
    refreshAuthenticatedQueries();
  }, []);

  const createOrg = useCallback(
    async (input: { name: string; slug: string }) => {
      if (!user?.isPlatformAdmin) {
        throw new Error("Only platform admins can create organizations.");
      }

      const created = await client.createUserOrganization(input);
      const [{ orgs: nextOrgs }, nextUser] = await Promise.all([
        client.listUserOrgs(),
        client.setActiveOrg(created.organization.id),
      ]);
      setOrgs(nextOrgs);
      setUser(nextUser);
      refreshAuthenticatedQueries();
    },
    [user?.isPlatformAdmin],
  );

  const updateOrg = useCallback(
    async (orgId: string, input: { name: string }) => {
      const org = orgs.find((entry) => entry.id === orgId);
      if (!org) {
        throw new Error("Organization not found.");
      }

      if (!user?.isPlatformAdmin && org.role !== "admin") {
        throw new Error("Only org admins can edit organizations.");
      }

      if (user?.isPlatformAdmin) {
        await client.updatePlatformOrganization(orgId, input);
      } else {
        await client.updateOrganization(orgId, input);
      }

      const { orgs: nextOrgs } = await client.listUserOrgs();
      setOrgs(nextOrgs);
      refreshAuthenticatedQueries();
    },
    [orgs, user?.isPlatformAdmin],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      orgs,
      activeOrg,
      isAuthenticated: user !== null,
      isLoading,
      setup,
      login,
      logout,
      switchOrg,
      createOrg,
      updateOrg,
      refreshSession,
    }),
    [
      user,
      orgs,
      activeOrg,
      isLoading,
      setup,
      login,
      logout,
      switchOrg,
      createOrg,
      updateOrg,
      refreshSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
