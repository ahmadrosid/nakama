import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistInlineAttachmentsInContent } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import {
  createAttachmentLoader,
  createAttachmentSaver,
} from "./attachment-service";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
let tempConfigDir = "";

afterEach(() => {
  if (tempConfigDir) {
    rmSync(tempConfigDir, { force: true, recursive: true });
    tempConfigDir = "";
  }

  if (originalConfigDir === undefined) {
    delete process.env.NAKAMA_CONFIG_DIR;
  } else {
    process.env.NAKAMA_CONFIG_DIR = originalConfigDir;
  }
});

describe("attachment service", () => {
  test("persists metadata and round-trips bytes through loader", async () => {
    tempConfigDir = mkdtempSync(join(tmpdir(), "nakama-att-svc-"));
    process.env.NAKAMA_CONFIG_DIR = tempConfigDir;

    const db = createInMemoryDatabaseAdapter();
    const context = {
      channel: "telegram" as const,
      orgId: "org_1",
      profileId: "profile_1",
      sessionId: "session_1",
    };
    const save = createAttachmentSaver(db, context);
    const load = createAttachmentLoader(db, {
      orgId: context.orgId,
      profileId: context.profileId,
    });

    const refs = await persistInlineAttachmentsInContent(
      [
        {
          data: Buffer.from("jpeg").toString("base64"),
          mediaType: "image/jpeg",
          type: "image",
        },
      ],
      save
    );

    expect(refs).toEqual([
      {
        attachmentId: expect.stringMatching(/^att_/),
        mediaType: "image/jpeg",
        size: 4,
        type: "image_ref",
      },
    ]);

    const attachmentId = (refs as Array<{ attachmentId: string }>)[0]!
      .attachmentId;
    const record = await db.getAttachment(attachmentId);

    expect(record).toMatchObject({
      channel: "telegram",
      kind: "image",
      mediaType: "image/jpeg",
      orgId: "org_1",
      profileId: "profile_1",
      sessionId: "session_1",
      sizeBytes: 4,
    });

    const loaded = await load(attachmentId);
    expect(loaded?.bytes.toString()).toBe("jpeg");
  });
});
