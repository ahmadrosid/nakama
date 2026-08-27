import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_IMAGE_BYTES,
} from "@nakama/core/message-content";
import type { Attachment, Message } from "discord.js";
import { Collection } from "discord.js";
import {
  buildDiscordImageInput,
  DOWNLOAD_FAILED_REPLY,
  OVERSIZED_IMAGE_REPLY,
  TOO_MANY_IMAGES_REPLY,
  UNSUPPORTED_ATTACHMENT_REPLY,
} from "./images";

function createMessage(options: {
  content?: string;
  attachments?: Array<{
    contentType?: string | null;
    name?: string;
    size?: number;
    url?: string;
  }>;
}): Message {
  const attachments = new Collection<string, Attachment>();

  for (const [index, attachment] of (options.attachments ?? []).entries()) {
    attachments.set(String(index + 1), {
      contentType: attachment.contentType ?? null,
      name: attachment.name ?? `image-${index + 1}.png`,
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

  test("returns null when there are no attachments", async () => {
    const result = await buildDiscordImageInput(
      createMessage({ content: "hi" })
    );

    expect(result).toBeNull();
  });

  test("rejects non-image attachments", async () => {
    const result = await buildDiscordImageInput(
      createMessage({
        attachments: [{ contentType: "application/pdf", name: "doc.pdf" }],
        content: "",
      })
    );

    expect(result).toEqual({
      kind: "reject",
      message: UNSUPPORTED_ATTACHMENT_REPLY,
    });
  });

  test("ignores non-image attachments when caption text is present", async () => {
    const result = await buildDiscordImageInput(
      createMessage({
        attachments: [{ contentType: "application/pdf", name: "doc.pdf" }],
        content: "see pdf",
      })
    );

    expect(result).toBeNull();
  });

  test("does not treat pdf as image when filename looks like png", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(8), { status: 200 })
    );

    const result = await buildDiscordImageInput(
      createMessage({
        attachments: [
          {
            contentType: "application/pdf",
            name: "shot.png",
            size: 8,
          },
        ],
        content: "",
      })
    );

    expect(result).toEqual({
      kind: "reject",
      message: UNSUPPORTED_ATTACHMENT_REPLY,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("downloads allowed images and uses content as caption", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pngBytes, { status: 200 })
    );

    const result = await buildDiscordImageInput(
      createMessage({
        attachments: [
          {
            contentType: "image/png",
            name: "shot.png",
            size: pngBytes.byteLength,
          },
        ],
        content: "what is this?",
      })
    );

    expect(result).toEqual({
      input: {
        images: [
          {
            data: Buffer.from(pngBytes).toString("base64"),
            mediaType: "image/png",
          },
        ],
        message: "what is this?",
      },
      kind: "input",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("infers jpeg from filename when contentType is null", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff]);
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(jpegBytes, { status: 200 })
    );

    const result = await buildDiscordImageInput(
      createMessage({
        attachments: [
          {
            contentType: null,
            name: "photo.jpg",
            size: jpegBytes.byteLength,
          },
        ],
      })
    );

    expect(result).toEqual({
      input: {
        images: [
          {
            data: Buffer.from(jpegBytes).toString("base64"),
            mediaType: "image/jpeg",
          },
        ],
        message: "",
      },
      kind: "input",
    });
  });

  test("rejects when more than max valid images without downloading", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(8), { status: 200 })
    );

    const attachments = Array.from(
      { length: MAX_ATTACHMENTS_PER_MESSAGE + 1 },
      (_, index) => ({
        contentType: "image/png",
        name: `shot-${index}.png`,
        size: 8,
      })
    );

    const result = await buildDiscordImageInput(createMessage({ attachments }));

    expect(result).toEqual({
      kind: "reject",
      message: TOO_MANY_IMAGES_REPLY,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("rejects oversized images before fetch", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(8), { status: 200 })
    );

    const result = await buildDiscordImageInput(
      createMessage({
        attachments: [
          {
            contentType: "image/jpeg",
            name: "big.jpg",
            size: MAX_IMAGE_BYTES + 1,
          },
        ],
      })
    );

    expect(result).toEqual({
      kind: "reject",
      message: OVERSIZED_IMAGE_REPLY,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("keeps valid images and ignores invalid siblings", async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pngBytes, { status: 200 })
    );

    const result = await buildDiscordImageInput(
      createMessage({
        attachments: [
          {
            contentType: "image/png",
            name: "ok.png",
            size: pngBytes.byteLength,
          },
          {
            contentType: "application/pdf",
            name: "notes.pdf",
            size: 100,
          },
        ],
      })
    );

    expect(result?.kind).toBe("input");
    if (result?.kind === "input") {
      expect(result.input.images).toHaveLength(1);
      expect(result.input.images[0]?.mediaType).toBe("image/png");
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("rejects download failures without throwing", async () => {
    fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 })
    );

    const result = await buildDiscordImageInput(
      createMessage({
        attachments: [
          {
            contentType: "image/png",
            name: "shot.png",
            size: 32,
          },
        ],
      })
    );

    expect(result).toEqual({
      kind: "reject",
      message: DOWNLOAD_FAILED_REPLY,
    });
  });
});
