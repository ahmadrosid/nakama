import {
  createAgentHarness,
  type AgentChatSession,
  type AgentHarness,
  type CompactionConfig,
} from "@tinyclaw/agent";
import type {
  AgentChannel,
  AssignToolRequest,
  ChatMessage,
  CompactionResponse,
  CreateProfileRequest,
  CreateToolRequest,
  InitSoulResponse,
  ListProfilesResponse,
  ListToolsResponse,
  ListSessionsResponse,
  ModelsResponse,
  ProfileResponse,
  ConfigureProviderResponse,
  ImageAttachment,
  SetModelResponse,
  SoulStackResponse,
  SoulStatusResponse,
  TelegramSettingsResponse,
  ToolDefinition,
  UpdateProfileRequest,
  UpdateSoulFileRequest,
  UpdateTelegramSettingsRequest,
  UserProviderConfig,
  type ProviderClient,
} from "@tinyclaw/core";
import {
  createId,
  createSessionId,
  inferProviderFromApiKey,
  loadTelegramSettingsPublic,
  loadUserTimezone,
  readEnvValue,
  regenerateTelegramHandshake,
  saveTelegramConfig,
  saveUserConfig,
  saveUserTimezone,
} from "@tinyclaw/core";
import {
  DEFAULT_PROFILE_ID,
  SUPER_BOT_PROFILE_ID,
  SUPER_BOT_TOOL_AUTHORING_RULES,
  type DatabaseAdapter,
  type StoredProfileRecord,
} from "@tinyclaw/db";
import {
  createProviderFromSources,
  detectProvider,
  getAvailableModels,
  getDefaultModel,
  getModelById,
  resolveModel,
} from "../providers";
import { createSuperBotTools } from "../tools/super-bot-tools";
import type { AutomationRunner } from "./automation-runner";
import { ProfileService } from "./profile-service";
import { SoulService } from "./soul-service";
import { resolveToolsFromStorage } from "./tool-resolver";
import { loadSessionHistory, wrapPersistedSession } from "./session-persistence";

interface StoredSession {
  channel: AgentChannel;
  profileId: string;
  session: AgentChatSession;
}

export class AgentService {
  private harness: AgentHarness;
  private userConfig: UserProviderConfig | null;
  private readonly db: DatabaseAdapter;
  private readonly profileService: ProfileService;
  private readonly soulService: SoulService;
  private readonly superBotTools: ToolDefinition[];
  private automationTools: ToolDefinition[] = [];
  private automationRunner: AutomationRunner | null = null;
  private readonly sessions = new Map<string, StoredSession>();
  private _providerConfigured: boolean;

  constructor(
    userConfig: UserProviderConfig | null,
    provider: ProviderClient | null,
    db: DatabaseAdapter,
  ) {
    this.userConfig = userConfig;
    this.db = db;
    this.profileService = new ProfileService(db);
    this.soulService = new SoulService();
    this.superBotTools = createSuperBotTools(this.profileService);
    this._providerConfigured = provider !== null;
    this.harness = this.createHarness(provider);
  }

  get profiles(): ProfileService {
    return this.profileService;
  }

  setAutomationTools(tools: ToolDefinition[]): void {
    this.automationTools = tools;
    this.sessions.clear();
  }

  setAutomationRunner(runner: AutomationRunner): void {
    this.automationRunner = runner;
  }

  async getUserTimezone(): Promise<string> {
    return this.userConfig?.timezone ?? loadUserTimezone();
  }

  async setUserTimezone(timezone: string): Promise<string> {
    await saveUserTimezone(timezone);

    if (this.userConfig) {
      this.userConfig = { ...this.userConfig, timezone };
    }

    return timezone;
  }

  async getTelegramSettings(): Promise<TelegramSettingsResponse> {
    return loadTelegramSettingsPublic();
  }

  async setTelegramSettings(
    input: UpdateTelegramSettingsRequest,
  ): Promise<TelegramSettingsResponse> {
    const existing = await loadTelegramSettingsPublic();
    const botToken =
      input.botToken !== undefined && input.botToken.trim()
        ? input.botToken.trim()
        : undefined;

    if (!botToken && !existing.configured) {
      throw new Error("Bot token is required.");
    }

    return saveTelegramConfig({
      ...(botToken ? { botToken } : {}),
      ...(input.allowedUserIds !== undefined
        ? { allowedUserIds: input.allowedUserIds }
        : existing.allowedUserIds.length > 0
          ? { allowedUserIds: existing.allowedUserIds.join(",") }
          : {}),
      ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
    });
  }

