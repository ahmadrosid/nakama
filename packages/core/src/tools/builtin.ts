import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isDocxFile, isLegacyDocFile } from "../artifact-mime";
import type { ToolContext, ToolDefinition } from "../contract";
import { convertDocxToMarkdown } from "../docx-text";
import { markdownToDocx } from "../docx-write";
import { pathExists } from "../fs";
import { isOmniEnabled, omniRetrieveTool } from "../omni";
import { getProfileSoulDir } from "../soul/resolve";
import { emailTool } from "./email";
import { extractDocumentTextTool } from "./extract-document-text";
import { knowledgeBaseSearchTool } from "./knowledge-base-search";
import {
  getCustomToolsDir,
  guardFilePath,
  PathGuardError,
  type PathGuardOptions,
} from "./paths";
import {
  jsonSchemaFromZod,
  parseToolInput,
  readFileLimitSchema,
  readFileOffsetSchema,
  requiredTrimmedString,
  trimmedOptionalString,
} from "./schema";
import { searchFilesTool } from "./search-files";
import { sqliteTool } from "./sqlite";
import { webFetchTool } from "./web-fetch";
import { webSearchTool } from "./web-search";

export const writeFileInputSchema = z
  .object({
    content: requiredTrimmedString("content"),
    cwd: trimmedOptionalString,
    path: requiredTrimmedString("path"),
  })
  .strict();

export const writeDocxInputSchema = z
  .object({
    cwd: trimmedOptionalString,
    markdown: requiredTrimmedString("markdown"),
    path: requiredTrimmedString("path"),
  })
  .strict();

export const deleteFileInputSchema = z
  .object({
    cwd: trimmedOptionalString,
    path: requiredTrimmedString("path"),
  })
  .strict();

export const editFileInputSchema = z
  .object({
    cwd: trimmedOptionalString,
    edits: z
      .array(
        z
          .object({
            newText: z.string({ error: "newText is required." }),
            oldText: z.string({ error: "oldText is required." }).min(1),
          })
          .strict()
      )
      .min(1, "edits must contain at least one replacement."),
    path: requiredTrimmedString("path"),
  })
  .strict();

export const readFileInputSchema = z
  .object({
    cwd: trimmedOptionalString,
    limit: readFileLimitSchema,
    offset: readFileOffsetSchema,
    path: requiredTrimmedString("path"),
  })
  .strict();

export type WriteFileInput = z.infer<typeof writeFileInputSchema>;
export type WriteDocxInput = z.infer<typeof writeDocxInputSchema>;
export type DeleteFileInput = z.infer<typeof deleteFileInputSchema>;
export type EditFileInput = z.infer<typeof editFileInputSchema>;
export type ReadFileInput = z.infer<typeof readFileInputSchema>;

export interface WriteFileOutput {
  bytesWritten: number;
  path: string;
}

export interface DeleteFileOutput {
  deleted: true;
  path: string;
}

export interface EditFileOutput {
  bytesWritten: number;
  fuzzyMatches: number;
  path: string;
  replacements: number;
}

export interface ReadFileOutput {
  bytesRead: number;
  content: string;
  endLine: number;
  path: string;
  startLine: number;
  totalLines: number;
  truncated: boolean;
}

interface FileToolRunOptions {
  workspaceRoot?: string;
}

let defaultGuardOptions: PathGuardOptions = {};

const BLOCKED_READ_BASENAMES = ["config.ini"];
const ARTIFACT_META_SUFFIX = ".nakama-meta.json";
const artifactRemap = new Map<string, string>();

