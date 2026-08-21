import { cp } from "node:fs/promises";
import type {
  AssignMcpServerRequest,
  AssignSkillRequest,
  AssignToolRequest,
  CloneProfileRequest,
  CreateProfileRequest,
  CreateToolRequest,
  DeleteKnowledgeBaseResponse,
  DocumentAttachment,
  ImageAttachment,
  JsonSchema,
  ListKnowledgeBaseResponse,
  ListProfilesResponse,
  ListToolsResponse,
  ProfileDetail,
  ProfileResponse,
  ProfileSummary,
  ToolDetail,
  ToolResponse,
  ToolSourceResponse,
  ToolSummary,
  UpdateProfileRequest,
  UploadKnowledgeBaseResponse,
} from "@nakama/core";
import {
  createId,
  deleteProfileAvatar,
  getKnowledgeBaseDir,
  getProfileSoulDir,
  hasProfileAvatar,
  initSoulDirectory,
  listKnowledgeBaseDocuments,
  listKnowledgeBaseSources,
  NakamaApiError,
  pathExists,
  uploadKnowledgeBaseDocument as persistKnowledgeBaseDocument,
  readKnowledgeBaseDocumentContent,
  readProfileAvatar,
  deleteKnowledgeBaseDocument as removeKnowledgeBaseDocument,
  resolveSoulStackForProfile,
  saveProfileAvatar,
  writeSoulFile,
} from "@nakama/core";
import {
  BUILTIN_TOOL_IDS,
  isProtectedToolId,
} from "@nakama/core/tools/protected";
import type {
  DatabaseAdapter,
  StoredProfileRecord,
  StoredToolRecord,
} from "@nakama/db";
import {
  ensureBuiltinToolDefinitions,
  ensureProfileDefaultBundledSkills,
} from "@nakama/db";
import {
  CUSTOM_TOOL_HANDLERS,
  type CustomToolType,
  customToolTypesLabel,
  getCustomToolHandler,
  isCustomToolType,
} from "./custom-tool-handlers";
import { toMcpServerSummaries } from "./mcp-service";
import { toSkillSummaries } from "./skills-service";
import { readToolSource } from "./tool-source";

const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const BASIC_PROFILE_TOOL_IDS = [
  BUILTIN_TOOL_IDS.write_file,
  BUILTIN_TOOL_IDS.edit_file,
  BUILTIN_TOOL_IDS.read_file,
  BUILTIN_TOOL_IDS.search_files,
  BUILTIN_TOOL_IDS.knowledge_base_search,
  BUILTIN_TOOL_IDS.web_fetch,
] as const;
const SOUL_FILE_KEY_BY_NAME = {
  "INSTRUCTIONS.md": "instructions",
  "MEMORY.md": "memory",
  "SOUL.md": "soul",
  "STYLE.md": "style",
} as const;

/** Everything in the soul stack except MEMORY.md, which a clone starts fresh. */
const CLONED_SOUL_FILE_KEYS = ["instructions", "soul", "style"] as const;

/** How many `-2`, `-3` suffixes to try before giving up on a generated id. */
const CLONE_ID_ATTEMPTS = 50;

async function copyProfileAvatarTo(
  orgId: string,
  sourceId: string,
  profileId: string
): Promise<void> {
  const avatar = await readProfileAvatar(orgId, sourceId);

  if (!avatar) {
    return;
  }

  await saveProfileAvatar(orgId, profileId, {
    data: avatar.bytes.toString("base64"),
    mediaType: avatar.mediaType,
  });
}

async function copyKnowledgeBaseTo(
  orgId: string,
  sourceId: string,
  profileId: string
): Promise<void> {
  const from = getKnowledgeBaseDir(orgId, sourceId);

  if (!(await pathExists(from))) {
    return;
  }

  // The manifest holds only document metadata and the stored file names carry
  // the document id, not the profile id, so the tree copies as-is.
  await cp(from, getKnowledgeBaseDir(orgId, profileId), {
    force: true,
    recursive: true,
  });
}

function slugifyProfileName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "profile"
  );
}

export class ProfileService {
  constructor(private readonly db: DatabaseAdapter) {}

  async listProfiles(orgId: string): Promise<ListProfilesResponse> {
    const profiles = await this.db.listProfilesForOrg(orgId);
    const summaries = await Promise.all(
      profiles.map((profile) => this.toProfileSummary(profile))
    );

    return { profiles: summaries };
  }

