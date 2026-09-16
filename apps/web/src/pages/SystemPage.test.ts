import { expect, test } from "bun:test";
import { legacySystemDestination } from "./system-page.shared";

test.each([
  ["", "/customize/tools"],
  ["tab=tools", "/customize/tools"],
  ["tab=mcp", "/customize/mcp"],
  ["tab=usage", "/customize/usage"],
  ["tab=plugins", "/customize/plugins"],
  ["tab=status", "/workers"],
  ["tab=organization&profile=alex", "/organization?profile=alex"],
])("old System links redirect: %s", (query, expected) => {
  expect(legacySystemDestination(new URLSearchParams(query), true)).toBe(
    expected
  );
});
test("org admins cannot use the legacy link to reach MCP", () => {
  expect(legacySystemDestination(new URLSearchParams("tab=mcp"), false)).toBe(
    "/customize/tools"
  );
});
