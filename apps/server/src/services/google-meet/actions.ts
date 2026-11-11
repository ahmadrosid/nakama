import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderInstance, UserConfig } from "@nakama/core";
import type { MeetImportProgress } from "@nakama/core/google-meet";
import { z } from "zod";
import type { ComposioService } from "../composio-service";
import { importMeetRecording } from "../meet-recording-import";
import { type Meeting, MeetingStore } from "./store";

export const OPENAI_PROVIDER_REQUIRED_MESSAGE =
  "Add an OpenAI provider in AI Providers first.";

const TRANSCRIPTION_PROVIDER_REQUIRED_MESSAGE =
  "Connect a transcription provider on the Google Meet page first.";

export interface MeetTranscriber {
  instance: Pick<ProviderInstance, "apiKey" | "baseUrl" | "type">;
  model: string;
}

// Meet calls OpenAI directly, so it takes the key from the AI provider settings:
// the default provider when it is OpenAI, otherwise the first OpenAI provider.
export function openaiProviderKey(config: UserConfig | null) {
  const providers = (config?.providers ?? []).filter(
    (provider) => provider.type === "openai" && provider.apiKey.trim()
  );

  const provider =
    providers.find(({ id }) => id === config?.defaultProviderId) ??
    providers[0];

  return provider?.apiKey.trim() || null;
}

function privateJson(path: string, data: { enabled: boolean }) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
  renameSync(temporary, path);
}

export const meetingActionSchemas = {
  "approve-extension": z
    .object({ code: z.string().trim().min(1).max(16) })
    .strict(),
  configure: z
    .object({
      enabled: z.boolean().optional(),
    })
    .strict(),
  delete: z.object({ meetingId: z.string() }).strict(),
  "extension-keys": z.object({}).strict(),
  "import-progress": z.object({}).strict(),
  "import-recording": z
    .object({
      fileId: z.string().regex(/^[A-Za-z0-9_-]{10,128}$/),
      messageId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    })
    .strict(),
  leave: z.object({ meetingId: z.string() }).strict(),
  meetings: z.object({}).strict(),
  recordings: z.object({}).strict(),
  "revoke-extension": z.object({ keyId: z.string().max(64) }).strict(),
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
  actor: { id: string; role: "admin" | "member" };
  captureUrl?(): Promise<string>;
  composio?: Pick<
    ComposioService,
    "listMeetRecordings" | "downloadMeetRecording"
  >;
  createCapture?(meeting: Meeting): { token: string; url: string };
  dataDir: string;
  importProgress?: {
    get(): MeetImportProgress | null;
    set(progress: MeetImportProgress | null): void;
  };
  openaiKey?(): string | null;
  orgId: string;
  profileId?: string;
  signal?: AbortSignal;
  transcribeAudio?(
    request: { data: string; filename: string; mediaType: string },
    signal?: AbortSignal
  ): Promise<{ text: string }>;
  /** The workspace transcription model, used for uploads and imports. */
  transcriber?(): Promise<MeetTranscriber | null>;
}

export interface MeetActionInput {
  after?: number;
  code?: string;
  content?: string;
  durationMinutes?: number;
  enabled?: boolean;
  fileId?: string;
  filename?: string;
  keyId?: string;
  meetingId?: string;
  messageId?: string;
  url?: string;
}

export function meetEnabled(directory: string) {
  const path = join(directory, "availability.json");

  return (
    !existsSync(path) || JSON.parse(readFileSync(path, "utf8")).enabled === true
  );
}

// Uploads and imports use the workspace transcription model. Installs that
// only have an OpenAI provider keep working through Whisper.
async function resolveTranscriber(
  context: MeetExecutionContext,
  openaiKey: string | null
): Promise<MeetTranscriber | null> {
  const selected = await context.transcriber?.();

  if (selected) {
    return selected;
  }

  return openaiKey
    ? { instance: { apiKey: openaiKey, type: "openai" }, model: "whisper-1" }
    : null;
}

