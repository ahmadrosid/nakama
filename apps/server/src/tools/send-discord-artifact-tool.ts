import { stat } from "node:fs/promises";
import path from "node:path";
import {
  getProfileArtifactsDir,
  guardFilePath,
  inferArtifactMimeType,
  PathGuardError,
  type ToolContext,
  type ToolDefinition,
} from "@nakama/core";
import {
  DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES,
  formatDiscordAttachmentSizeLimitMessage,
  formatDiscordUnsupportedAttachmentMessage,
  isDiscordAttachableArtifact,
} from "@nakama/core/discord-attachment";

export const SEND_DISCORD_ARTIFACT_TOOL_NAME = "send_discord_artifact";

export interface SendDiscordArtifactInput {
  path: string;
}

export interface SendDiscordArtifactSuccess {
  filename: string;
  mimeType: string;
  ok: true;
  path: string;
  sizeBytes: number;
}

export interface SendDiscordArtifactFailure {
  error: string;
  ok: false;
}

export type SendDiscordArtifactOutput =
  | SendDiscordArtifactSuccess
  | SendDiscordArtifactFailure;

function requireDiscordChannel(context: ToolContext): void {
  if (context.channel !== "discord") {
    throw new Error(
      "send_discord_artifact is only available in Discord chats."
    );
  }
}

function requireOrgAndProfile(context: ToolContext): {
  orgId: string;
  profileId: string;
} {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();
  if (!(orgId && profileId)) {
    throw new Error("Organization and profile context are required.");
  }
  return { orgId, profileId };
}

function normalizeArtifactRelativePath(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^\.\//, "");
  if (!trimmed) {
    throw new Error("path is required (e.g. artifacts/report.pdf).");
  }

  const withoutPrefix = trimmed.startsWith("artifacts/")
    ? trimmed.slice("artifacts/".length)
    : trimmed;

  if (!withoutPrefix || withoutPrefix.includes("..")) {
    throw new Error("path must be a file under the profile artifacts folder.");
  }

  return withoutPrefix;
}

async function runSendDiscordArtifact(
  input: SendDiscordArtifactInput,
  context: ToolContext
): Promise<SendDiscordArtifactOutput> {
  try {
    requireDiscordChannel(context);
    const { orgId, profileId } = requireOrgAndProfile(context);
    const relativePath = normalizeArtifactRelativePath(input.path);
    const artifactsDir = getProfileArtifactsDir(orgId, profileId);
    const guarded = await guardFilePath(relativePath, null, undefined, {
      allowedDirs: [artifactsDir],
      cwd: artifactsDir,
    });
    const fileStat = await stat(guarded.resolved);
    if (!fileStat.isFile()) {
      return {
        error: `Artifact not found: ${relativePath}`,
        ok: false,
      };
    }

    const filename = path.basename(guarded.resolved);
    const mimeType = inferArtifactMimeType(filename);
    const sizeBytes = fileStat.size;

    if (sizeBytes > DISCORD_ARTIFACT_ATTACHMENT_MAX_BYTES) {
      return {
        error: formatDiscordAttachmentSizeLimitMessage(sizeBytes),
        ok: false,
      };
    }

    if (!isDiscordAttachableArtifact({ filename, mimeType })) {
      return {
        error: formatDiscordUnsupportedAttachmentMessage({
          filename,
          mimeType,
        }),
        ok: false,
      };
    }

    return {
      filename,
      mimeType,
      ok: true,
      path: relativePath,
      sizeBytes,
    };
  } catch (error) {
    if (error instanceof PathGuardError) {
      return { error: error.message, ok: false };
    }
    return {
      error:
        error instanceof Error
          ? error.message
          : "Failed to prepare attachment.",
      ok: false,
    };
  }
}

export const sendDiscordArtifactTool: ToolDefinition<
  SendDiscordArtifactInput,
  SendDiscordArtifactOutput
> = {
  description:
    "Attach a file from this profile's artifacts folder to the current Discord channel. Use when the user asks you to send, share, or attach a PDF, image, CSV, or other saved artifact. Pass a path like artifacts/report.pdf or report.pdf.",
  name: SEND_DISCORD_ARTIFACT_TOOL_NAME,
  parameters: {
    additionalProperties: false,
    properties: {
      path: {
        description:
          "Artifact path relative to the profile artifacts folder (e.g. nakama-pitch-deck.pdf or artifacts/nakama-pitch-deck.pdf).",
        type: "string",
      },
    },
    required: ["path"],
    type: "object",
  },
  run: runSendDiscordArtifact,
};

export function createSendDiscordArtifactTools(): ToolDefinition[] {
  return [sendDiscordArtifactTool];
}

export function parseSendDiscordArtifactToolResult(
  result: unknown
): SendDiscordArtifactSuccess | null {
  if (typeof result !== "object" || result === null) {
    return null;
  }

  const record = result as Record<string, unknown>;
  if (record.ok !== true) {
    return null;
  }

  if (
    typeof record.path !== "string" ||
    typeof record.filename !== "string" ||
    typeof record.mimeType !== "string" ||
    typeof record.sizeBytes !== "number"
  ) {
    return null;
  }

  return {
    filename: record.filename,
    mimeType: record.mimeType,
    ok: true,
    path: record.path,
    sizeBytes: record.sizeBytes,
  };
}
