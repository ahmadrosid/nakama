import { describe, expect, test } from "bun:test";
import { TELEGRAM_ARTIFACT_DOCUMENT_MAX_BYTES, sendTelegramArtifactDocument } from "./send-artifact-document";

describe("sendTelegramArtifactDocument", () => {
  test("rejects files over the telegram cap", async () => {
    const result = await sendTelegramArtifactDocument(
      { chat: { id: 1 }, api: { sendDocument: async () => ({}) } } as never,
      {
        filename: "big.md",
        bytes: new Uint8Array(TELEGRAM_ARTIFACT_DOCUMENT_MAX_BYTES + 1),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("too large");
  });
});
