import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./index";
import type { StoredNotificationDestinationRecord } from "./types";

describe("notification destinations", () => {
  test("round trips Discord and WhatsApp config with organization isolation", async () => {
    const db = createInMemoryDatabaseAdapter();
    const configs = [
      {
        channel: "discord",
        config: { channelId: "12345678901234567890", profileId: "agent_1" },
      },
      { channel: "whatsapp", config: { profileId: "agent_1" } },
    ] as const;
    for (const configured of configs) {
      const record: StoredNotificationDestinationRecord = {
        ...configured,
        createdAt: "2026-10-03T00:00:00.000Z",
        id: `dest_${configured.channel}`,
        name: "Ops",
        orgId: "org_1",
        secretHash: "hash",
        updatedAt: "2026-10-03T00:00:00.000Z",
      };
      await db.upsertNotificationDestination(record);
      expect(await db.getNotificationDestination(record.id)).toEqual(record);
    }
    expect(await db.listNotificationDestinationsForOrg("org_1")).toHaveLength(
      2
    );
    expect(await db.listNotificationDestinationsForOrg("org_2")).toEqual([]);
  });
  test("persists and lists org-scoped telegram destinations", async () => {
    const db = createInMemoryDatabaseAdapter();

    await db.upsertNotificationDestination({
      channel: "telegram",
      config: { chatId: 1001, topicId: 22 },
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "dest_1",
      name: "Payments",
      orgId: "org_1",
      secretHash: "hash_1",
      updatedAt: "2026-07-04T10:00:00.000Z",
    });

    await db.upsertNotificationDestination({
      channel: "telegram",
      config: { chatId: 1002, topicId: null },
      createdAt: "2026-07-04T11:00:00.000Z",
      id: "dest_2",
      name: "Ops",
      orgId: "org_2",
      secretHash: "hash_2",
      updatedAt: "2026-07-04T11:00:00.000Z",
    });

    expect(await db.getNotificationDestination("dest_1")).toEqual({
      channel: "telegram",
      config: { chatId: 1001, topicId: 22 },
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "dest_1",
      name: "Payments",
      orgId: "org_1",
      secretHash: "hash_1",
      updatedAt: "2026-07-04T10:00:00.000Z",
    });

    expect(await db.listNotificationDestinationsForOrg("org_1")).toEqual([
      {
        channel: "telegram",
        config: { chatId: 1001, topicId: 22 },
        createdAt: "2026-07-04T10:00:00.000Z",
        id: "dest_1",
        name: "Payments",
        orgId: "org_1",
        secretHash: "hash_1",
        updatedAt: "2026-07-04T10:00:00.000Z",
      },
    ]);
  });

  test("updates and deletes destinations", async () => {
    const db = createInMemoryDatabaseAdapter();

    await db.upsertNotificationDestination({
      channel: "telegram",
      config: { chatId: 1001, topicId: 22 },
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "dest_1",
      name: "Payments",
      orgId: "org_1",
      secretHash: "hash_1",
      updatedAt: "2026-07-04T10:00:00.000Z",
    });

    await db.upsertNotificationDestination({
      channel: "telegram",
      config: { chatId: 1001, topicId: null },
      createdAt: "2026-07-04T10:00:00.000Z",
      id: "dest_1",
      name: "Payments Updated",
      orgId: "org_1",
      secretHash: "hash_2",
      updatedAt: "2026-07-04T10:05:00.000Z",
    });

    expect((await db.getNotificationDestination("dest_1"))?.secretHash).toBe(
      "hash_2"
    );
    expect(await db.deleteNotificationDestination("dest_1")).toBe(true);
    expect(await db.getNotificationDestination("dest_1")).toBeNull();
  });
});
