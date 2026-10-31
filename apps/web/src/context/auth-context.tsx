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
import {
  browserPushSupported,
  forgetThisDevicePush,
} from "@/hooks/use-web-push";
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

interface SessionState {
  orgs: UserOrgSummary[];
  platformOrgs: OrganizationSummary[];
  platformOrgsError: boolean;
  user: AuthUserResponse;
}

let mountLoad: Promise<SessionState> | null = null;

// StrictMode runs the mount effect twice; both runs share one set of requests.
function loadMountSessionState(): Promise<SessionState> {
  mountLoad ??= loadSessionState().finally(() => {
    mountLoad = null;
  });

  return mountLoad;
}

async function loadSessionState(): Promise<SessionState> {
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

function useAuthSession() {
  const [user, setUser] = useState<AuthUserResponse | null>(null);
  const [orgs, setOrgs] = useState<UserOrgSummary[]>([]);
  const [platformOrgs, setPlatformOrgs] = useState<OrganizationSummary[]>([]);
  const [platformOrgsError, setPlatformOrgsError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const authRevision = useRef(0);
  // `undefined` until the first session loads; `null` after logout.
  const sessionIdentity = useRef<string | null | undefined>(undefined);
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

  const refreshSession = useCallback(async (shareMountLoad = false) => {
    const revision = authRevision.current;
    const requestRevision = ++sessionRequestRevision.current;

    const session = await (shareMountLoad
      ? loadMountSessionState()
      : loadSessionState());

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

    // Same user and org keep their cache: the first load holds only requests
    // for this identity, and a refresh (MFA, invite) does not change tenant.
    const identity = `${session.user.id}:${session.user.activeOrgId ?? session.user.orgId ?? ""}`;
    const previous = sessionIdentity.current;
    sessionIdentity.current = identity;

    if (previous !== undefined && previous !== identity) {
      resetQueryCache();
    }
  }, []);

  useEffect(() => {
    const revision = authRevision.current;
    const requestRevision = sessionRequestRevision.current + 1;
    refreshSession(true).catch(() => {
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
    if (browserPushSupported) {
      // Before logout, while the server still knows who owns it: a signed-out
      // device must stop showing this user's replies on its lock screen.
      await navigator.serviceWorker
        .getRegistration()
        .then(forgetThisDevicePush)
        .catch(() => undefined);
    }

    // Taken after the push cleanup, so an auth change during it cannot make
    // this logout end the server session but keep the user on screen.
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
    sessionIdentity.current = null;
    resetQueryCache();
  }, []);

  return {
    activeOrg,
    authRevision,
    isLoading,
    login,
    logout,
    orgs,
    platformOrgs,
    platformOrgsError,
    refreshPlatformOrgs,
    refreshSession,
    sessionRequestRevision,
    setIsLoading,
    setOrgs,
    setPlatformOrgs,
    setUser,
    setup,
    user,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const {
    activeOrg,
    authRevision,
    sessionRequestRevision,
    user,
    setUser,
    orgs,
    setOrgs,
    platformOrgs,
    setPlatformOrgs,
    platformOrgsError,
    isLoading,
    setIsLoading,
    refreshPlatformOrgs,
    refreshSession,
    setup,
    login,
    logout,
  } = useAuthSession();

  const switchOrg = useCallback(
    async (orgId: string) => {
      const revision = ++authRevision.current;
      const nextUser = await client.setActiveOrg(orgId);

      if (revision !== authRevision.current) {
        return;
      }

      authRevision.current += 1;
      setUser(nextUser);
      setIsLoading(false);
      resetQueryCache();
    },
    [authRevision, setIsLoading, setUser]
  );

  const archiveOrg = useCallback(
    async (orgId: string) => {
      if (!canArchiveOrganization(user?.isPlatformAdmin === true)) {
        throw new Error("Only platform admins can delete organizations.");
      }

      const revision = ++authRevision.current;
      const sessionRevision = sessionRequestRevision.current;
      await client.archivePlatformOrganization(orgId);

      if (
        revision !== authRevision.current ||
        sessionRevision !== sessionRequestRevision.current
      ) {
        return;
      }

      const [{ orgs: nextOrgs }, { organizations }] = await Promise.all([
        client.listUserOrgs(),
        client.listPlatformOrganizations(),
      ]);

      if (
        revision !== authRevision.current ||
        sessionRevision !== sessionRequestRevision.current
      ) {
        return;
      }

      const nextOrgId =
        nextOrgIdAfterArchive(nextOrgs, orgId) ??
        organizations.find((org) => !org.archivedAt && org.id !== orgId)?.id;

      let nextUser: AuthUserResponse;

      if (nextOrgId) {
        nextUser = await client.setActiveOrg(nextOrgId);
      } else {
        client.setOrgId(null);
        nextUser = await client.getMe();
      }

      if (
        revision !== authRevision.current ||
        sessionRevision !== sessionRequestRevision.current
      ) {
        return;
      }

      authRevision.current += 1;
      setOrgs(nextOrgs);
      setPlatformOrgs(organizations);
      setUser(nextUser);
      setIsLoading(false);
      resetQueryCache();
    },
    [
      authRevision,
      sessionRequestRevision,
      setIsLoading,
      setOrgs,
      setPlatformOrgs,
      setUser,
      user?.isPlatformAdmin,
    ]
  );

  const createOrg = useCallback(
    async (input: { name: string; slug: string }) => {
      if (!user?.isPlatformAdmin) {
        throw new Error("Only platform admins can create organizations.");
      }

      const revision = ++authRevision.current;
      const sessionRevision = sessionRequestRevision.current;
      const created = await client.createUserOrganization(input);

      if (
        revision !== authRevision.current ||
        sessionRevision !== sessionRequestRevision.current
      ) {
        return;
      }

      const [{ orgs: nextOrgs }, nextUser] = await Promise.all([
        client.listUserOrgs(),
        client.setActiveOrg(created.organization.id),
      ]);

      if (
        revision !== authRevision.current ||
        sessionRevision !== sessionRequestRevision.current
      ) {
        return;
      }

      authRevision.current += 1;
      setOrgs(nextOrgs);
      setPlatformOrgs((current) => [...current, created.organization]);
      setUser(nextUser);
      setIsLoading(false);
      resetQueryCache();
    },
    [
      authRevision,
      sessionRequestRevision,
      setIsLoading,
      setOrgs,
      setPlatformOrgs,
      setUser,
      user?.isPlatformAdmin,
    ]
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
        // Same org, new settings: mark everything stale so the next mount
        // refetches, but refetch only the overview in place. Refetching every
        // mounted query makes the settings page flash loading states.
        void queryClient.invalidateQueries({ refetchType: "none" });
        void queryClient.invalidateQueries({
          queryKey: ["organizationOverview"],
        });
      }
    },
    [
      authRevision,
      orgs,
      platformOrgs,
      refreshPlatformOrgs,
      sessionRequestRevision,
      setOrgs,
      user?.isPlatformAdmin,
    ]
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
