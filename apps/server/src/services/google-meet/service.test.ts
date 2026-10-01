import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOrgPluginDataDir } from "@nakama/core";
import { createInMemoryDatabaseAdapter } from "@nakama/db";
import { GoogleMeetService } from "./service";
import { MeetingStore } from "./store";
import { transcriptionProviders } from "./transcription";

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

test("cutover resumes after metadata failure and preserves tool assignments and retained transcripts", async () => {
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
  await db.upsertTool({
    createdAt: now,
    description: "Meetings",
    handlerConfig: {},
    handlerType: "plugin",
    id: "old-tool",
    name: "plugin_google_meet__meetings",
    orgId: "a",
    pluginId: "google-meet",
    pluginKey: "meetings",
    updatedAt: now,
  });
  await db.assignToolToProfile("profile", "old-tool");
  await db.upsertSkill({
    createdAt: now,
    createdBy: "bundled",
    description: "Meetings",
    disableModelInvocation: false,
    enabled: true,
    hasTool: false,
    id: "old-skill",
    name: "google-meet",
    orgId: "a",
    pluginId: "google-meet",
    pluginKey: "google-meet",
    sourcePath: join(root, "old-skill"),
    updatedAt: now,
  });
  await db.assignSkillToProfile("profile", "old-skill");
  const legacy = getOrgPluginDataDir("a", "google-meet", root);
  const store = new MeetingStore(legacy, "a");
  const meeting = store.importFile(
    "notes.md",
    "Keep this transcript",
    "alice",
    "profile"
  );
  store.close();
  const retire = spyOn(db, "retireGoogleMeetPlugin");
  retire.mockRejectedValueOnce(new Error("interrupted"));
  await expect(service.ensureOrganization("a")).rejects.toThrow();
  await service.ensureOrganization("a");
  const assigned = await db.listToolsForProfile("profile");
  expect(assigned).toHaveLength(1);
  expect(assigned[0]?.id).toBe("old-tool");
  expect(assigned[0]?.handlerType).toBe("builtin");
  expect(assigned[0]?.pluginId).toBeNull();
  const skill = (await db.listSkillsForProfile("profile"))[0]!;
  expect(skill.id).toBe("old-skill");
  expect(skill.pluginId).toBeNull();
  expect(existsSync(join(skill.sourcePath, "SKILL.md"))).toBe(true);
  expect(
    existsSync(join(root, ".meet-rollback", "a", "data", "meetings.sqlite"))
  ).toBe(true);
  expect(existsSync(join(legacy, "meetings.sqlite"))).toBe(true);
  // Uninstalled plugin data stays disabled until an admin enables it.
  expect((await service.invoke("a", "meetings", {}, admin)).enabled).toBe(
    false
  );
  await service.invoke("a", "configure", { enabled: true }, admin);
  const migrated = await service.invoke(
    "a",
    "transcript",
    { meetingId: meeting.id },
    admin
  );
  expect(migrated.segments.map((segment) => segment.text).join("")).toBe(
    "Keep this transcript"
  );
  expect(
    JSON.parse(
      readFileSync(join(service.directory("a"), "migration.json"), "utf8")
    ).orgId
  ).toBe("a");
  await service.reopen();
  expect((await db.listToolsForProfile("profile"))[0]?.id).toBe("old-tool");
  retire.mockRestore();
});

test("enabled legacy installation stays enabled and its lifecycle record is retired", async () => {
  expect(
    await db.publishOrgPluginRelease({
      contributions: { skills: [], tools: [] },
      databaseGeneration: null,
      expectedRevision: 0,
      lifecycleState: "enabled",
      now,
      orgId: "a",
      pluginId: "google-meet",
      selectedVersion: "1.0.0",
    })
  ).toMatchObject({ ok: true });
  await service.ensureOrganization("a");
  expect((await service.invoke("a", "meetings", {}, admin)).enabled).toBe(true);
  expect(await db.getOrgPlugin("a", "google-meet")).toBeNull();
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
    .find((item) => item.name === "plugin_google_meet__meetings")!;
  const context = {
    orgId: "a",
    orgRole: "admin" as const,
    profileId: "profile",
    userId: "alice",
  };
  await expect(tool.run({}, context)).rejects.toThrow();
  await db.assignToolToProfile("profile", "meet_a_meetings");
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
  const provider = transcriptionProviders.openai!;
  transcriptionProviders.openai = {
    async connect({ onSegment }) {
      return {
        close() {},
        async finish() {
          onSegment({
            id: "turn",
            receivedAt: Date.now(),
            text: "Captured speech",
          });
        },
        push() {},
      };
    },
  };
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
    transcriptionProviders.openai = provider;
  }
});