async function transcriptionStatus(
  context: MeetExecutionContext,
  openaiKey: string | null
) {
  try {
    const selected = await context.transcriber?.();

    return {
      configured: Boolean(selected || openaiKey),
      transcription: selected
        ? { model: selected.model, type: selected.instance.type }
        : null,
      transcriptionError: null,
    };
  } catch (error) {
    // A broken setting must not hide the meeting list; the page shows why.
    return {
      configured: Boolean(openaiKey),
      transcription: null,
      transcriptionError:
        error instanceof Error
          ? error.message
          : "Transcription setting is invalid",
    };
  }
}

export async function run(
  input: MeetActionInput,
  context: MeetExecutionContext
) {
  const actionKey = z
    .enum([
      "configure",
      "delete",
      "import-progress",
      "import-recording",
      "leave",
      "meetings",
      "recordings",
      "start-capture",
      "status",
      "transcript",
      "upload",
    ])
    .parse(context.actionKey);

  const schema = meetingActionSchemas[actionKey];

  input = schema.parse(input);

  if (
    !context.actor.id ||
    (context.actor.role !== "admin" && context.actor.role !== "member")
  ) {
    throw new Error("Member access required");
  }

  const store = new MeetingStore(context.dataDir, context.orgId);

  // An agent sees its profile's meetings plus its member's own page meetings,
  // which have no profile.
  const canAccess = (meeting: Meeting) =>
    (context.actor.role === "admin" || meeting.actorId === context.actor.id) &&
    (!context.profileId ||
      meeting.profileId === context.profileId ||
      (meeting.profileId === null && meeting.actorId === context.actor.id));

  try {
    const action = context.actionKey ?? "";
    const openaiKey = context.openaiKey?.() ?? null;

    if (action === "configure") {
      if (context.actor.role !== "admin") {
        throw new Error("Admin access required");
      }

      if (input.enabled !== undefined) {
        privateJson(join(context.dataDir, "availability.json"), {
          enabled: input.enabled,
        });
      }

      return {
        configured: (await transcriptionStatus(context, openaiKey)).configured,
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
        ...(await transcriptionStatus(context, openaiKey)),
        enabled,
        liveReady: Boolean(openaiKey),
        meetings: enabled
          ? store.list(
              context.actor.role === "admin" ? null : context.actor.id,
              context.profileId ?? null,
              context.actor.id
            )
          : [],
      };
    }

    if (action === "start-capture") {
      if (!openaiKey) {
        throw new Error(OPENAI_PROVIDER_REQUIRED_MESSAGE);
      }

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
        !filename ||
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

      if (!encoded || encoded.length > Math.ceil(limit / 3) * 4) {
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

      if (!result.text.trim()) {
        throw new Error("No speech found in the audio file");
      }

      return store.importFile(
        filename,
        result.text,
        context.actor.id,
        context.profileId
      );
    }

    if (action === "import-progress") {
      return { progress: context.importProgress?.get() ?? null };
    }

    if (action === "recordings" || action === "import-recording") {
      if (!context.composio) {
        throw new Error("Recording import is unavailable");
      }

      if (action === "recordings") {
        return context.composio.listMeetRecordings(
          context.orgId,
          context.actor.id
        );
      }

      const transcriber = await resolveTranscriber(context, openaiKey);

      if (!transcriber) {
        throw new Error(TRANSCRIPTION_PROVIDER_REQUIRED_MESSAGE);
      }

      const progress = context.importProgress;

      try {
        const result = await importMeetRecording(
          context.composio,
          {
            // SAFETY: The surrounding code checked this value before the assertion.
            fileId: input.fileId as string,
            // SAFETY: The surrounding code checked this value before the assertion.
            messageId: input.messageId as string,
            model: transcriber.model,
            orgId: context.orgId,
            provider: transcriber.instance,
            userId: context.actor.id,
          },
          context.signal ?? AbortSignal.timeout(20 * 60_000),
          (step) => progress?.set(step)
        );

        context.signal?.throwIfAborted();

        if (!result.text.trim()) {
          throw new Error("Recording transcription returned no speech");
        }

        progress?.set({ step: "save" });

        return store.importFile(
          result.filename,
          result.text,
          context.actor.id,
          context.profileId
        );
      } finally {
        progress?.set(null);
      }
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
