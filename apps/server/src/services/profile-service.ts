import type {
  AssignMcpServerRequest,
  AssignSkillRequest,
  AssignToolRequest,
  CreateProfileRequest,
  CreateToolRequest,
  DeleteKnowledgeBaseResponse,
  DocumentAttachment,
  ImageAttachment,
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
} from "@tinyclaw/core";
import {
  createId,
  deleteKnowledgeBaseDocument as removeKnowledgeBaseDocument,
  deleteProfileAvatar,
  getProfileSoulDir,
  hasProfileAvatar,
  initSoulDirectory,
  listKnowledgeBaseDocuments,
  readProfileAvatar,
  resolveSoulStackForProfile,
  saveProfileAvatar,
  TinyClawApiError,
  uploadKnowledgeBaseDocument as persistKnowledgeBaseDocument,
} from "@tinyclaw/core";
import { isProtectedToolId } from "@tinyclaw/core/tools/protected";
import { BUILTIN_TOOL_IDS } from "@tinyclaw/core/tools/protected";
import type { DatabaseAdapter, StoredProfileRecord, StoredToolRecord } from "@tinyclaw/db";
import { ensureBuiltinToolDefinitions } from "@tinyclaw/db";
import { loadJavascriptTool, validateJavascriptToolModule } from "./javascript-tool-loader";
import { toMcpServerSummaries } from "./mcp-service";
import { toSkillSummaries } from "./skills-service";
import { readToolSource } from "./tool-source";

