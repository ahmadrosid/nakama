import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { NakamaApiError } from "@nakama/core/api-error";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { useArtifactShareControls } from "@/components/chat/use-artifact-share-controls";
import {
  AuthContext,
  type AuthContextValue,
} from "@/context/auth-context-shared";
import { artifactShareStorageKey } from "@/lib/artifact-share-storage";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { useRevokeArtifactShareMutation } from "./use-resource-mutations";

const revoke = spyOn(client, "revokeProfileArtifactShare");
const publish = spyOn(client, "publishProfileArtifactShare");
const queryClient = new QueryClient({
  defaultOptions: { mutations: { retry: false } },
});
const variables = {
  path: "report.html",
  profileId: "profile",
  shareId: "old-share",
};
const queryKey = queryKeys.artifacts.shareStatus(
  variables.profileId,
  variables.path
);

afterEach(() => {
  revoke.mockReset();
  publish.mockReset();
  queryClient.clear();
});

afterAll(() => {
  revoke.mockRestore();
  publish.mockRestore();
});

function renderMutation() {
  let mutation: ReturnType<typeof useRevokeArtifactShareMutation>;
  function Probe() {
    mutation = useRevokeArtifactShareMutation();
    return null;
  }
  renderToString(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(Probe)
    )
  );
  return () => mutation.mutateAsync(variables);
}

test.each([200, 404])(
  "revoke completes and invalidates stale share status on HTTP %s",
  async (status) => {
    queryClient.setQueryData(queryKey, { active: true, id: variables.shareId });
    if (status === 404) {
      revoke.mockRejectedValue(new NakamaApiError("Not found", 404));
    } else {
      revoke.mockResolvedValue({ id: variables.shareId, revoked: true });
    }

    const mutate = renderMutation();
    await expect(mutate()).resolves.toEqual({
      id: variables.shareId,
      revoked: status === 200,
    });
    expect(revoke).toHaveBeenCalledWith(variables.profileId, variables.shareId);
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);
  }
);

test.each([401, 403, 500])(
  "revoke preserves HTTP %s failures rather than allowing rotation to continue",
  async (status) => {
    queryClient.setQueryData(queryKey, { active: true, id: variables.shareId });
    const error = new NakamaApiError("Request failed", status);
    revoke.mockRejectedValue(error);

    const mutate = renderMutation();
    await expect(mutate()).rejects.toBe(error);
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
  }
);

describe("artifact share controls with a stale share ID", () => {
  const unusedAuthAction = mock(async () => {});
  const auth: AuthContextValue = {
    activeOrg: {
      createdAt: "2026-09-06T00:00:00Z",
      id: "org",
      name: "Test",
      role: "admin",
      slug: "test",
      updatedAt: "2026-09-06T00:00:00Z",
    },
    archiveOrg: unusedAuthAction,
    createOrg: unusedAuthAction,
    isAuthenticated: true,
    isLoading: false,
    login: unusedAuthAction,
    logout: unusedAuthAction,
    orgs: [],
    refreshSession: unusedAuthAction,
    setup: unusedAuthAction,
    switchOrg: unusedAuthAction,
    updateOrg: unusedAuthAction,
    user: null,
  };
  const storageKey = artifactShareStorageKey(
    "org",
    variables.profileId,
    variables.path
  );
  const store = new Map<string, string>();
  let previousLocalStorage: Storage;

  beforeEach(() => {
    previousLocalStorage = globalThis.localStorage;
    store.clear();
    store.set(
      storageKey,
      JSON.stringify({
        shareId: variables.shareId,
        shareUrl: "https://example.com/s/old",
      })
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => store.delete(key),
        setItem: (key: string, value: string) => store.set(key, value),
      },
    });
    queryClient.setQueryData(queryKey, { active: true, id: variables.shareId });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: previousLocalStorage,
    });
  });

  function renderControls() {
    let controls: ReturnType<typeof useArtifactShareControls>;
    function Probe() {
      controls = useArtifactShareControls({
        artifactPath: variables.path,
        profileId: variables.profileId,
      });
      return null;
    }
    renderToString(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          AuthContext.Provider,
          { value: auth },
          createElement(Probe)
        )
      )
    );
    return {
      revoke: () => controls.handleRevoke(),
      rotate: () => controls.handleRotateLink(),
    };
  }

  test.each(["rotate", "revoke"] as const)(
    "%s leaves a replacement share alone when the old ID returns 404",
    async (action) => {
      const replacement = { active: true, id: "replacement-share" };
      revoke.mockImplementation(() => {
        queryClient.setQueryData(queryKey, replacement);
        return Promise.reject(new NakamaApiError("Not found", 404));
      });
      publish.mockResolvedValue({
        id: replacement.id,
        refreshed: true,
        sharePath: "",
        shareUrl: null,
        token: "",
        webPublicUrlConfigured: true,
      });

      await renderControls()[action]();

      expect(revoke).toHaveBeenCalledWith(
        variables.profileId,
        variables.shareId
      );
      expect(publish).not.toHaveBeenCalled();
      expect(store.has(storageKey)).toBe(false);
      expect(queryClient.getQueryData<typeof replacement>(queryKey)).toEqual(
        replacement
      );
    }
  );

  test("rotation still publishes after successfully revoking the current link", async () => {
    revoke.mockResolvedValue({ id: variables.shareId, revoked: true });
    publish.mockResolvedValue({
      id: "new-share",
      refreshed: false,
      sharePath: "/s/new",
      shareUrl: "https://example.com/s/new",
      token: "new",
      webPublicUrlConfigured: true,
    });

    await renderControls().rotate();

    expect(publish).toHaveBeenCalledWith(variables.profileId, variables.path);
    expect(JSON.parse(store.get(storageKey) ?? "null")).toEqual({
      shareId: "new-share",
      shareUrl: "https://example.com/s/new",
    });
  });

  test("rotation does not clear or publish on a permission failure", async () => {
    revoke.mockRejectedValue(new NakamaApiError("Forbidden", 403));

    await renderControls().rotate();

    expect(publish).not.toHaveBeenCalled();
    expect(store.has(storageKey)).toBe(true);
  });
});
