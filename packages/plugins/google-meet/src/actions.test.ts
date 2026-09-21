import { expect, mock, test } from "bun:test";
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
    const deletion = { ...context, actionKey: "delete" };
    await expect(run({ meetingId: meeting.id }, deletion)).rejects.toThrow();
    const finished = new MeetingStore(dir, "org");
    finished.update(meeting.id, "finished");
    finished.close();
    for (const denied of [
      { ...deletion, actor: { id: "b", role: "member" as const } },
      { ...deletion, actor: { id: "a", role: "viewer" as const } },
      { ...deletion, profileId: "other" },
    ]) {
      await expect(run({ meetingId: meeting.id }, denied)).rejects.toThrow();
    }
    expect(await run({ meetingId: meeting.id }, deletion)).toEqual({
      deleted: true,
    });
    const reopened = new MeetingStore(dir, "org");
    expect(reopened.get(meeting.id)).toBeNull();
    expect(reopened.transcript(meeting.id)).toEqual([]);
    expect(reopened.list()).toEqual([]);
    reopened.close();
    expect(
      existsSync(join(dir, "transcripts", `meeting-${meeting.id}.txt`))
    ).toBe(false);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("uploads preserve Markdown and use Nakama's host for audio without plugin credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-upload-"));
  const host = mock(async () => ({ text: "Audio transcript" }));
  const context = {
    actionKey: "upload",
    actor: { id: "a", role: "member" as const },
    apiVersion: 1 as const,
    dataDir: dir,
    host,
    invocationId: "test",
    orgId: "org",
    pluginId: "google-meet",
    pluginVersion: "0.1.0",
    profileId: "p",
  };
  try {
    const content = "# Planning\n\n**Keep** this Markdown.\n";
    const meeting = (await run(
      {
        content: Buffer.from(content).toString("base64"),
        filename: "notes.md",
      },
      context
    )) as { id: string; state: string };
    expect(meeting.state).toBe("finished");
    expect(host).not.toHaveBeenCalled();
    const audio = Buffer.from("audio").toString("base64");
    const imported = (await run(
      { content: audio, filename: "meeting.wav" },
      context
    )) as { id: string };
    expect(host).toHaveBeenCalledWith({
      data: audio,
      filename: "meeting.wav",
      op: "transcribe_audio",
    });
    const store = new MeetingStore(dir, "org");
    try {
      expect(
        store
          .transcript(meeting.id)
          .map((segment) => segment.text)
          .join("")
      ).toBe(content);
      expect(store.transcript(imported.id)[0]?.text).toBe("Audio transcript");
      expect(store.list("a", "p")).toHaveLength(2);
      expect(store.list("b", "p")).toEqual([]);
      expect(store.list("a", "other")).toEqual([]);
    } finally {
      store.close();
    }
    for (const filename of ["../notes.md", "notes.html", "bad\0.md"]) {
      await expect(
        run({ content: audio, filename }, context)
      ).rejects.toThrow();
    }
    await expect(
      run({ content: "%%%", filename: "notes.md" }, context)
    ).rejects.toThrow();
    await expect(
      run(
        {
          content: Buffer.alloc(1024 * 1024 + 1, "x").toString("base64"),
          filename: "notes.md",
        },
        context
      )
    ).rejects.toThrow();
    await expect(
      run(
        { content: audio, filename: "notes.md" },
        { ...context, actor: { id: "a", role: "viewer" } }
      )
    ).rejects.toThrow();
    host.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(
      run({ content: audio, filename: "meeting.wav" }, context)
    ).rejects.toThrow();
    const afterFailure = new MeetingStore(dir, "org");
    expect(afterFailure.list()).toHaveLength(2);
    afterFailure.close();
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});
