import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NakamaClient } from "@nakama/client";
import { loadSavedCliOrgId, loadSavedCliProfileId } from "./cli-config";
import { InvalidOrgArgError, parseCliOrgArgs, switchChatOrg } from "./org";

test("org switching scopes the new session and preserves the current client on failure", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "nakama-org-switch-"));
  const previous = process.env.NAKAMA_CONFIG_DIR;
  process.env.NAKAMA_CONFIG_DIR = configDir;
  let failSession = false;
  const requests: { path: string; org: string | null }[] = [];
  const client = new NakamaClient({
    baseUrl: "https://example.com",
    fetch: (async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push({ org: new Headers(init?.headers).get("X-Org-Id"), path });
      if (path === "/v1/auth/orgs") {
        return Response.json({
          orgs: [{ id: "org_new", name: "Team", slug: "team" }],
        });
      }
      if (path === "/v1/profiles") {
        return Response.json({
          profiles: [{ id: "profile_new", isSuper: true, name: "Bot" }],
        });
      }
      if (path === "/v1/sessions") {
        expect(JSON.parse(String(init?.body)).profileId).toBe("profile_new");
        return failSession
          ? Response.json({ error: "unavailable" }, { status: 500 })
          : Response.json({ sessionId: "session_new" });
      }
      return Response.json({ providerConfigured: true });
    }) as typeof fetch,
    orgId: "org_old",
  });
  try {
    const lines: string[] = [];
    expect(
      await switchChatOrg(client, "", "cli", (line) => lines.push(line))
    ).toBeUndefined();
    expect(lines.length).toBeGreaterThan(0);
    await expect(
      switchChatOrg(client, "unknown", "cli", () => {})
    ).rejects.toThrow();
    failSession = true;
    await expect(
      switchChatOrg(client, "team", "cli", () => {})
    ).rejects.toThrow();
    expect(await loadSavedCliOrgId()).toBeNull();
    failSession = false;
    const next = await switchChatOrg(client, "team", "cli", () => {});
    expect(next?.profile.id).toBe("profile_new");
    expect(await loadSavedCliOrgId()).toBe("org_new");
    expect(await loadSavedCliProfileId()).toBe("profile_new");
    expect(
      requests
        .filter((request) => request.path === "/v1/sessions")
        .every((request) => request.org === "org_new")
    ).toBe(true);
    await client.listProfiles();
    expect(requests.at(-1)?.org).toBe("org_old");
  } finally {
    if (previous === undefined) {
      delete process.env.NAKAMA_CONFIG_DIR;
    } else {
      process.env.NAKAMA_CONFIG_DIR = previous;
    }
    await rm(configDir, { force: true, recursive: true });
  }
});

describe("parseCliOrgArgs", () => {
  test("parses --org flag", () => {
    expect(parseCliOrgArgs(["launch", "claude", "--org", "org_abc"])).toEqual({
      orgId: "org_abc",
    });
    expect(parseCliOrgArgs(["--org=org_xyz"])).toEqual({ orgId: "org_xyz" });
  });

  test("parses org slugs", () => {
    expect(parseCliOrgArgs(["--org", "acme-co"])).toEqual({
      orgId: "acme-co",
    });
  });

  test("rejects missing --org value", () => {
    expect(() => parseCliOrgArgs(["--org"])).toThrow(InvalidOrgArgError);
    expect(() => parseCliOrgArgs(["--org", "--theme", "dark"])).toThrow(
      InvalidOrgArgError
    );
  });

  test("rejects invalid --org shape", () => {
    expect(() => parseCliOrgArgs(["--org", "../etc"])).toThrow(
      InvalidOrgArgError
    );
    expect(() => parseCliOrgArgs(["--org=org_abc/../x"])).toThrow(
      InvalidOrgArgError
    );
    expect(() => parseCliOrgArgs([`--org=${"a".repeat(200)}`])).toThrow(
      InvalidOrgArgError
    );
  });
});
