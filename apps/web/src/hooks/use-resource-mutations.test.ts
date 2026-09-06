import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { NakamaApiError } from "@nakama/core/api-error";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { client } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { useRevokeArtifactShareMutation } from "./use-resource-mutations";

const revoke = spyOn(client, "revokeProfileArtifactShare");
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
  queryClient.clear();
});

afterAll(() => revoke.mockRestore());

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
