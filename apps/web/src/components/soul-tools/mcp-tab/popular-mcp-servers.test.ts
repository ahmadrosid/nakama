import { expect, test } from "bun:test";
import {
  composioToolkitPath,
  unregisteredPopularServers,
} from "@/components/soul-tools/mcp-tab/popular-mcp-servers";
import { PAGE_PATHS } from "@/lib/navigation";

const names = (servers: readonly { name: string }[]) =>
  servers.map((server) => server.name);

test("offers only the apps Composio can connect", () => {
  expect(
    names(unregisteredPopularServers([], [{ slug: "canva_mcp" }]))
  ).toEqual(["Canva"]);
  expect(unregisteredPopularServers([], [])).toEqual([]);
});

test("skips an app the org already added as an MCP server", () => {
  const catalog = [{ slug: "notion_mcp" }, { slug: "canva_mcp" }];

  expect(
    names(unregisteredPopularServers([{ name: "notion" }], catalog))
  ).toEqual(["Canva"]);
});

test("links to the Connectors page searched to the app's MCP toolkit", () => {
  expect(composioToolkitPath("Higgsfield")).toBe(
    `${PAGE_PATHS.composio}?search=higgsfield%20mcp`
  );
});