  async getProfile(orgId: string, profileId: string): Promise<ProfileResponse> {
    const profile = await this.requireProfile(orgId, profileId);
    const tools = await this.db.listToolsForProfile(profileId);
    const mcpServers = await this.db.listMcpServersForProfile(profileId);
    const skills = await this.db.listSkillsForProfile(profileId);
    const skillUsage = await this.db.listSkillUsageForProfile(profileId);

    return {
      profile: {
        ...(await this.toProfileSummary(profile)),
        mcpServers: toMcpServerSummaries(mcpServers),
        skills: toSkillSummaries(skills, skillUsage),
        systemPrompt: profile.systemPrompt,
        tools: tools.map(toToolSummary),
      },
    };
  }

  async createProfile(
    orgId: string,
    request: CreateProfileRequest
  ): Promise<ProfileResponse> {
    const name = request.name.trim();

    if (!name) {
      throw new Error("Profile name is required.");
    }

    validateGeneratedSoulFiles(request.soulFiles);

    const profileId = await this.resolveNewProfileId(request.id, name);
    const now = new Date().toISOString();
    const profile: StoredProfileRecord = {
      createdAt: now,
      id: profileId,
      isDefault: false,
      isSuper: request.isSuper ?? false,
      model: request.model ?? null,
      name,
      orgId,
      systemPrompt:
        request.systemPrompt?.trim() ?? "You are a helpful personal assistant.",
      updatedAt: now,
    };

    await this.db.upsertProfile(profile);
    const soulDir = getProfileSoulDir(orgId, profile.id);
    await initSoulDirectory(soulDir);
    await writeGeneratedSoulFiles(soulDir, request.soulFiles);
    await this.assignDefaultTools(profile.id);
    await ensureProfileDefaultBundledSkills(this.db, profile.id);

    return this.getProfile(orgId, profile.id);
  }

  /**
   * Duplicate a profile inside its own org. Assignments are re-linked by id, as
   * tools, MCP servers and Composio toolkits are shared records; only the soul
   * files, avatar and knowledge base are per-profile bytes and get copied.
   * MEMORY.md is deliberately left at the template `initSoulDirectory` writes,
   * so a clone starts without the source's accumulated continuity.
   */
  async cloneProfile(
    orgId: string,
    sourceId: string,
    request: CloneProfileRequest = {}
  ): Promise<ProfileResponse> {
    const source = await this.requireProfile(orgId, sourceId);

    if (source.isSuper) {
      throw new NakamaApiError("Super Bot cannot be cloned.", 400);
    }

    const name = request.name?.trim() || `${source.name} (copy)`;
    const profileId = await this.resolveCloneProfileId(request.id, name);
    const now = new Date().toISOString();

    await this.db.upsertProfile({
      createdAt: now,
      id: profileId,
      isDefault: false,
      isSuper: false,
      model: source.model,
      name,
      orgId,
      skillsPostTurnReview: source.skillsPostTurnReview,
      skillsWriteApproval: source.skillsWriteApproval,
      systemPrompt: source.systemPrompt,
      updatedAt: now,
    });

    await this.copyProfileSoul(orgId, sourceId, profileId);
    await this.copyProfileAssignments(sourceId, profileId);
    await copyProfileAvatarTo(orgId, sourceId, profileId);
    await copyKnowledgeBaseTo(orgId, sourceId, profileId);

    return this.getProfile(orgId, profileId);
  }

  private async copyProfileSoul(
    orgId: string,
    sourceId: string,
    profileId: string
  ): Promise<void> {
    const cloneSoulDir = getProfileSoulDir(orgId, profileId);
    await initSoulDirectory(cloneSoulDir);

    const sourceSoul = await resolveSoulStackForProfile(orgId, sourceId);

    for (const key of CLONED_SOUL_FILE_KEYS) {
      const content = sourceSoul?.files[key];

      if (content) {
        await writeSoulFile(cloneSoulDir, key, content);
      }
    }
  }

