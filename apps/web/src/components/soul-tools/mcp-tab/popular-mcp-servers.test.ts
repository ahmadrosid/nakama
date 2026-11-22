import { expect, test } from "bun:test";
import {
  composioToolkitFor,
  POPULAR_SERVERS,
  unregisteredPopularServers,
} from "@/components/soul-tools/mcp-tab/popular-mcp-servers";

const names = (servers: readonly { name: string }[]) =>
  servers.map((server) => server.name);

test("keeps an app with its own MCP sign-in when Composio cannot connect it", () => {
  expect(names(unregisteredPopularServers([], []))).toEqual([
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

test("signs in to Eksis directly even when Composio lists an eksis toolkit", () => {
  const eksis = POPULAR_SERVERS.find((app) => app.name === "Eksis");

  if (!eksis) {
    throw new Error("Eksis preset missing");
  }

  expect(composioToolkitFor(eksis, [{ slug: "eksis" }])).toBeNull();
});
