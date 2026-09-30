import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

/**
 * Mirrors refreshAuthenticatedQueries in auth-context.tsx. The behaviour under
 * test is that an org switch drops the previous org's data instead of letting a
 * late response from the old org land in a component now showing the new one.
 */
function refreshAuthenticatedQueries(queryClient: QueryClient): void {
  void queryClient.cancelQueries();
  queryClient.removeQueries();
  void queryClient.invalidateQueries();
}

describe("org switch cache teardown", () => {
  test("discards an in-flight response issued under the previous org", async () => {
    const queryClient = new QueryClient();
    let resolveOldOrg: ((value: string) => void) | undefined;
    const query = queryClient.fetchQuery({
      queryFn: () =>
        new Promise<string>((resolve) => {
          resolveOldOrg = resolve;
        }),
      queryKey: ["composio", "toolkits"],
    });

    // The user switches orgs while the request is still open.
    refreshAuthenticatedQueries(queryClient);

    // The old org's response lands afterwards. It must not be committed.
    resolveOldOrg?.("old-org-toolkits");
    await query.catch(() => undefined);

    expect(queryClient.getQueryData(["composio", "toolkits"])).toBeUndefined();
  });

  test("clears cached values that carry no org id in their key", () => {
    const queryClient = new QueryClient();
    for (const queryKey of [
      ["composio", "toolkits"],
      ["composio", "settings"],
      ["automations"],
      ["tools"],
      ["mcp", "servers"],
      ["workflows", "database"],
      ["userContext"],
    ]) {
      queryClient.setQueryData(queryKey, { orgA: true });
    }

    refreshAuthenticatedQueries(queryClient);

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