  private async copyProfileAssignments(
    sourceId: string,
    profileId: string
  ): Promise<void> {
    for (const tool of await this.db.listToolsForProfile(sourceId)) {
      await this.db.assignToolToProfile(profileId, tool.id);
    }

    for (const skill of await this.db.listSkillsForProfile(sourceId)) {
      await this.db.assignSkillToProfile(profileId, skill.id);
    }

    for (const server of await this.db.listMcpServersForProfile(sourceId)) {
      await this.db.assignMcpServerToProfile(profileId, server.id);
    }

    const toolkits = await this.db.listProfileComposioToolkits(sourceId);

    if (toolkits.length > 0) {
      await this.db.replaceProfileComposioToolkits(
        profileId,
        toolkits.map((toolkit) => ({ ...toolkit, profileId }))
      );
    }
  }

  /**
   * An explicit id must be free, same as create. A generated one is suffixed
   * until it is, because cloning twice is a normal thing to do.
   */
  private async resolveCloneProfileId(
    requestedId: string | undefined,
    name: string
  ): Promise<string> {
    if (requestedId?.trim()) {
      return this.resolveNewProfileId(requestedId, name);
    }

    const base = slugifyProfileName(name);

    for (let suffix = 1; suffix <= CLONE_ID_ATTEMPTS; suffix++) {
      const candidate = suffix === 1 ? base : `${base}-${suffix}`;

      if (!(await this.db.getProfile(candidate))) {
        return this.resolveNewProfileId(candidate, name);
      }
    }

    throw new NakamaApiError(
      `Could not find a free profile id for "${name}".`,
      409
    );
  }

  async updateProfile(
    orgId: string,
    profileId: string,
    request: UpdateProfileRequest
  ): Promise<ProfileResponse> {
    const profile = await this.requireProfile(orgId, profileId);
    const now = new Date().toISOString();

    await this.db.upsertProfile({
      ...profile,
      model: request.model === undefined ? profile.model : request.model,
      name: request.name?.trim() ?? profile.name,
      skillsPostTurnReview:
        request.skillsPostTurnReview === undefined
          ? profile.skillsPostTurnReview
          : request.skillsPostTurnReview,
      skillsWriteApproval:
        request.skillsWriteApproval === undefined
          ? profile.skillsWriteApproval
          : request.skillsWriteApproval,
      systemPrompt: request.systemPrompt?.trim() ?? profile.systemPrompt,
      updatedAt: now,
    });

    return this.getProfile(orgId, profileId);
  }

  async deleteProfile(orgId: string, profileId: string): Promise<void> {
    const profile = await this.requireProfile(orgId, profileId);

    if (profile.isDefault) {
      throw new Error(
        "The default profile for an organization cannot be deleted."
      );
    }

    const deleted = await this.db.deleteProfile(profileId);

    if (!deleted) {
      throw new Error("Profile not found.");
    }
  }

  async listTools(): Promise<ListToolsResponse> {
    await ensureBuiltinToolDefinitions(this.db);
    const tools = await this.db.listTools();
    return { tools: tools.map(toToolDetail) };
  }

  async getTool(toolId: string): Promise<ToolResponse> {
    const tool = await this.requireTool(toolId);
    return { tool: await enrichToolParameters(toToolDetail(tool)) };
  }

  async getToolSource(toolId: string): Promise<ToolSourceResponse> {
    const tool = await this.requireTool(toolId);
    return readToolSource(tool);
  }

  async listProfileTools(
    orgId: string,
    profileId: string
  ): Promise<ListToolsResponse> {
    await this.requireProfile(orgId, profileId);
    const tools = await this.db.listToolsForProfile(profileId);
    return { tools: tools.map(toToolSummary) };
  }

  async deleteTool(toolId: string): Promise<void> {
    const tool = await this.db.getTool(toolId);

    if (!tool) {
      throw new Error("Tool not found.");
    }

    if (isProtectedToolId(tool.id)) {
      throw new Error(`Built-in tool "${tool.name}" cannot be deleted.`);
    }

    const deleted = await this.db.deleteTool(toolId);

    if (!deleted) {
      throw new Error("Tool not found.");
    }
  }

