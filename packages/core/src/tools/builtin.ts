import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ToolContext, ToolDefinition } from "../contract";
import { isDocxFile, isLegacyDocFile } from "../artifact-mime";
import { convertDocxToMarkdown } from "../docx-text";
import { markdownToDocx } from "../docx-write";
import { pathExists } from "../fs";
import { getProfileSoulDir } from "../soul/resolve";
import { getCustomToolsDir, guardFilePath, PathGuardError, type PathGuardOptions } from "./paths";
import { searchFilesTool } from "./search-files";
import { knowledgeBaseSearchTool } from "./knowledge-base-search";
import { webSearchTool } from "./web-search";
import { webFetchTool } from "./web-fetch";
import { emailTool } from "./email";
import {
  jsonSchemaFromZod,
  parseToolInput,
  readFileLimitSchema,
  readFileOffsetSchema,
  requiredTrimmedString,
  trimmedOptionalString,
} from "./schema";

export const writeFileInputSchema = z
  .object({
    path: requiredTrimmedString("path"),
    content: requiredTrimmedString("content"),
    cwd: trimmedOptionalString,
  })
  .strict();

export const writeDocxInputSchema = z
  .object({
    path: requiredTrimmedString("path"),
    markdown: requiredTrimmedString("markdown"),
    cwd: trimmedOptionalString,
  })
  .strict();

export const deleteFileInputSchema = z
  .object({
    path: requiredTrimmedString("path"),
    cwd: trimmedOptionalString,
  })
  .strict();

export const editFileInputSchema = z
  .object({
    path: requiredTrimmedString("path"),
    edits: z
      .array(
        z
          .object({
            oldText: requiredTrimmedString("oldText"),
            newText: z.string({ error: "newText is required." }),
          })
          .strict(),
      )
      .min(1, "edits must contain at least one replacement."),
    cwd: trimmedOptionalString,
  })
  .strict();

export const readFileInputSchema = z
  .object({
    path: requiredTrimmedString("path"),
    cwd: trimmedOptionalString,
    offset: readFileOffsetSchema,
    limit: readFileLimitSchema,
  })
  .strict();

export type WriteFileInput = z.infer<typeof writeFileInputSchema>;
export type WriteDocxInput = z.infer<typeof writeDocxInputSchema>;
export type DeleteFileInput = z.infer<typeof deleteFileInputSchema>;
export type EditFileInput = z.infer<typeof editFileInputSchema>;
export type ReadFileInput = z.infer<typeof readFileInputSchema>;

export interface WriteFileOutput {
  path: string;
  bytesWritten: number;
}

export interface DeleteFileOutput {
  path: string;
  deleted: true;
}

export interface EditFileOutput {
  path: string;
  replacements: number;
  bytesWritten: number;
  fuzzyMatches: number;
}

export interface ReadFileOutput {
  path: string;
  content: string;
  bytesRead: number;
  startLine: number;
  endLine: number;
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
  return normalized.startsWith("artifacts/") && !normalized.endsWith(ARTIFACT_META_SUFFIX);
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

function requireProfileScope(context: ToolContext): { orgId: string; profileId: string } {
  const orgId = context.orgId?.trim();
  const profileId = context.profileId?.trim();

  if (!orgId || !profileId) {
    throw new Error("orgId and profileId are required.");
  }

  return { orgId, profileId };
}

function buildFileGuardOptions(
  context: ToolContext,
  options: FileToolRunOptions = {},
): PathGuardOptions {
  const { orgId, profileId } = requireProfileScope(context);
  const workspaceRoot = options.workspaceRoot ?? getProfileSoulDir(orgId, profileId);

  return {
    ...defaultGuardOptions,
    allowedDirs: [workspaceRoot, getCustomToolsDir()],
    cwd: workspaceRoot,
  };
}

export const writeFileTool: ToolDefinition<WriteFileInput, WriteFileOutput> = {
  name: "write_file",
  description:
    "Write text content to a file in the active profile workspace. Creates parent directories if needed. Cannot produce Word documents — use write_docx for .docx.",
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
      "write_file writes UTF-8 text and cannot produce a valid .docx (it is a ZIP archive). Use the write_docx tool with Markdown content instead.",
    );
  }

  if (isLegacyDocFile(filename)) {
    throw new Error(
      "write_file cannot produce a valid .doc. Use the write_docx tool to create a .docx instead.",
    );
  }
}

