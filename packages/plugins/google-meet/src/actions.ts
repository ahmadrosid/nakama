import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginExecutionContext } from "@nakama/core";
import { type Meeting, MeetingStore } from "./store";
import { transcriptionConfig } from "./transcription";

export function privateJson(path: string, data: unknown) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
  renameSync(temporary, path);
}

export function readSettings(directory: string) {
  return transcriptionConfig(
    JSON.parse(readFileSync(join(directory, "settings.json"), "utf8"))
  );
}

export async function run(
  input: Record<string, unknown>,
  context: PluginExecutionContext & {
    host?(request: Record<string, unknown>): Promise<unknown>;
  }
) {
  if (context.actor.role === "viewer") {
    throw new Error("Member access required");
  }
  const store = new MeetingStore(context.dataDir, context.orgId);
  const canAccess = (meeting: Meeting) =>
    (context.actor.role === "admin" || meeting.actorId === context.actor.id) &&
    (!context.profileId || meeting.profileId === context.profileId);
  try {
    const action = context.actionKey ?? "";
    const settingsPath = join(context.dataDir, "settings.json");
    if (action === "configure") {
      if (context.actor.role !== "admin") {
        throw new Error("Admin access required");
      }
      const previous = existsSync(settingsPath)
        ? readSettings(context.dataDir)
        : {};
      const config = transcriptionConfig({
        ...previous,
        ...input,
        apiKey: input.apiKey || (previous as { apiKey?: string }).apiKey,
      });
      privateJson(settingsPath, config);
      return { configured: true };
    }
    let worker: {
      state: string;
      updatedAt?: number;
      message?: string;
      captureUrl?: string;
    } = {
      state: "stopped",
    };
    try {
      worker = JSON.parse(
        readFileSync(
          join(context.dataDir, "workers", "meet", "status.json"),
          "utf8"
        )
      );
    } catch {
      /* Worker has not started. */
    }
    if (!worker.updatedAt || Date.now() - worker.updatedAt > 15_000) {
      worker = { state: "stopped" };
    }
    if (action === "meetings") {
      return {
        authenticated: worker.state === "ready",
        canConfigure: context.actor.role === "admin",
        captureProtocol: 2,
        configured: existsSync(settingsPath),
        meetings: store.list(
          context.actor.role === "admin" ? null : context.actor.id,
          context.profileId ?? null
        ),
        worker,
      };
    }
    if (action === "start-capture") {
      if (worker.state !== "ready") {
        throw new Error(
          worker.message ?? "Start the Google Meet worker in Workers first"
        );
      }
      readSettings(context.dataDir);
      const meeting = store.create(
        String(input.url ?? "").trim(),
        context.actor.id,
        context.profileId,
        Number(input.durationMinutes ?? 120)
      );
      const token = crypto.randomUUID();
      privateJson(join(context.dataDir, "capture.json"), {
        actorId: meeting.actorId,
        expiresAt: Date.now() + meeting.durationMinutes * 60_000,
        meetingId: meeting.id,
        profileId: meeting.profileId,
        token,
      });
      return {
        ...meeting,
        capture: worker.captureUrl
          ? {
              token,
              url: `${worker.captureUrl}?meetingId=${meeting.id}&token=${token}`,
            }
          : undefined,
      };
    }
    if (action === "upload") {
      const filename = input.filename;
      const encoded = input.content;
      if (
        typeof filename !== "string" ||
        filename.length > 255 ||
        /[\\/\x00-\x1f]/.test(filename)
      ) {
        throw new Error("Invalid filename");
      }
      const markdown = /\.(md|markdown)$/i.test(filename);
      if (
        !(markdown || /\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)$/i.test(filename))
      ) {
        throw new Error("Choose a Markdown or supported audio file");
      }
      const limit = (markdown ? 1 : 7) * 1024 * 1024;
      if (
        typeof encoded !== "string" ||
        !encoded.length ||
        encoded.length > Math.ceil(limit / 3) * 4
      ) {
        throw new Error(`File must be under ${markdown ? 1 : 7} MB`);
      }
      const bytes = Buffer.from(encoded, "base64");
      if (
        !bytes.length ||
        bytes.length > limit ||
        bytes.toString("base64") !== encoded
      ) {
        throw new Error("Invalid file content or size");
      }
      if (markdown) {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (!text.trim() || text.includes("\0")) {
          throw new Error("Markdown file must contain text");
        }
        return store.importFile(
          filename,
          text,
          context.actor.id,
          context.profileId
        );
      }
      if (!context.host) {
        throw new Error(
          "Nakama transcription is unavailable; update the server"
        );
      }
      const result = (await context.host({
        data: encoded,
        filename,
        op: "transcribe_audio",
      })) as { text?: unknown };
      if (typeof result.text !== "string" || !result.text.trim()) {
        throw new Error("No speech found in the audio file");
      }
      return store.importFile(
        filename,
        result.text,
        context.actor.id,
        context.profileId
      );
    }
    const meeting = store.get(String(input.meetingId ?? ""));
    if (!(meeting && canAccess(meeting))) {
      throw new Error("Meeting not found");
    }
    if (action === "status") {
      return { meeting, worker };
    }
    if (action === "delete") {
      store.delete(meeting.id);
      return { deleted: true };
    }
    if (action === "leave") {
      store.stop(meeting.id);
      if (meeting.state === "queued") {
        store.update(
          meeting.id,
          "failed",
          "Capture cancelled before recording started"
        );
      }
      return { ...meeting, stopRequested: 1 };
    }
    if (action === "transcript") {
      const after = Number(input.after ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new Error("Invalid transcript cursor");
      }
      const segments = store.transcript(meeting.id, after);
      return {
        meeting,
        nextCursor: segments.at(-1)?.sequence ?? after,
        segments,
      };
    }
    if (action === "caption") {
      if (
        typeof input.id !== "string" ||
        typeof input.text !== "string" ||
        typeof input.speakerName !== "string" ||
        !input.text.trim() ||
        !input.speakerName.trim()
      ) {
        throw new Error("Invalid caption");
      }
      store.addCaptionSegment(meeting.id, {
        endMs: typeof input.endMs === "number" ? input.endMs : null,
        id: input.id,
        receivedAt: Date.now(),
        speakerName: input.speakerName.trim(),
        startMs: typeof input.startMs === "number" ? input.startMs : null,
        text: input.text.trim(),
      });
      return { ok: true };
    }
    throw new Error("Unknown meeting action");
  } finally {
    store.close();
  }
}
