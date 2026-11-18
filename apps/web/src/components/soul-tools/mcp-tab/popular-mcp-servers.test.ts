import { expect, test } from "bun:test";
import {
  composioToolkitFor,
  POPULAR_SERVERS,
  unregisteredPopularServers,
} from "@/components/soul-tools/mcp-tab/popular-mcp-servers";

const names = (servers: readonly { name: string }[]) =>
  servers.map((server) => server.name);

test("offers the apps Composio can connect", () => {
  expect(names(unregisteredPopularServers([], [{ slug: "notion" }]))).toEqual([
    "Notion",
    "Eksis",
  ]);
});

test("keeps an app with its own MCP sign-in when Composio cannot connect it", () => {
  expect(names(unregisteredPopularServers([], []))).toEqual([
    "Notion",
    "Eksis",
  ]);
});

test("does not offer Canva", () => {
  expect(names(unregisteredPopularServers([], [{ slug: "canva" }]))).toEqual([
    "Notion",
    "Eksis",
  ]);
});

test("skips an app the org already added as an MCP server", () => {
  expect(
    names(
      unregisteredPopularServers([{ name: "notion" }], [{ slug: "notion" }])
    )
  ).toEqual(["Eksis"]);
});

const notion = POPULAR_SERVERS.find((app) => app.name === "Notion");

test("connects Notion through Composio only when Composio offers it", () => {
  if (!notion) {
    throw new Error("Notion preset missing");
  }

  expect(composioToolkitFor(notion, [{ slug: "notion" }])).toBe("notion");
  expect(composioToolkitFor(notion, [{ slug: "canva" }])).toBeNull();
  expect(composioToolkitFor(notion, [])).toBeNull();
});

test("skips Eksis once the org added it", () => {
  expect(
    names(unregisteredPopularServers([{ name: "eksis" }], [{ slug: "eksis" }]))
  ).toEqual(["Notion"]);
});

test("signs in to Eksis directly even when Composio lists an eksis toolkit", () => {
  const eksis = POPULAR_SERVERS.find((app) => app.name === "Eksis");

  if (!eksis) {
    throw new Error("Eksis preset missing");
  }

  expect(composioToolkitFor(eksis, [{ slug: "eksis" }])).toBeNull();
});
