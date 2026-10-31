import type {
  ListComposioToolkitsResponse,
  UpdateComposioSettingsRequest,
  UpdateProfileComposioToolkitsRequest,
} from "@nakama/core/contract";
import { toast } from "@nakama/ui/toast";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { client } from "@/lib/client";
import { invalidateQueries } from "@/lib/query-client";
import { queryKeys } from "@/lib/query-keys";

/**
 * Composio OAuth connect links are hosted on composio.dev (and subdomains such
 * as backend.composio.dev). Reject anything else before assigning location.href.
 */
export function isAllowedComposioRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    if (parsed.protocol !== "https:") {
      return false;
    }

    const host = parsed.hostname.toLowerCase();

    return host === "composio.dev" || host.endsWith(".composio.dev");
  } catch {
    return false;
  }
}

const composioSettingsQueryOptions = queryOptions({
  queryFn: () => client.getComposioSettings(),
  queryKey: queryKeys.composio.settings,
});

export function useComposioSettings() {
  return useQuery(composioSettingsQueryOptions);
}

export function useSaveComposioSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: UpdateComposioSettingsRequest) =>
      request.apiKey?.trim()
        ? client.setComposioSecret(request.apiKey)
        : client.getComposioSettings(),
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKeys.composio.settings, saved);
      await invalidateQueries(
        queryClient,
        queryKeys.composio.toolkits,
        queryKeys.health
      );
    },
  });
}

const composioToolkitsQueryOptions = queryOptions({
  queryFn: () => client.listComposioToolkits(),
  queryKey: queryKeys.composio.toolkits,
});

export function useComposioToolkits(options: { enabled?: boolean } = {}) {
  return useQuery({ ...composioToolkitsQueryOptions, ...options });
}

export function useEnableComposioToolkit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (toolkitSlug: string) =>
      client.enableComposioToolkit(toolkitSlug),
    onSuccess: () => {
      invalidateQueries(queryClient, queryKeys.composio.toolkits);
    },
  });
}

export function useDisableComposioToolkit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (toolkitSlug: string) =>
      client.disableComposioToolkit(toolkitSlug),
    onSuccess: () => {
      invalidateQueries(queryClient, queryKeys.composio.toolkits);
    },
  });
}

export function useConnectComposioToolkit() {
  return useMutation({
    mutationFn: (toolkitSlug: string) =>
      client.connectComposioToolkit(toolkitSlug),
    onSuccess: (response) => {
      // Composio hosts the account picker and consent, then redirects back to
      // /integrations through our OAuth callback.
      if (!isAllowedComposioRedirectUrl(response.redirectUrl)) {
        toast("Blocked an unexpected Composio redirect URL.");

        return;
      }

      window.location.href = response.redirectUrl;
    },
  });
}

/**
 * One click from the Connect an app dialog. An admin turns the toolkit on; it
 * is added to `profileId`, which the caller passes only when the user manages
 * that agent; then anyone who has no account linked yet signs in, and
 * Composio returns them to `returnTo`. Resolves to the sign-in URL, or null
 * when the account was already linked.
 */
export async function connectComposioApp(input: {
  isOrgAdmin: boolean;
  /** The agent to add the toolkit to. Pass it only when the user manages it. */
  profileId?: string;
  returnTo: string;
  toolkits: Pick<
    ListComposioToolkitsResponse,
    "orgToolkits" | "userConnections"
  >;
  toolkitSlug: string;
}): Promise<string | null> {
  let toolkit = input.toolkits.orgToolkits.find(
    (item) => item.toolkitSlug === input.toolkitSlug
  );

  if (input.isOrgAdmin && toolkit?.status !== "enabled") {
    toolkit = await client.enableComposioToolkit(input.toolkitSlug);
  }

  if (input.profileId && toolkit?.status === "enabled") {
    const { assignments } = await client.listProfileComposioToolkits(
      input.profileId
    );

    if (!assignments.some((item) => item.toolkitId === toolkit.id)) {
      await client.updateProfileComposioToolkits(input.profileId, {
        assignments: [
          ...assignments.map(({ allowedActions, toolkitId }) => ({
            allowedActions,
            toolkitId,
          })),
          { toolkitId: toolkit.id },
        ],
      });
    }
  }

  const linked = input.toolkits.userConnections.some(
    (item) => item.toolkitId === toolkit?.id && item.status === "connected"
  );

  if (linked) {
    return null;
  }

  const { redirectUrl } = await client.connectComposioToolkit(
    input.toolkitSlug,
    { returnTo: input.returnTo }
  );

  if (!isAllowedComposioRedirectUrl(redirectUrl)) {
    throw new Error("Blocked an unexpected Composio redirect URL.");
  }

  return redirectUrl;
}

export function useDisconnectComposioToolkit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (toolkitSlug: string) =>
      client.disconnectComposioToolkit(toolkitSlug),
    onSuccess: () => {
      invalidateQueries(queryClient, queryKeys.composio.toolkits);
    },
  });
}

export function useSyncComposioToolkit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (toolkitSlug: string) =>
      client.syncComposioToolkit(toolkitSlug),
    onSuccess: () => {
      invalidateQueries(queryClient, queryKeys.composio.toolkits);
    },
  });
}

export function profileComposioToolkitsQueryOptions(profileId: string | null) {
  return queryOptions({
    enabled: Boolean(profileId),
    queryFn: () => client.listProfileComposioToolkits(profileId!),
    queryKey: queryKeys.composio.profileToolkits(profileId ?? "none"),
  });
}

export function useProfileComposioToolkits(profileId: string | null) {
  return useQuery(profileComposioToolkitsQueryOptions(profileId));
}

export function useUpdateProfileComposioToolkitsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      profileId,
      assignments,
    }: {
      profileId: string;
      assignments: UpdateProfileComposioToolkitsRequest["assignments"];
    }) => client.updateProfileComposioToolkits(profileId, { assignments }),
    onSuccess: (_data, variables) =>
      invalidateQueries(
        queryClient,
        queryKeys.composio.profileToolkits(variables.profileId),
        queryKeys.profiles.all,
        ["organizationOverview"],
        ["organizationPublicationCatalog"]
      ),
  });
}