  async regenerateTelegramHandshake(): Promise<TelegramSettingsResponse> {
    return regenerateTelegramHandshake();
  }

  async runAutomationPrompt(profileId: string, prompt: string): Promise<string> {
    if (!this._providerConfigured) {
      throw new Error("Provider is not configured.");
    }

    const profile = await this.requireProfile(profileId);
    const tools = await this.resolveProfileTools(profile, { includeAutomationTools: false });
    const soulStack = await this.soulService.resolveSoulStack(profileId);
    const systemPrompt = soulStack
      ? await this.soulService.resolveSystemPrompt(profileId, profile.systemPrompt)
      : profile.systemPrompt;
    const userTimezone = await this.getUserTimezone();

    const session = this.harness.createChatSession({
      channel: "automation",
      tools,
      systemPrompt,
      enableToolLoop: true,
      soul: soulStack !== null,
      userTimezone,
    });

    return session.send(prompt);
  }

  async runAutomation(automationId: string) {
    if (!this.automationRunner) {
      throw new Error("Automation runner is not configured.");
    }

    return this.automationRunner.run(automationId);
  }

  get providerConfigured(): boolean {
    return this._providerConfigured;
  }

  async createSession(
    channel: AgentChannel,
    profileId = DEFAULT_PROFILE_ID,
  ): Promise<string> {
    const sessionId = createSessionId();

    await this.db.upsertSession({
      id: sessionId,
      profileId,
      channel,
      createdAt: new Date().toISOString(),
    });

    const session = await this.buildChatSession(channel, profileId, sessionId);

    this.sessions.set(sessionId, { channel, profileId, session });

    return sessionId;
  }

