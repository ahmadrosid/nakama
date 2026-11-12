import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import * as recordingImport from "../meet-recording-import";
import { GoogleMeetService } from "./service";

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

  service = new GoogleMeetService(
    db,
    root,
    async () => ({ text: "Recording" }),
    () => "test"
  );
});

afterEach(async () => {
  await service.close();
  rmSync(root, { force: true, recursive: true });
});

test("startup is idempotent and restart preserves settings while recovering unfinished capture", async () => {
  await db.upsertTool({
    createdAt: now,
    description: "",
    handlerConfig: { name: "google_meet_delete" },
    handlerType: "builtin",
    id: "meet_a_delete",
    name: "google_meet_delete",
    orgId: "a",
    updatedAt: now,
  });
  await Promise.all([
    service.ensureOrganization("a"),
    service.ensureOrganization("a"),
  ]);

  const capture = await service.invoke(
    "a",
    "start-capture",
    { url: "https://meet.google.com/abc-defg-hij" },
    admin,
    undefined,
    undefined,
    "ws://127.0.0.1:4310/v1/meet/capture"
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
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    "google_meet_meetings",
    "google_meet_transcript",
  ]);
  expect(service.tools().map((tool) => tool.name)).toEqual([
    "google_meet_meetings",
    "google_meet_transcript",
  ]);
});

test("agent tools require current assignment and see only their profile and their member's page meetings", async () => {
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

  const page = await service.invoke(
    "a",
    "upload",
    { content: "UGFnZSBub3Rlcw==", filename: "page.md" },
    admin
  );

  await service.invoke(
    "a",
    "upload",
    { content: "Qm9iIG5vdGVz", filename: "bob.md" },
    { id: "bob", role: "member" }
  );

  await service.invoke(
    "a",
    "upload",
    { content: "T3RoZXIgbm90ZXM=", filename: "other.md" },
    admin,
    undefined,
    "other-profile"
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

  expect(result.meetings.map((meeting) => meeting.id).sort()).toEqual(
    [own.id, page.id].sort()
  );
  await db.unassignToolFromProfile("profile", "meet_a_meetings");
  await expect(tool.run({}, context)).rejects.toThrow();
});

test("members cannot read another user's or another organization's meeting; missing actors cannot read or write", async () => {
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
    service.invoke("a", "meetings", {}, { id: "", role: "member" })
  ).rejects.toThrow();
  await expect(
    service.invoke(
      "a",
      "delete",
      { meetingId: meeting.id },
      { id: "", role: "member" }
    )
  ).rejects.toThrow();
  const own = await service.invoke("a", "meetings", {}, admin);
  expect(own.meetings.map((item) => item.id)).toEqual([meeting.id]);
});

test("queued capture blocks snapshots and disabling invalidates its ticket", async () => {
  const capture = await service.invoke(
    "a",
    "start-capture",
    { durationMinutes: 1, url: "https://meet.google.com/abc-defg-hij" },
    admin,
    undefined,
    undefined,
    "ws://127.0.0.1:4310/v1/meet/capture"
  );

  expect(capture.capture.url).toBe("ws://127.0.0.1:4310/v1/meet/capture");
  // A 409, so a scheduled backup keeps this reason for Settings
  await expect(service.withSnapshot(async () => true)).rejects.toEqual(
    expect.objectContaining({ status: 409 })
  );
  await service.invoke("a", "configure", { enabled: false }, admin);
  expect(await service.withSnapshot(async () => true)).toBe(true);
});

test("bounds simultaneous uploads and shutdown cancels a provider that ignores abort", async () => {
  await service.close();
  service = new GoogleMeetService(
    db,
    root,
    () => new Promise(() => {}),
    () => "test"
  );
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

test("start-capture without the main server's socket URL fails and saves no meeting", async () => {
  await expect(
    service.invoke(
      "a",
      "start-capture",
      { url: "https://meet.google.com/abc-defg-hij" },
      admin
    )
  ).rejects.toThrow();

  const overview = await service.invoke("a", "meetings", {}, admin);
  expect(overview.meetings).toEqual([]);
  expect(await service.withSnapshot(async () => true)).toBe(true);
});

test("a set NAKAMA_MEET_CAPTURE_* variable logs one warning and starts fine", async () => {
  const previous = process.env.NAKAMA_MEET_CAPTURE_HOST;
  process.env.NAKAMA_MEET_CAPTURE_HOST = "0.0.0.0";
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);

  try {
    await service.close();
    service = new GoogleMeetService(
      db,
      root,
      async () => ({ text: "Recording" }),
      () => "test"
    );

    expect(warn).toHaveBeenCalledTimes(1);
    await service.initialize();
    expect((await service.invoke("a", "meetings", {}, admin)).meetings).toEqual(
      []
    );
  } finally {
    warn.mockRestore();

    if (previous === undefined) {
      delete process.env.NAKAMA_MEET_CAPTURE_HOST;
    } else {
      process.env.NAKAMA_MEET_CAPTURE_HOST = previous;
    }
  }
});

test("built-in recording imports use the current member and cancel without saving", async () => {
  await service.close();
  let importing!: () => void;

  const started = new Promise<void>((resolve) => {
    importing = resolve;
  });

  const importer = spyOn(
    recordingImport,
    "importMeetRecording"
  ).mockImplementation(async (_composio, input, signal) => {
    expect(input).toMatchObject({
      model: "whisper-1",
      orgId: "a",
      provider: { apiKey: "test", type: "openai" },
      userId: "alice",
    });
    importing();
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true })
    );

    return { filename: "meeting.mp4", text: "Late transcript" };
  });

  service = new GoogleMeetService(
    db,
    root,
    async () => ({ text: "" }),
    () => "test",
    {
      async downloadMeetRecording() {
        throw new Error("Unexpected download");
      },
      async listMeetRecordings(orgId, userId) {
        expect([orgId, userId]).toEqual(["a", "alice"]);

        return { driveConnected: true, gmailConnected: true, recordings: [] };
      },
    }
  );

  try {
    expect(
      (await service.invoke("a", "recordings", {}, admin)).driveConnected
    ).toBe(true);
    await expect(
      service.invoke(
        "a",
        "import-recording",
        { fileId: "../invalid", messageId: "msg" },
        admin
      )
    ).rejects.toThrow();
    expect(importer).not.toHaveBeenCalled();

    const pending = service.invoke(
      "a",
      "import-recording",
      { fileId: "drive_file_123", messageId: "msg" },
      admin
    );

    const settled = Promise.allSettled([pending]);
    await started;
    await expect(service.withSnapshot(async () => true)).rejects.toThrow();
    expect(() => service.pauseOrganization("a")).toThrow();
    await service.close();
    expect((await settled)[0]?.status).toBe("rejected");
    await service.reopen();
    expect((await service.invoke("a", "meetings", {}, admin)).meetings).toEqual(
      []
    );
    await service.invoke("a", "configure", { enabled: false }, admin);
    await expect(
      service.invoke("a", "recordings", {}, admin)
    ).rejects.toThrow();
  } finally {
    importer.mockRestore();
  }
});
