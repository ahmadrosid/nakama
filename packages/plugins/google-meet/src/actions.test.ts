import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
      authenticated: true,
      state: "ready",
      updatedAt: Date.now(),
    });
    for (const actionKey of [
      "connect",
      "connection",
      "finish-login",
      "disconnect",
    ]) {
      await expect(
        run({}, { ...context, actionKey, actor: { id: "a", role: "member" } })
      ).rejects.toThrow("Admin access required");
    }
    const meeting = (await run(
      { url: "https://meet.google.com/abc-defg-hij" },
      { ...context, actionKey: "join" }
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
    for (const actionKey of ["status", "transcript", "leave"]) {
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
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
