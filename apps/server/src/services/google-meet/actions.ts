import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
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

export const meetingActionSchemas = {
  configure: z
    .object({
      apiKey: z.string().max(4096).optional(),
      enabled: z.boolean().optional(),
    })
    .strict(),
  delete: z.object({ meetingId: z.string() }).strict(),
  leave: z.object({ meetingId: z.string() }).strict(),
  meetings: z.object({}).strict(),
  "start-capture": z
    .object({
      durationMinutes: z.number().int().min(1).max(120).optional(),
      url: z.string(),
    })
    .strict(),
  status: z.object({ meetingId: z.string() }).strict(),
  transcript: z
    .object({
      after: z.number().int().nonnegative().optional(),
      meetingId: z.string(),
    })
    .strict(),
  upload: z
    .object({
      content: z.string().max(9_786_712),
      filename: z.string().max(255),
    })
    .strict(),
};

export interface MeetExecutionContext {
  actionKey: string;
  actor: { id: string; role: "admin" | "member" | "viewer" };
  captureUrl?(): Promise<string>;
  createCapture?(meeting: Meeting): { token: string; url: string };
  dataDir: string;
  orgId: string;
  profileId?: string;
  signal?: AbortSignal;
  transcribeAudio?(
    request: { data: string; filename: string; mediaType: string },
    signal?: AbortSignal
  ): Promise<{ text: string }>;
}

export function meetEnabled(directory: string) {
  const path = join(directory, "availability.json");
  return (
    !existsSync(path) || JSON.parse(readFileSync(path, "utf8")).enabled === true
  );
}

export async function run(
  input: Record<string, unknown>,
  context: MeetExecutionContext
) {
  const schema =
    meetingActionSchemas[
      context.actionKey as keyof typeof meetingActionSchemas
    ];
  if (!Object.hasOwn(meetingActionSchemas, context.actionKey)) {
    throw new Error("Unknown meeting action");
  }
  input = schema.parse(input);
  if (!context.actor.id || context.actor.role === "viewer") {
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
      if (input.apiKey !== undefined) {
        privateJson(
          settingsPath,
          transcriptionConfig({ apiKey: input.apiKey })
        );
      }
      if (typeof input.enabled === "boolean") {
        privateJson(join(context.dataDir, "availability.json"), {
          enabled: input.enabled,
        });
      }
      return {
        configured: existsSync(settingsPath),
        enabled: meetEnabled(context.dataDir),
      };
    }
    const enabled = meetEnabled(context.dataDir);
    if (
      !(enabled || (action === "meetings" && context.actor.role === "admin"))
    ) {
      throw new Error("Google Meet is disabled");
    }
    if (action === "meetings") {
      return {
        canConfigure: context.actor.role === "admin",
        captureProtocol: 2,
        configured: existsSync(settingsPath),
        enabled,
        meetings: enabled
          ? store.list(
              context.actor.role === "admin" ? null : context.actor.id,
              context.profileId ?? null
            )
          : [],
      };
    }
    if (action === "start-capture") {
      readSettings(context.dataDir);
      if (!(context.captureUrl && context.createCapture)) {
        throw new Error("Capture service unavailable");
      }
      await context.captureUrl();
      const meeting = store.create(
        String(input.url ?? "").trim(),
        context.actor.id,
        context.profileId,
        Number(input.durationMinutes ?? 120)
      );
      return { ...meeting, capture: context.createCapture(meeting) };
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
      if (!context.transcribeAudio) {
        throw new Error("Transcription is unavailable");
      }
      const result = await context.transcribeAudio(
        { data: encoded, filename, mediaType: "application/octet-stream" },
        context.signal
      );
      context.signal?.throwIfAborted();
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
      return { meeting };
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
    throw new Error("Unknown meeting action");
  } finally {
    store.close();
  }
}
