import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginExecutionContext } from "@nakama/core";
import { privateJson, run } from "./actions";
import { MeetingStore } from "./store";

test("settings are admin-only, credentials never returned, meetings are scoped to actor and profile", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-actions-"));
  const context: PluginExecutionContext = {
    actionKey: "configure",
    actor: { id: "a", role: "admin" },
    apiVersion: 1,
    dataDir: dir,
    invocationId: "test",
    orgId: "org",
    pluginId: "google-meet",
    pluginVersion: "0.1.0",
    profileId: "p",
  };
  const input = {
    apiKey: "secret-api-key",
  };
  try {
    await expect(
      run(input, { ...context, actor: { id: "a", role: "member" } })
    ).rejects.toThrow();
    const result = await run(input, context);
    expect(JSON.stringify(result)).not.toContain("secret");
    mkdirSync(join(dir, "workers", "meet"), { recursive: true });
    privateJson(join(dir, "workers", "meet", "status.json"), {
      state: "ready",
      updatedAt: Date.now(),
    });
    const meeting = (await run(
      { url: "https://meet.google.com/abc-defg-hij" },
      { ...context, actionKey: "start-capture" }
    )) as { id: string };
    const store = new MeetingStore(dir, "org");
    store.addSegment(meeting.id, {
      id: "turn",
      receivedAt: 1,
      text: "Saved speech",
    });
    store.close();
    const overview = (await run({}, { ...context, actionKey: "meetings" })) as {
      meetings: { transcriptFile?: string }[];
    };
    expect(overview.meetings[0]?.transcriptFile).toBe(
      `meeting-${meeting.id}.txt`
    );
    const other = (await run(
      {},
      { ...context, actionKey: "meetings", actor: { id: "b", role: "member" } }
    )) as { meetings: unknown[] };
    expect(other.meetings).toEqual([]);
    for (const actionKey of ["status", "transcript", "leave", "delete"]) {
      await expect(
        run(
          { meetingId: meeting.id },
          { ...context, actionKey, actor: { id: "b", role: "member" } }
        )
      ).rejects.toThrow();
      await expect(
        run(
          { meetingId: meeting.id },
          { ...context, actionKey, profileId: "other" }
        )
      ).rejects.toThrow();
      await expect(
        run(
          { meetingId: meeting.id },
          { ...context, actionKey, actor: { id: "a", role: "viewer" } }
        )
      ).rejects.toThrow();
    }
    const status = (await run(
      { meetingId: meeting.id },
      { ...context, actionKey: "status" }
    )) as { meeting: { state: string } };
    expect(status.meeting.state).toBe("queued");
    await expect(
      run({ meetingId: meeting.id }, { ...context, actionKey: "delete" })
    ).rejects.toThrow();
    const stopped = await run(
      { meetingId: meeting.id },
      { ...context, actionKey: "leave" }
    );
    expect(stopped).toMatchObject({ state: "finished", stopRequested: 1 });
    expect(
      await run(
        { meetingId: meeting.id },
        {
          ...context,
          actionKey: "delete",
          actor: { id: "a", role: "member" },
        }
      )
    ).toEqual({ deleted: true });
    const deleted = new MeetingStore(dir, "org");
    expect(deleted.get(meeting.id)).toBeNull();
    expect(deleted.transcript(meeting.id)).toEqual([]);
    expect(deleted.list()).toEqual([]);
    deleted.close();
    expect(
      existsSync(join(dir, "transcripts", `meeting-${meeting.id}.txt`))
    ).toBe(false);
    const next = await run(
      { url: "https://meet.google.com/abc-defg-hij" },
      { ...context, actionKey: "start-capture" }
    );
    expect(next).toMatchObject({ state: "queued" });
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("meeting history keeps active meetings first and groups local calendar days", async () => {
  const { meetingGroups } = await import("./ui");
  const now = new Date(2026, 0, 1, 0, 5);
  const base = {
    actorId: "a",
    durationMinutes: 120,
    error: null,
    profileId: null,
    stopRequested: 0,
    updatedAt: 0,
    url: "https://meet.google.com/abc-defg-hij",
  };
  const groups = meetingGroups(
    [
      { ...base, createdAt: now.getTime(), id: "today", state: "finished" },
      {
        ...base,
        createdAt: new Date(2025, 11, 31, 23, 55).getTime(),
        id: "yesterday",
        state: "failed",
      },
      {
        ...base,
        createdAt: new Date(2025, 11, 31, 23, 50).getTime(),
        id: "active",
        state: "transcribing",
      },
    ],
    now
  );
  expect(groups.map((group) => group.title)).toEqual([
    "In progress",
    "Today",
    "Yesterday",
  ]);
  expect(
    groups.flatMap((group) => group.meetings.map((meeting) => meeting.id))
  ).toEqual(["active", "today", "yesterday"]);
  expect(meetingGroups([], now)).toEqual([]);
});
