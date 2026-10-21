import { describe, expect, test } from "bun:test";
import { parseGroupCreatedResult } from "./chat-stream";

describe("parseGroupCreatedResult", () => {
  test("reads the group from a create_group result", () => {
    expect(
      parseGroupCreatedResult({
        group: { id: "g1", name: "Launch" },
        type: "group_created",
      })
    ).toEqual({ id: "g1", name: "Launch" });
  });

  test("ignores other tool results", () => {
    expect(
      parseGroupCreatedResult({ profile: {}, type: "profile_created" })
    ).toBeNull();
    expect(parseGroupCreatedResult("nope")).toBeNull();
  });
});
