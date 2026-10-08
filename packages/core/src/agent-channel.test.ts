import { describe, expect, test } from "bun:test";
import { parseAgentChannel } from "./contract";

describe("parseAgentChannel", () => {
  test("returns null for a string that is not a channel", () => {
    // Session rows keep the column as `string`, so this is the case that
    // decides what an unknown stored value means everywhere it is read.
    for (const value of ["sms", "Web", "web ", "", "matrix"]) {
      expect(parseAgentChannel(value)).toBeNull();
    }
  });
});
