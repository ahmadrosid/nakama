import { expect, test } from "bun:test";
import { unregisteredPopularServers } from "@/components/soul-tools/mcp-tab/popular-mcp-servers";

const names = (servers: readonly { name: string }[]) =>
  servers.map((server) => server.name);

test("offers only the apps Composio can connect", () => {
  expect(names(unregisteredPopularServers([], [{ slug: "canva" }]))).toEqual([
    "Canva",
  ]);
  expect(unregisteredPopularServers([], [])).toEqual([]);
});

test("skips an app the org already added as an MCP server", () => {
  const catalog = [{ slug: "notion" }, { slug: "canva" }];

  expect(
    names(unregisteredPopularServers([{ name: "notion" }], catalog))
  ).toEqual(["Canva"]);
});
