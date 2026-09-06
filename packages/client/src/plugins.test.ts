import { expect, test } from "bun:test";
import { NakamaClient } from "./index";

function captureClient() {
  const fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> =
    [];
  const client = new NakamaClient({
    authToken: "local-auth-token",
    baseUrl: "http://localhost:4310",
    fetch: async (input, init) => {
      fetchCalls.push({ init, input });
      return Response.json({ ok: true, plugins: [], releases: [] });
    },
    orgId: "org_cookie",
  });
  return { client, fetchCalls };
}

test("plugin client methods send expected org and revision fields", async () => {
  const { client, fetchCalls } = captureClient();

  await client.listOrgPlugins("org_explicit");
  await client.enableOrgPlugin("notes", 4, "org_explicit");
  await client.updateOrgPlugin(
    "notes",
    { expectedRevision: 5, targetVersion: "1.1.0" },
    "org_explicit"
  );
  await client.deleteRetainedPluginData({
    confirm: true,
    expectedRevision: 6,
    orgId: "org_explicit",
    pluginId: "notes",
  });
  await client.invokePluginAction(
    "notes",
    "list",
    { input: { q: "n" } },
    "org_explicit"
  );
  await client.installPluginPackage("Zm9v", { expectedDigest: "abc" });

  expect(String(fetchCalls[0]!.input)).toBe("http://localhost:4310/v1/plugins");
  expect(new Headers(fetchCalls[0]!.init?.headers).get("X-Org-Id")).toBe(
    "org_explicit"
  );

  expect(String(fetchCalls[1]!.input)).toBe(
    "http://localhost:4310/v1/plugins/notes/enable"
  );
  expect(JSON.parse(String(fetchCalls[1]!.init?.body))).toEqual({
    expectedRevision: 4,
  });
  expect(new Headers(fetchCalls[1]!.init?.headers).get("X-Org-Id")).toBe(
    "org_explicit"
  );

  expect(JSON.parse(String(fetchCalls[2]!.init?.body))).toEqual({
    expectedRevision: 5,
    targetVersion: "1.1.0",
  });

  expect(String(fetchCalls[3]!.input)).toBe(
    "http://localhost:4310/v1/plugins/notes/retained-data/delete"
  );
  expect(JSON.parse(String(fetchCalls[3]!.init?.body))).toEqual({
    confirm: true,
    expectedRevision: 6,
    orgId: "org_explicit",
    pluginId: "notes",
  });
  expect(new Headers(fetchCalls[3]!.init?.headers).get("X-Org-Id")).toBe(
    "org_explicit"
  );

  expect(String(fetchCalls[4]!.input)).toBe(
    "http://localhost:4310/v1/plugins/notes/actions/list"
  );
  expect(JSON.parse(String(fetchCalls[4]!.init?.body))).toEqual({
    input: { q: "n" },
  });
  expect(new Headers(fetchCalls[4]!.init?.headers).get("X-Org-Id")).toBe(
    "org_explicit"
  );

  expect(String(fetchCalls[5]!.input)).toBe(
    "http://localhost:4310/v1/platform/plugins/releases"
  );
  expect(JSON.parse(String(fetchCalls[5]!.init?.body))).toEqual({
    data: "Zm9v",
    expectedDigest: "abc",
  });
});

test("plugin client falls back to the configured org when a call omits one", async () => {
  const { client, fetchCalls } = captureClient();
  await client.listOrgPlugins();
  expect(new Headers(fetchCalls[0]!.init?.headers).get("X-Org-Id")).toBe(
    "org_cookie"
  );
});
