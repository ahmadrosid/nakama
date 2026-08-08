import { describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "./adapters/in-memory";

describe("notification destinations", () => {
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
