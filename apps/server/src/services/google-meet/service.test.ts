import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { GoogleMeetService } from "./service";
import * as transcription from "./transcription";

let root: string;

let db: ReturnType<typeof createInMemoryDatabaseAdapter>;

let service: GoogleMeetService;

const admin = { id: "alice", role: "admin" } as const;

const now = new Date().toISOString();

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "meet-service-"));
  db = createInMemoryDatabaseAdapter();

  for (const id of ["a", "b"]) {
    await db.upsertOrganization({
      createdAt: now,
      id,
      name: id,
      slug: id,
      updatedAt: now,
    });
  }

  service = new GoogleMeetService(db, root, async () => ({
    text: "Recording",
  }));
});

afterEach(async () => {
  await service.close();
  rmSync(root, { force: true, recursive: true });
});

test("startup is idempotent and restart preserves settings while recovering unfinished capture", async () => {
  await Promise.all([
    service.ensureOrganization("a"),
    service.ensureOrganization("a"),
  ]);
  await service.invoke("a", "configure", { apiKey: "test" }, admin);

  const capture = await service.invoke(
    "a",
    "start-capture",
    { url: "https://meet.google.com/abc-defg-hij" },
    admin
  );

  await service.close();
  await service.reopen();

  const status = await service.invoke(
    "a",
    "status",
    { meetingId: capture.id },
    admin
  );

  expect(status.meeting.state).toBe("failed");
  expect((await service.invoke("a", "meetings", {}, admin)).configured).toBe(
    true
  );
  await service.invoke("a", "configure", { enabled: false }, admin);
  await service.close();
  await service.reopen();
  expect((await service.invoke("a", "meetings", {}, admin)).enabled).toBe(
    false
  );
  const tools = (await db.listTools()).filter((tool) => tool.orgId === "a");
  expect(tools).toHaveLength(6);
  expect(
    tools.every(
      (tool) =>
        tool.handlerType === "builtin" && tool.name.startsWith("google_meet_")
    )
  ).toBe(true);
});

test("agent tools require current assignment and hide page captures without a profile", async () => {
  await db.createUser({
    createdAt: now,
    email: "alice@example.com",
    id: "alice",
    passwordHash: "unused",
    updatedAt: now,
  });
  await db.upsertOrgMember({
    createdAt: now,
    orgId: "a",
    role: "admin",
    userId: "alice",
  });
  await db.upsertProfile({
    createdAt: now,
    id: "profile",
    isSuper: false,
    model: null,
    name: "Agent",
    orgId: "a",
    systemPrompt: "",
    updatedAt: now,
  });
  await service.invoke(
    "a",
    "upload",
    { content: "UGFnZSBub3Rlcw==", filename: "page.md" },
    admin
  );

  const own = await service.invoke(
    "a",
    "upload",
    { content: "QWdlbnQgbm90ZXM=", filename: "agent.md" },
    admin,
    undefined,
    "profile"
  );

  const tool = service
    .tools()
    .find((item) => item.name === "google_meet_meetings")!;

  const context = {
    orgId: "a",
    orgRole: "admin" as const,
    profileId: "profile",
    userId: "alice",
  };

  await expect(tool.run({}, context)).rejects.toThrow();
  await db.assignToolToProfile("profile", "meet_a_meetings");

  // SAFETY: The meetings tool returns the overview contract.
  const result = (await tool.run({}, context)) as {
    meetings: Array<{ id: string }>;
  };

  expect(result.meetings.map((meeting) => meeting.id)).toEqual([own.id]);
  await db.unassignToolFromProfile("profile", "meet_a_meetings");
  await expect(tool.run({}, context)).rejects.toThrow();
});

test("members cannot read another user's or another organization's meeting; viewers cannot read or write", async () => {
  const meeting = await service.invoke(
    "a",
    "upload",
    {
      content: Buffer.from("Private notes").toString("base64"),
      filename: "notes.md",
    },
    admin
  );

  await expect(
    service.invoke(
      "a",
      "transcript",
      { meetingId: meeting.id },
      { id: "bob", role: "member" }
    )
  ).rejects.toThrow();
  await expect(
    service.invoke("b", "transcript", { meetingId: meeting.id }, admin)
  ).rejects.toThrow();
  await expect(
    service.invoke("a", "meetings", {}, { id: "alice", role: "viewer" })
  ).rejects.toThrow();
  await expect(
    service.invoke(
      "a",
      "delete",
      { meetingId: meeting.id },
      { id: "alice", role: "viewer" }
    )
  ).rejects.toThrow();
  const own = await service.invoke("a", "meetings", {}, admin);
  expect(own.meetings.map((item) => item.id)).toEqual([meeting.id]);
});