  async createTool(request: CreateToolRequest): Promise<ToolDetail> {
    const name = request.name.trim();
    const description = request.description.trim();

    if (!name) {
      throw new Error("Tool name is required.");
    }

    if (!description) {
      throw new Error("Tool description is required.");
    }

    const existing = await this.db.getToolByName(name);

    if (existing) {
      throw new Error(`Tool already exists: ${name}`);
    }

    const handlerType = readToolHandlerType(request.handlerType);
    const handlerConfig = readCustomToolHandlerConfig(
      handlerType,
      request.handlerConfig
    );

    await CUSTOM_TOOL_HANDLERS[handlerType].validateModule(
      handlerConfig.modulePath
    );

    const now = new Date().toISOString();
    const record: StoredToolRecord = {
      createdAt: now,
      description,
      handlerConfig,
      handlerType,
      id: createId("tool"),
      name,
      updatedAt: now,
    };

    await this.db.upsertTool(record);

    return enrichToolParameters(toToolDetail(record), record);
  }

  async assignTool(
    orgId: string,
    profileId: string,
    request: AssignToolRequest
  ): Promise<ProfileResponse> {
    await this.requireProfile(orgId, profileId);

    const tool = await this.db.getTool(request.toolId);

    if (!tool) {
      throw new Error("Tool not found.");
    }

    await this.db.assignToolToProfile(profileId, request.toolId);

    return this.getProfile(orgId, profileId);
  }

  async unassignTool(
    orgId: string,
    profileId: string,
    toolId: string
  ): Promise<ProfileResponse> {
    await this.requireProfile(orgId, profileId);

    const removed = await this.db.unassignToolFromProfile(profileId, toolId);

    if (!removed) {
      throw new Error("Tool is not assigned to this profile.");
    }

    return this.getProfile(orgId, profileId);
  }

  async assignMcpServer(
    orgId: string,
    profileId: string,
    request: AssignMcpServerRequest
  ): Promise<ProfileResponse> {
    await this.requireProfile(orgId, profileId);

    const server = await this.db.getMcpServer(request.serverId);

    if (!server) {
      throw new Error("MCP server not found.");
    }

    await this.db.assignMcpServerToProfile(profileId, request.serverId);

    return this.getProfile(orgId, profileId);
  }

  async unassignMcpServer(
    orgId: string,
    profileId: string,
    serverId: string
  ): Promise<ProfileResponse> {
    await this.requireProfile(orgId, profileId);

    const removed = await this.db.unassignMcpServerFromProfile(
      profileId,
      serverId
    );

    if (!removed) {
      throw new Error("MCP server is not assigned to this profile.");
    }

    return this.getProfile(orgId, profileId);
  }

  async assignSkill(
    orgId: string,
    profileId: string,
    request: AssignSkillRequest
  ): Promise<ProfileResponse> {
    await this.requireProfile(orgId, profileId);

    const skill = await this.db.getSkill(request.skillId);

    if (!skill) {
      throw new Error("Skill not found.");
    }

    await this.db.assignSkillToProfile(profileId, request.skillId);

    return this.getProfile(orgId, profileId);
  }

  async unassignSkill(
    orgId: string,
    profileId: string,
    skillId: string
  ): Promise<ProfileResponse> {
    await this.requireProfile(orgId, profileId);

    const removed = await this.db.unassignSkillFromProfile(profileId, skillId);

    if (!removed) {
      throw new Error("Skill is not assigned to this profile.");
    }

    return this.getProfile(orgId, profileId);
  }

  async uploadProfileAvatar(
    orgId: string,
    profileId: string,
    attachment: ImageAttachment
  ): Promise<ProfileResponse> {
    const profile = await this.requireProfile(orgId, profileId);

    await saveProfileAvatar(orgId, profileId, attachment);

    const now = new Date().toISOString();
    await this.db.upsertProfile({
      ...profile,
      updatedAt: now,
    });

    return this.getProfile(orgId, profileId);
  }

  async getProfileAvatar(
    orgId: string,
    profileId: string
  ): Promise<{ mediaType: string; bytes: Buffer }> {
    await this.requireProfile(orgId, profileId);

    const avatar = await readProfileAvatar(orgId, profileId);

    if (!avatar) {
      throw new NakamaApiError("Profile avatar not found.", 404);
    }

    return avatar;
  }

  async getProfileAvatarByProfileId(
    profileId: string
  ): Promise<{ mediaType: string; bytes: Buffer }> {
    const profile = await this.db.getProfile(profileId);

    if (!profile?.orgId) {
      throw new NakamaApiError("Profile not found.", 404);
    }

    return this.getProfileAvatar(profile.orgId, profileId);
  }

