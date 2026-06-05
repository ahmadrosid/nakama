import {
  createAgentHarness,
  draftTaskPromptFromFields,
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
  InitUserContextResponse,
  ListProfilesResponse,
  ListToolsResponse,
  ListSessionsResponse,
  ModelsResponse,
  ProfileResponse,
  ToolResponse,
  ToolSourceResponse,
  ConfigureProviderRequest,
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
  UpdateUserContextRequest,
  UserContextStatusResponse,
  ThinkingSettings,
  ThinkingSettingsResponse,
  UpdateThinkingRequest,
  UserProviderConfig,
  ProviderChatOptions,
  ProviderClient,
} from "@tinyclaw/core";
import {
  isValidBaseUrl,
  normalizeBaseUrl,
  validateCustomModels,
  validateDisplayName,
} from "@tinyclaw/core";
import {
  buildThinkingProviderOptions,
  composeSoulSystemPrompt,
  createId,
  createSessionId,
  getProfileSoulDir,
  getResolvedSoulStatus,
  getUserContextStatus,
  apiKeyEnvVarForProvider,
  initSoulDirectory,
  initUserContext as initializeUserContext,
  isWritableSoulFileKey,
  loadSoulStack,
  loadTelegramSettingsPublic,
  loadUserContext,
  loadUserTimezone,
  readEnvValue,
  regenerateTelegramHandshake,
  resolveSoulStackForProfile,
  saveTelegramConfig,
  loadUserThinkingSettings,
  saveUserConfig,
  saveUserThinkingSettings,
  saveUserTimezone,
  writeSoulFile,
  writeUserContext as persistUserContext,
} from "@tinyclaw/core";
import {
  DEFAULT_PROFILE_ID,
  SUPER_BOT_TOOL_AUTHORING_RULES,
  type DatabaseAdapter,
  type StoredProfileRecord,
  type StoredTaskRunRecord,
} from "@tinyclaw/db";
import {
  createProviderFromSources,
  fetchRemoteOpenAIModels,
  getDefaultModel,
  getModelById,
  getModelsForConfiguredProvider,
  isCompatibleModelId,
  isCostEstimated,
  isOpenRouterModelSlug,
  resolveModel,
  resolveProvider,
} from "../providers";
import { createSuperBotTools } from "../tools/super-bot-tools";
import type { AutomationRunner } from "./automation-runner";
import {
  loadSessionHistory,
  replaceSessionHistory,
  wrapPersistedSession,
} from "./session-persistence";
import type { TaskRunner } from "./task-runner";
import { ProfileService } from "./profile-service";
import { SuperBotSessionState } from "./super-bot-session-state";
import { resolveToolsFromStorage } from "./tool-resolver";
import { wrapProviderWithUsageTracking } from "../providers/usage-tracking";
import type { LlmUsageTracker } from "./llm-usage-tracker";

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
  private readonly superBotSessionState = new SuperBotSessionState();
  private readonly superBotTools: ToolDefinition[];
  private automationTools: ToolDefinition[] = [];
  private automationRunner: AutomationRunner | null = null;
  private taskRunner: TaskRunner | null = null;
  private readonly sessions = new Map<string, StoredSession>();
  private _providerConfigured: boolean;

  constructor(
    userConfig: UserProviderConfig | null,
    provider: ProviderClient | null,
    db: DatabaseAdapter,
    private readonly llmUsageTracker?: LlmUsageTracker,
  ) {
    this.userConfig = userConfig;
    this.db = db;
    this.profileService = new ProfileService(db);
    this.superBotTools = createSuperBotTools(this.profileService, this.superBotSessionState);
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

  setTaskRunner(runner: TaskRunner): void {
    this.taskRunner = runner;
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

  async getThinkingSettings(): Promise<ThinkingSettingsResponse> {
    const thinking = await this.resolveThinkingSettings();
    return { thinking };
  }

  async setThinkingSettings(
    input: UpdateThinkingRequest,
  ): Promise<ThinkingSettingsResponse> {
    const effort = input.effort ?? (await this.resolveThinkingSettings()).effort;
    const thinking: ThinkingSettings = {
      enabled: input.enabled,
      effort,
    };

    await saveUserThinkingSettings(thinking);

    if (this.userConfig) {
      this.userConfig = {
        ...this.userConfig,
        thinkingEnabled: thinking.enabled,
        thinkingEffort: thinking.effort,
      };
    }

    this.harness = this.createHarness(
      createProviderFromSources(process.env, this.userConfig),
    );
    this.sessions.clear();

    return { thinking };
  }

  private async resolveThinkingSettings(): Promise<ThinkingSettings> {
    if (
      this.userConfig?.thinkingEnabled !== undefined ||
      this.userConfig?.thinkingEffort !== undefined
    ) {
      return {
        enabled: this.userConfig.thinkingEnabled ?? true,
        effort: this.userConfig.thinkingEffort ?? "medium",
      };
    }

    return loadUserThinkingSettings();
  }

  private resolveChatProviderOptions(
    overrides?: Partial<ProviderChatOptions>,
  ): ProviderChatOptions | undefined {
    const providerName = resolveProvider({ env: process.env, configuredProvider: this.userConfig?.provider });
    const thinking =
      providerName === "openai_compatible"
        ? undefined
        : buildThinkingProviderOptions(this.userConfig);
    const webSearch = overrides?.webSearch;
    const mergedThinking = overrides?.thinking ?? thinking;

    if (!webSearch && !mergedThinking) {
      return undefined;
    }

    return {
      ...(webSearch ? { webSearch } : {}),
      ...(mergedThinking ? { thinking: mergedThinking } : {}),
    };
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
    const { systemPrompt, soulActive } = await this.resolveProfileSystemPrompt(
      profileId,
      profile.systemPrompt,
    );
    const userTimezone = await this.getUserTimezone();
    const userContext = await loadUserContext();

    const session = this.harness.createChatSession({
      channel: "automation",
      tools,
      systemPrompt,
      userContext,
      enableToolLoop: true,
      soul: soulActive,
      userTimezone,
    });

    return session.send(prompt);
  }

  async runTaskPrompt(taskId: string, profileId: string, prompt: string): Promise<string> {
    if (!this._providerConfigured) {
      throw new Error("Provider is not configured.");
    }

    const sessionId = await this.ensureTaskSession(taskId, profileId);
    const session = await this.resolveSession(sessionId);

    if (!session) {
      throw new Error("Session not found.");
    }

    return session.send(prompt);
  }

  async ensureTaskSession(taskId: string, profileId: string): Promise<string> {
    const record = await this.db.getTask(taskId);

    if (!record) {
      throw new Error("Task not found.");
    }

    if (record.sessionId) {
      const existing = await this.db.getSession(record.sessionId);

      if (existing) {
        return record.sessionId;
      }
    }

    const sessionId = await this.createSession("task", profileId);

    await this.db.upsertTask({
      ...record,
      sessionId,
      updatedAt: new Date().toISOString(),
    });

    return sessionId;
  }

  async getTaskChatMessages(
    taskId: string,
  ): Promise<{ sessionId: string; messages: ChatMessage[] } | null> {
    const record = await this.db.getTask(taskId);

    if (!record) {
      return null;
    }

    let sessionId = record.sessionId;

    if (sessionId) {
      const existing = await this.db.getSession(sessionId);

      if (!existing) {
        sessionId = null;
      }
    }

    if (!sessionId) {
      sessionId = await this.ensureTaskSession(taskId, record.profileId);
    }

    let messages = await loadSessionHistory(this.db, sessionId);

    if (messages.length === 0) {
      const runs = await this.db.listTaskRuns(taskId, 1);
      const latestRun = runs[0];

      if (latestRun && latestRun.status !== "running") {
        await this.seedTaskSessionFromRun(record.prompt, latestRun, sessionId);
        messages = await loadSessionHistory(this.db, sessionId);
      }
    }

    return { sessionId, messages };
  }

  private async seedTaskSessionFromRun(
    prompt: string,
    run: StoredTaskRunRecord,
    sessionId: string,
  ): Promise<void> {
    const history: ChatMessage[] = [{ role: "user", content: prompt }];

    if (run.status === "failed") {
      history.push({
        role: "assistant",
        content: run.error ?? "Task run failed.",
      });
    } else if (run.output) {
      history.push({
        role: "assistant",
        content: run.output,
      });
    }

    await replaceSessionHistory(this.db, sessionId, history);
  }

  async runAutomation(automationId: string) {
    if (!this.automationRunner) {
      throw new Error("Automation runner is not configured.");
    }

    return this.automationRunner.run(automationId);
  }

  async runTask(taskId: string) {
    if (!this.taskRunner) {
      throw new Error("Task runner is not configured.");
    }

    return this.taskRunner.run(taskId);
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
    this.superBotSessionState.clearSession(sessionId);
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
    if (!this._providerConfigured) {
      throw new Error("Provider is not configured.");
    }

    return this.harness.createAutomationFromPrompt({ prompt, channel });
  }

  async draftTaskPrompt(title: string, description?: string): Promise<string> {
    const provider = createProviderFromSources(process.env, this.userConfig);

    return draftTaskPromptFromFields(
      { title, description },
      { provider: provider ?? undefined },
    );
  }

  async discoverModels(baseUrl: string, apiKey = ""): Promise<ModelsResponse> {
    const entries = await fetchRemoteOpenAIModels(baseUrl, apiKey);
    const models = getModelsForConfiguredProvider("openai_compatible", {
      provider: "openai_compatible",
      apiKey,
      baseUrl,
      customModels: entries,
    });

    return {
      provider: "openai_compatible",
      currentModel: null,
      defaultModel: entries[0]?.id ?? null,
      displayName: null,
      models,
    };
  }

  async getModels(options: { source?: "catalog" | "remote" } = {}): Promise<ModelsResponse> {
    const provider = resolveProvider({ env: process.env, configuredProvider: this.userConfig?.provider });
    const currentModel =
      provider && this.userConfig
        ? resolveModel(
            provider,
            this.userConfig.model,
            this.userConfig.customModels,
          )
        : null;
    const defaultModel = provider
      ? getDefaultModel(provider, this.userConfig?.customModels)
      : "gpt-5.4";
    const displayName =
      provider === "openai_compatible" ? (this.userConfig?.displayName ?? null) : null;
    const baseUrl =
      provider === "openai_compatible" ? (this.userConfig?.baseUrl ?? null) : null;
    const customModels =
      provider === "openai_compatible" || provider === "openrouter"
        ? (this.userConfig?.customModels ?? [])
        : undefined;

    let models = getModelsForConfiguredProvider(
      provider,
      this.userConfig,
      currentModel,
    );

    if (
      options.source === "remote" &&
      provider === "openai_compatible" &&
      this.userConfig?.baseUrl
    ) {
      const remote = fetchRemoteOpenAIModels(
        this.userConfig.baseUrl,
        this.userConfig.apiKey,
      );
      return {
        provider,
        currentModel,
        defaultModel,
        displayName,
        baseUrl,
        customModels: await remote,
        models: getModelsForConfiguredProvider(provider, {
          ...this.userConfig,
          customModels: await remote,
        }),
      };
    }

    return {
      provider,
      currentModel,
      defaultModel,
      displayName,
      baseUrl,
      customModels,
      models,
    };
  }

  getLlmUsageStats() {
    return (
      this.llmUsageTracker?.getStats() ?? {
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
        trackedSince: new Date().toISOString(),
      }
    );
  }

  async setModel(model: string): Promise<SetModelResponse> {
    if (!this.userConfig) {
      throw new Error("Provider is not configured.");
    }

    const trimmedModel = model.trim();
    const option = getModelById(trimmedModel);
    let targetProvider = option?.provider;
    let targetModel = option?.id;

    if (!option) {
      if (isOpenRouterModelSlug(trimmedModel)) {
        targetProvider = "openrouter";
        targetModel = trimmedModel;
      } else if (
        this.userConfig.provider === "openai_compatible" &&
        isCompatibleModelId(trimmedModel, this.userConfig.customModels)
      ) {
        targetProvider = "openai_compatible";
        targetModel = trimmedModel;
      } else {
        throw new Error(`Unknown model: ${model}`);
      }
    }

    const nextConfig = {
      ...this.userConfig,
      provider: targetProvider!,
      model: targetModel!,
    };

    const currentProvider = resolveProvider({ env: process.env, configuredProvider: this.userConfig?.provider });

    if (targetProvider !== currentProvider) {
      const apiKey = readEnvValue(process.env, apiKeyEnvVarForProvider(targetProvider!));

      if (!apiKey) {
        throw new Error(
          `Switching to ${targetProvider} requires ${apiKeyEnvVarForProvider(targetProvider!)}.`,
        );
      }

      nextConfig.apiKey = apiKey;
    }

    this.userConfig = nextConfig;
    await saveUserConfig(this.userConfig);

    const nextProvider = createProviderFromSources(process.env, this.userConfig);

    if (!nextProvider) {
      throw new Error(`Could not configure provider for ${targetProvider}.`);
    }

    this._providerConfigured = true;
    this.harness = this.createHarness(nextProvider);
    this.sessions.clear();

    return {
      provider: targetProvider!,
      currentModel: targetModel!,
    };
  }

  async configureProvider(
    request: ConfigureProviderRequest,
  ): Promise<ConfigureProviderResponse> {
    const provider = request.provider;
    const trimmedKey = request.apiKey.trim();
    const apiKey =
      trimmedKey ||
      (provider === "openai_compatible" || provider === "openrouter"
        ? (this.userConfig?.apiKey ?? "")
        : "");

    if (!apiKey && provider !== "openai_compatible") {
      throw new Error("API key is required.");
    }

    const providerFields: Pick<
      UserProviderConfig,
      "displayName" | "baseUrl" | "customModels"
    > =
      provider === "openai_compatible"
        ? this.buildCompatibleProviderFields(request)
        : provider === "openrouter"
          ? this.buildOpenRouterProviderFields(request)
          : this.buildNativeBaseUrlFields(request);

    const customModels =
      providerFields.customModels ??
      (provider === "openrouter" ? this.userConfig?.customModels : undefined);
    const selectedModel = request.model?.trim()
      ? resolveModel(provider, request.model.trim(), customModels)
      : getDefaultModel(provider, customModels);
    const option = getModelById(selectedModel);
    const thinking = await this.resolveThinkingSettings();
    const nextConfig: UserProviderConfig = {
      provider: option?.provider ?? provider,
      apiKey,
      model: selectedModel,
      ...providerFields,
      ...(this.userConfig?.timezone ? { timezone: this.userConfig.timezone } : {}),
      thinkingEnabled: thinking.enabled,
      thinkingEffort: thinking.effort,
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
    await this.ensureSoulScaffolded();

    return {
      provider: nextConfig.provider,
      currentModel: selectedModel,
      displayName:
        nextConfig.provider === "openai_compatible"
          ? (nextConfig.displayName ?? null)
          : null,
    };
  }

  private buildCompatibleProviderFields(
    request: ConfigureProviderRequest,
  ): Pick<UserProviderConfig, "displayName" | "baseUrl" | "customModels"> {
    const displayName = validateDisplayName(request.displayName ?? "");
    const baseUrl = normalizeBaseUrl(request.baseUrl ?? "");

    if (!isValidBaseUrl(baseUrl)) {
      throw new Error("A valid http(s) base URL is required.");
    }

    let customModels = request.customModels?.length
      ? validateCustomModels(request.customModels)
      : undefined;

    if (!customModels?.length && request.model?.trim()) {
      customModels = validateCustomModels([{ id: request.model.trim(), default: true }]);
    }

    if (!customModels?.length) {
      throw new Error("At least one model is required.");
    }

    return { displayName, baseUrl, customModels };
  }

  private buildOpenRouterProviderFields(
    request: ConfigureProviderRequest,
  ): Pick<UserProviderConfig, "customModels"> {
    if (!request.customModels?.length) {
      return {};
    }

    return { customModels: validateOpenRouterCustomModels(request.customModels) };
  }

  private buildNativeBaseUrlFields(
    request: ConfigureProviderRequest,
  ): Pick<UserProviderConfig, "baseUrl"> {
    const raw = request.baseUrl?.trim();
    if (!raw) {
      return {};
    }

    const normalized = normalizeBaseUrl(raw);
    if (!isValidBaseUrl(normalized)) {
      throw new Error("A valid http(s) base URL is required.");
    }

    return { baseUrl: normalized };
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

  async getTool(toolId: string): Promise<ToolResponse> {
    return this.profileService.getTool(toolId);
  }

  async getToolSource(toolId: string): Promise<ToolSourceResponse> {
    return this.profileService.getToolSource(toolId);
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

  async getProfileSoulStatus(
    profileId: string,
    includeContents = false,
  ): Promise<SoulStatusResponse> {
    await this.requireProfile(profileId);
    const status = await getResolvedSoulStatus(profileId);

    if (!includeContents) {
      return { ...status, profileId };
    }

    const stack = await loadSoulStack(getProfileSoulDir(profileId));
    return { ...status, profileId, contents: stack.files };
  }

  async ensureSoulScaffolded(): Promise<void> {
    const profiles = await this.db.listProfiles();

    for (const profile of profiles) {
      await initSoulDirectory(getProfileSoulDir(profile.id));
    }
  }

  async initProfileSoul(profileId: string): Promise<InitSoulResponse> {
    await this.requireProfile(profileId);
    const result = await initSoulDirectory(getProfileSoulDir(profileId));
    return { ...result, profileId };
  }

  async getProfileSoulStack(profileId: string): Promise<SoulStackResponse> {
    await this.requireProfile(profileId);
    const stack = await loadSoulStack(getProfileSoulDir(profileId));
    return { ...stack, profileId };
  }

  async writeProfileSoulFile(
    profileId: string,
    key: string,
    request: UpdateSoulFileRequest,
  ): Promise<void> {
    await this.requireProfile(profileId);

    if (!isWritableSoulFileKey(key)) {
      throw new Error(`Invalid soul file key: ${key}`);
    }

    await writeSoulFile(getProfileSoulDir(profileId), key, request.content);
  }

  async getUserContext(includeContent = false): Promise<UserContextStatusResponse> {
    const status = await getUserContextStatus();

    if (!includeContent) {
      const { content: _content, ...rest } = status;
      return rest;
    }

    return status;
  }

  async initUserContext(): Promise<InitUserContextResponse> {
    return initializeUserContext();
  }

  async writeUserContext(request: UpdateUserContextRequest): Promise<void> {
    await persistUserContext(request.content);
  }

  private createHarness(provider: ProviderClient | null): AgentHarness {
    const providerName = resolveProvider({ env: process.env, configuredProvider: this.userConfig?.provider });
    const modelId =
      provider && providerName && this.userConfig
        ? resolveModel(
            providerName,
            this.userConfig.model,
            this.userConfig.customModels,
          )
        : null;

    this.syncUsagePricingContext(providerName);

    const trackedProvider =
      provider && this.llmUsageTracker && modelId
        ? wrapProviderWithUsageTracking(provider, this.llmUsageTracker, modelId)
        : provider;

    return createAgentHarness({
      provider: trackedProvider ?? undefined,
      chatOptions: this.resolveChatProviderOptions(),
    });
  }

  private syncUsagePricingContext(
    provider: ReturnType<typeof resolveProvider>,
  ): void {
    this.llmUsageTracker?.setPricingContext({
      provider,
      userConfig: this.userConfig,
    });
  }

  getUsageStatusFields(): {
    displayName: string | null;
    costEstimated: boolean;
  } {
    const provider = resolveProvider({ env: process.env, configuredProvider: this.userConfig?.provider });
    const currentModel =
      provider && this.userConfig
        ? resolveModel(
            provider,
            this.userConfig.model,
            this.userConfig.customModels,
          )
        : null;

    return {
      displayName:
        provider === "openai_compatible" ? (this.userConfig?.displayName ?? null) : null,
      costEstimated: isCostEstimated(provider, currentModel, this.userConfig),
    };
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

    let resolved = [...tools];

    if (includeAutomationTools && this.automationTools.length > 0) {
      resolved = [...resolved, ...this.automationTools];
    }

    if (profile.isSuper) {
      resolved = [...resolved, ...this.superBotTools];
    }

    return resolved;
  }

  private async buildChatSession(
    channel: AgentChannel,
    profileId: string,
    sessionId: string,
  ): Promise<AgentChatSession> {
    const profile = await this.requireProfile(profileId);
    const tools = await this.resolveProfileTools(profile);
    const { systemPrompt, soulActive } = await this.resolveProfileSystemPrompt(
      profileId,
      profile.systemPrompt,
    );
    const resolvedSystemPrompt = profile.isSuper
      ? `${systemPrompt.trim()}\n\n${SUPER_BOT_TOOL_AUTHORING_RULES}`
      : systemPrompt;
    const initialHistory = await loadSessionHistory(this.db, sessionId);
    const userTimezone = await this.getUserTimezone();
    const userContext = await loadUserContext();
    const compaction = this.resolveCompactionConfig(profile);

    const session = this.harness.createChatSession({
      channel,
      tools,
      systemPrompt: resolvedSystemPrompt,
      userContext,
      enableToolLoop: true,
      soul: soulActive,
      initialHistory,
      userTimezone,
      compaction,
      toolContext: {
        profileId,
        sessionId,
      },
    });

    return wrapPersistedSession(sessionId, session, this.db, {
      onBeginTurn: (id) => this.superBotSessionState.beginTurn(id),
    });
  }

  private async resolveProfileSystemPrompt(
    profileId: string,
    profilePrompt: string,
  ): Promise<{ systemPrompt: string; soulActive: boolean }> {
    const stack = await resolveSoulStackForProfile(profileId);

    if (!stack) {
      return { systemPrompt: profilePrompt, soulActive: false };
    }

    return {
      systemPrompt: composeSoulSystemPrompt(stack, { profilePrompt }),
      soulActive: true,
    };
  }

  private resolveCompactionConfig(
    profile: StoredProfileRecord,
  ): CompactionConfig | undefined {
    if (!this.userConfig) {
      return undefined;
    }

    const provider = resolveProvider({ env: process.env, configuredProvider: this.userConfig?.provider });

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


