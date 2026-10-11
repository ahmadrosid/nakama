import type {
  AuthUserResponse,
  OrganizationSummary,
  PasskeyCredentialResponse,
  SetupAuthRequest,
  UpdateOrganizationRequest,
  UserOrgSummary,
} from "@nakama/core/contract";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { client } from "@/lib/client";
import {
  canArchiveOrganization,
  nextOrgIdAfterArchive,
} from "@/lib/org-archive";
import { queryClient } from "@/lib/query-client";

// Every cached payload belongs to the user and organization that fetched it, so
// an identity change drops the whole cache instead of naming tenant-scoped keys
// one at a time. Naming them is what left `notificationDestinations` behind.
// Active queries refetch at once, and no row from the previous tenant renders
// while that is in flight.
function resetQueryCache(): void {
  queryClient.clear();
}

async function loadSessionState(): Promise<{
  user: AuthUserResponse;
  orgs: UserOrgSummary[];
  platformOrgs: OrganizationSummary[];
  platformOrgsError: boolean;
}> {
  const [user, { orgs }] = await Promise.all([
    client.getMe(),
    client.listUserOrgs(),
  ]);

  if (!user.isPlatformAdmin || (user.mfaRequired && !user.mfaEnrolled)) {
    return { orgs, platformOrgs: [], platformOrgsError: false, user };
  }

  try {
    const { organizations } = await client.listPlatformOrganizations();

    return {
      orgs,
      platformOrgs: organizations,
      platformOrgsError: false,
      user,
    };
  } catch {
    return { orgs, platformOrgs: [], platformOrgsError: true, user };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUserResponse | null>(null);
  const [orgs, setOrgs] = useState<UserOrgSummary[]>([]);
  const [platformOrgs, setPlatformOrgs] = useState<OrganizationSummary[]>([]);
  const [platformOrgsError, setPlatformOrgsError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const authRevision = useRef(0);
  const sessionRequestRevision = useRef(0);
  const platformRequestRevision = useRef(0);

  const refreshPlatformOrgs = useCallback(async () => {
    const revision = authRevision.current;
    const sessionRevision = sessionRequestRevision.current;
    const requestRevision = ++platformRequestRevision.current;

    try {
      const { organizations } = await client.listPlatformOrganizations();

      if (
        revision !== authRevision.current ||
        sessionRevision !== sessionRequestRevision.current ||
        requestRevision !== platformRequestRevision.current
      ) {
        return;
      }

      setPlatformOrgs(organizations);
      setPlatformOrgsError(false);
    } catch (error) {
      if (
        revision === authRevision.current &&
        sessionRevision === sessionRequestRevision.current &&
        requestRevision === platformRequestRevision.current
      ) {
        setPlatformOrgsError(true);
      }

      throw error;
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const revision = authRevision.current;
    const requestRevision = ++sessionRequestRevision.current;
    const session = await loadSessionState();

    if (
      revision !== authRevision.current ||
      requestRevision !== sessionRequestRevision.current
    ) {
      return;
    }

    setUser(session.user);
    setOrgs(session.orgs);
    setPlatformOrgs(session.platformOrgs);
    setPlatformOrgsError(session.platformOrgsError);
    setIsLoading(false);
    resetQueryCache();
  }, []);

  useEffect(() => {
    const revision = authRevision.current;
    const requestRevision = sessionRequestRevision.current + 1;
    refreshSession().catch(() => {
      if (
        revision !== authRevision.current ||
        requestRevision !== sessionRequestRevision.current
      ) {
        return;
      }

      setUser(null);
      setOrgs([]);
      setPlatformOrgs([]);
      setPlatformOrgsError(false);
      setIsLoading(false);
    });

    return () => {
      authRevision.current += 1;
    };
  }, [refreshSession]);

  const activeOrg = useMemo(() => {
    const activeOrgId = user?.activeOrgId ?? user?.orgId ?? null;

    if (!activeOrgId) {
      return null;
    }

    return (
      orgs.find((org) => org.id === activeOrgId) ??
      platformOrgs.find((org) => org.id === activeOrgId && !org.archivedAt) ??
      null
    );
  }, [orgs, platformOrgs, user]);

  const setup = useCallback(
    async (request: SetupAuthRequest) => {
      const revision = ++authRevision.current;

      const webPublicUrl =
        request.webPublicUrl ??
        (typeof window !== "undefined" && window.location?.origin
          ? window.location.origin
          : undefined);

      await client.setupUser({
        ...request,
        // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- This optional field must stay absent when no value exists to preserve the wire payload contract.
        ...(webPublicUrl ? { webPublicUrl } : {}),
      });

      if (revision !== authRevision.current) {
        return;
      }

      authRevision.current += 1;
      await refreshSession();
    },
    [refreshSession]
  );

  const login = useCallback(
    async (
      email: string,
      password: string,
      mfa?: {
        backupCode?: string;
        mfaCode?: string;
        passkey?: PasskeyCredentialResponse;
        passkeyChallenge?: string;
      }
    ) => {
      const revision = ++authRevision.current;
      const response = await client.login(email, password, mfa);

      if (revision === authRevision.current) {
        authRevision.current += 1;
        await refreshSession();
      }

      return response;
    },
    [refreshSession]
  );

  const logout = useCallback(async () => {
    const revision = ++authRevision.current;

    try {
      await client.logout();
    } catch {
      // Session may already be revoked (e.g. after password change clears
      // cookies and revokes every browser session server-side).
    }

    if (revision !== authRevision.current) {
      return;
    }

    authRevision.current += 1;
    client.setOrgId(null);
    setUser(null);
    setOrgs([]);
    setPlatformOrgs([]);
    setPlatformOrgsError(false);
    setIsLoading(false);
    resetQueryCache();
  }, []);

  const switchOrg = useCallback(async (orgId: string) => {
    const revision = ++authRevision.current;
    const nextUser = await client.setActiveOrg(orgId);

    if (revision !== authRevision.current) {
      return;
    }

    authRevision.current += 1;
    setUser(nextUser);
    setIsLoading(false);
    resetQueryCache();
  }, []);

  const archiveOrg = useCallback(
    async (orgId: string) => {
      if (!canArchiveOrganization(user?.isPlatformAdmin === true)) {
        throw new Error("Only platform admins can delete organizations.");
      }

      await client.archivePlatformOrganization(orgId);

      const [{ orgs: nextOrgs }, { organizations }] = await Promise.all([
        client.listUserOrgs(),
        client.listPlatformOrganizations(),
      ]);

      const nextOrgId =
        nextOrgIdAfterArchive(nextOrgs, orgId) ??
        organizations.find((org) => !org.archivedAt && org.id !== orgId)?.id;

      setOrgs(nextOrgs);
      setPlatformOrgs(organizations);

      if (nextOrgId) {
        setUser(await client.setActiveOrg(nextOrgId));
      } else {
        client.setOrgId(null);
        setUser(await client.getMe());
      }

      resetQueryCache();
    },
    [user?.isPlatformAdmin]
  );

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
      setPlatformOrgs((current) => [...current, created.organization]);
      setUser(nextUser);
      resetQueryCache();
    },
    [user?.isPlatformAdmin]
  );

  const updateOrg = useCallback(
    async (orgId: string, input: UpdateOrganizationRequest) => {
      const org =
        orgs.find((entry) => entry.id === orgId) ??
        platformOrgs.find((entry) => entry.id === orgId && !entry.archivedAt);

      if (!org) {
        throw new Error("Organization not found.");
      }

      if (
        !user?.isPlatformAdmin &&
        (!("role" in org) || org.role !== "admin")
      ) {
        throw new Error("Only org admins can edit organizations.");
      }

      const revision = authRevision.current;
      const sessionRevision = sessionRequestRevision.current;

      if (user?.isPlatformAdmin) {
        await client.updatePlatformOrganization(orgId, input);
      } else {
        await client.updateOrganization(orgId, input);
      }

      if (
        revision !== authRevision.current ||
        sessionRevision !== sessionRequestRevision.current
      ) {
        return;
      }

      const { orgs: nextOrgs } = await client.listUserOrgs();

      if (
        revision !== authRevision.current ||
        sessionRevision !== sessionRequestRevision.current
      ) {
        return;
      }

      setOrgs(nextOrgs);

      if (user?.isPlatformAdmin) {
        await refreshPlatformOrgs();
      }

      if (
        revision === authRevision.current &&
        sessionRevision === sessionRequestRevision.current
      ) {
        resetQueryCache();
      }
    },
    [orgs, platformOrgs, refreshPlatformOrgs, user?.isPlatformAdmin]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      activeOrg,
      archiveOrg,
      createOrg,
      isAuthenticated: user !== null,
      isLoading,
      login,
      logout,
      orgs,
      platformOrgs,
      platformOrgsError,
      refreshPlatformOrgs,
      refreshSession,
      setup,
      switchOrg,
      updateOrg,
      user,
    }),
    [
      user,
      orgs,
      platformOrgs,
      platformOrgsError,
      refreshPlatformOrgs,
      activeOrg,
      isLoading,
      setup,
      login,
      logout,
      switchOrg,
      archiveOrg,
      createOrg,
      updateOrg,
      refreshSession,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
