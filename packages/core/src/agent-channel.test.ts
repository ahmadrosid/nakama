import { describe, expect, test } from "bun:test";
import { AGENT_CHANNELS, parseAgentChannel } from "./contract";

describe("parseAgentChannel", () => {
  test("returns every channel that is in AGENT_CHANNELS", () => {
    expect(AGENT_CHANNELS.map((channel) => parseAgentChannel(channel))).toEqual(
      [...AGENT_CHANNELS]
    );
  });

  test("returns null for a string that is not a channel", () => {
    // Session rows keep the column as `string`, so this is the case that
    // decides what an unknown stored value means everywhere it is read.
    for (const value of ["sms", "Web", "web ", "", "slack"]) {
      expect(parseAgentChannel(value)).toBeNull();
    }
  });
});