export async function runWriteFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {},
): Promise<WriteFileOutput> {
  const parsed = parseToolInput(writeFileInputSchema, input);
  refuseWordExtension(parsed.path);
  const contentBytes = Buffer.byteLength(parsed.content, "utf8");
  const guardOptions = buildFileGuardOptions(context, options);

  const guarded = await guardFilePath(
    parsed.path,
    parsed.cwd ?? null,
    contentBytes,
    guardOptions,
  );
  const { orgId, profileId } = requireProfileScope(context);
  const workspaceRoot = options.workspaceRoot ?? getProfileSoulDir(orgId, profileId);
  let filePath = guarded.resolved;
  const normalizedPath = normalizeArtifactPath(parsed.path);

  if (normalizedPath.endsWith(ARTIFACT_META_SUFFIX) && normalizedPath.startsWith("artifacts/")) {
    const remapped = artifactRemap.get(
      artifactRemapKey(context, normalizedPath.slice(0, -ARTIFACT_META_SUFFIX.length)),
    );
    if (remapped) {
      filePath = path.resolve(workspaceRoot, `${remapped}${ARTIFACT_META_SUFFIX}`);
    }
  } else if (isArtifactPath(parsed.path)) {
    const uniquePath = await uniqueArtifactPath(filePath);
    if (uniquePath !== filePath) {
      artifactRemap.set(
        artifactRemapKey(context, parsed.path),
        normalizeArtifactPath(path.relative(workspaceRoot, uniquePath)),
      );
      filePath = uniquePath;
    }
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, parsed.content, "utf8");

  return { path: filePath, bytesWritten: contentBytes };
}

export const writeDocxTool: ToolDefinition<WriteDocxInput, WriteFileOutput> = {
  name: "write_docx",
  description:
    "Create a real Microsoft Word (.docx) document from Markdown. Headings, bold/italic, lists, tables, and code blocks are converted. Use this whenever the user asks for a Word document — write_file cannot produce one.",
  parameters: jsonSchemaFromZod(writeDocxInputSchema),
  run(input, context) {
    return runWriteDocx(input, context);
  },
};

export async function runWriteDocx(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {},
): Promise<WriteFileOutput> {
  const parsed = parseToolInput(writeDocxInputSchema, input);

  if (!isDocxFile(path.basename(parsed.path))) {
    throw new Error("write_docx requires a path ending in .docx");
  }

  const bytes = await markdownToDocx(parsed.markdown);
  const guardOptions = buildFileGuardOptions(context, options);
  const guarded = await guardFilePath(parsed.path, parsed.cwd ?? null, bytes.length, guardOptions);
  // Same rule as write_file: never silently overwrite an existing artifact.
  const filePath = isArtifactPath(parsed.path)
    ? await uniqueArtifactPath(guarded.resolved)
    : guarded.resolved;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);

  return { path: filePath, bytesWritten: bytes.length };
}

export const deleteFileTool: ToolDefinition<DeleteFileInput, DeleteFileOutput> = {
  name: "delete_file",
  description:
    "Delete a file from disk. Only files within the profile workspace or custom tools directory can be deleted.",
  parameters: jsonSchemaFromZod(deleteFileInputSchema),
  run(input, context) {
    return runDeleteFile(input, context);
  },
};

export async function runDeleteFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {},
): Promise<DeleteFileOutput> {
  const parsed = parseToolInput(deleteFileInputSchema, input);
  const guardOptions = buildFileGuardOptions(context, options);

  const guarded = await guardFilePath(parsed.path, parsed.cwd ?? null, undefined, guardOptions);
  await unlink(guarded.resolved);

  return { path: guarded.resolved, deleted: true };
}

export const editFileTool: ToolDefinition<EditFileInput, EditFileOutput> = {
  name: "edit_file",
  description:
    "Edit an existing text file with one or more exact replacements. Each oldText must be present once, non-overlapping, and is matched against the original file.",
  parameters: jsonSchemaFromZod(editFileInputSchema),
  run(input, context) {
    return runEditFile(input, context);
  },
};

