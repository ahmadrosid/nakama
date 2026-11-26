import { describe, expect, test } from "bun:test";
import { parseProfileCreatedResult } from "./chat-stream";

describe("parseProfileCreatedResult", () => {
  test("keeps createdAt when it predates the Moodstone cutoff", () => {
    const createdAt = "2026-09-01T00:00:00.000Z";
    const updatedAt = "2026-10-12T00:00:00.000Z";

    const profile = parseProfileCreatedResult({
      profile: {
        createdAt,
        hasAvatar: false,
        id: "profile_1",
        isSuper: false,
        name: "Old Timer",
        updatedAt,
      },
      type: "profile_created",
    });

    expect(profile?.createdAt).toBe(createdAt);
    expect(profile?.updatedAt).toBe(updatedAt);
  });
});
