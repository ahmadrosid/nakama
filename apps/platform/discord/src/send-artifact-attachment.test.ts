import { describe, expect, test } from "bun:test";
import { DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES } from "./send-artifact-attachment";

describe("sendDiscordArtifactAttachment limits", () => {
  test("exports an 8 MB discord cap", () => {
    expect(DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});
