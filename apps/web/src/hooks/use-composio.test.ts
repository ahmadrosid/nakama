import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { ComposioToolkitSummary } from "@nakama/core/contract";
import { client } from "@/lib/client";
import {
  connectComposioApp,
  isAllowedComposioRedirectUrl,
} from "./use-composio";

describe("isAllowedComposioRedirectUrl", () => {
  test("allows https composio.dev and subdomains", () => {
    expect(
      isAllowedComposioRedirectUrl("https://backend.composio.dev/api/v3/s/abc")
    ).toBe(true);
    expect(
      isAllowedComposioRedirectUrl("https://composio.dev/connect?toolkit=gmail")
    ).toBe(true);
    expect(
      isAllowedComposioRedirectUrl("https://PLATFORM.COMPOSIO.DEV/oauth/start")
    ).toBe(true);
    expect(
      isAllowedComposioRedirectUrl("https://dashboard.composio.dev/oauth")
    ).toBe(true);
  });

  test("rejects non-https, foreign hosts, and garbage", () => {
    expect(
      isAllowedComposioRedirectUrl("http://backend.composio.dev/api/v3/s/abc")
    ).toBe(false);
    expect(
      isAllowedComposioRedirectUrl("https://evil.com/?next=composio.dev")
    ).toBe(false);
    expect(
      isAllowedComposioRedirectUrl("https://composio.dev.evil.com/phish")
    ).toBe(false);
    expect(
      isAllowedComposioRedirectUrl("https://notcomposio.dev/connect")
    ).toBe(false);
    expect(isAllowedComposioRedirectUrl("")).toBe(false);
    expect(isAllowedComposioRedirectUrl("not a url")).toBe(false);
  });
});

describe("connectComposioApp", () => {
  const spies: Array<{ mockRestore(): void }> = [];

  afterEach(() => {
    for (const spy of spies.splice(0)) {
      spy.mockRestore();
    }
  });

  const canva: ComposioToolkitSummary = {
    cachedTools: [],
    displayName: "Canva",
    id: "tk_canva",
    lastError: null,
    status: "enabled",
    toolkitSlug: "canva",
    updatedAt: "",
  };

  function mockClient(
    assignments: {
      allowedActions: string[] | null;
      toolkitId: string;
      toolkitSlug: string;
    }[]
  ) {
    const assigned: string[][] = [];
    const enabled: string[] = [];
    const returnTo: (string | undefined)[] = [];
    const calls = { assigned, enabled, returnTo };

    spies.push(
      spyOn(client, "enableComposioToolkit").mockImplementation(
        async (slug) => {
          calls.enabled.push(slug);

          return canva;
        }
      ),
      spyOn(client, "listProfileComposioToolkits").mockResolvedValue({
        assignments,
      }),
      spyOn(client, "updateProfileComposioToolkits").mockImplementation(
        async (_profileId, request) => {
          calls.assigned.push(
            request.assignments.map((item) => item.toolkitId)
          );

          return { assignments: [] };
        }
      ),
      spyOn(client, "connectComposioToolkit").mockImplementation(
        async (_slug, options) => {
          calls.returnTo.push(options?.returnTo);

          return { redirectUrl: "https://backend.composio.dev/link/abc" };
        }
      )
    );

    return calls;
  }

  test("an admin enables, adds to the agent and signs in", async () => {
    const calls = mockClient([
      { allowedActions: null, toolkitId: "tk_gmail", toolkitSlug: "gmail" },
    ]);

    const url = await connectComposioApp({
      isOrgAdmin: true,
      profileId: "p1",
      returnTo: "/profiles?profile=p1",
      toolkitSlug: "canva",
      toolkits: { orgToolkits: [], userConnections: [] },
    });

    expect(url).toBe("https://backend.composio.dev/link/abc");
    expect(calls.enabled).toEqual(["canva"]);
    expect(calls.assigned).toEqual([["tk_gmail", "tk_canva"]]);
    expect(calls.returnTo).toEqual(["/profiles?profile=p1"]);
  });

  test("a linked account needs no sign-in", async () => {
    const calls = mockClient([
      { allowedActions: null, toolkitId: "tk_canva", toolkitSlug: "canva" },
    ]);

    const url = await connectComposioApp({
      isOrgAdmin: true,
      profileId: "p1",
      returnTo: "/profiles",
      toolkitSlug: "canva",
      toolkits: {
        orgToolkits: [canva],
        userConnections: [
          {
            id: "c1",
            lastError: null,
            status: "connected",
            toolkitId: "tk_canva",
            toolkitSlug: "canva",
            updatedAt: "",
          },
        ],
      },
    });

    expect(url).toBeNull();
    expect(calls.enabled).toEqual([]);
    expect(calls.assigned).toEqual([]);
    expect(calls.returnTo).toEqual([]);
  });

  test("a member adds an enabled toolkit to their agent and signs in", async () => {
    const calls = mockClient([]);

    await connectComposioApp({
      isOrgAdmin: false,
      profileId: "p1",
      returnTo: "/chat",
      toolkitSlug: "canva",
      toolkits: { orgToolkits: [canva], userConnections: [] },
    });

    expect(calls.enabled).toEqual([]);
    expect(calls.assigned).toEqual([["tk_canva"]]);
    expect(calls.returnTo).toEqual(["/chat"]);
  });

  test("without an agent it only signs in", async () => {
    const calls = mockClient([]);

    await connectComposioApp({
      isOrgAdmin: false,
      returnTo: "/chat",
      toolkitSlug: "canva",
      toolkits: { orgToolkits: [canva], userConnections: [] },
    });

    expect(calls.enabled).toEqual([]);
    expect(calls.assigned).toEqual([]);
    expect(calls.returnTo).toEqual(["/chat"]);
  });
});
