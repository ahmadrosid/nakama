import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  getChatWorkspaceDir,
  getProfileArtifactsDir,
  getProfileSoulDir,
  guardFilePath,
  inferArtifactMimeType,
  PathGuardError,
  type ToolContext,
  type ToolDefinition,
  WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES,
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

function artifactLocation(
  context: ToolContext,
  rawPath: string,
  orgId: string,
  profileId: string
): { root: string; directory: string; relativePath: string } {
  if (!context.workspaceId) {
    return {
      directory: getProfileArtifactsDir(orgId, profileId),
      relativePath: normalizeArtifactRelativePath(rawPath),
      root: getProfileSoulDir(orgId, profileId),
    };
  }
  const root = getChatWorkspaceDir(orgId, context.workspaceId);
  const raw = rawPath.trim();
  if (
    !raw ||
    path.isAbsolute(raw) ||
    raw.includes("\\") ||
    raw.split("/").includes("..")
  ) {
    throw new Error("Artifact path must stay inside this workspace.");
  }
  const relativePath =
    raw.startsWith("artifacts/") && context.outputRoot
      ? path.relative(
          root,
          path.join(context.outputRoot, raw.slice("artifacts/".length))
        )
      : raw;
  return { directory: root, relativePath, root };
}

async function runSendDiscordArtifact(
  input: SendDiscordArtifactInput,
  context: ToolContext
): Promise<SendDiscordArtifactOutput> {
  try {
    requireDiscordChannel(context);
    const { orgId, profileId } = requireOrgAndProfile(context);
    const { relativePath, directory: artifactsDir } = artifactLocation(
      context,
      input.path,
      orgId,
      profileId
    );
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
      ...(await context.registerGeneratedFile?.(guarded.resolved)),
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

export const sendWhatsAppArtifactTool: ToolDefinition<SendDiscordArtifactInput> =
  {
    description:
      "Select a completed artifact for delivery to this WhatsApp conversation after the current agent turn completes. Use for sending or resending the matching file. This prepares delivery; it does not confirm an upload. Finish any edits before selecting the file.",
    name: "send_whatsapp_artifact",
    parameters: sendDiscordArtifactTool.parameters,
    async run(input, context) {
      try {
        if (context.channel !== "whatsapp") {
          throw new Error("Only available in WhatsApp chats.");
        }
        const { orgId, profileId } = requireOrgAndProfile(context);
        const {
          root: soulDir,
          directory: artifactsDir,
          relativePath,
        } = artifactLocation(context, input.path, orgId, profileId);
        if (
          context.workspaceRoot &&
          (await realpath(context.workspaceRoot)) !== (await realpath(soulDir))
        ) {
          throw new Error("WhatsApp delivery requires the profile workspace.");
        }
        if (
          path.isAbsolute(relativePath) ||
          /^[a-z]:/i.test(relativePath) ||
          relativePath.includes("\\")
        ) {
          throw new Error("Artifact path must be relative.");
        }
        if ((await lstat(artifactsDir)).isSymbolicLink()) {
          throw new Error("The artifacts folder must not be a symlink.");
        }
        // Do not permit an artifacts-root symlink to another profile/workspace.
        await guardFilePath(artifactsDir, null, undefined, {
          allowedDirs: [soulDir],
          cwd: soulDir,
        });
        const guarded = await guardFilePath(relativePath, null, undefined, {
          allowedDirs: [artifactsDir],
          cwd: artifactsDir,
        });
        const fileStat = await stat(guarded.resolved);
        if (!fileStat.isFile()) {
          throw new Error("Artifact must be a regular file.");
        }
        if (fileStat.size > WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES) {
          throw new Error(
            "Artifact exceeds the 16 MiB WhatsApp upload budget."
          );
        }
        const digest = createHash("sha256");
        let sizeBytes = 0;
        for await (const chunk of createReadStream(guarded.resolved, {
          signal: context.signal,
        })) {
          sizeBytes += chunk.length;
          if (sizeBytes > WHATSAPP_ARTIFACT_DOCUMENT_MAX_BYTES) {
            throw new Error(
              "Artifact exceeds the 16 MiB WhatsApp upload budget."
            );
          }
          digest.update(chunk);
        }
        return {
          filename: path.basename(relativePath),
          mimeType: inferArtifactMimeType(relativePath),
          ok: true,
          path: relativePath,
          sha256: digest.digest("hex"),
          sizeBytes,
          status: "prepared",
          ...(await context.registerGeneratedFile?.(guarded.resolved)),
        };
      } catch (error) {
        return {
          error:
            error instanceof Error
              ? error.message
              : "Could not prepare artifact.",
          ok: false,
        };
      }
    },
  };