  async deleteProfileAvatar(orgId: string, profileId: string): Promise<void> {
    const profile = await this.requireProfile(orgId, profileId);
    const removed = await deleteProfileAvatar(orgId, profileId);

    if (!removed) {
      throw new NakamaApiError("Profile avatar not found.", 404);
    }

    const now = new Date().toISOString();
    await this.db.upsertProfile({
      ...profile,
      updatedAt: now,
    });
  }

  async listKnowledgeBase(
    orgId: string,
    profileId: string
  ): Promise<ListKnowledgeBaseResponse> {
    await this.requireProfile(orgId, profileId);
    const documents = await listKnowledgeBaseDocuments(orgId, profileId);
    const sources = await listKnowledgeBaseSources();
    return { documents, profileId, sources };
  }

  async uploadKnowledgeBaseDocument(
    orgId: string,
    profileId: string,
    document: DocumentAttachment
  ): Promise<UploadKnowledgeBaseResponse> {
    await this.requireProfile(orgId, profileId);

    try {
      const uploaded = await persistKnowledgeBaseDocument(
        orgId,
        profileId,
        document
      );
      return { document: uploaded, profileId };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to upload knowledge base document.";
      throw new NakamaApiError(message, 400);
    }
  }

  async deleteKnowledgeBaseDocument(
    orgId: string,
    profileId: string,
    documentId: string
  ): Promise<DeleteKnowledgeBaseResponse> {
    await this.requireProfile(orgId, profileId);
    const deleted = await removeKnowledgeBaseDocument(
      orgId,
      profileId,
      documentId
    );

    if (!deleted) {
      throw new NakamaApiError("Knowledge base document not found.", 404);
    }

    return { deleted: true, documentId, profileId };
  }

  async readKnowledgeBaseDocument(
    orgId: string,
    profileId: string,
    documentId: string,
    options: { render?: "text" } = {}
  ): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
    await this.requireProfile(orgId, profileId);

    try {
      return await readKnowledgeBaseDocumentContent(
        orgId,
        profileId,
        documentId,
        options
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Knowledge base document not found.";
      throw new NakamaApiError(message, 404);
    }
  }

  private async resolveNewProfileId(
    requestedId: string | undefined,
    name: string
  ): Promise<string> {
    const trimmed = requestedId?.trim() || slugifyProfileName(name);

    if (!PROFILE_ID_PATTERN.test(trimmed)) {
      throw new NakamaApiError(
        "Profile id must start with a letter or number and use only letters, numbers, underscores, and hyphens (max 64 characters).",
        400
      );
    }

    const existing = await this.db.getProfile(trimmed);

    if (existing) {
      throw new NakamaApiError("Profile id already exists.", 409);
    }

    return trimmed;
  }

  private async requireProfile(
    orgId: string,
    profileId: string
  ): Promise<StoredProfileRecord> {
    const profile = await this.db.getProfileForOrg(profileId, orgId);

    if (!profile) {
      throw new NakamaApiError("Profile not found.", 404);
    }

    return profile;
  }

  private async assignDefaultTools(profileId: string): Promise<void> {
    for (const toolId of BASIC_PROFILE_TOOL_IDS) {
      const tool = await this.db.getTool(toolId);

      if (tool) {
        await this.db.assignToolToProfile(profileId, tool.id);
      }
    }
  }

  private async requireTool(toolId: string): Promise<StoredToolRecord> {
    const tool = await this.db.getTool(toolId);

    if (!tool) {
      throw new NakamaApiError("Tool not found.", 404);
    }

    return tool;
  }

  private async toProfileSummary(
    profile: StoredProfileRecord
  ): Promise<ProfileSummary> {
    const orgId = profile.orgId;

    if (!orgId) {
      throw new Error("Profile is missing orgId.");
    }

    const tools = await this.db.listToolsForProfile(profile.id);
    const mcpServers = await this.db.listMcpServersForProfile(profile.id);
    const soulStack = await resolveSoulStackForProfile(orgId, profile.id);

    return {
      createdAt: profile.createdAt,
      hasAvatar: await hasProfileAvatar(orgId, profile.id),
      id: profile.id,
      isDefault: profile.isDefault ?? false,
      isSuper: profile.isSuper,
      mcpServerCount: mcpServers.length,
      model: profile.model,
      name: profile.name,
      skillsPostTurnReview: profile.skillsPostTurnReview ?? null,
      skillsWriteApproval: profile.skillsWriteApproval ?? null,
      soulActive: soulStack !== null,
      toolCount: tools.length,
      updatedAt: profile.updatedAt,
    };
  }
}

