import { describe, expect, test } from "bun:test";
import {
  assertBridgeClientMethods,
  parseListProfilesResponse,
  parseListUserOrgsResponse,
} from "./bridge-api";

describe("bridge API contract", () => {
  test("assertBridgeClientMethods rejects incomplete clients", () => {
    expect(() => assertBridgeClientMethods({ listProfiles: () => {} })).toThrow(
      /listUserOrgs/
    );
  });

  test("parseListUserOrgsResponse accepts valid payloads", () => {
    expect(
      parseListUserOrgsResponse({
        orgs: [{ id: "org_a", name: "Acme", role: "admin", slug: "acme" }],
      })
    ).toEqual({
      orgs: [{ id: "org_a", name: "Acme", role: "admin", slug: "acme" }],
    });
  });

  test("parseListUserOrgsResponse rejects renamed fields", () => {
    expect(() => parseListUserOrgsResponse({ organizations: [] })).toThrow(
      /expected \{ orgs/
    );
  });

  test("parseListProfilesResponse accepts valid payloads", () => {
    expect(
      parseListProfilesResponse({
        profiles: [{ id: "default", name: "Default Bot" }],
      })
    ).toEqual({
      profiles: [{ id: "default", name: "Default Bot" }],
    });
  });

  test("parseListProfilesResponse rejects renamed fields", () => {
    expect(() => parseListProfilesResponse({ items: [] })).toThrow(
      /expected \{ profiles/
    );
  });
});
