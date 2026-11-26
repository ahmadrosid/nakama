import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { link, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import {
  buildToolExecutionContext,
  fetchPublicHttps,
  NakamaApiError,
  normalizeBaseUrl,
  readBoundedBody,
  type ToolContext,
  type ToolDefinition,
  type UserConfig,
  uniqueArtifactPath,
} from "@nakama/core";
import { defaultDiscoveryBaseUrl } from "@nakama/core/discovery-providers";
import type { DatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import { readApiKeyForInstance } from "../providers/create";
import { resolveConfiguredModelInstance } from "../services/provider-instance-helpers";

const GENERATE_VIDEO_TOOL_NAME = "generate_video";

const VIDEO_MODEL_REQUIRED_MESSAGE =
  "Video generation is off. A platform admin can pick a video generation model in Settings → AI Providers (/settings/providers#video-generation).";

const VIDEO_MODEL_INVALID_MESSAGE =
  "Configured video generation model is invalid. Update it in Settings → AI Providers (/settings/providers#video-generation).";

const VIDEO_GENERATION_DURATIONS = [6, 10] as const;

const VIDEO_GENERATION_RESOLUTIONS = ["768P", "1080P"] as const;

/** Hailuo makes a clip in about 1-5 minutes; past this the turn gets an error. */
const VIDEO_GENERATION_TIMEOUT_MS = 10 * 60 * 1000;

/** MiniMax asks callers to poll the task no faster than every 10 s. */
const DEFAULT_POLL_INTERVAL_MS = 10_000;

/** A 10 s 1080P clip is about 20 MB; this stops a runaway download. */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const MAX_JSON_BODY_BYTES = 256 * 1024;

const DEFAULT_FILENAME = "generated-video.mp4";

/** Plain messages for MiniMax `base_resp.status_code`; the raw text goes to the server log. */
const MINIMAX_STATUS_MESSAGES = new Map<number, string>([
  [1002, "MiniMax is rate limiting video requests. Try again in a minute."],
  [1004, "MiniMax rejected the API key. Update it in Settings → AI Providers."],
  [1008, "The MiniMax account has no balance left for video."],
  [1026, "MiniMax flagged the prompt as sensitive. Change the prompt."],
  [2013, "MiniMax rejected the video parameters."],
  [2049, "MiniMax rejected the API key. Update it in Settings → AI Providers."],
]);

/**
 * Any model ID MiniMax serves, so a new Hailuo model needs no code change.
 * The shape check keeps a typo or pasted text out of the request URL and body.
 */
const VIDEO_MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type VideoFetch = (url: string, init?: RequestInit) => Promise<Response>;

interface ResolvedVideoGenerationSelection {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * `<providerId>::<modelId>` on a MiniMax provider. Null when no model is set;
 * throws when the saved model no longer resolves.
 */
export function resolveVideoGenerationSelection(
  userConfig: UserConfig | null | undefined,
  videoModel: string | null | undefined
): ResolvedVideoGenerationSelection | null {
  const resolved = resolveConfiguredModelInstance(userConfig, videoModel, {
    invalid: VIDEO_MODEL_INVALID_MESSAGE,
    missingProvider: VIDEO_MODEL_INVALID_MESSAGE,
  });

  if (!resolved) {
    return null;
  }

  const { instance, modelId } = resolved;

  if (instance.type !== "minimax" && instance.type !== "minimax_cn") {
    throw new NakamaApiError(VIDEO_MODEL_INVALID_MESSAGE, 400);
  }

  // Said plainly, since the admin sees it on the Settings page as they type.
  if (!VIDEO_MODEL_ID_PATTERN.test(modelId)) {
    throw new NakamaApiError(
      "A model ID can have only letters, numbers, dots, dashes and underscores, up to 128 characters.",
      400
    );
  }

  const apiKey = readApiKeyForInstance(instance, process.env)?.trim();

  if (!apiKey) {
    throw new NakamaApiError(
      `API key is missing for provider "${instance.label}".`,
      400
    );
  }

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(
      instance.baseUrl?.trim() || defaultDiscoveryBaseUrl(instance.type) || ""
    ),
    model: modelId,
  };
}

const BaseRespSchema = z
  .object({
    status_code: z.number().optional(),
    status_msg: z.string().optional(),
  })
  .optional()
  .catch(undefined);

const CreateTaskSchema = z.object({
  base_resp: BaseRespSchema,
  task_id: z.string().optional().catch(undefined),
});

const QueryTaskSchema = z.object({
  base_resp: BaseRespSchema,
  file_id: z.string().optional().catch(undefined),
  status: z.string().optional().catch(undefined),
});

const RetrieveFileSchema = z.object({
  base_resp: BaseRespSchema,
  file: z
    .object({ download_url: z.string().optional().catch(undefined) })
    .optional()
    .catch(undefined),
});

interface GenerateVideoInput {
  duration: number;
  prompt: string;
  resolution: string;
  selection: ResolvedVideoGenerationSelection;
  signal?: AbortSignal;
  /** Where the download goes; the caller moves it to its final name. */
  tempPath: string;
}

/**
 * MiniMax video is a task: create it, poll until it succeeds, then stream the
 * file from its download URL to `tempPath`. Returns the bytes written.
 */
async function generateVideoWithMinimax(
  input: GenerateVideoInput,
  seams: Pick<GenerateVideoToolDeps, "download" | "fetch" | "pollIntervalMs">
): Promise<number> {
  const fetchFn: VideoFetch = seams.fetch ?? fetch;
  const deadline = AbortSignal.timeout(VIDEO_GENERATION_TIMEOUT_MS);

  const signal = input.signal
    ? AbortSignal.any([input.signal, deadline])
    : deadline;

  const { apiKey, baseUrl, model } = input.selection;
  const headers = { Authorization: `Bearer ${apiKey}` };

  const readJson = async <T>(
    response: Response,
    schema: z.ZodType<T>,
    step: string
  ): Promise<T> => {
    if (!response.ok) {
      await response.body?.cancel();

      throw new NakamaApiError(
        `Video generation failed at ${step} (HTTP ${response.status}).`,
        502
      );
    }

    const body = await readBoundedBody(response, MAX_JSON_BODY_BYTES);

    try {
      return schema.parse(JSON.parse(body.toString("utf8")));
    } catch {
      throw new NakamaApiError(
        `Video generation returned an unexpected ${step} response.`,
        502
      );
    }
  };

  const assertOk = (baseResp: z.infer<typeof BaseRespSchema>, step: string) => {
    const code = baseResp?.status_code;

    if (!code) {
      return;
    }

    console.warn(
      `[generate_video] MiniMax ${step} failed: code ${code}: ${baseResp?.status_msg?.slice(0, 500) ?? ""}`
    );

    throw new NakamaApiError(
      MINIMAX_STATUS_MESSAGES.get(code) ??
        `MiniMax refused the video request (code ${code}). Check that the MiniMax plan includes video.`,
      502
    );
  };

  let taskId: string | undefined;

  try {
    const created = await readJson(
      await fetchFn(`${baseUrl}/video_generation`, {
        body: JSON.stringify({
          duration: input.duration,
          model,
          prompt: input.prompt,
          resolution: input.resolution,
        }),
        headers: { ...headers, "Content-Type": "application/json" },
        method: "POST",
        signal,
      }),
      CreateTaskSchema,
      "create"
    );

    assertOk(created.base_resp, "create");

    taskId = created.task_id;

    if (!taskId) {
      throw new NakamaApiError("Video generation returned no task id.", 502);
    }

    let fileId: string | undefined;

    while (!fileId) {
      await sleep(seams.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, undefined, {
        signal,
      });

      const task = await readJson(
        await fetchFn(
          `${baseUrl}/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
          { headers, signal }
        ),
        QueryTaskSchema,
        "status"
      );

      assertOk(task.base_resp, "status");

      if (task.status === "Fail") {
        throw new NakamaApiError("The provider failed to make the video.", 502);
      }

      if (task.status === "Success") {
        if (!task.file_id) {
          throw new NakamaApiError(
            "Video generation finished with no file id.",
            502
          );
        }

        fileId = task.file_id;
      }
    }

    const file = await readJson(
      await fetchFn(
        `${baseUrl}/files/retrieve?file_id=${encodeURIComponent(fileId)}`,
        { headers, signal }
      ),
      RetrieveFileSchema,
      "file"
    );

    assertOk(file.base_resp, "file");
    const downloadUrl = file.file?.download_url;

    if (!downloadUrl) {
      throw new NakamaApiError(
        "Video generation returned no download URL.",
        502
      );
    }

    // The URL comes from the provider's reply, so it goes through the same
    // public-HTTPS checks as any other fetched URL.
    const download = await (seams.download ?? fetchPublicHttps)(
      downloadUrl,
      signal
    );

    const declared = Number(download.headers.get("content-length"));

    if (!(download.ok && download.body) || declared > MAX_VIDEO_BYTES) {
      await download.body?.cancel();

      throw new NakamaApiError(
        declared > MAX_VIDEO_BYTES
          ? `Generated video exceeds the ${MAX_VIDEO_BYTES / (1024 * 1024)} MB size limit.`
          : `Video download failed (HTTP ${download.status}).`,
        502
      );
    }

    return await streamToFile(download.body, input.tempPath, signal);
  } catch (error) {
    if (deadline.aborted && !input.signal?.aborted) {
      throw new NakamaApiError(
        `Video generation timed out after ${VIDEO_GENERATION_TIMEOUT_MS / 60_000} minutes.${taskId ? ` MiniMax task ${taskId} may still finish; its file can be fetched later from MiniMax.` : ""}`,
        504
      );
    }

    throw error;
  }
}

async function streamToFile(
  body: ReadableStream<Uint8Array>,
  targetPath: string,
  signal: AbortSignal
): Promise<number> {
  let size = 0;

  try {
    await pipeline(
      async function* () {
        for await (const chunk of body) {
          size += chunk.byteLength;

          if (size > MAX_VIDEO_BYTES) {
            throw new NakamaApiError(
              `Generated video exceeds the ${MAX_VIDEO_BYTES / (1024 * 1024)} MB size limit.`,
              502
            );
          }

          yield chunk;
        }
      },
      createWriteStream(targetPath, { flags: "wx" }),
      { signal }
    );

    if (size === 0) {
      throw new NakamaApiError("Video generation returned an empty file.", 502);
    }
  } catch (error) {
    await unlink(targetPath).catch(() => undefined);

    throw error;
  }

  return size;
}

const GenerateVideoInputSchema = z.object({
  duration: z.unknown().optional(),
  filename: z.string().optional().catch(undefined),
  model: z.unknown().optional(),
  prompt: z.string().optional().catch(undefined),
  resolution: z.string().optional().catch(undefined),
});

export interface GenerateVideoToolDeps {
  db: DatabaseAdapter;
  /** Test seam for the file download; defaults to fetchPublicHttps. */
  download?: (url: string, signal: AbortSignal) => Promise<Response>;
  /** Test seam for MiniMax API calls; defaults to global fetch. */
  fetch?: VideoFetch;
  getUserConfig: () => UserConfig | null | undefined;
  pollIntervalMs?: number;
}

type GenerateVideoToolOutput =
  | {
      model: string;
      mimeType: string;
      path: string;
      sizeBytes: number;
    }
  | { error: string };

export function createGenerateVideoTool(
  deps: GenerateVideoToolDeps
): ToolDefinition {
  return {
    description:
      "Generate a short video clip from a text prompt using the workspace video model. Takes 1-5 minutes. Saves an MP4 under artifacts/. A platform admin sets the model in Settings → AI Providers (/settings/providers#video-generation) — do not pass a model name.",
    name: GENERATE_VIDEO_TOOL_NAME,
    parallelSafe: false,
    parameters: {
      additionalProperties: false,
      properties: {
        duration: {
          description:
            "Clip length in seconds: 6 (default) or 10. 1080P allows 6 only.",
          enum: [...VIDEO_GENERATION_DURATIONS],
          type: "number",
        },
        filename: {
          description:
            "Optional output filename under artifacts/ (defaults to a generated .mp4 name).",
          type: "string",
        },
        prompt: {
          description:
            "Text description of the video. Camera moves can go in brackets, e.g. [Push in].",
          type: "string",
        },
        resolution: {
          description: "768P (default) or 1080P.",
          enum: [...VIDEO_GENERATION_RESOLUTIONS],
          type: "string",
        },
      },
      required: ["prompt"],
      type: "object",
    },
    async run(input, context) {
      try {
        return await runGenerateVideoTool(
          // A non-object input parses to {}, which the prompt check reports.
          GenerateVideoInputSchema.catch({}).parse(input),
          context,
          deps
        );
      } catch (error) {
        if (error instanceof NakamaApiError) {
          return { error: error.message };
        }

        if (context.signal?.aborted) {
          return { error: "Video generation stopped." };
        }

        console.error("[generate_video] failed:", error);

        return {
          error: "Video generation failed. The server log has the cause.",
        };
      }
    },
  };
}

async function runGenerateVideoTool(
  input: z.infer<typeof GenerateVideoInputSchema>,
  context: ToolContext,
  deps: GenerateVideoToolDeps
): Promise<GenerateVideoToolOutput> {
  const prompt = input.prompt?.trim();

  if (!prompt) {
    return { error: "prompt is required." };
  }

  if (prompt.length > 2000) {
    return { error: "prompt must be 2000 characters or fewer." };
  }

  if (Object.hasOwn(input, "model")) {
    return {
      error:
        "model is not a generate_video parameter; a platform admin sets it in Settings → AI Providers (/settings/providers#video-generation).",
    };
  }

  // Models often send numbers as strings ("10").
  const duration = input.duration === undefined ? 6 : Number(input.duration);
  const resolution = input.resolution?.trim().toUpperCase() || "768P";

  if (!VIDEO_GENERATION_DURATIONS.some((allowed) => allowed === duration)) {
    return { error: "duration must be 6 or 10." };
  }

  if (!VIDEO_GENERATION_RESOLUTIONS.some((allowed) => allowed === resolution)) {
    return { error: "resolution must be 768P or 1080P." };
  }

  if (resolution === "1080P" && duration !== 6) {
    return { error: "1080P allows a 6 second clip only." };
  }

  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();

  if (!(orgId && profileId)) {
    return { error: "orgId and profileId are required." };
  }

  const stored = await deps.db.getWorkspaceSettings();

  const selection = resolveVideoGenerationSelection(
    deps.getUserConfig(),
    stored?.videoModel
  );

  if (!selection) {
    return { error: VIDEO_MODEL_REQUIRED_MESSAGE };
  }

  const { workspaceRoot } = buildToolExecutionContext(context);

  if (!workspaceRoot) {
    return { error: "orgId and profileId are required." };
  }

  const artifactsDir = path.join(workspaceRoot, "artifacts");
  await mkdir(artifactsDir, { recursive: true });

  // Each call downloads to its own hidden file and takes a free name only at
  // the end, so two calls that want the same name cannot clash.
  const wantedPath = path.join(artifactsDir, outputFilename(input.filename));
  const tempPath = path.join(artifactsDir, `.${randomUUID()}.mp4.part`);

  const sizeBytes = await generateVideoWithMinimax(
    {
      duration,
      prompt,
      resolution,
      selection,
      signal: context.signal,
      tempPath,
    },
    deps
  );

  const targetPath = await moveToFreeName(tempPath, wantedPath);

  await deps.db.upsertArtifactRecord({
    channel: context.channel ?? null,
    createdAt: new Date().toISOString(),
    filename: path.relative(artifactsDir, targetPath).split(path.sep).join("/"),
    orgId,
    profileId,
    sessionId: context.sessionId?.trim() || null,
    userId: context.userId?.trim() || null,
  });

  return {
    mimeType: "video/mp4",
    model: selection.model,
    path: path.relative(workspaceRoot, targetPath).replace(/\\/g, "/"),
    sizeBytes,
  };
}

/**
 * `link` fails when the name exists, so a name another call took between the
 * check and the link is skipped instead of overwritten.
 */
async function moveToFreeName(
  tempPath: string,
  wantedPath: string
): Promise<string> {
  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = await uniqueArtifactPath(wantedPath);

      try {
        await link(tempPath, candidate);

        return candidate;
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "EEXIST"
          )
        ) {
          throw error;
        }
      }
    }

    throw new Error(`No free artifact name for ${wantedPath}`);
  } finally {
    await unlink(tempPath).catch(() => undefined);
  }
}

function outputFilename(filename: string | undefined): string {
  const base = path.basename((filename?.trim() || "").replace(/\\/g, "/"));
  // A leading dot would hide the file from the artifacts list.
  const stem = path.basename(base, path.extname(base)).replace(/^\.+/, "");

  return stem ? `${stem}.mp4` : DEFAULT_FILENAME;
}