function toToolSummary(record: StoredToolRecord): ToolSummary {
  return {
    description: record.description,
    handlerType: record.handlerType,
    id: record.id,
    name: record.name,
  };
}

async function enrichToolParameters(
  detail: ToolDetail,
  record?: StoredToolRecord
): Promise<ToolDetail> {
  const handler = getCustomToolHandler(detail.handlerType);

  if (!handler) {
    return detail;
  }

  const source =
    record ??
    ({
      createdAt: detail.createdAt,
      description: detail.description,
      handlerConfig: detail.handlerConfig,
      handlerType: detail.handlerType,
      id: detail.id,
      name: detail.name,
      updatedAt: detail.updatedAt,
    } satisfies StoredToolRecord);

  const loaded = await handler.load(source);
  if (!loaded?.parameters) {
    return detail;
  }

  return { ...detail, parameters: loaded.parameters };
}

function toToolDetail(record: StoredToolRecord): ToolDetail {
  return {
    ...toToolSummary(record),
    createdAt: record.createdAt,
    handlerConfig: record.handlerConfig,
    updatedAt: record.updatedAt,
  };
}

export type { ProfileDetail };

function readToolHandlerType(handlerType: string | undefined): CustomToolType {
  if (handlerType === undefined) {
    return "javascript";
  }

  if (isCustomToolType(handlerType)) {
    return handlerType;
  }

  throw new Error(
    `Only ${customToolTypesLabel()} tools can be created. Use handlerType ${customToolTypesLabel()}.`
  );
}

function readCustomToolHandlerConfig(
  handlerType: CustomToolType,
  handlerConfig: unknown
): { modulePath: string; parameters?: JsonSchema } {
  const { extension } = CUSTOM_TOOL_HANDLERS[handlerType];

  if (typeof handlerConfig !== "object" || handlerConfig === null) {
    throw new Error(
      `Custom tools require handlerConfig.modulePath ending in "${extension}".`
    );
  }

  const config = handlerConfig as Record<string, unknown>;
  const modulePath = config.modulePath;

  if (
    typeof modulePath !== "string" ||
    !modulePath.trim().endsWith(extension)
  ) {
    throw new Error(
      `Custom tools require handlerConfig.modulePath ending in "${extension}".`
    );
  }

  const parameters = config.parameters;

  if (
    parameters !== undefined &&
    (typeof parameters !== "object" ||
      parameters === null ||
      Array.isArray(parameters))
  ) {
    throw new Error(
      "handlerConfig.parameters must be a JSON schema object when provided."
    );
  }

  return {
    modulePath: modulePath.trim(),
    ...(parameters === undefined ? {} : { parameters }),
  };
}

async function writeGeneratedSoulFiles(
  soulDir: string,
  soulFiles: CreateProfileRequest["soulFiles"] | undefined
): Promise<void> {
  if (soulFiles === undefined) {
    return;
  }

  const files = {
    ...soulFiles,
    "MEMORY.md": soulFiles["MEMORY.md"] ?? "",
  };

  for (const [fileName, content] of Object.entries(files)) {
    if (content === undefined) {
      continue;
    }

    if (typeof content !== "string") {
      throw new Error(`Soul file content must be a string: ${fileName}`);
    }

    await writeSoulFile(
      soulDir,
      SOUL_FILE_KEY_BY_NAME[fileName as keyof typeof SOUL_FILE_KEY_BY_NAME],
      content
    );
  }
}

function validateGeneratedSoulFiles(
  soulFiles: CreateProfileRequest["soulFiles"] | undefined
): void {
  if (soulFiles === undefined) {
    return;
  }

  for (const [key, value] of Object.entries(soulFiles)) {
    if (!(key in SOUL_FILE_KEY_BY_NAME)) {
      throw new Error(`Unsupported soul file: ${key}`);
    }

    if (typeof value !== "string") {
      throw new Error(`Soul file content must be a string: ${key}`);
    }
  }
}
