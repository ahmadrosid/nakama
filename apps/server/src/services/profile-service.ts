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
  nanoid,
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
import { SUPER_BOT_PROFILE_ID } from "@tinyclaw/db";
import { validateJavascriptToolModule } from "./javascript-tool-loader";
import { toMcpServerSummaries } from "./mcp-service";
import { toSkillSummaries } from "./skills-service";
import { readToolSource } from "./tool-source";

export class ProfileService {
  constructor(private readonly db: DatabaseAdapter) {}

  async listProfiles(): Promise<ListProfilesResponse> {
    const profiles = await this.db.listProfiles();
    const summaries = await Promise.all(
      profiles.map((profile) => this.toProfileSummary(profile)),
    );

    return { profiles: summaries };
  }

  async getProfile(profileId: string): Promise<ProfileResponse> {
    const profile = await this.requireProfile(profileId);
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

  async createProfile(request: CreateProfileRequest): Promise<ProfileResponse> {
    const now = new Date().toISOString();
    const profile: StoredProfileRecord = {
      id: nanoid(),
      name: request.name.trim(),
      systemPrompt: request.systemPrompt?.trim() ?? "You are a helpful personal assistant.",
      model: request.model ?? null,
      isSuper: request.isSuper ?? false,
      createdAt: now,
      updatedAt: now,
    };

    if (!profile.name) {
      throw new Error("Profile name is required.");
    }

    await this.db.upsertProfile(profile);
    await initSoulDirectory(getProfileSoulDir(profile.id));
    await this.assignDefaultTools(profile.id);

    return this.getProfile(profile.id);
  }

  async updateProfile(
    profileId: string,
    request: UpdateProfileRequest,
  ): Promise<ProfileResponse> {
    const profile = await this.requireProfile(profileId);
    const now = new Date().toISOString();

    await this.db.upsertProfile({
      ...profile,
      name: request.name?.trim() ?? profile.name,
      systemPrompt: request.systemPrompt?.trim() ?? profile.systemPrompt,
      model: request.model === undefined ? profile.model : request.model,
      updatedAt: now,
    });

    return this.getProfile(profileId);
  }

  async deleteProfile(profileId: string): Promise<void> {
    if (profileId === SUPER_BOT_PROFILE_ID) {
      throw new Error("The Super Bot profile cannot be deleted.");
    }

    const deleted = await this.db.deleteProfile(profileId);

    if (!deleted) {
      throw new Error("Profile not found.");
    }
  }

  async listTools(): Promise<ListToolsResponse> {
    const tools = await this.db.listTools();
    return { tools: tools.map(toToolDetail) };
  }

  async getTool(toolId: string): Promise<ToolResponse> {
    const tool = await this.requireTool(toolId);
    return { tool: toToolDetail(tool) };
  }

  async getToolSource(toolId: string): Promise<ToolSourceResponse> {
    const tool = await this.requireTool(toolId);
    return readToolSource(tool);
  }

  async listProfileTools(profileId: string): Promise<ListToolsResponse> {
    await this.requireProfile(profileId);
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

    return toToolDetail(record);
  }

  async assignTool(profileId: string, request: AssignToolRequest): Promise<ProfileResponse> {
    await this.requireProfile(profileId);

    const tool = await this.db.getTool(request.toolId);

    if (!tool) {
      throw new Error("Tool not found.");
    }

    await this.db.assignToolToProfile(profileId, request.toolId);

    return this.getProfile(profileId);
  }

  async unassignTool(profileId: string, toolId: string): Promise<ProfileResponse> {
    await this.requireProfile(profileId);

    const removed = await this.db.unassignToolFromProfile(profileId, toolId);

    if (!removed) {
      throw new Error("Tool is not assigned to this profile.");
    }

    return this.getProfile(profileId);
  }

  async assignMcpServer(
    profileId: string,
    request: AssignMcpServerRequest,
  ): Promise<ProfileResponse> {
    await this.requireProfile(profileId);

    const server = await this.db.getMcpServer(request.serverId);

    if (!server) {
      throw new Error("MCP server not found.");
    }

    await this.db.assignMcpServerToProfile(profileId, request.serverId);

    return this.getProfile(profileId);
  }

  async unassignMcpServer(profileId: string, serverId: string): Promise<ProfileResponse> {
    await this.requireProfile(profileId);

    const removed = await this.db.unassignMcpServerFromProfile(profileId, serverId);

    if (!removed) {
      throw new Error("MCP server is not assigned to this profile.");
    }

    return this.getProfile(profileId);
  }

  async assignSkill(
    profileId: string,
    request: AssignSkillRequest,
  ): Promise<ProfileResponse> {
    await this.requireProfile(profileId);

    const skill = await this.db.getSkill(request.skillId);

    if (!skill) {
      throw new Error("Skill not found.");
    }

    await this.db.assignSkillToProfile(profileId, request.skillId);

    return this.getProfile(profileId);
  }

  async unassignSkill(profileId: string, skillId: string): Promise<ProfileResponse> {
    await this.requireProfile(profileId);

    const removed = await this.db.unassignSkillFromProfile(profileId, skillId);

    if (!removed) {
      throw new Error("Skill is not assigned to this profile.");
    }

    return this.getProfile(profileId);
  }

  async uploadProfileAvatar(
    profileId: string,
    attachment: ImageAttachment,
  ): Promise<ProfileResponse> {
    const profile = await this.requireProfile(profileId);

    await saveProfileAvatar(profileId, attachment);

    const now = new Date().toISOString();
    await this.db.upsertProfile({
      ...profile,
      updatedAt: now,
    });

    return this.getProfile(profileId);
  }

  async getProfileAvatar(profileId: string): Promise<{ mediaType: string; bytes: Buffer }> {
    await this.requireProfile(profileId);

    const avatar = await readProfileAvatar(profileId);

    if (!avatar) {
      throw new TinyClawApiError("Profile avatar not found.", 404);
    }

    return avatar;
  }

  async deleteProfileAvatar(profileId: string): Promise<void> {
    const profile = await this.requireProfile(profileId);
    const removed = await deleteProfileAvatar(profileId);

    if (!removed) {
      throw new TinyClawApiError("Profile avatar not found.", 404);
    }

    const now = new Date().toISOString();
    await this.db.upsertProfile({
      ...profile,
      updatedAt: now,
    });
  }

  async listKnowledgeBase(profileId: string): Promise<ListKnowledgeBaseResponse> {
    await this.requireProfile(profileId);
    const documents = await listKnowledgeBaseDocuments(profileId);
    return { documents, profileId };
  }

  async uploadKnowledgeBaseDocument(
    profileId: string,
    document: DocumentAttachment,
  ): Promise<UploadKnowledgeBaseResponse> {
    await this.requireProfile(profileId);

    try {
      const uploaded = await persistKnowledgeBaseDocument(profileId, document);
      return { document: uploaded, profileId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to upload knowledge base document.";
      throw new TinyClawApiError(message, 400);
    }
  }

  async deleteKnowledgeBaseDocument(
    profileId: string,
    documentId: string,
  ): Promise<DeleteKnowledgeBaseResponse> {
    await this.requireProfile(profileId);
    const deleted = await removeKnowledgeBaseDocument(profileId, documentId);

    if (!deleted) {
      throw new TinyClawApiError("Knowledge base document not found.", 404);
    }

    return { deleted: true, profileId, documentId };
  }

  private async requireProfile(profileId: string): Promise<StoredProfileRecord> {
    const profile = await this.db.getProfile(profileId);

    if (!profile) {
      throw new Error("Profile not found.");
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
    const tools = await this.db.listToolsForProfile(profile.id);
    const mcpServers = await this.db.listMcpServersForProfile(profile.id);
    const soulStack = await resolveSoulStackForProfile(profile.id);

    return {
      id: profile.id,
      name: profile.name,
      model: profile.model,
      isSuper: profile.isSuper,
      toolCount: tools.length,
      mcpServerCount: mcpServers.length,
      soulActive: soulStack !== null,
      hasAvatar: await hasProfileAvatar(profile.id),
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
