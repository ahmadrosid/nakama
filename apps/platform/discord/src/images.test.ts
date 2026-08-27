import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { MAX_IMAGE_BYTES } from "@nakama/core/message-content";
import type { Attachment, Message } from "discord.js";
import { Collection } from "discord.js";
import { buildDiscordImageInput } from "./images";

function createMessage(options: {
  content?: string;
  attachments?: Array<{
    contentType?: string | null;
    size?: number;
    url?: string;
  }>;
}): Message {
  const attachments = new Collection<string, Attachment>();

  for (const [index, attachment] of (options.attachments ?? []).entries()) {
    attachments.set(String(index + 1), {
      contentType: attachment.contentType ?? "image/png",
      size: attachment.size ?? 32,
      url: attachment.url ?? `https://cdn.example/image-${index + 1}.png`,
    } as Attachment);
  }

  return {
    attachments,
    content: options.content ?? "",
  } as unknown as Message;
}

describe("buildDiscordImageInput", () => {
  let fetchSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  test("returns null when there are no image attachments", async () => {
    const result = await buildDiscordImageInput(
      createMessage({
        attachments: [{ contentType: "application/pdf" }],
        content: "see pdf",
      })
    );

    expect(result).toBeNull();
  });

  test("downloads allowed images and uses content as caption", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pngBytes, { status: 200 })
    );

    const result = await buildDiscordImageInput(
      createMessage({
        attachments: [{ contentType: "image/png", size: pngBytes.byteLength }],
        content: "what is this?",
      })
    );

    expect(result).toEqual({
      images: [
        {
          data: Buffer.from(pngBytes).toString("base64"),
          mediaType: "image/png",
        },
      ],
      message: "what is this?",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("rejects oversized images before fetch completes the turn", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(8), { status: 200 })
    );

    await expect(
      buildDiscordImageInput(
        createMessage({
          attachments: [
            {
              contentType: "image/jpeg",
              size: MAX_IMAGE_BYTES + 1,
            },
          ],
        })
      )
    ).rejects.toThrow(/too large/i);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