export async function runEditFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {},
): Promise<EditFileOutput> {
  const parsed = parseToolInput(editFileInputSchema, input);
  // Editing a Word document as UTF-8 text would corrupt the archive.
  refuseWordExtension(parsed.path);

  const guardOptions = buildFileGuardOptions(context, options);
  const maxBytes = guardOptions.maxFileBytes ?? 10 * 1024 * 1024;
  const guarded = await guardFilePath(parsed.path, parsed.cwd ?? null, undefined, guardOptions);
  const filePath = guarded.resolved;

  if (BLOCKED_READ_BASENAMES.includes(path.basename(filePath).toLowerCase())) {
    throw new PathGuardError(
      `Editing ${path.basename(filePath)} is not allowed`,
      "SPECIAL_FILE",
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
      "TOO_LARGE",
    );
  }

  const rawBuffer = await readFile(filePath);
  const hasBom =
    rawBuffer.length >= 3 && rawBuffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const content = rawBuffer.toString("utf8", hasBom ? 3 : 0);
  const lineEnding = detectLineEnding(content);
  const plans = parsed.edits
    .map((edit, index) => planEdit(content, edit, index, lineEnding))
    .sort((a, b) => a.start - b.start);
  assertNoOverlappingEdits(plans);

  const nextContent = applyEditPlans(content, plans);
  const outputContent = hasBom ? `\uFEFF${nextContent}` : nextContent;
  const bytesWritten = Buffer.byteLength(outputContent, "utf8");

  await guardFilePath(parsed.path, parsed.cwd ?? null, bytesWritten, guardOptions);
  await writeFile(filePath, outputContent, "utf8");

  return {
    path: filePath,
    replacements: plans.length,
    bytesWritten,
    fuzzyMatches: plans.filter((plan) => plan.fuzzy).length,
  };
}

interface PlannedEdit {
  index: number;
  start: number;
  end: number;
  newText: string;
  fuzzy: boolean;
}

function planEdit(
  content: string,
  edit: EditFileInput["edits"][number],
  index: number,
  lineEnding: string,
): PlannedEdit {
  if (edit.oldText === edit.newText) {
    throw new Error(`Edit ${index + 1} makes no change: oldText and newText are identical.`);
  }

  const exactMatches = findAllOccurrences(content, edit.oldText);

  if (exactMatches.length > 1) {
    throw new Error(
      `Edit ${index + 1} is ambiguous: oldText matched ${exactMatches.length} times.`,
    );
  }

  if (exactMatches.length === 1) {
    const start = exactMatches[0]!;
    return {
      index,
      start,
      end: start + edit.oldText.length,
      newText: normalizeReplacementLineEndings(edit.newText, lineEnding),
      fuzzy: false,
    };
  }

  const fuzzyMatches = findNormalizedMatches(content, edit.oldText);

  if (fuzzyMatches.length === 0) {
    throw new Error(`Edit ${index + 1} oldText not found in file.`);
  }

  if (fuzzyMatches.length > 1) {
    throw new Error(`Edit ${index + 1} is ambiguous after normalized matching.`);
  }

  const match = fuzzyMatches[0]!;

  return {
    index,
    start: match.start,
    end: match.end,
    newText: normalizeReplacementLineEndings(edit.newText, lineEnding),
    fuzzy: true,
  };
}

function detectLineEnding(content: string): string {
  const crlf = content.match(/\r\n/g)?.length ?? 0;
  const lf = content.match(/(?<!\r)\n/g)?.length ?? 0;
  const cr = content.match(/\r(?!\n)/g)?.length ?? 0;

  if (crlf >= lf && crlf >= cr && crlf > 0) {
    return "\r\n";
  }

  if (cr > lf && cr > 0) {
    return "\r";
  }

  return "\n";
}

function normalizeReplacementLineEndings(value: string, lineEnding: string): string {
  return value.replace(/\r\n|\r|\n/g, lineEnding);
}

function findAllOccurrences(content: string, search: string): number[] {
  const matches: number[] = [];
  let index = 0;

  while (true) {
    index = content.indexOf(search, index);
    if (index === -1) {
      return matches;
    }
    matches.push(index);
    index += search.length;
  }
}

interface NormalizedMatch {
  start: number;
  end: number;
}

interface NormalizedChar {
  char: string;
  start: number;
  end: number;
}

function findNormalizedMatches(content: string, search: string): NormalizedMatch[] {
  const normalizedContent = normalizeForEditMatch(content);
  const normalizedSearch = normalizeForEditMatch(search);
  const needle = normalizedSearch.text;

  if (!needle) {
    return [];
  }

  const matches: NormalizedMatch[] = [];
  let index = 0;

  while (true) {
    index = normalizedContent.text.indexOf(needle, index);
    if (index === -1) {
      return matches;
    }

    const firstChar = normalizedContent.chars[index];
    const lastChar = normalizedContent.chars[index + needle.length - 1];

    if (firstChar && lastChar) {
      matches.push({ start: firstChar.start, end: lastChar.end });
    }

    index += needle.length;
  }
}