test("queued capture blocks snapshots and disabling invalidates its token", async () => {
  await service.invoke("a", "configure", { apiKey: "test" }, admin);

  const capture = await service.invoke(
    "a",
    "start-capture",
    { durationMinutes: 1, url: "https://meet.google.com/abc-defg-hij" },
    admin
  );

  const address = capture.capture.url.replace(/^ws:/, "http:");
  expect((await fetch(address)).status).toBe(426);
  expect(
    (await fetch(address.replace(capture.capture.token, "invalid"))).status
  ).toBe(401);
  await expect(service.withSnapshot(async () => true)).rejects.toThrow();
  await service.invoke("a", "configure", { enabled: false }, admin);
  expect((await fetch(address)).status).toBe(401);
  expect(await service.withSnapshot(async () => true)).toBe(true);
});

test("bounds simultaneous uploads and shutdown cancels a provider that ignores abort", async () => {
  await service.close();
  service = new GoogleMeetService(db, root, () => new Promise(() => {}));
  await service.ensureOrganization("a");

  const input = {
    content: Buffer.from("audio").toString("base64"),
    filename: "call.wav",
  };

  const pending = Array.from({ length: 4 }, () =>
    service.invoke("a", "upload", input, admin)
  );

  const settled = Promise.allSettled(pending);
  await expect(
    service.invoke("a", "upload", input, admin)
  ).rejects.toMatchObject({ status: 429 });
  await expect(service.withSnapshot(async () => true)).rejects.toThrow();
  await Bun.sleep(10);
  await service.close();
  expect((await settled).every((result) => result.status === "rejected")).toBe(
    true
  );
});

test("shared capture listener consumes tokens once and preserves protocol 2 finalization", async () => {
  const connect = spyOn(transcription, "connectTranscription");
  connect.mockImplementation(async ({ onSegment }) => ({
    close() {},
    async finish() {
      onSegment({
        id: "turn",
        receivedAt: Date.now(),
        text: "Captured speech",
      });
    },
    push() {},
  }));

  try {
    await service.invoke("a", "configure", { apiKey: "test" }, admin);
    await service.invoke("b", "configure", { apiKey: "test" }, admin);

    const first = await service.invoke(
      "a",
      "start-capture",
      { url: "https://meet.google.com/abc-defg-hij" },
      admin
    );

    const second = await service.invoke(
      "b",
      "start-capture",
      { url: "https://meet.google.com/xyz-abcd-efg" },
      admin
    );

    expect(new URL(first.capture.url).origin).toBe(
      new URL(second.capture.url).origin
    );
    const ws = new WebSocket(first.capture.url);

    const finalized = new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("Capture timed out")),
        2000
      );

      ws.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));

        if (message.type === "ready") {
          ws.send(new Uint8Array(4800));
          ws.send(JSON.stringify({ protocol: 2, type: "stop" }));
        }

        if (message.type === "capture-finalized") {
          clearTimeout(deadline);
          resolve();
        }
      });
      ws.addEventListener("error", () => {
        clearTimeout(deadline);
        reject(new Error("Socket failed"));
      });
    });

    await finalized;
    expect(
      (await fetch(first.capture.url.replace(/^ws:/, "http:"))).status
    ).toBe(401);
    await Bun.sleep(10);

    const transcript = await service.invoke(
      "a",
      "transcript",
      { meetingId: first.id },
      admin
    );

    expect(transcript.meeting.state).toBe("finished");
    expect(transcript.segments.map((segment) => segment.text)).toEqual([
      "Captured speech",
    ]);
    await service.invoke("b", "leave", { meetingId: second.id }, admin);
  } finally {
    connect.mockRestore();
  }
});