const PROFILE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

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
      profiles.map((profile) => this.toProfileSummary(profile)),
    );

    return { profiles: summaries };
  }

  async getProfile(orgId: string, profileId: string): Promise<ProfileResponse> {
    const profile = await this.requireProfile(orgId, profileId);
    const tools = await this.db.listToolsForProfile(profileId);
    const mcpServers = await this.db.listMcpServersForProfile(profileId);
    const skills = await this.db.listSkillsForProfile(profileId);

    return {
      profile: {
        ...(await this.toProfileSummary(profile)),
        systemPrompt: profile.systemPrompt,
        tools: tools.map(toToolSummary),
        mcpServers: toMcpServerSummaries(mcpServers),
        skills: toSkillSummaries(skills),
      },
    };
  }

  async createProfile(orgId: string, request: CreateProfileRequest): Promise<ProfileResponse> {
    const name = request.name.trim();

    if (!name) {
      throw new Error("Profile name is required.");
    }

    const profileId = await this.resolveNewProfileId(request.id, name);
    const now = new Date().toISOString();
    const profile: StoredProfileRecord = {
      id: profileId,
      name,
      systemPrompt: request.systemPrompt?.trim() ?? "You are a helpful personal assistant.",
      model: request.model ?? null,
      isSuper: request.isSuper ?? false,
      orgId,
      isDefault: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.upsertProfile(profile);
    await initSoulDirectory(getProfileSoulDir(orgId, profile.id));
    await this.assignDefaultTools(profile.id);

    return this.getProfile(orgId, profile.id);
  }

  async updateProfile(
    orgId: string,
    profileId: string,
    request: UpdateProfileRequest,
  ): Promise<ProfileResponse> {
    const profile = await this.requireProfile(orgId, profileId);
    const now = new Date().toISOString();

    await this.db.upsertProfile({
      ...profile,
      name: request.name?.trim() ?? profile.name,
      systemPrompt: request.systemPrompt?.trim() ?? profile.systemPrompt,
      model: request.model === undefined ? profile.model : request.model,
      updatedAt: now,
    });

    return this.getProfile(orgId, profileId);
  }

  async deleteProfile(orgId: string, profileId: string): Promise<void> {
    const profile = await this.requireProfile(orgId, profileId);

    if (profile.isDefault) {
      throw new Error("The default profile for an organization cannot be deleted.");
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

  async listProfileTools(orgId: string, profileId: string): Promise<ListToolsResponse> {
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
    const handlerConfig = readJavascriptToolHandlerConfig(request.handlerConfig);

    await validateJavascriptToolModule(handlerConfig.modulePath);

    const now = new Date().toISOString();
    const record: StoredToolRecord = {
      id: createId("tool"),
      name,
      description,
      handlerType,
      handlerConfig,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.upsertTool(record);

    return enrichToolParameters(toToolDetail(record), record);
  }

  async assignTool(
    orgId: string,
    profileId: string,
    request: AssignToolRequest,
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
    toolId: string,
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
    request: AssignMcpServerRequest,
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
    serverId: string,
  ): Promise<ProfileResponse> {
    await this.requireProfile(orgId, profileId);

    const removed = await this.db.unassignMcpServerFromProfile(profileId, serverId);

    if (!removed) {
      throw new Error("MCP server is not assigned to this profile.");
    }

    return this.getProfile(orgId, profileId);
  }

  async assignSkill(
    orgId: string,
    profileId: string,
    request: AssignSkillRequest,
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
    skillId: string,
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
    attachment: ImageAttachment,
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
    profileId: string,
  ): Promise<{ mediaType: string; bytes: Buffer }> {
    await this.requireProfile(orgId, profileId);

    const avatar = await readProfileAvatar(orgId, profileId);

    if (!avatar) {
      throw new TinyClawApiError("Profile avatar not found.", 404);
    }

    return avatar;
  }

  async getProfileAvatarByProfileId(
    profileId: string,
  ): Promise<{ mediaType: string; bytes: Buffer }> {
    const profile = await this.db.getProfile(profileId);

    if (!profile?.orgId) {
      throw new TinyClawApiError("Profile not found.", 404);
    }

    return this.getProfileAvatar(profile.orgId, profileId);
  }

  async deleteProfileAvatar(orgId: string, profileId: string): Promise<void> {
    const profile = await this.requireProfile(orgId, profileId);
    const removed = await deleteProfileAvatar(orgId, profileId);

    if (!removed) {
      throw new TinyClawApiError("Profile avatar not found.", 404);
    }

    const now = new Date().toISOString();
    await this.db.upsertProfile({
      ...profile,
      updatedAt: now,
    });
  }

  async listKnowledgeBase(orgId: string, profileId: string): Promise<ListKnowledgeBaseResponse> {
    await this.requireProfile(orgId, profileId);
    const documents = await listKnowledgeBaseDocuments(orgId, profileId);
    return { documents, profileId };
  }

  async uploadKnowledgeBaseDocument(
    orgId: string,
    profileId: string,
    document: DocumentAttachment,
  ): Promise<UploadKnowledgeBaseResponse> {
    await this.requireProfile(orgId, profileId);

    try {
      const uploaded = await persistKnowledgeBaseDocument(orgId, profileId, document);
      return { document: uploaded, profileId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload knowledge base document.";
      throw new TinyClawApiError(message, 400);
    }
  }

  async deleteKnowledgeBaseDocument(
    orgId: string,
    profileId: string,
    documentId: string,
  ): Promise<DeleteKnowledgeBaseResponse> {
    await this.requireProfile(orgId, profileId);
    const deleted = await removeKnowledgeBaseDocument(orgId, profileId, documentId);

    if (!deleted) {
      throw new TinyClawApiError("Knowledge base document not found.", 404);
    }

    return { deleted: true, profileId, documentId };
  }

  private async resolveNewProfileId(
    requestedId: string | undefined,
    name: string,
  ): Promise<string> {
    const trimmed = requestedId?.trim() || slugifyProfileName(name);

    if (!PROFILE_ID_PATTERN.test(trimmed)) {
      throw new TinyClawApiError(
        "Profile id must start with a letter or number and use only letters, numbers, underscores, and hyphens (max 64 characters).",
        400,
      );
    }

    const existing = await this.db.getProfile(trimmed);

    if (existing) {
      throw new TinyClawApiError("Profile id already exists.", 409);
    }

    return trimmed;
  }

  private async requireProfile(orgId: string, profileId: string): Promise<StoredProfileRecord> {
    const profile = await this.db.getProfileForOrg(profileId, orgId);

    if (!profile) {
      throw new TinyClawApiError("Profile not found.", 404);
    }

    return profile;
  }

  private async assignDefaultTools(profileId: string): Promise<void> {
    const createSkillTool = await this.db.getTool(BUILTIN_TOOL_IDS.create_skill);

    if (createSkillTool) {
      await this.db.assignToolToProfile(profileId, createSkillTool.id);
    }
  }

  private async requireTool(toolId: string): Promise<StoredToolRecord> {
    const tool = await this.db.getTool(toolId);

    if (!tool) {
      throw new TinyClawApiError("Tool not found.", 404);
    }

    return tool;
  }

  private async toProfileSummary(profile: StoredProfileRecord): Promise<ProfileSummary> {
    const orgId = profile.orgId;

    if (!orgId) {
      throw new Error("Profile is missing orgId.");
    }

    const tools = await this.db.listToolsForProfile(profile.id);
    const mcpServers = await this.db.listMcpServersForProfile(profile.id);
    const soulStack = await resolveSoulStackForProfile(orgId, profile.id);

    return {
      id: profile.id,
      name: profile.name,
      model: profile.model,
      isSuper: profile.isSuper,
      isDefault: profile.isDefault ?? false,
      toolCount: tools.length,
      mcpServerCount: mcpServers.length,
      soulActive: soulStack !== null,
      hasAvatar: await hasProfileAvatar(orgId, profile.id),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}

function toToolSummary(record: StoredToolRecord): ToolSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    handlerType: record.handlerType,
  };
}

async function enrichToolParameters(detail: ToolDetail, record?: StoredToolRecord): Promise<ToolDetail> {
  if (detail.handlerType !== "javascript") {
    return detail;
  }

  const source =
    record ??
    ({
      id: detail.id,
      name: detail.name,
      description: detail.description,
      handlerType: detail.handlerType,
      handlerConfig: detail.handlerConfig,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
    } satisfies StoredToolRecord);

  const loaded = await loadJavascriptTool(source);
  if (!loaded?.parameters) {
    return detail;
  }

  return { ...detail, parameters: loaded.parameters };
}

function toToolDetail(record: StoredToolRecord): ToolDetail {
  return {
    ...toToolSummary(record),
    handlerConfig: record.handlerConfig,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export type { ProfileDetail };

function readToolHandlerType(handlerType: string | undefined): "javascript" {
  if (handlerType === undefined || handlerType === "javascript") {
    return "javascript";
  }

  throw new Error('Only JavaScript tools can be created. Use handlerType "javascript".');
}

function readJavascriptToolHandlerConfig(
  handlerConfig: unknown,
): { modulePath: string } {
  if (typeof handlerConfig !== "object" || handlerConfig === null) {
    throw new Error(
      'JavaScript tools require handlerConfig.modulePath ending in ".js".',
    );
  }

  const modulePath = (handlerConfig as Record<string, unknown>).modulePath;

  if (typeof modulePath !== "string" || !modulePath.trim().endsWith(".js")) {
    throw new Error(
      'JavaScript tools require handlerConfig.modulePath ending in ".js".',
    );
  }

  return { modulePath: modulePath.trim() };
}
