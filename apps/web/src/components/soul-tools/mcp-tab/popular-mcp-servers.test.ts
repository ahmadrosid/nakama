import { expect, test } from "bun:test";
import { unregisteredPopularServers } from "@/components/soul-tools/mcp-tab/popular-mcp-servers";

const names = (servers: readonly { name: string }[]) =>
  servers.map((server) => server.name);

test("offers the apps Composio can connect", () => {
  expect(names(unregisteredPopularServers([], [{ slug: "notion" }]))).toEqual([
    "Notion",
  ]);
});

test("keeps an app with its own MCP sign-in when Composio cannot connect it", () => {
  expect(names(unregisteredPopularServers([], []))).toEqual(["Notion"]);
});

test("does not offer Canva", () => {
  expect(names(unregisteredPopularServers([], [{ slug: "canva" }]))).toEqual([
    "Notion",
  ]);
});

test("skips an app the org already added as an MCP server", () => {
  expect(
    unregisteredPopularServers([{ name: "notion" }], [{ slug: "notion" }])
  ).toEqual([]);
});