function normalizeArtifactPath(relativePath: string): string {
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isArtifactPath(relativePath: string): boolean {
  const normalized = normalizeArtifactPath(relativePath);
  return (
    normalized.startsWith("artifacts/") &&
    !normalized.endsWith(ARTIFACT_META_SUFFIX)
  );
}

function artifactRemapKey(context: ToolContext, relativePath: string): string {
  return `${context.sessionId ?? "default"}:${normalizeArtifactPath(relativePath)}`;
}

async function uniqueArtifactPath(filePath: string): Promise<string> {
  if (!(await pathExists(filePath))) {
    return filePath;
  }

  const date = new Date().toISOString().slice(0, 10);
  const directory = path.dirname(filePath);
  const extension = path.extname(filePath);
  const baseName = path.basename(filePath, extension);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? date : `${date}-${attempt + 1}`;
    const candidate = path.join(directory, `${baseName}-${suffix}${extension}`);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Unable to find available artifact filename for ${filePath}`);
}

export function setDefaultFileGuardOptions(options: PathGuardOptions): void {
  defaultGuardOptions = { ...options };
}

function requireProfileScope(context: ToolContext): {
  orgId: string;
  profileId: string;
} {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();

  if (!(orgId && profileId)) {
    throw new Error("orgId and profileId are required.");
  }

  return { orgId, profileId };
}

/**
 * When skill_manage is available, refuse mutating any file under
 * `skills/<name>/` via file tools so creates/edits/sidecars go through
 * skill_manage (and write approval when gated).
 *
 * Call after path guard succeeds. Matches any descendant under
 * `.../skills/<name>/` on the resolved path (including nested paths and
 * realpath'd absolute paths under the workspace).
 */
export function refuseProfileSkillMarkdownWrite(
  context: ToolContext,
  resolvedPath: string
): void {
  if (!context.forbidProfileSkillMarkdownWrites) {
    return;
  }

  const normalized = resolvedPath.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)skills\/([^/]+)\/(.+)$/i);
  if (!match) {
    return;
  }

  const skillName = match[1];
  const rest = match[2];
  if (!skillName || skillName === "." || skillName === ".." || !rest) {
    return;
  }

  throw new Error(
    `Use skill_manage to create, patch, edit, delete, or manage supporting files for profile skills; writing skills/${skillName}/${rest} via file tools is not allowed when skill_manage is available.`
  );
}

/**
 * Always refuse agent writes of skill-local executables under skills/<name>/.
 * Those modules are loaded via dynamic import and must stay admin-authored in Phase 1.
 */
export function refuseSkillLocalToolFileWrite(resolvedPath: string): void {
  const normalized = resolvedPath.replace(/\\/g, "/");
  const match = normalized.match(/(?:^|\/)skills\/([^/]+)\/([^/]+)$/i);
  if (!match) {
    return;
  }

  const skillName = match[1];
  const fileName = match[2];
  if (!skillName || skillName === "." || skillName === ".." || !fileName) {
    return;
  }

  const lower = fileName.toLowerCase();
  if (lower !== "tool.ts" && lower !== "tool.js") {
    return;
  }

  throw new Error(
    `Skill-local tools (${fileName}) under skills/${skillName}/ cannot be written by agents in Phase 1.`
  );
}

function buildFileGuardOptions(
  context: ToolContext,
  options: FileToolRunOptions = {}
): PathGuardOptions {
  const { orgId, profileId } = requireProfileScope(context);
  const workspaceRoot =
    options.workspaceRoot ?? getProfileSoulDir(orgId, profileId);
  assertAbsoluteWorkspaceRoot(workspaceRoot);

  return {
    ...defaultGuardOptions,
    allowedDirs: [workspaceRoot, getCustomToolsDir()],
    cwd: workspaceRoot,
  };
}

function assertAbsoluteWorkspaceRoot(workspaceRoot: string): void {
  if (!path.isAbsolute(workspaceRoot)) {
    throw new Error(
      "workspaceRoot must be an absolute path; relative roots resolve against process.cwd() and break profile isolation."
    );
  }
}

export const writeFileTool: ToolDefinition<WriteFileInput, WriteFileOutput> = {
  description:
    "Write text content to a file in the active profile workspace. Creates parent directories if needed. Cannot produce Word documents — use write_docx for .docx.",
  name: "write_file",
  parameters: jsonSchemaFromZod(writeFileInputSchema),
  run(input, context) {
    return runWriteFile(input, context);
  },
};

/**
 * A `.docx` is a ZIP archive and a `.doc` is an OLE container; neither can be written
 * as UTF-8 text. Left unguarded, a model asked for a Word document saves HTML under a
 * `.docx` name, and Word then renders the stylesheet as visible text.
 */
function refuseWordExtension(targetPath: string): void {
  const filename = path.basename(targetPath);

  if (isDocxFile(filename)) {
    throw new Error(
      "write_file writes UTF-8 text and cannot produce a valid .docx (it is a ZIP archive). Use the write_docx tool with Markdown content instead."
    );
  }

  if (isLegacyDocFile(filename)) {
    throw new Error(
      "write_file cannot produce a valid .doc. Use the write_docx tool to create a .docx instead."
    );
  }
}

export async function runWriteFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {}
): Promise<WriteFileOutput> {
  const parsed = parseToolInput(writeFileInputSchema, input);
  refuseWordExtension(parsed.path);
  const contentBytes = Buffer.byteLength(parsed.content, "utf8");
  const guardOptions = buildFileGuardOptions(context, options);

  const guarded = await guardFilePath(
    parsed.path,
    parsed.cwd ?? null,
    contentBytes,
    guardOptions
  );
  refuseProfileSkillMarkdownWrite(context, guarded.resolved);
  refuseSkillLocalToolFileWrite(guarded.resolved);
  const { orgId, profileId } = requireProfileScope(context);
  const workspaceRoot =
    options.workspaceRoot ?? getProfileSoulDir(orgId, profileId);
  let filePath = guarded.resolved;
  const normalizedPath = normalizeArtifactPath(parsed.path);

  if (
    normalizedPath.endsWith(ARTIFACT_META_SUFFIX) &&
    normalizedPath.startsWith("artifacts/")
  ) {
    const remapped = artifactRemap.get(
      artifactRemapKey(
        context,
        normalizedPath.slice(0, -ARTIFACT_META_SUFFIX.length)
      )
    );
    if (remapped) {
      filePath = path.resolve(
        workspaceRoot,
        `${remapped}${ARTIFACT_META_SUFFIX}`
      );
    }
  } else if (isArtifactPath(parsed.path)) {
    const uniquePath = await uniqueArtifactPath(filePath);
    if (uniquePath !== filePath) {
      artifactRemap.set(
        artifactRemapKey(context, parsed.path),
        normalizeArtifactPath(path.relative(workspaceRoot, uniquePath))
      );
      filePath = uniquePath;
    }
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await context.memoryFiles?.write(filePath, parsed.content);
  await writeFile(filePath, parsed.content, "utf8");

  return { bytesWritten: contentBytes, path: filePath };
}

export const writeDocxTool: ToolDefinition<WriteDocxInput, WriteFileOutput> = {
  description:
    "Create a real Microsoft Word (.docx) document from Markdown. Headings, bold/italic, lists, tables, and code blocks are converted. Use this whenever the user asks for a Word document — write_file cannot produce one.",
  name: "write_docx",
  parameters: jsonSchemaFromZod(writeDocxInputSchema),
  run(input, context) {
    return runWriteDocx(input, context);
  },
};

export async function runWriteDocx(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {}
): Promise<WriteFileOutput> {
  const parsed = parseToolInput(writeDocxInputSchema, input);

  if (!isDocxFile(path.basename(parsed.path))) {
    throw new Error("write_docx requires a path ending in .docx");
  }

  const bytes = await markdownToDocx(parsed.markdown);
  const guardOptions = buildFileGuardOptions(context, options);
  const guarded = await guardFilePath(
    parsed.path,
    parsed.cwd ?? null,
    bytes.length,
    guardOptions
  );
  refuseProfileSkillMarkdownWrite(context, guarded.resolved);
  refuseSkillLocalToolFileWrite(guarded.resolved);
  // Same rule as write_file: never silently overwrite an existing artifact.
  const filePath = isArtifactPath(parsed.path)
    ? await uniqueArtifactPath(guarded.resolved)
    : guarded.resolved;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);

  return { bytesWritten: bytes.length, path: filePath };
}

export const deleteFileTool: ToolDefinition<DeleteFileInput, DeleteFileOutput> =
  {
    description:
      "Delete a file from disk. Only files within the profile workspace or custom tools directory can be deleted.",
    name: "delete_file",
    parameters: jsonSchemaFromZod(deleteFileInputSchema),
    run(input, context) {
      return runDeleteFile(input, context);
    },
  };

export async function runDeleteFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {}
): Promise<DeleteFileOutput> {
  const parsed = parseToolInput(deleteFileInputSchema, input);
  const guardOptions = buildFileGuardOptions(context, options);

  const guarded = await guardFilePath(
    parsed.path,
    parsed.cwd ?? null,
    undefined,
    guardOptions
  );
  refuseProfileSkillMarkdownWrite(context, guarded.resolved);
  refuseSkillLocalToolFileWrite(guarded.resolved);
  await context.memoryFiles?.remove(guarded.resolved);
  await unlink(guarded.resolved);

  return { deleted: true, path: guarded.resolved };
}

export const editFileTool: ToolDefinition<EditFileInput, EditFileOutput> = {
  description:
    "Edit an existing text file with one or more exact replacements. Each oldText must be present once, non-overlapping, and is matched against the original file.",
  name: "edit_file",
  parameters: jsonSchemaFromZod(editFileInputSchema),
  run(input, context) {
    return runEditFile(input, context);
  },
};

export async function runEditFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {}
): Promise<EditFileOutput> {
  const parsed = parseToolInput(editFileInputSchema, input);
  // Editing a Word document as UTF-8 text would corrupt the archive.
  refuseWordExtension(parsed.path);

  const guardOptions = buildFileGuardOptions(context, options);
  const maxBytes = guardOptions.maxFileBytes ?? 10 * 1024 * 1024;
  const guarded = await guardFilePath(
    parsed.path,
    parsed.cwd ?? null,
    undefined,
    guardOptions
  );
  refuseProfileSkillMarkdownWrite(context, guarded.resolved);
  refuseSkillLocalToolFileWrite(guarded.resolved);
  const filePath = guarded.resolved;

  if (BLOCKED_READ_BASENAMES.includes(path.basename(filePath).toLowerCase())) {
    throw new PathGuardError(
      `Editing ${path.basename(filePath)} is not allowed`,
      "SPECIAL_FILE"
    );
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  if (fileStat.size > maxBytes) {
    throw new PathGuardError(
      `File content exceeds max ${maxBytes} bytes (got ${fileStat.size})`,
      "TOO_LARGE"
    );
  }

  let rawBuffer = await readFile(filePath);
  if (context.memoryFiles) {
    rawBuffer = Buffer.from(
      await context.memoryFiles.read(filePath, rawBuffer.toString("utf8"))
    );
  }
  const hasBom =
    rawBuffer.length >= 3 &&
    rawBuffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const content = rawBuffer.toString("utf8", hasBom ? 3 : 0);
  const lineEnding = detectLineEnding(content);
  const normalizedContent = normalizeToLF(content);
  const edits = parsed.edits.map((edit) => ({
    newText: normalizeToLF(edit.newText),
    oldText: normalizeToLF(edit.oldText),
  }));
  const fuzzyMatches = edits.filter(
    (edit) =>
      !normalizedContent.includes(edit.oldText) &&
      normalizeForEditMatch(normalizedContent).includes(
        normalizeForEditMatch(edit.oldText)
      )
  ).length;
  const base =
    fuzzyMatches > 0
      ? normalizeForEditMatch(normalizedContent)
      : normalizedContent;
  const plans = edits
    .map((edit, index) => planEdit(base, edit, index))
    .sort((a, b) => a.start - b.start);
  assertNoOverlappingEdits(plans);

  const nextContent =
    fuzzyMatches > 0
      ? applyEditsPreservingLines(normalizedContent, base, plans)
      : applyEditPlans(base, plans);
  if (nextContent === normalizedContent) {
    throw new Error(
      "No changes made: replacements produced identical content."
    );
  }
  const restored =
    lineEnding === "\r\n" ? nextContent.replace(/\n/g, "\r\n") : nextContent;
  const outputContent = hasBom ? `\uFEFF${restored}` : restored;
  const bytesWritten = Buffer.byteLength(outputContent, "utf8");

  await guardFilePath(
    parsed.path,
    parsed.cwd ?? null,
    bytesWritten,
    guardOptions
  );
  await context.memoryFiles?.write(filePath, outputContent);
  await writeFile(filePath, outputContent, "utf8");

  return {
    bytesWritten,
    fuzzyMatches,
    path: filePath,
    replacements: plans.length,
  };
}

// Matching semantics follow Pi's edit-diff.ts (ce5ec9ca355a852fb1f25c088cf409df47a95213).
interface PlannedEdit {
  end: number;
  index: number;
  newText: string;
  start: number;
}

function planEdit(
  content: string,
  edit: EditFileInput["edits"][number],
  index: number
): PlannedEdit {
  const exactStart = content.indexOf(edit.oldText);
  const normalizedSearch = normalizeForEditMatch(edit.oldText);
  const normalizedContent = normalizeForEditMatch(content);
  const fuzzyStart = normalizedContent.indexOf(normalizedSearch);
  if (exactStart === -1 && (fuzzyStart === -1 || !normalizedSearch)) {
    throw new Error(`Edit ${index + 1} oldText not found in file.`);
  }
  if (normalizedContent.split(normalizedSearch).length - 1 > 1) {
    throw new Error(
      `Edit ${index + 1} is ambiguous after normalized matching.`
    );
  }
  const start = exactStart === -1 ? fuzzyStart : exactStart;
  return {
    end:
      start +
      (exactStart === -1 ? normalizedSearch.length : edit.oldText.length),
    index,
    newText: edit.newText,
    start,
  };
}

function detectLineEnding(content: string): string {
  const lf = content.indexOf("\n");
  const crlf = content.indexOf("\r\n");
  return lf !== -1 && crlf !== -1 && crlf < lf ? "\r\n" : "\n";
}

function normalizeToLF(value: string): string {
  return value.replace(/\r\n|\r/g, "\n");
}

function normalizeForEditMatch(value: string): string {
  return value
    .normalize("NFKC")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ");
}

function applyEditsPreservingLines(
  original: string,
  base: string,
  plans: PlannedEdit[]
): string {
  const originalLines = original.match(/[^\n]*\n|[^\n]+/g) ?? [];
  const baseLines = base.match(/[^\n]*\n|[^\n]+/g) ?? [];
  if (originalLines.length !== baseLines.length) {
    throw new Error(
      "Cannot preserve unchanged lines: normalization changed the line count."
    );
  }
  // Widen replacements to touched lines, copying every other line from the original.
  let offset = 0;
  const spans = baseLines.map((line) => {
    const start = offset;
    offset += line.length;
    return { end: offset, start };
  });
  const groups: { first: number; last: number; plans: PlannedEdit[] }[] = [];
  for (const plan of plans) {
    const first = spans.findIndex(
      (span) => plan.start >= span.start && plan.start < span.end
    );
    const last = spans.findIndex((span) => plan.end <= span.end);
    if (first === -1 || last < first) {
      throw new Error("Replacement range is outside the file.");
    }
    const previous = groups.at(-1);
    if (previous && first <= previous.last) {
      previous.last = Math.max(previous.last, last);
      previous.plans.push(plan);
    } else {
      groups.push({ first, last, plans: [plan] });
    }
  }
  let cursor = 0;
  let result = "";
  for (const group of groups) {
    result += originalLines.slice(cursor, group.first).join("");
    const start = spans[group.first].start;
    result += applyEditPlans(
      base.slice(start, spans[group.last].end),
      group.plans.map((plan) => ({
        ...plan,
        end: plan.end - start,
        start: plan.start - start,
      }))
    );
    cursor = group.last + 1;
  }
  return result + originalLines.slice(cursor).join("");
}

function assertNoOverlappingEdits(plans: PlannedEdit[]): void {
  // Caller sorts by start before invoking; only overlap is still possible.
  let previous: PlannedEdit | undefined;
  for (const current of plans) {
    if (previous !== undefined && current.start < previous.end) {
      throw new Error(
        `Edit ${current.index + 1} overlaps with edit ${previous.index + 1}.`
      );
    }
    previous = current;
  }
}

function applyEditPlans(content: string, plans: PlannedEdit[]): string {
  let nextContent = "";
  let cursor = 0;

  for (const plan of plans) {
    nextContent += content.slice(cursor, plan.start);
    nextContent += plan.newText;
    cursor = plan.end;
  }

  nextContent += content.slice(cursor);
  return nextContent;
}

/**
 * Word documents are ZIP archives, not UTF-8, so decoding them as text yields
 * mojibake. Convert `.docx` to Markdown instead, which keeps headings and tables
 * legible to the model while still being plain text to every caller downstream.
 */
async function readFileAsText(filePath: string): Promise<string> {
  const filename = path.basename(filePath);

  // Word-named files are judged by their bytes: a real .docx archive, a legacy OLE
  // .doc, or (commonly) HTML that an agent saved under a Word extension.
  if (isDocxFile(filename) || isLegacyDocFile(filename)) {
    return convertDocxToMarkdown(await readFile(filePath));
  }

  return readFile(filePath, "utf8");
}

export const readFileTool: ToolDefinition<ReadFileInput, ReadFileOutput> = {
  description:
    "Read text from a file in the active profile workspace. Word .docx files are converted to Markdown. Use offset/limit for large files.",
  name: "read_file",
  parallelSafe: true,
  parameters: jsonSchemaFromZod(readFileInputSchema),
  run(input, context) {
    return runReadFile(input, context);
  },
};

export async function runReadFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {}
): Promise<ReadFileOutput> {
  const parsed = parseToolInput(readFileInputSchema, input);
  const guardOptions = buildFileGuardOptions(context, options);
  const maxBytes = guardOptions.maxFileBytes ?? 10 * 1024 * 1024;

  const guarded = await guardFilePath(
    parsed.path,
    parsed.cwd ?? null,
    undefined,
    guardOptions
  );
  const filePath = guarded.resolved;

  if (BLOCKED_READ_BASENAMES.includes(path.basename(filePath).toLowerCase())) {
    throw new PathGuardError(
      `Reading ${path.basename(filePath)} is not allowed`,
      "SPECIAL_FILE"
    );
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  if (!fileStat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  if (fileStat.size > maxBytes) {
    throw new PathGuardError(
      `File content exceeds max ${maxBytes} bytes (got ${fileStat.size})`,
      "TOO_LARGE"
    );
  }

  const localContent = await readFileAsText(filePath);
  const rawContent = context.memoryFiles
    ? await context.memoryFiles.read(filePath, localContent)
    : localContent;
  const lines = rawContent.length === 0 ? [] : rawContent.split("\n");
  const totalLines = lines.length;
  const startLine = Math.min(
    Math.max(1, parsed.offset),
    totalLines === 0 ? 1 : totalLines + 1
  );
  const startIndex = startLine - 1;
  const endIndex =
    parsed.limit == null
      ? totalLines
      : Math.min(startIndex + parsed.limit, totalLines);
  const slice = lines.slice(startIndex, endIndex);
  const content = slice.join("\n");
  const endLine =
    slice.length > 0
      ? startLine + slice.length - 1
      : Math.max(0, startLine - 1);

  return {
    bytesRead: Buffer.byteLength(content, "utf8"),
    content,
    endLine,
    path: filePath,
    startLine,
    totalLines,
    truncated: endIndex < totalLines,
  };
}

export const builtinTools: ToolDefinition[] = [
  writeFileTool,
  writeDocxTool,
  deleteFileTool,
  editFileTool,
  readFileTool,
  searchFilesTool,
  knowledgeBaseSearchTool,
  sqliteTool,
  webSearchTool,
  webFetchTool,
  emailTool,
  extractDocumentTextTool,
  // Gated on the server-wide env var, not the per-org toggle: the toggle says
  // whether an org folds, and publishing the expander per-org would let an org
  // flip folding on with no way to read back what was folded until a restart.
  ...(isOmniEnabled() ? [omniRetrieveTool] : []),
];

export { PathGuardError };
