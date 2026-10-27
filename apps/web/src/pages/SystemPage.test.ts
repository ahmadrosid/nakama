import { expect, test } from "bun:test";
import { legacySystemDestination } from "./system-page.shared";

test.each([
  ["", "/settings/tools"],
  ["tab=tools", "/settings/tools"],
  ["tab=mcp", "/settings/mcp"],
  ["tab=usage", "/settings/usage"],
  ["tab=plugins", "/settings/plugins"],
  ["tab=status", "/workers"],
  ["tab=organization&profile=alex", "/organization?profile=alex"],
])("old System links redirect: %s", (query, expected) => {
  expect(legacySystemDestination(new URLSearchParams(query), true)).toBe(
    expected
  );
});

test("org admins cannot use the legacy link to reach MCP", () => {
  expect(legacySystemDestination(new URLSearchParams("tab=mcp"), false)).toBe(
    "/settings/tools"
  );
});
