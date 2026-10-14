import { expect, test } from "bun:test";
import { createSqliteDatabase } from "./adapters/sqlite";

const NOW = "2026-01-01T00:00:00.000Z";

test("a purged session's attachments move only to a session that can still read them", async () => {
  const database = await createSqliteDatabase(":memory:");
  const db = database.adapter;

  try {
    for (const [orgId, profileIds] of [
      ["org_a", ["profile_a", "profile_a2"]],
      ["org_b", ["profile_b"]],
    ] as const) {
      await db.upsertOrganization({
        createdAt: NOW,
        id: orgId,
        name: orgId,
        slug: orgId,
        updatedAt: NOW,
      });

      for (const id of profileIds) {
        await db.upsertProfile({
          createdAt: NOW,
          id,
          isDefault: false,
          isSuper: false,
          model: null,
          name: id,
          orgId,
          systemPrompt: "",
          updatedAt: NOW,
        });
      }
    }

    // Each session's one message names the attachment ids listed for it.
    const sessions: [id: string, profileId: string, content: unknown][] = [
      [
        "source",
        "profile_a",
        [{ attachmentId: "att_branch" }, { attachmentId: "att_unshared" }],
      ],
      ["branch", "profile_a", [{ attachmentId: "att_branch" }]],
      ["other_org", "profile_b", [{ attachmentId: "att_other_org" }]],
      ["other_profile", "profile_a2", [{ attachmentId: "att_other_profile" }]],
      // A user typing the id is not a reference to the file.
      ["quoted", "profile_a", 'see "attachmentId":"att_quoted"'],
      ["source_b", "profile_b", ""],
      ["branch_b", "profile_b", [{ attachmentId: "att_wrong_org" }]],
    ];

    for (const [id, profileId, content] of sessions) {
      await db.upsertSession({
        agentQuestionnaire: null,
        agentTodos: [],
        channel: "web",
        createdAt: NOW,
        id,
        model: null,
        profileId,
        title: null,
        userId: null,
      });
      await db.replaceMessagesForSession(id, [
        {
          createdAt: NOW,
          id: `msg_${id}`,
          payload: { content, role: "user" },
          seq: 0,
          sessionId: id,
        },
      ]);
    }

    const attachments: [id: string, orgId: string, owner: string][] = [
      ["att_branch", "org_a", "source"],
      ["att_other_org", "org_a", "source"],
      ["att_other_profile", "org_a", "source"],
      ["att_quoted", "org_a", "source"],
      ["att_unshared", "org_a", "source"],
      // Filed under org_a while its profile and both sessions are in org_b.
      ["att_wrong_org", "org_a", "source_b"],
    ];

    for (const [id, orgId, sessionId] of attachments) {
      await db.insertAttachment({
        channel: "web",
        createdAt: NOW,
        ephemeral: false,
        filename: null,
        id,
        kind: "image",
        mediaType: "image/png",
        orgId,
        profileId: sessionId === "source_b" ? "profile_b" : "profile_a",
        sessionId,
        sizeBytes: 1,
        storagePath: id,
      });
    }

    const owners = async () =>
      Object.fromEntries(
        await Promise.all(
          attachments.map(async ([id]) => [
            id,
            (await db.getAttachment(id))?.sessionId,
          ])
        )
      );

    const before = await owners();

    await db.handOverSharedAttachments("source", "org_b");
    await db.handOverSharedAttachments("source_b", "org_a");
    await db.handOverSharedAttachments("source_b", "org_b");
    expect(await owners()).toEqual(before);

    await db.handOverSharedAttachments("source", "org_a");
    expect(await owners()).toEqual({ ...before, att_branch: "branch" });
  } finally {
    database.close();
  }
});
