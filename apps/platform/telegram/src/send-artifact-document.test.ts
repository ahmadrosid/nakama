import { describe, expect, test } from "bun:test";
import {
  sendTelegramArtifactDocument,
  TELEGRAM_ARTIFACT_DOCUMENT_MAX_BYTES,
} from "./send-artifact-document";

describe("sendTelegramArtifactDocument", () => {
  test("rejects files over the telegram cap", async () => {
    // SAFETY: This test supplies only the API and chat fields read by the function.
    const result = await sendTelegramArtifactDocument(
      { api: { sendDocument: async () => ({}) }, chat: { id: 1 } } as never,
      {
        bytes: new Uint8Array(TELEGRAM_ARTIFACT_DOCUMENT_MAX_BYTES + 1),
        filename: "big.md",
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("too large");
  });
});