  async getSessionMessages(sessionId: string): Promise<ChatMessage[] | null> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return null;
    }

    return loadSessionHistory(this.db, sessionId);
  }

  async listSessions(
    profileId: string,
    channel: AgentChannel,
  ): Promise<ListSessionsResponse> {
    await this.requireProfile(profileId);

    const sessions = await this.db.listSessionSummaries(profileId, channel);

    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        profileId: session.profileId,
        channel: parseAgentChannel(session.channel) ?? channel,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
        preview: session.preview,
      })),
    };
  }

  async purgeSession(sessionId: string): Promise<boolean> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return false;
    }

    this.sessions.delete(sessionId);
    await this.db.deleteSession(sessionId);
    return true;
  }

  async resolveSession(sessionId: string): Promise<AgentChatSession | null> {
    const stored = this.sessions.get(sessionId);

    if (stored) {
      return stored.session;
    }

    const record = await this.db.getSession(sessionId);

    if (!record) {
      return null;
    }

    const channel = parseAgentChannel(record.channel);

    if (!channel) {
      return null;
    }

    const session = await this.buildChatSession(
      channel,
      record.profileId,
      sessionId,
    );

    this.sessions.set(sessionId, {
      channel,
      profileId: record.profileId,
      session,
    });

    return session;
  }

  async clearSession(sessionId: string): Promise<boolean> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return false;
    }

    const stored = this.sessions.get(sessionId);

    if (stored) {
      stored.session.clear();
    }

    await this.db.deleteMessagesForSession(sessionId);
    return true;
  }

  async compactSession(
    sessionId: string,
    options: { force?: boolean } = {},
  ): Promise<CompactionResponse | null> {
    const session = await this.resolveSession(sessionId);

    if (!session) {
      return null;
    }

    return session.compact(options);
  }

  deleteSession(sessionId: string): boolean {
    const deleted = this.sessions.delete(sessionId);

    if (deleted) {
      void this.db.deleteSession(sessionId);
    }

    return deleted;
  }

  async draftAutomation(prompt: string, channel: AgentChannel) {
    return this.harness.createAutomationFromPrompt({ prompt, channel });
  }

  getModels(): ModelsResponse {
    const provider = detectProvider(process.env, this.userConfig);
    const currentModel =
      provider && this.userConfig
        ? resolveModel(provider, this.userConfig.model)
        : null;
    const defaultModel = provider ? getDefaultModel(provider) : "gpt-5.4";

    return {
      provider,
      currentModel,
      defaultModel,
      models: getAvailableModels(),
    };
  }

  async setModel(model: string): Promise<SetModelResponse> {
    if (!this.userConfig) {
      throw new Error("Provider is not configured.");
    }

    const option = getModelById(model);

    if (!option) {
      throw new Error(`Unknown model: ${model}`);
    }

    const nextConfig = {
      ...this.userConfig,
      provider: option.provider,
      model: option.id,
    };

    const currentProvider = detectProvider(process.env, this.userConfig);

    if (option.provider !== currentProvider) {
      const apiKey =
        option.provider === "openai"
          ? readEnvValue(process.env, "OPENAI_API_KEY")
          : readEnvValue(process.env, "ANTHROPIC_API_KEY");

      if (!apiKey) {
        throw new Error(
          `Switching to ${option.provider} requires ${
            option.provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"
          }.`,
        );
      }

      nextConfig.apiKey = apiKey;
    }

    this.userConfig = nextConfig;
    await saveUserConfig(this.userConfig);

    const nextProvider = createProviderFromSources(process.env, this.userConfig);

    if (!nextProvider) {
      throw new Error(`Could not configure provider for ${option.provider}.`);
    }

    this._providerConfigured = true;
    this.harness = this.createHarness(nextProvider);
    this.sessions.clear();

    return {
      provider: option.provider,
      currentModel: option.id,
    };
  }

  async configureProvider(
    apiKey: string,
    model?: string,
  ): Promise<ConfigureProviderResponse> {
    const trimmedKey = apiKey.trim();

    if (!trimmedKey) {
      throw new Error("API key is required.");
    }

    const provider = inferProviderFromApiKey(trimmedKey);
    const selectedModel = model?.trim()
      ? resolveModel(provider, model.trim())
      : getDefaultModel(provider);
    const option = getModelById(selectedModel);
    const nextConfig: UserProviderConfig = {
      provider: option?.provider ?? provider,
      apiKey: trimmedKey,
      model: selectedModel,
    };

    this.userConfig = nextConfig;
    await saveUserConfig(this.userConfig);

    const nextProvider = createProviderFromSources(process.env, this.userConfig);

    if (!nextProvider) {
      throw new Error(`Could not configure provider for ${provider}.`);
    }

    this._providerConfigured = true;
    this.harness = this.createHarness(nextProvider);
    this.sessions.clear();

    return {
      provider: nextConfig.provider,
      currentModel: selectedModel,
    };
  }

  async listProfiles(): Promise<ListProfilesResponse> {
    return this.profileService.listProfiles();
  }

  async getProfile(profileId: string): Promise<ProfileResponse> {
    return this.profileService.getProfile(profileId);
  }

  async createProfile(request: CreateProfileRequest): Promise<ProfileResponse> {
    return this.profileService.createProfile(request);
  }

  async updateProfile(
    profileId: string,
    request: UpdateProfileRequest,
  ): Promise<ProfileResponse> {
    return this.profileService.updateProfile(profileId, request);
  }

  async deleteProfile(profileId: string): Promise<void> {
    return this.profileService.deleteProfile(profileId);
  }

  async listTools(): Promise<ListToolsResponse> {
    return this.profileService.listTools();
  }

  async createTool(request: CreateToolRequest) {
    const tool = await this.profileService.createTool(request);
    return { tool };
  }

  async deleteTool(toolId: string): Promise<void> {
    return this.profileService.deleteTool(toolId);
  }

  async listProfileTools(profileId: string): Promise<ListToolsResponse> {
    return this.profileService.listProfileTools(profileId);
  }

  async assignTool(
    profileId: string,
    request: AssignToolRequest,
  ): Promise<ProfileResponse> {
    return this.profileService.assignTool(profileId, request);
  }

  async unassignTool(profileId: string, toolId: string): Promise<ProfileResponse> {
    return this.profileService.unassignTool(profileId, toolId);
  }

  async uploadProfileAvatar(
    profileId: string,
    attachment: ImageAttachment,
  ): Promise<ProfileResponse> {
    return this.profileService.uploadProfileAvatar(profileId, attachment);
  }

  async getProfileAvatar(
    profileId: string,
  ): Promise<{ mediaType: string; bytes: Buffer }> {
    return this.profileService.getProfileAvatar(profileId);
  }

  async deleteProfileAvatar(profileId: string): Promise<void> {
    return this.profileService.deleteProfileAvatar(profileId);
  }

  async getGlobalSoulStatus(includeContents = false): Promise<SoulStatusResponse> {
    const status = await this.soulService.getGlobalSoulStatus();

    if (!includeContents) {
      return status;
    }

    const stack = await this.soulService.getGlobalSoulStack();
    return { ...status, contents: stack.files };
  }

  async getProfileSoulStatus(
    profileId: string,
    includeContents = false,
  ): Promise<SoulStatusResponse> {
    await this.requireProfile(profileId);
    const status = await this.soulService.getProfileSoulStatus(profileId);

    if (!includeContents) {
      return { ...status, profileId };
    }

    const stack = await this.soulService.getProfileSoulStack(profileId);
    return { ...status, profileId, contents: stack.files };
  }

  async initGlobalSoul(): Promise<InitSoulResponse> {
    return this.soulService.initGlobalSoul();
  }

  async initProfileSoul(profileId: string): Promise<InitSoulResponse> {
    await this.requireProfile(profileId);
    const result = await this.soulService.initProfileSoul(profileId);
    return { ...result, profileId };
  }

  async getGlobalSoulStack(): Promise<SoulStackResponse> {
    return this.soulService.getGlobalSoulStack();
  }

  async getProfileSoulStack(profileId: string): Promise<SoulStackResponse> {
    await this.requireProfile(profileId);
    const stack = await this.soulService.getProfileSoulStack(profileId);
    return { ...stack, profileId };
  }

  async writeGlobalSoulFile(key: string, request: UpdateSoulFileRequest): Promise<void> {
    await this.soulService.writeGlobalSoulFile(key, request.content);
  }

  async writeProfileSoulFile(
    profileId: string,
    key: string,
    request: UpdateSoulFileRequest,
  ): Promise<void> {
    await this.requireProfile(profileId);
    await this.soulService.writeProfileSoulFile(profileId, key, request.content);
  }

  private createHarness(provider: ProviderClient | null): AgentHarness {
    return createAgentHarness({
      provider: provider ?? undefined,
    });
  }

  private async requireProfile(profileId: string): Promise<StoredProfileRecord> {
    const profile = await this.db.getProfile(profileId);

    if (!profile) {
      throw new Error("Profile not found.");
    }

    return profile;
  }

  private async resolveProfileTools(
    profile: StoredProfileRecord,
    options: { includeAutomationTools?: boolean } = {},
  ): Promise<ToolDefinition[]> {
    const storedTools = await this.db.listToolsForProfile(profile.id);
    const tools = await resolveToolsFromStorage(storedTools);
    const includeAutomationTools = options.includeAutomationTools ?? true;

    if (profile.isSuper) {
      return [...tools, ...this.superBotTools];
    }

    if (includeAutomationTools && this.automationTools.length > 0) {
      return [...tools, ...this.automationTools];
    }

    return tools;
  }

  private async buildChatSession(
    channel: AgentChannel,
    profileId: string,
    sessionId: string,
  ): Promise<AgentChatSession> {
    const profile = await this.requireProfile(profileId);
    const tools = await this.resolveProfileTools(profile);
    const soulStack = await this.soulService.resolveSoulStack(profileId);
    const systemPrompt = soulStack
      ? await this.soulService.resolveSystemPrompt(profileId, profile.systemPrompt)
      : profile.systemPrompt;
    const resolvedSystemPrompt = profile.isSuper
      ? `${systemPrompt.trim()}\n\n${SUPER_BOT_TOOL_AUTHORING_RULES}`
      : systemPrompt;
    const initialHistory = await loadSessionHistory(this.db, sessionId);
    const userTimezone = await this.getUserTimezone();
    const compaction = this.resolveCompactionConfig(profile);

    const session = this.harness.createChatSession({
      channel,
      tools,
      systemPrompt: resolvedSystemPrompt,
      enableToolLoop: true,
      soul: soulStack !== null,
      initialHistory,
      userTimezone,
      compaction,
      toolContext: {
        profileId,
        sessionId,
      },
    });

    return wrapPersistedSession(sessionId, session, this.db);
  }

  private resolveCompactionConfig(
    profile: StoredProfileRecord,
  ): CompactionConfig | undefined {
    if (!this.userConfig) {
      return undefined;
    }

    const provider = detectProvider(process.env, this.userConfig);

    if (!provider) {
      return undefined;
    }

    const modelId = resolveModel(provider, profile.model ?? this.userConfig.model);
    const model = getModelById(modelId);

    if (!model) {
      return undefined;
    }

    return {
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
    };
  }
}

function parseAgentChannel(value: string): AgentChannel | null {
  if (value === "cli" || value === "web" || value === "telegram" || value === "automation") {
    return value;
  }

  return null;
}

export { SUPER_BOT_PROFILE_ID, DEFAULT_PROFILE_ID };
