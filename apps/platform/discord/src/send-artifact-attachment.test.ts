import { describe, expect, test } from "bun:test";
import {
  DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES,
  isDiscordAttachableArtifact,
  sendDiscordArtifactAttachment,
} from "./send-artifact-attachment";

describe("sendDiscordArtifactAttachment limits", () => {
  test("accepts common Discord attachment types", () => {
    expect(
      isDiscordAttachableArtifact({
        filename: "deck.pdf",
        mimeType: "application/pdf",
      })
    ).toBe(true);
    expect(
      isDiscordAttachableArtifact({
        filename: "export.csv",
        mimeType: "text/csv",
      })
    ).toBe(true);
    expect(
      isDiscordAttachableArtifact({
        filename: "shot.png",
        mimeType: "image/png",
      })
    ).toBe(true);
    expect(
      isDiscordAttachableArtifact({
        filename: "bundle.zip",
        mimeType: "application/zip",
      })
    ).toBe(true);
  });

  test("rejects unsupported attachment types with a clear reason", () => {
    expect(
      isDiscordAttachableArtifact({
        filename: "payload.exe",
        mimeType: "application/octet-stream",
      })
    ).toBe(false);
  });

  test("returns a clear error when the file exceeds the Discord size cap", async () => {
    const channel = {
      send: async () => {
        throw new Error("should not send");
      },
    };

    const result = await sendDiscordArtifactAttachment(channel as never, {
      bytes: new Uint8Array(DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES + 1),
      filename: "deck.pdf",
      mimeType: "application/pdf",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too large for Discord/i);
    expect(result.error).toMatch(/8\.0 MB/i);
  });

  test("returns a clear error for unsupported file types", async () => {
    const channel = {
      send: async () => {
        throw new Error("should not send");
      },
    };

    const result = await sendDiscordArtifactAttachment(channel as never, {
      bytes: new Uint8Array([1, 2, 3]),
      filename: "payload.exe",
      mimeType: "application/octet-stream",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unsupported file type/i);
    expect(result.error).toMatch(/\.exe/i);
  });
});