function normalizeForEditMatch(value: string): { text: string; chars: NormalizedChar[] } {
  const chars: NormalizedChar[] = [];

  for (let index = 0; index < value.length; ) {
    const start = index;
    const codePoint = value.codePointAt(index);

    if (codePoint === undefined) {
      break;
    }

    const rawChar = String.fromCodePoint(codePoint);
    index += rawChar.length;
    const normalizedChar = normalizeEditChar(rawChar);

    if (normalizedChar === null) {
      continue;
    }

    chars.push({ char: normalizedChar, start, end: index });
  }

  const filteredChars = removeTrailingWhitespaceTokens(chars);

  return {
    text: filteredChars.map((char) => char.char).join(""),
    chars: filteredChars,
  };
}

function normalizeEditChar(char: string): string | null {
  if (char === "\r") {
    return null;
  }

  if (char === "\u00A0") {
    return " ";
  }

  if (char === "\u2018" || char === "\u2019") {
    return "'";
  }

  if (char === "\u201C" || char === "\u201D") {
    return "\"";
  }

  if (char === "\u2013" || char === "\u2014") {
    return "-";
  }

  return char;
}

function removeTrailingWhitespaceTokens(chars: NormalizedChar[]): NormalizedChar[] {
  const keep = new Array<boolean>(chars.length).fill(true);
  let runStart: number | null = null;

  for (let index = 0; index <= chars.length; index += 1) {
    const char = chars[index]?.char;

    if (char === " " || char === "\t") {
      runStart ??= index;
      continue;
    }

    if ((char === "\n" || char === undefined) && runStart !== null) {
      for (let runIndex = runStart; runIndex < index; runIndex += 1) {
        keep[runIndex] = false;
      }
    }

    runStart = null;
  }

  return chars.filter((_char, index) => keep[index]);
}

function assertNoOverlappingEdits(plans: PlannedEdit[]): void {
  for (let index = 1; index < plans.length; index += 1) {
    const previous = plans[index - 1]!;
    const current = plans[index]!;

    if (current.start < previous.end) {
      throw new Error(
        `Edit ${current.index + 1} overlaps with edit ${previous.index + 1}.`,
      );
    }
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
  name: "read_file",
  description:
    "Read text from a file in the active profile workspace. Word .docx files are converted to Markdown. Use offset/limit for large files.",
  parameters: jsonSchemaFromZod(readFileInputSchema),
  run(input, context) {
    return runReadFile(input, context);
  },
};

export async function runReadFile(
  input: unknown,
  context: ToolContext,
  options: FileToolRunOptions = {},
): Promise<ReadFileOutput> {
  const parsed = parseToolInput(readFileInputSchema, input);
  const guardOptions = buildFileGuardOptions(context, options);
  const maxBytes = guardOptions.maxFileBytes ?? 10 * 1024 * 1024;

  const guarded = await guardFilePath(parsed.path, parsed.cwd ?? null, undefined, guardOptions);
  const filePath = guarded.resolved;

  if (BLOCKED_READ_BASENAMES.includes(path.basename(filePath).toLowerCase())) {
    throw new PathGuardError(
      `Reading ${path.basename(filePath)} is not allowed`,
      "SPECIAL_FILE",
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
      "TOO_LARGE",
    );
  }

  const rawContent = await readFileAsText(filePath);
  const lines = rawContent.length === 0 ? [] : rawContent.split("\n");
  const totalLines = lines.length;
  const startLine = Math.min(
    Math.max(1, parsed.offset),
    totalLines === 0 ? 1 : totalLines + 1,
  );
  const startIndex = startLine - 1;
  const endIndex =
    parsed.limit != null ? Math.min(startIndex + parsed.limit, totalLines) : totalLines;
  const slice = lines.slice(startIndex, endIndex);
  const content = slice.join("\n");
  const endLine = slice.length > 0 ? startLine + slice.length - 1 : Math.max(0, startLine - 1);

  return {
    path: filePath,
    content,
    bytesRead: Buffer.byteLength(content, "utf8"),
    startLine,
    endLine,
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
  webSearchTool,
  webFetchTool,
  emailTool,
];

export { PathGuardError };
