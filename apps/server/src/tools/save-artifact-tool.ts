import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getProfileSoulDir,
  runWriteFile,
  type ToolContext,
  type ToolDefinition,
  type WriteFileOutput,
} from "@nakama/core";
import type { DatabaseAdapter } from "@nakama/db";
import { z } from "zod";
import { convertHtmlToPdf } from "../services/html-pdf";

const SaveArtifactInputSchema = z.object({
  content: z.string(),
  path: z.string(),
});

export const SAVE_ARTIFACT_TOOL_NAME = "save_artifact";

export interface SaveArtifactToolDeps {
  db: DatabaseAdapter;
}

export function createSaveArtifactTool(
  deps: SaveArtifactToolDeps
): ToolDefinition {
  return {
    description:
      "Save a text deliverable (HTML page, report, deck, Markdown, code, log, data) under artifacts/ in the profile workspace and record who made it. For a PDF, use a .pdf path with full HTML as content; the server prints it with headless Chrome. An existing name gets a date suffix; use the returned path. Use edit_file to change an existing artifact.",
    name: SAVE_ARTIFACT_TOOL_NAME,
    parallelSafe: false,
    parameters: {
      additionalProperties: false,
      properties: {
        content: {
          description: "Full UTF-8 text of the file.",
          type: "string",
        },
        path: {
          description:
            "File path under artifacts/, for example artifacts/q3-report.html.",
          type: "string",
        },
      },
      required: ["path", "content"],
      type: "object",
    },
    run(input, context) {
      const parsed = SaveArtifactInputSchema.safeParse(input);

      if (!parsed.success) {
        throw new Error("path and content are required.");
      }

      return runSaveArtifactTool(parsed.data, context, deps);
    },
  };
}

export async function runSaveArtifactTool(
  input: z.infer<typeof SaveArtifactInputSchema>,
  context: ToolContext,
  deps: SaveArtifactToolDeps
): Promise<WriteFileOutput> {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();

  if (!(orgId && profileId)) {
    throw new Error("orgId and profileId are required.");
  }

  // Same root runWriteFile writes under.
  const workspaceRoot = getProfileSoulDir(orgId, profileId);
  const artifactsDir = path.join(workspaceRoot, "artifacts");

  if (!isInside(artifactsDir, path.resolve(workspaceRoot, input.path))) {
    throw new Error("save_artifact only saves under artifacts/.");
  }

  const isPdf = input.path.toLowerCase().endsWith(".pdf");

  // A .pdf path takes HTML and prints it in headless Chrome first, so a missing
  // Chrome fails before anything is written.
  if (isPdf) {
    await mkdir(artifactsDir, { recursive: true });
  }

  const pdf = isPdf
    ? await convertHtmlToPdf(
        input.content,
        path
          .relative(artifactsDir, path.resolve(workspaceRoot, input.path))
          .split(path.sep)
          .join("/")
          .replace(/\.pdf$/i, ".html"),
        artifactsDir
      )
    : null;

  // The guard that sends write_file here must not block this tool's own write.
  // For a PDF it reserves the guarded, unique path; the PDF bytes replace the
  // HTML right after.
  const written = await runWriteFile(input, {
    ...context,
    forbidArtifactFileWrites: false,
  });

  if (pdf) {
    await writeFile(written.path, pdf);
    written.bytesWritten = pdf.length;
  }

  // The owner comes from the server-side context, never from the tool input.
  await deps.db.upsertArtifactRecord({
    channel: context.channel ?? null,
    createdAt: new Date().toISOString(),
    // The write path is resolved through symlinks (macOS /var → /private/var).
    filename: path
      .relative(await realpath(artifactsDir), written.path)
      .split(path.sep)
      .join("/"),
    orgId,
    profileId,
    sessionId: context.sessionId?.trim() || null,
    userId: context.userId?.trim() || null,
  });

  return written;
}

function isInside(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);

  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}
