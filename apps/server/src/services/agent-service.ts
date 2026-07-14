import {
  createAgentHarness,
  draftTaskPromptFromFields,
  executeToolCall,
  suggestToolParamsFromPrompt,
  type AgentChatSession,
  type AgentHarness,
  type CompactionConfig,
} from "@nakama/agent";
import type {
  AgentChannel,
  AgentQuestionnaire,
  AgentTodo,
  AssignSkillRequest,
  AssignToolRequest,
  BranchSessionResponse,
  ChatMessage,
  CompactionResponse,
  CreateProfileRequest,
  DeleteArtifactResponse,
  CreateSkillRequest,
  CreateToolRequest,
  InitSoulResponse,
  InitUserContextResponse,
  ListArtifactsResponse,
  ListProfilesResponse,
  ListSkillsResponse,
  ListToolsResponse,
  ListSessionsResponse,
  ModelsResponse,
  ProfileResponse,
  ToolResponse,
  ToolSourceResponse,
  RunToolResponse,
  SuggestToolParamsResponse,
  ConfigureProviderRequest,
  ConfigureProviderResponse,
  CreateProviderRequest,
  CreateProviderResponse,
  DeleteKnowledgeBaseResponse,
  DeleteProviderResponse,
  DiscoverModelsRequest,
  DocumentAttachment,
  ImageAttachment,
  ListKnowledgeBaseResponse,
  ListProvidersResponse,
  UpdateProviderRequest,
  UpdateProviderResponse,
  SkillResponse,
  SoulStackResponse,
  SyncSkillsResponse,
  SoulStatusResponse,
  CodingHarnessSettingsResponse,
  CodingAgentLaunchPlanResponse,
  PrepareCodingAgentLaunchRequest,
  TelegramSettingsResponse,
  DiscordSettingsResponse,
  ComposioSettingsResponse,
  EmailSettingsResponse,
  SendEmailTestRequest,
  SendEmailTestResponse,
  UpdateCodingHarnessSettingsRequest,
  VerifyCodingHarnessResponse,
  ToolDefinition,
  UpdateProfileRequest,
  UpdateSoulFileRequest,
  UpdateTelegramSettingsRequest,
  UpdateDiscordSettingsRequest,
  UpdateComposioSettingsRequest,
  UpdateEmailSettingsRequest,
  UpdateWhatsAppSettingsRequest,
  UpdateUserContextRequest,
  UserContextStatusResponse,
  WhatsAppSettingsResponse,
  ThinkingSettings,
  ThinkingSettingsResponse,
  UpdateThinkingRequest,
  UpdateVisionRequest,
  VisionSettings,
  VisionSettingsResponse,
  UpdateTranscriptionRequest,
  TranscriptionSettings,
  TranscriptionSettingsResponse,
  TranscribeAudioRequest,
  TranscribeAudioResponse,
  UploadKnowledgeBaseRequest,
  UploadKnowledgeBaseResponse,
  ProviderChatOptions,
  ProviderClient,
  UserConfig,
} from "@nakama/core";
import {
  DEFAULT_THINKING_EFFORT,
  DEFAULT_THINKING_ENABLED,
  buildThinkingProviderOptions,
  listArtifacts,
  buildToolExecutionContext,
  composeKnowledgeBaseCatalog,
  composeSoulSystemPrompt,
  createId,
  nanoid,
  extractImageParts,
  findProviderInstance,
  getActiveProviderInstance,
  getProfileSoulDir,
  deleteArtifactFile,
  readArtifactFile,
  getResolvedSoulStatus,
  buildUserContextStatus,
  normalizeUserContextContent,
  USER_CONTEXT_TEMPLATE,
  initSoulDirectory,
  isProviderConfigured,
  isWritableSoulFileKey,
  loadSoulStack,
  loadTelegramSettingsPublic,
  loadDiscordSettingsPublic,
  loadComposioSettingsPublic,
  loadEmailSettingsPublic,
  loadEmailConfig,
  isEmailConfigComplete,
  emailConfigToMailboxConfig,
  saveEmailConfig,
  loadWhatsAppSettingsPublic,
  loadUserTimezone,
  loadUserVisionSettings,
  loadUserTranscriptionSettings,
  messageContentHasImages,
  persistInlineAttachmentsInContent,
  readBundledSkillBody,
  rehydrateAttachmentRefsInContent,
  rehydrateMessagesForProvider as rehydrateAttachmentMessages,
  regenerateTelegramHandshake,
  regenerateDiscordHandshake,
  regenerateWhatsAppPairingCode,
  replaceImagePartsWithDescriptions,
  resolveSoulStackForProfile,
  saveTelegramConfig,
  saveDiscordConfig,
  saveComposioConfig,
  saveWhatsAppConfig,
  createSmtpSender,
  loadUserThinkingSettings,
  saveUserConfig,
  saveUserThinkingSettings,
  saveUserTimezone,
  NakamaApiError,
  writeSoulFile,
  type OrgRole,
} from "@nakama/core";
import { canAccessSuperBotProfile } from "@nakama/core/profiles";
import {
  SUPER_BOT_TOOL_AUTHORING_RULES,
  WORKSPACE_SETTINGS_ID,
  type DatabaseAdapter,
  type StoredProfileRecord,
  type StoredTaskRunRecord,
} from "@nakama/db";
import {
  createProviderForInstance,
  createProviderFromActiveConfig,
  createProviderFromSources,
  fetchRemoteOpenAIModels,
  AVAILABLE_MODELS,
  catalogCustomModelsToCatalog,
  getModelById,
  getModelsForProviderInstance,
  isCostEstimated,
  resolveModel,
} from "../providers";
import { wrapProviderForNonVision } from "../providers/non-vision-wrap";
import {
  applyProviderInstanceUpdate,
  buildProviderInstanceFromCreateRequest,
  countModelsForInstance,
  mergeModelsForConfig,
  resolveProfileProviderSelection,
  resolveDefaultModelForInstance,
  resolveInitialModel,
  toProviderInstanceSummary,
} from "./provider-instance-helpers";
import { createSuperBotTools } from "../tools/super-bot-tools";
import { createAskUserQuestionTools } from "../tools/ask-user-question-tool";
import { createTodoTools } from "../tools/todo-tools";
import { SUB_AGENT_TOOL_NAME } from "../tools/sub-agent-tool";
import {
  buildSubAgentPrompt,
  buildSubAgentResult,
  DEFAULT_SUB_AGENT_TIMEOUT_MS,
  failSubAgentResult,
  MAX_SUB_AGENT_TIMEOUT_MS,
  type SubAgentRunInput,
  type SubAgentRunResult,
} from "../tools/sub-agent-shared";
import { AgentQuestionnaireState } from "./agent-questionnaire-state";
import {
  getCodingHarnessInstallCommand,
  getCodingHarnessInstallHint,
  listCodingAgentHarnessStatuses,
  loadCodingAgentWorkspaceSettings,
  resolveCodingAgentHarness,
  saveCodingAgentWorkspaceSettings,
  verifyCodingAgentHarness,
} from "./coding-agent-harness-service";
import {
  buildCodingAgentCommandTemplate,
  formatCodingAgentCommandContext,
  getBackendSkillName,
} from "./coding-agent-command";
import { prepareCodingAgentLaunch as buildCodingAgentLaunchPlan } from "./coding-agent-launcher";
import {
  getInferenceGatewayBaseUrl,
  normalizeCodingAgentModel,
} from "./coding-agent-spawn-env";
import { loadLocalAuthToken } from "@nakama/core/local-auth";
import { AgentTodoState } from "./agent-todo-state";
import type { AutomationRunner } from "./automation-runner";
import {
  loadSessionHistory,
  replaceSessionHistory,
  wrapPersistedSession,
} from "./session-persistence";
import type { TaskRunner } from "./task-runner";
import { buildMcpToolDefinitions } from "./mcp-tool-bridge";
import {
  buildComposioConnectTools,
  buildComposioToolDefinitions,
} from "./composio-tool-bridge";
import type { ComposioService } from "./composio-service";
import type { McpClientManager } from "./mcp-client-manager";
import type { McpService } from "./mcp-service";
import { ProfileService } from "./profile-service";
import type { SkillsService } from "./skills-service";
import { SessionTitleService } from "./session-title-service";
import { SuperBotSessionState } from "./super-bot-session-state";
import { resolveProfileStoredTools } from "./tool-resolver";
import {
  invalidateJavascriptModuleCache,
  loadJavascriptTool,
  resolveJavascriptModulePath,
} from "./javascript-tool-loader";
import { wrapProviderWithUsageTracking } from "../providers/usage-tracking";
import type { LlmUsageTracker } from "./llm-usage-tracker";
import {
  createVisionFallbackProvider,
  describeImagesWithVisionModel,
  resolvePrimaryModelVisionSupport,
  resolveVisionProviderSelection,
  VISION_MODEL_REQUIRED_MESSAGE,
} from "./image-vision-fallback";
import {
  resolveTranscriptionProviderSelection,
  transcribeAudioWithOpenAI,
  TRANSCRIPTION_MODEL_REQUIRED_MESSAGE,
} from "./audio-transcription";
import {
  createAttachmentLoader,
  createAttachmentSaver,
} from "./attachment-service";

interface StoredSession {
  channel: AgentChannel;
  profileId: string;
  session: AgentChatSession;
}

export type { SubAgentRunInput, SubAgentRunResult };

export interface SessionAccessOptions {
  orgRole?: OrgRole | null;
  isPlatformAdmin?: boolean;
  excludeSuperBot?: boolean;
}

export class AgentService {
  private harness: AgentHarness;
  private userConfig: UserConfig | null;
  private readonly db: DatabaseAdapter;
  private readonly profileService: ProfileService;
  private readonly superBotSessionState = new SuperBotSessionState();
  private readonly agentTodoState: AgentTodoState;
  private readonly agentQuestionnaireState: AgentQuestionnaireState;
  private readonly superBotTools: ToolDefinition[];
  private automationTools: ToolDefinition[] = [];
  private automationRunHistoryTools: ToolDefinition[] = [];
  private questionTools: ToolDefinition[] = [];
  private todoTools: ToolDefinition[] = [];
  private automationRunner: AutomationRunner | null = null;
  private taskRunner: TaskRunner | null = null;
  private mcpClientManager: McpClientManager | null = null;
  private mcpService: McpService | null = null;
  private composioService: ComposioService | null = null;
  private skillsService: SkillsService | null = null;
  private readonly sessions = new Map<string, StoredSession>();
  private readonly sessionTitleService: SessionTitleService;
  private _providerConfigured: boolean;
  private visionSettingsPromise: Promise<void> | null = null;
  private transcriptionSettingsPromise: Promise<void> | null = null;

  constructor(
    userConfig: UserConfig | null,
    provider: ProviderClient | null,
    db: DatabaseAdapter,
    private readonly llmUsageTracker?: LlmUsageTracker,
  ) {
    this.userConfig = userConfig;
    this.db = db;
    this.profileService = new ProfileService(db);
    this.sessionTitleService = new SessionTitleService(db, () => this.userConfig);
    this.agentTodoState = new AgentTodoState(db);
    this.agentQuestionnaireState = new AgentQuestionnaireState(db);
    this.questionTools = createAskUserQuestionTools(this.agentQuestionnaireState);
    this.todoTools = createTodoTools(this.agentTodoState);
    this.superBotTools = createSuperBotTools(this.profileService, this.superBotSessionState);
    this._providerConfigured = isProviderConfigured(userConfig) && provider !== null;
    const activeInstance = getActiveProviderInstance(userConfig);
    this.harness = this.createHarness({
      provider,
      providerInstance: activeInstance,
      modelId: activeInstance ? resolveDefaultModelForInstance(activeInstance) : null,
      thinking: this.resolveWorkspaceThinkingDefaults(),
    });
  }

  get profiles(): ProfileService {
    return this.profileService;
  }

  setAutomationTools(tools: ToolDefinition[]): void {
    this.automationTools = tools;
    this.sessions.clear();
  }

  setAutomationRunHistoryTools(tools: ToolDefinition[]): void {
    this.automationRunHistoryTools = tools;
  }

  setAutomationRunner(runner: AutomationRunner): void {
    this.automationRunner = runner;
  }

  setTaskRunner(runner: TaskRunner): void {
    this.taskRunner = runner;
  }

  setMcpClientManager(manager: McpClientManager): void {
    this.mcpClientManager = manager;
    this.sessions.clear();
  }

  setMcpService(service: McpService): void {
    this.mcpService = service;
  }

  setComposioService(service: ComposioService): void {
    this.composioService = service;
  }

  setSkillsService(service: SkillsService): void {
    this.skillsService = service;
    this.sessions.clear();
  }

  getMcpService(): McpService {
    if (!this.mcpService) {
      throw new Error("MCP service is not configured.");
    }

    return this.mcpService;
  }

  async getUserTimezone(): Promise<string> {
    return this.userConfig?.timezone ?? loadUserTimezone();
  }

  getUserConfig(): UserConfig | null {
    return this.userConfig;
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
      {
        provider: createProviderFromSources(process.env, this.userConfig),
        providerInstance: getActiveProviderInstance(this.userConfig),
        modelId: (() => {
          const active = getActiveProviderInstance(this.userConfig);
          return active ? resolveDefaultModelForInstance(active) : null;
        })(),
        thinking: this.resolveWorkspaceThinkingDefaults(),
      },
    );
    this.sessions.clear();

    return { thinking };
  }

  async getVisionSettings(): Promise<VisionSettingsResponse> {
    await this.ensureVisionSettingsLoaded();
    const vision = await this.resolveVisionSettings();
    return { vision };
  }

  async setVisionSettings(input: UpdateVisionRequest): Promise<VisionSettingsResponse> {
    await this.ensureVisionSettingsLoaded();
    const model = input.model?.trim() || null;

    if (model) {
      const resolved = resolveVisionProviderSelection({
        ...this.userConfig,
        visionModel: model,
        providers: this.userConfig?.providers ?? [],
        defaultProviderId: this.userConfig?.defaultProviderId ?? null,
      });

      if (!resolved) {
        throw new NakamaApiError(
          "Selected image parsing model is unavailable. Choose a vision-capable model.",
          400,
        );
      }
    }

    const vision: VisionSettings = { model };
    const existing = await this.db.getWorkspaceSettings();
    await this.db.upsertWorkspaceSettings({
      id: WORKSPACE_SETTINGS_ID,
      visionModel: model,
      transcriptionModel: existing?.transcriptionModel ?? this.userConfig?.transcriptionModel ?? null,
      codingAgentHarnesses: existing?.codingAgentHarnesses ?? [],
      selectedCodingAgentHarness: existing?.selectedCodingAgentHarness ?? null,
      updatedAt: new Date().toISOString(),
    });

    if (this.userConfig) {
      this.userConfig = {
        ...this.userConfig,
        visionModel: model,
      };
    }

    this.sessions.clear();

    return { vision };
  }

  async getTranscriptionSettings(): Promise<TranscriptionSettingsResponse> {
    await this.ensureTranscriptionSettingsLoaded();
    const transcription = await this.resolveTranscriptionSettings();
    return { transcription };
  }

  async setTranscriptionSettings(
    input: UpdateTranscriptionRequest,
  ): Promise<TranscriptionSettingsResponse> {
    await this.ensureTranscriptionSettingsLoaded();
    const model = input.model?.trim() || null;

    if (model) {
      const resolved = resolveTranscriptionProviderSelection({
        ...this.userConfig,
        transcriptionModel: model,
        providers: this.userConfig?.providers ?? [],
        defaultProviderId: this.userConfig?.defaultProviderId ?? null,
      });

      if (!resolved) {
        throw new NakamaApiError(
          "Selected audio transcription model is unavailable. Choose an OpenAI Whisper model.",
          400,
        );
      }
    }

    const transcription: TranscriptionSettings = { model };
    const existing = await this.db.getWorkspaceSettings();
    await this.db.upsertWorkspaceSettings({
      id: WORKSPACE_SETTINGS_ID,
      visionModel: existing?.visionModel ?? this.userConfig?.visionModel ?? null,
      transcriptionModel: model,
      codingAgentHarnesses: existing?.codingAgentHarnesses ?? [],
      selectedCodingAgentHarness: existing?.selectedCodingAgentHarness ?? null,
      updatedAt: new Date().toISOString(),
    });

    if (this.userConfig) {
      this.userConfig = {
        ...this.userConfig,
        transcriptionModel: model,
      };
    }

    return { transcription };
  }

  async transcribeAudio(input: TranscribeAudioRequest): Promise<TranscribeAudioResponse> {
    await this.ensureTranscriptionSettingsLoaded();

    const data = input.data?.trim();
    const mediaType = input.mediaType?.trim();

    if (!data || !mediaType) {
      throw new NakamaApiError("Audio data and media type are required.", 400);
    }

    let bytes: Buffer;

    try {
      bytes = Buffer.from(data, "base64");
    } catch {
      throw new NakamaApiError("Audio data must be valid base64.", 400);
    }

    if (bytes.length === 0) {
      throw new NakamaApiError("Audio data is empty.", 400);
    }

    const selection = resolveTranscriptionProviderSelection(this.userConfig);

    if (!selection) {
      throw new NakamaApiError(TRANSCRIPTION_MODEL_REQUIRED_MESSAGE, 400);
    }

    const text = await transcribeAudioWithOpenAI(
      selection.instance.apiKey,
      selection.instance.baseUrl,
      selection.model,
      {
        bytes,
        filename: input.filename?.trim() || "audio.ogg",
        mediaType,
      },
    );

    return { text };
  }

  async ensureTranscriptionSettingsLoaded(): Promise<void> {
    if (!this.transcriptionSettingsPromise) {
      this.transcriptionSettingsPromise = this.loadTranscriptionSettingsFromDatabase();
    }

    await this.transcriptionSettingsPromise;
  }

  private async loadTranscriptionSettingsFromDatabase(): Promise<void> {
    const stored = await this.db.getWorkspaceSettings();

    if (stored) {
      if (this.userConfig) {
        this.userConfig = {
          ...this.userConfig,
          transcriptionModel: stored.transcriptionModel,
        };
      }
      return;
    }

    const legacyModel =
      this.userConfig?.transcriptionModel ??
      (await loadUserTranscriptionSettings()).model ??
      null;

    await this.db.upsertWorkspaceSettings({
      id: WORKSPACE_SETTINGS_ID,
      visionModel: this.userConfig?.visionModel ?? null,
      transcriptionModel: legacyModel,
      codingAgentHarnesses: stored?.codingAgentHarnesses ?? [],
      selectedCodingAgentHarness: stored?.selectedCodingAgentHarness ?? null,
      updatedAt: new Date().toISOString(),
    });

    if (this.userConfig) {
      this.userConfig = { ...this.userConfig, transcriptionModel: legacyModel };
    }
  }

  private async resolveTranscriptionSettings(): Promise<TranscriptionSettings> {
    return { model: this.userConfig?.transcriptionModel ?? null };
  }

  async ensureVisionSettingsLoaded(): Promise<void> {
    if (!this.visionSettingsPromise) {
      this.visionSettingsPromise = this.loadVisionSettingsFromDatabase();
    }

    await this.visionSettingsPromise;
  }

  private async loadVisionSettingsFromDatabase(): Promise<void> {
    const stored = await this.db.getWorkspaceSettings();

    if (stored) {
      if (this.userConfig) {
        this.userConfig = {
          ...this.userConfig,
          visionModel: stored.visionModel,
          transcriptionModel: stored.transcriptionModel,
        };
      }
      return;
    }

    const legacyVisionModel =
      this.userConfig?.visionModel ?? (await loadUserVisionSettings()).model ?? null;
    const legacyTranscriptionModel =
      this.userConfig?.transcriptionModel ??
      (await loadUserTranscriptionSettings()).model ??
      null;

    await this.db.upsertWorkspaceSettings({
      id: WORKSPACE_SETTINGS_ID,
      visionModel: legacyVisionModel,
      transcriptionModel: legacyTranscriptionModel,
      codingAgentHarnesses: stored?.codingAgentHarnesses ?? [],
      selectedCodingAgentHarness: stored?.selectedCodingAgentHarness ?? null,
      updatedAt: new Date().toISOString(),
    });

    if (this.userConfig) {
      this.userConfig = {
        ...this.userConfig,
        visionModel: legacyVisionModel,
        transcriptionModel: legacyTranscriptionModel,
      };
    }
  }

  private async resolveVisionSettings(): Promise<VisionSettings> {
    return { model: this.userConfig?.visionModel ?? null };
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
    providerInstance: ReturnType<typeof getActiveProviderInstance>,
    thinkingSettings: ThinkingSettings,
    overrides?: Partial<ProviderChatOptions>,
  ): ProviderChatOptions | undefined {
    const thinking = buildThinkingProviderOptions({
      thinkingEnabled: thinkingSettings.enabled,
      thinkingEffort: thinkingSettings.effort,
    });
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

  async getDiscordSettings(): Promise<DiscordSettingsResponse> {
    return loadDiscordSettingsPublic();
  }

  async setDiscordSettings(
    input: UpdateDiscordSettingsRequest,
  ): Promise<DiscordSettingsResponse> {
    const existing = await loadDiscordSettingsPublic();
    const botToken =
      input.botToken !== undefined && input.botToken.trim()
        ? input.botToken.trim()
        : undefined;

    if (!botToken && !existing.configured) {
      throw new Error("Bot token is required.");
    }

    return saveDiscordConfig({
      ...(botToken ? { botToken } : {}),
      ...(input.allowedUserIds !== undefined
        ? { allowedUserIds: input.allowedUserIds }
        : existing.allowedUserIds.length > 0
          ? { allowedUserIds: existing.allowedUserIds.join(",") }
          : {}),
      ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
    });
  }

  async regenerateDiscordHandshake(): Promise<DiscordSettingsResponse> {
    return regenerateDiscordHandshake();
  }

  async getComposioSettings(): Promise<ComposioSettingsResponse> {
    const settings = await loadComposioSettingsPublic();
    return {
      ...settings,
      composioReachable: settings.configured
        ? await (this.composioService?.isReachable() ?? false)
        : false,
    };
  }

  async setComposioSettings(
    input: UpdateComposioSettingsRequest,
  ): Promise<ComposioSettingsResponse> {
    const existing = await loadComposioSettingsPublic();
    const apiKey =
      input.apiKey !== undefined && input.apiKey.trim()
        ? input.apiKey.trim()
        : undefined;

    if (!apiKey && !existing.configured) {
      throw new Error("Composio API key is required.");
    }

    if (apiKey) {
      await this.composioService?.validateConfiguration(apiKey);
      await saveComposioConfig({ apiKey });
      this.composioService?.reloadConfiguration();
    }

    return this.getComposioSettings();
  }

  async getEmailSettings(): Promise<EmailSettingsResponse> {
    return loadEmailSettingsPublic();
  }

  async setEmailSettings(input: UpdateEmailSettingsRequest): Promise<EmailSettingsResponse> {
    return saveEmailConfig(input);
  }

  async sendEmailTest(recipient: string): Promise<SendEmailTestResponse> {
    const config = await loadEmailConfig();

    if (!isEmailConfigComplete(config)) {
      throw new Error("Complete email settings before sending a test message.");
    }

    const to = recipient.trim();

    if (!to) {
      throw new Error("Recipient email is required.");
    }

    const sender = createSmtpSender(emailConfigToMailboxConfig(config!));
    const result = await sender.send({
      to,
      subject: "Nakama test email",
      text: "This is a test email from your Nakama deployment.",
    });

    return {
      ok: true,
      to,
      messageId: result.messageId,
    };
  }

  async getCodingHarnessSettings(): Promise<CodingHarnessSettingsResponse> {
    const settings = await loadCodingAgentWorkspaceSettings(this.db);
    const statuses = await listCodingAgentHarnessStatuses(this.db);
    const activeHarness =
      statuses.find(
        (harness) =>
          harness.id === settings.selectedHarnessId &&
          harness.enabled &&
          harness.installed &&
          harness.ready,
      ) ??
      statuses.find((harness) => harness.enabled && harness.installed && harness.ready) ??
      null;

    return {
      configured: activeHarness !== null,
      selectedHarnessId: settings.selectedHarnessId,
      activeHarnessId: activeHarness?.id ?? null,
      harnesses: statuses.map((harness) => ({
        id: harness.id,
        kind: harness.kind,
        name: harness.name,
        command: harness.command,
        enabled: harness.enabled,
        installed: harness.installed,
        version: harness.version,
        authenticated: harness.authenticated,
        ready: harness.ready,
        nextStep: harness.nextStep,
        statusMessage: harness.statusMessage,
        selected: harness.id === settings.selectedHarnessId,
        installHint: getCodingHarnessInstallHint(harness.kind),
        installCommand: getCodingHarnessInstallCommand(harness.kind),
      })),
    };
  }

  async setCodingHarnessSettings(
    input: UpdateCodingHarnessSettingsRequest,
  ): Promise<CodingHarnessSettingsResponse> {
    await saveCodingAgentWorkspaceSettings(this.db, input);
    return this.getCodingHarnessSettings();
  }

  async verifyCodingHarness(harnessId?: string): Promise<VerifyCodingHarnessResponse> {
    return verifyCodingAgentHarness(this.db, harnessId);
  }

  async prepareCodingAgentLaunch(
    orgId: string,
    input: PrepareCodingAgentLaunchRequest,
    options: {
      persistSelection?: boolean;
      orgRole?: OrgRole | null;
      isPlatformAdmin?: boolean;
      localCli?: boolean;
    } = {},
  ): Promise<CodingAgentLaunchPlanResponse> {
    return buildCodingAgentLaunchPlan(
      this.db,
      {
        orgId,
        profileId: input.profileId,
        backend: input.backend,
        model: input.model,
        cwd: input.cwd,
        passthroughArgs: input.passthroughArgs,
        persistSelection: options.persistSelection === true,
      },
      {
        orgRole: options.orgRole,
        isPlatformAdmin: options.isPlatformAdmin,
        localCli: options.localCli,
      },
    );
  }

  async getWhatsAppSettings(): Promise<WhatsAppSettingsResponse> {
    return loadWhatsAppSettingsPublic();
  }

  async setWhatsAppSettings(
    input: UpdateWhatsAppSettingsRequest,
  ): Promise<WhatsAppSettingsResponse> {
    return saveWhatsAppConfig({
      ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber.trim() } : {}),
      ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
    });
  }

  async regenerateWhatsAppPairingCode(): Promise<WhatsAppSettingsResponse> {
    return regenerateWhatsAppPairingCode();
  }

  async runAutomationPrompt(
    orgId: string,
    profileId: string,
    prompt: string,
    automationId?: string,
    automationRunId?: string,
  ): Promise<string> {
    if (!this._providerConfigured) {
      throw new Error("Provider is not configured.");
    }

    const profile = await this.requireProfile(orgId, profileId);
    const tools = [
      ...(await this.resolveProfileTools(profile, {
        includeAutomationTools: false,
        includeTodoTools: false,
      })),
      ...this.automationRunHistoryTools,
    ];
    const { systemPrompt, soulActive } = await this.resolveProfileSystemPrompt(
      orgId,
      profileId,
      profile.systemPrompt,
    );
    const userTimezone = await this.getUserTimezone();
    const userContext = await this.loadUserContextForUser(orgId, undefined);
    const harness = this.createHarnessForProfile(profile);

    const session = harness.createChatSession({
      channel: "automation",
      tools,
      systemPrompt,
      userContext,
      enableToolLoop: true,
      soul: soulActive,
      userTimezone,
      toolContext: buildToolExecutionContext({
        automationId,
        automationRunId,
        orgId,
        profileId,
      }),
    });

    return session.send(prompt);
  }

  async runSubAgentPrompt(input: SubAgentRunInput): Promise<SubAgentRunResult> {
    const startedAt = Date.now();

    if (!this._providerConfigured) {
      return failSubAgentResult("Provider is not configured.");
    }

    const task = input.task.trim();

    if (!task) {
      return failSubAgentResult("task is required.");
    }

    const timeoutMs = clampSubAgentTimeout(input.timeoutMs);
    const profile = await this.requireProfile(input.orgId, input.profileId);
    const tools = await this.resolveProfileTools(profile, {
      includeAutomationTools: false,
      includeTodoTools: false,
      includeQuestionTools: false,
      includeSubAgentTool: false,
      userId: input.userId,
    });
    const { systemPrompt, soulActive } = await this.resolveProfileSystemPrompt(
      input.orgId,
      input.profileId,
      profile.systemPrompt,
    );
    const childSystemPrompt = [
      systemPrompt.trim(),
      "",
      "You are running as a focused sub-agent delegated from a parent conversation.",
      "Complete the assigned task and return a clear final answer.",
      "Do not spawn sub-agents.",
    ].join("\n");
    const userTimezone = await this.getUserTimezone();
    const userContext = await this.loadUserContextForUser(input.orgId, input.userId);
    const harness = this.createHarnessForProfile(profile);
    const prompt = buildSubAgentPrompt(task, input.context);

    const session = harness.createChatSession({
      channel: "subagent",
      tools,
      systemPrompt: childSystemPrompt,
      userContext,
      enableToolLoop: true,
      soul: soulActive,
      userTimezone,
      toolContext: buildToolExecutionContext({
        orgId: input.orgId,
        profileId: input.profileId,
        userId: input.userId,
        clientOrigin: input.clientOrigin,
        agentDepth: input.agentDepth,
      }),
    });

    const sendPromise = session.send(prompt).then((reply) => ({
      kind: "success" as const,
      reply: reply.trim(),
    }));

    const timeoutPromise = new Promise<{ kind: "timeout" }>((resolve) => {
      setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    });

    const outcome = await Promise.race([sendPromise, timeoutPromise]);
    const durationMs = Date.now() - startedAt;

    if (outcome.kind === "timeout") {
      console.info(
        `[sub_agent] timeout org=${input.orgId} profile=${input.profileId} durationMs=${durationMs}`,
      );
      return buildSubAgentResult("timeout", "", "Sub-agent timed out.");
    }

    if (!outcome.reply) {
      console.info(
        `[sub_agent] fail org=${input.orgId} profile=${input.profileId} durationMs=${durationMs} reason=empty_reply`,
      );
      return buildSubAgentResult("fail", "", "Sub-agent returned no final reply.");
    }

    console.info(
      `[sub_agent] success org=${input.orgId} profile=${input.profileId} durationMs=${durationMs}`,
    );
    return buildSubAgentResult("success", outcome.reply);
  }

  async runTaskPrompt(taskId: string, profileId: string, prompt: string): Promise<string> {
    if (!this._providerConfigured) {
      throw new Error("Provider is not configured.");
    }

    const task = await this.db.getTask(taskId);

    if (!task?.orgId) {
      throw new Error("Task not found.");
    }

    const sessionId = await this.ensureTaskSession(taskId, profileId, task.orgId);
    const session = await this.resolveSession(sessionId);

    if (!session) {
      throw new Error("Session not found.");
    }

    return session.send(prompt);
  }

  async ensureTaskSession(
    taskId: string,
    profileId: string,
    orgId: string,
  ): Promise<string> {
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

    const sessionId = await this.createSession(orgId, "task", profileId);

    await this.db.upsertTask({
      ...record,
      sessionId,
      updatedAt: new Date().toISOString(),
    });

    return sessionId;
  }

  async getTaskChatMessages(
    taskId: string,
    orgId?: string,
  ): Promise<{ sessionId: string; messages: ChatMessage[] } | null> {
    const record = await this.db.getTask(taskId);

    if (!record || (orgId && record.orgId !== orgId)) {
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
      const orgId = record.orgId?.trim();

      if (!orgId) {
        throw new Error("Task organization is missing.");
      }

      sessionId = await this.ensureTaskSession(taskId, record.profileId, orgId);
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
    orgId: string,
    channel: AgentChannel,
    profileId?: string,
    userId?: string | null,
    access?: SessionAccessOptions,
  ): Promise<string> {
    const resolvedProfileId = await this.resolveSessionProfile(orgId, profileId);
    const profile = await this.requireProfile(orgId, resolvedProfileId);

    if (
      profile.isSuper &&
      (access?.excludeSuperBot ||
        !canAccessSuperBotProfile({
          orgRole: access?.orgRole,
          isPlatformAdmin: access?.isPlatformAdmin,
        }))
    ) {
      throw new NakamaApiError("Super Bot is only available to org admins.", 403);
    }

    const sessionId = nanoid();

    await this.db.upsertSession({
      id: sessionId,
      profileId: resolvedProfileId,
      channel,
      userId: userId ?? null,
      createdAt: new Date().toISOString(),
      title: null,
      agentTodos: [],
      agentQuestionnaire: null,
    });

    const session = await this.buildChatSession(
      channel,
      orgId,
      resolvedProfileId,
      sessionId,
      userId ?? null,
    );

    this.sessions.set(sessionId, { channel, profileId: resolvedProfileId, session });

    return sessionId;
  }

  async getSessionTodos(sessionId: string): Promise<AgentTodo[] | null> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return null;
    }

    return this.agentTodoState.listActive(sessionId);
  }

  async getSessionQuestionnaire(sessionId: string): Promise<AgentQuestionnaire | null> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return null;
    }

    return this.agentQuestionnaireState.get(sessionId);
  }

  async getSessionMessages(sessionId: string): Promise<{
    channel: AgentChannel;
    messages: ChatMessage[];
    messageMeta: Array<{ id: string; seq: number; createdAt: string }>;
  } | null> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return null;
    }

    const channel = parseAgentChannel(record.channel);

    if (!channel) {
      return null;
    }

    const storedMessages = await this.db.listMessagesForSession(sessionId);

    return {
      channel,
      messages: storedMessages.map((message) => message.payload as ChatMessage),
      messageMeta: storedMessages.map((message) => ({
        id: message.id,
        seq: message.seq,
        createdAt: message.createdAt,
      })),
    };
  }

  async branchSession(
    sessionId: string,
    messageIndex: number,
  ): Promise<BranchSessionResponse | null> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return null;
    }

    if (!Number.isInteger(messageIndex) || messageIndex < 0) {
      throw new Error("messageIndex must be a non-negative integer.");
    }

    const sourceMessages = await loadSessionHistory(this.db, sessionId);

    if (messageIndex >= sourceMessages.length) {
      throw new Error("messageIndex is out of bounds.");
    }

    const nextSessionId = nanoid();
    const sourceTitle = record.title?.trim();
    const branchTitle = sourceTitle ? `${sourceTitle} (Branch)` : "Untitled (Branch)";

    await this.db.upsertSession({
      id: nextSessionId,
      profileId: record.profileId,
      channel: record.channel,
      userId: record.userId ?? null,
      createdAt: new Date().toISOString(),
      title: null,
      agentTodos: [],
      agentQuestionnaire: null,
    });

    await replaceSessionHistory(
      this.db,
      nextSessionId,
      sourceMessages.slice(0, messageIndex + 1),
    );
    await this.db.updateSessionTitle(nextSessionId, branchTitle);

    const channel = parseAgentChannel(record.channel);

    if (!channel) {
      throw new Error("Session channel is invalid.");
    }

    const { orgId } = await this.requireProfileRecord(record.profileId);

    const session = await this.buildChatSession(
      channel,
      orgId,
      record.profileId,
      nextSessionId,
      record.userId ?? null,
    );
    this.sessions.set(nextSessionId, {
      channel,
      profileId: record.profileId,
      session,
    });

    return { sessionId: nextSessionId };
  }

  async listSessions(
    orgId: string,
    profileId: string,
    channel: AgentChannel,
  ): Promise<ListSessionsResponse> {
    await this.requireProfile(orgId, profileId);

    const sessions = await this.db.listSessionSummaries(profileId, channel);

    return {
      sessions: sessions.map((session) => ({
        id: session.id,
        profileId: session.profileId,
        channel: parseAgentChannel(session.channel) ?? channel,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messageCount,
        title: session.title,
        preview: session.preview,
      })),
    };
  }

  scheduleSessionTitleGeneration(sessionId: string): void {
    this.sessionTitleService.scheduleSessionTitleGeneration(sessionId);
  }

  async purgeSession(sessionId: string): Promise<boolean> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return false;
    }

    this.sessions.delete(sessionId);
    this.superBotSessionState.clearSession(sessionId);
    this.agentTodoState.clearSession(sessionId);
    this.agentQuestionnaireState.clearSession(sessionId);
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

    const { orgId } = await this.requireProfileRecord(record.profileId);

    const session = await this.buildChatSession(
      channel,
      orgId,
      record.profileId,
      sessionId,
      record.userId ?? null,
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
    await this.agentQuestionnaireState.clear(sessionId);
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

  async deleteSession(sessionId: string): Promise<boolean> {
    const deleted = this.sessions.delete(sessionId);

    if (deleted) {
      this.agentTodoState.clearSession(sessionId);
      this.agentQuestionnaireState.clearSession(sessionId);
      await this.db.deleteSession(sessionId);
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

  async discoverModels(request: DiscoverModelsRequest): Promise<ModelsResponse> {
    const providerId = request.providerId?.trim();
    if (providerId) {
      return this.discoverModelsForProvider(providerId);
    }

    const baseUrl = request.baseUrl?.trim();
    if (!baseUrl) {
      throw new Error("baseUrl or providerId is required.");
    }

    const entries = await fetchRemoteOpenAIModels(baseUrl, request.apiKey ?? "");
    const probeInstance = {
      id: "discover",
      type: "openai_compatible" as const,
      label: "Discover",
      apiKey: request.apiKey ?? "",
      baseUrl,
      customModels: entries,
      createdAt: new Date(0).toISOString(),
    };
    const models = getModelsForProviderInstance(probeInstance);

    return {
      currentProviderId: null,
      providers: [],
      models,
      catalog: AVAILABLE_MODELS,
      provider: "openai_compatible",
      displayName: null,
      customModels: entries,
    };
  }

  async discoverModelsForProvider(providerId: string): Promise<ModelsResponse> {
    const instance = findProviderInstance(
      this.userConfig ?? { providers: [], defaultProviderId: null },
      providerId,
    );

    if (!instance) {
      throw new Error("Provider not found.");
    }

    if (instance.type !== "openai") {
      throw new Error(`Remote model discovery is not supported for ${instance.type}.`);
    }

    if (!instance.apiKey.trim()) {
      throw new Error("Add an API key before discovering models.");
    }

    const baseUrl = instance.baseUrl?.trim() || "https://api.openai.com/v1";
    const entries = await fetchRemoteOpenAIModels(baseUrl, instance.apiKey);
    const staticModels = AVAILABLE_MODELS.filter((model) => model.provider === "openai");
    const models = catalogCustomModelsToCatalog(entries, staticModels, "openai");

    return {
      currentProviderId: providerId,
      providers: [],
      models,
      catalog: AVAILABLE_MODELS,
      provider: "openai",
      displayName: null,
    };
  }

  async listProviders(): Promise<ListProvidersResponse> {
    const providers = this.userConfig?.providers ?? [];

    return {
      providers: providers.map((instance) =>
        toProviderInstanceSummary(instance, countModelsForInstance(instance)),
      ),
      defaultProviderId: this.userConfig?.defaultProviderId ?? null,
    };
  }

  async createProvider(request: CreateProviderRequest): Promise<CreateProviderResponse> {
    const existing = this.userConfig?.providers ?? [];
    const instance = buildProviderInstanceFromCreateRequest(request, existing);
    const model = resolveInitialModel(instance, request.model);
    const providers = [...existing, instance];
    const isFirst = providers.length === 1;
    const thinking = await this.resolveThinkingSettings();
    const baseConfig = this.userConfig ?? {
      defaultProviderId: null,
      providers: [],
      thinkingEnabled: thinking.enabled,
      thinkingEffort: thinking.effort,
    };

    this.userConfig = {
      ...baseConfig,
      providers,
      defaultProviderId:
        isFirst || !baseConfig.defaultProviderId ? instance.id : baseConfig.defaultProviderId,
    };

    await saveUserConfig(this.userConfig);
    this.refreshHarness();

    if (isFirst) {
      await this.ensureSoulScaffolded();
    }

    return {
      provider: toProviderInstanceSummary(instance, countModelsForInstance(instance)),
      defaultProviderId: this.userConfig.defaultProviderId!,
      initialModel: model,
    };
  }

  async updateProvider(
    providerId: string,
    request: UpdateProviderRequest,
  ): Promise<UpdateProviderResponse> {
    if (!this.userConfig) {
      throw new Error("Provider is not configured.");
    }

    const current = findProviderInstance(this.userConfig, providerId);

    if (!current) {
      throw new Error("Provider not found.");
    }

    const updated = applyProviderInstanceUpdate(current, request);
    const providers = this.userConfig.providers.map((instance) =>
      instance.id === providerId ? updated : instance,
    );

    this.userConfig = { ...this.userConfig, providers };
    await saveUserConfig(this.userConfig);
    this.refreshHarness();

    return {
      provider: toProviderInstanceSummary(updated, countModelsForInstance(updated)),
    };
  }

  async deleteProvider(providerId: string): Promise<DeleteProviderResponse> {
    if (!this.userConfig) {
      throw new Error("Provider is not configured.");
    }

    const providers = this.userConfig.providers.filter((instance) => instance.id !== providerId);

    if (providers.length === this.userConfig.providers.length) {
      throw new Error("Provider not found.");
    }

    let defaultProviderId = this.userConfig.defaultProviderId;

    if (defaultProviderId === providerId) {
      defaultProviderId = providers[0]?.id ?? null;
    }

    this.userConfig = {
      ...this.userConfig,
      providers,
      defaultProviderId,
    };

    await saveUserConfig(this.userConfig);
    this.refreshHarness();

    return { defaultProviderId };
  }

  async getModels(options: { source?: "catalog" | "remote" } = {}): Promise<ModelsResponse> {
    const active = getActiveProviderInstance(this.userConfig);
    const currentProviderId = this.userConfig?.defaultProviderId ?? null;
    const configuredProviders = this.userConfig?.providers ?? [];
    const providers = configuredProviders.map((instance) =>
      toProviderInstanceSummary(instance, countModelsForInstance(instance)),
    );

    if (configuredProviders.length === 0) {
      return this.buildModelsResponse({
        active: null,
        currentProviderId: null,
        providers: [],
        models: AVAILABLE_MODELS,
      });
    }

    if (
      options.source === "remote" &&
      active?.type === "openai_compatible" &&
      active.baseUrl
    ) {
      const remote = await fetchRemoteOpenAIModels(active.baseUrl, active.apiKey);
      const remoteInstance = { ...active, customModels: remote };
      const models = mergeModelsForConfig(
        (this.userConfig?.providers ?? []).map((instance) =>
          instance.id === active.id ? remoteInstance : instance,
        ),
      );

      return this.buildModelsResponse({
        active,
        currentProviderId,
        providers,
        models,
        customModels: remote,
      });
    }

    const models = mergeModelsForConfig(this.userConfig?.providers ?? []);

    return this.buildModelsResponse({
      active,
      currentProviderId,
      providers,
      models,
    });
  }

  private buildModelsResponse(options: {
    active: ReturnType<typeof getActiveProviderInstance>;
    currentProviderId: string | null;
    providers: ReturnType<typeof toProviderInstanceSummary>[];
    models: ModelsResponse["models"];
    customModels?: ModelsResponse["customModels"];
  }): ModelsResponse {
    const { active, currentProviderId, providers, models, customModels } = options;

    return {
      currentProviderId,
      providers,
      models,
      catalog: AVAILABLE_MODELS,
      provider: active?.type ?? null,
      displayName: active?.type === "openai_compatible" ? active.label : null,
      baseUrl: active?.type === "openai_compatible" ? (active.baseUrl ?? null) : null,
      customModels:
        customModels ??
        (active && (active.type === "openrouter" || active.type === "openai_compatible")
          ? active.customModels
          : undefined),
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

  getLlmUsageStatsByModel() {
    return this.llmUsageTracker?.getStatsByModel() ?? [];
  }

  async configureProvider(
    request: ConfigureProviderRequest,
  ): Promise<ConfigureProviderResponse> {
    const result = await this.createProvider({
      type: request.provider,
      apiKey: request.apiKey,
      model: request.model,
      label: request.displayName,
      baseUrl: request.baseUrl,
      customModels: request.customModels,
    });

    const instance = findProviderInstance(this.userConfig, result.defaultProviderId);

    return {
      provider: result.provider.type,
      currentModel: result.initialModel,
      displayName:
        instance?.type === "openai_compatible" ? (instance.label ?? null) : null,
    };
  }

  private refreshHarness(): void {
    const provider = createProviderFromActiveConfig(this.userConfig);
    const active = getActiveProviderInstance(this.userConfig);
    this._providerConfigured = isProviderConfigured(this.userConfig) && provider !== null;
    this.harness = this.createHarness({
      provider,
      providerInstance: active,
      modelId: active ? resolveDefaultModelForInstance(active) : null,
      thinking: this.resolveWorkspaceThinkingDefaults(),
    });
    this.sessions.clear();
  }

  async listProfiles(orgId: string): Promise<ListProfilesResponse> {
    return this.profileService.listProfiles(orgId);
  }

  async getProfile(orgId: string, profileId: string): Promise<ProfileResponse> {
    return this.profileService.getProfile(orgId, profileId);
  }

  async createProfile(orgId: string, request: CreateProfileRequest): Promise<ProfileResponse> {
    return this.profileService.createProfile(orgId, request);
  }

  async updateProfile(
    orgId: string,
    profileId: string,
    request: UpdateProfileRequest,
  ): Promise<ProfileResponse> {
    const response = await this.profileService.updateProfile(orgId, profileId, request);

    if (request.model !== undefined) {
      for (const [sessionId, record] of this.sessions.entries()) {
        if (record.profileId === profileId) {
          this.sessions.delete(sessionId);
        }
      }
    }

    return response;
  }

  async deleteProfile(orgId: string, profileId: string): Promise<void> {
    return this.profileService.deleteProfile(orgId, profileId);
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

  async runToolPlayground(
    toolId: string,
    parameters: Record<string, unknown>,
    context: { orgId: string; userId: string },
  ): Promise<RunToolResponse> {
    const { tool } = await this.profileService.getTool(toolId);

    if (tool.handlerType !== "javascript") {
      throw new Error("Only custom JavaScript tools can be run in the playground.");
    }

    const record = await this.db.getTool(toolId);

    if (!record) {
      throw new Error("Tool not found.");
    }

    const profileId = await this.resolvePlaygroundProfileId(context.orgId, toolId);

    const handlerConfig =
      typeof record.handlerConfig === "object" && record.handlerConfig !== null
        ? (record.handlerConfig as { modulePath?: string })
        : null;

    if (handlerConfig?.modulePath) {
      try {
        invalidateJavascriptModuleCache(
          resolveJavascriptModulePath(handlerConfig.modulePath),
        );
      } catch {
        // Invalid module paths fail when loading the tool.
      }
    }

    const loaded = await loadJavascriptTool(record);

    if (!loaded) {
      throw new Error(`Failed to load tool "${tool.name}".`);
    }

    const toolContext = buildToolExecutionContext({
      orgId: context.orgId,
      profileId,
      userId: context.userId,
    });

    const raw = await executeToolCall(
      [loaded],
      { name: loaded.name, arguments: parameters },
      toolContext,
    );

    if (
      raw !== null &&
      typeof raw === "object" &&
      "error" in raw &&
      typeof (raw as { error?: unknown }).error === "string"
    ) {
      return { ok: false, error: (raw as { error: string }).error };
    }

    return { ok: true, result: raw };
  }

  async suggestToolPlaygroundParams(
    toolId: string,
    prompt: string,
  ): Promise<SuggestToolParamsResponse> {
    const { tool } = await this.profileService.getTool(toolId);

    if (tool.handlerType !== "javascript") {
      throw new Error("Only custom JavaScript tools support parameter suggestions.");
    }

    const record = await this.db.getTool(toolId);

    if (!record) {
      throw new Error("Tool not found.");
    }

    const loaded = await loadJavascriptTool(record);
    const provider = createProviderFromSources(process.env, this.userConfig);
    const parameters = await suggestToolParamsFromPrompt(
      {
        toolName: tool.name,
        description: tool.description,
        parameters: loaded?.parameters,
        prompt,
      },
      { provider: provider ?? undefined },
    );

    return { parameters };
  }

  async listProfileTools(orgId: string, profileId: string): Promise<ListToolsResponse> {
    return this.profileService.listProfileTools(orgId, profileId);
  }

  async assignTool(
    orgId: string,
    profileId: string,
    request: AssignToolRequest,
  ): Promise<ProfileResponse> {
    return this.profileService.assignTool(orgId, profileId, request);
  }

  async unassignTool(
    orgId: string,
    profileId: string,
    toolId: string,
  ): Promise<ProfileResponse> {
    return this.profileService.unassignTool(orgId, profileId, toolId);
  }

  async assignMcpServer(
    orgId: string,
    profileId: string,
    request: { serverId: string },
  ): Promise<ProfileResponse> {
    return this.profileService.assignMcpServer(orgId, profileId, request);
  }

  async unassignMcpServer(
    orgId: string,
    profileId: string,
    serverId: string,
  ): Promise<ProfileResponse> {
    return this.profileService.unassignMcpServer(orgId, profileId, serverId);
  }

  async listSkills(): Promise<ListSkillsResponse> {
    return this.requireSkillsService().listSkills();
  }

  async getSkill(skillId: string): Promise<SkillResponse> {
    return this.requireSkillsService().getSkill(skillId);
  }

  async createSkill(orgId: string, request: CreateSkillRequest): Promise<SkillResponse> {
    return this.requireSkillsService().createSkill(orgId, request);
  }

  async deleteSkill(skillId: string): Promise<void> {
    return this.requireSkillsService().deleteSkill(skillId);
  }

  async syncSkills(): Promise<SyncSkillsResponse> {
    return this.requireSkillsService().syncDiscoveredSkills();
  }

  async assignSkill(
    orgId: string,
    profileId: string,
    request: AssignSkillRequest,
  ): Promise<ProfileResponse> {
    return this.profileService.assignSkill(orgId, profileId, request);
  }

  async unassignSkill(
    orgId: string,
    profileId: string,
    skillId: string,
  ): Promise<ProfileResponse> {
    return this.profileService.unassignSkill(orgId, profileId, skillId);
  }

  async uploadProfileAvatar(
    orgId: string,
    profileId: string,
    attachment: ImageAttachment,
  ): Promise<ProfileResponse> {
    return this.profileService.uploadProfileAvatar(orgId, profileId, attachment);
  }

  async getProfileAvatar(
    orgId: string,
    profileId: string,
  ): Promise<{ mediaType: string; bytes: Buffer }> {
    return this.profileService.getProfileAvatar(orgId, profileId);
  }

  async getProfileAvatarByProfileId(
    profileId: string,
  ): Promise<{ mediaType: string; bytes: Buffer }> {
    return this.profileService.getProfileAvatarByProfileId(profileId);
  }

  async deleteProfileAvatar(orgId: string, profileId: string): Promise<void> {
    return this.profileService.deleteProfileAvatar(orgId, profileId);
  }

  async listKnowledgeBase(orgId: string, profileId: string): Promise<ListKnowledgeBaseResponse> {
    return this.profileService.listKnowledgeBase(orgId, profileId);
  }

  async uploadKnowledgeBaseDocument(
    orgId: string,
    profileId: string,
    document: DocumentAttachment,
  ): Promise<UploadKnowledgeBaseResponse> {
    return this.profileService.uploadKnowledgeBaseDocument(orgId, profileId, document);
  }

  async deleteKnowledgeBaseDocument(
    orgId: string,
    profileId: string,
    documentId: string,
  ): Promise<DeleteKnowledgeBaseResponse> {
    return this.profileService.deleteKnowledgeBaseDocument(orgId, profileId, documentId);
  }

  async getProfileSoulStatus(
    orgId: string,
    profileId: string,
    includeContents = false,
  ): Promise<SoulStatusResponse> {
    const profile = await this.requireProfile(orgId, profileId);
    const status = await getResolvedSoulStatus(orgId, profileId);

    if (!includeContents) {
      return { ...status, profileId };
    }

    const stack = await loadSoulStack(getProfileSoulDir(orgId, profileId));
    return { ...status, profileId, contents: stack.files };
  }

  async ensureSoulScaffolded(): Promise<void> {
    const profiles = await this.db.listProfiles();

    for (const profile of profiles) {
      if (!profile.orgId) {
        continue;
      }

      await initSoulDirectory(getProfileSoulDir(profile.orgId, profile.id));
    }
  }

  async initProfileSoul(orgId: string, profileId: string): Promise<InitSoulResponse> {
    await this.requireProfile(orgId, profileId);
    const result = await initSoulDirectory(getProfileSoulDir(orgId, profileId));
    return { ...result, profileId };
  }

  async getProfileSoulStack(orgId: string, profileId: string): Promise<SoulStackResponse> {
    await this.requireProfile(orgId, profileId);
    const stack = await loadSoulStack(getProfileSoulDir(orgId, profileId));
    return { ...stack, profileId };
  }

  async writeProfileSoulFile(
    orgId: string,
    profileId: string,
    key: string,
    request: UpdateSoulFileRequest,
  ): Promise<void> {
    await this.requireProfile(orgId, profileId);

    if (!isWritableSoulFileKey(key)) {
      throw new Error(`Invalid soul file key: ${key}`);
    }

    await writeSoulFile(getProfileSoulDir(orgId, profileId), key, request.content);
  }

  async listProfileArtifacts(orgId: string, profileId: string): Promise<ListArtifactsResponse> {
    await this.requireProfile(orgId, profileId);
    return listArtifacts(orgId, profileId);
  }

  async readProfileArtifact(orgId: string, profileId: string, filename: string) {
    await this.requireProfile(orgId, profileId);
    return readArtifactFile({ orgId, profileId, filename });
  }

  async deleteProfileArtifact(
    orgId: string,
    profileId: string,
    filename: string,
  ): Promise<DeleteArtifactResponse> {
    await this.requireProfile(orgId, profileId);
    return deleteArtifactFile({ orgId, profileId, filename });
  }

  async getUserContext(
    orgId: string,
    userId: string,
    includeContent = false,
  ): Promise<UserContextStatusResponse> {
    const raw = await this.db.getUserContext(orgId, userId);
    return buildUserContextStatus(raw, includeContent);
  }

  async initUserContext(orgId: string, userId: string): Promise<InitUserContextResponse> {
    const existing = normalizeUserContextContent(await this.db.getUserContext(orgId, userId));
    if (existing !== undefined) {
      return { created: false };
    }

    await this.db.setUserContext(
      orgId,
      userId,
      USER_CONTEXT_TEMPLATE,
      new Date().toISOString(),
    );
    return { created: true };
  }

  async writeUserContext(
    orgId: string,
    userId: string,
    request: UpdateUserContextRequest,
  ): Promise<void> {
    await this.db.setUserContext(
      orgId,
      userId,
      request.content,
      new Date().toISOString(),
    );
  }

  private async loadUserContextForUser(
    orgId: string,
    userId?: string | null,
  ): Promise<string | undefined> {
    if (!userId) {
      return undefined;
    }

    return normalizeUserContextContent(await this.db.getUserContext(orgId, userId));
  }

  private createHarness(options: {
    provider: ProviderClient | null;
    providerInstance?: ReturnType<typeof getActiveProviderInstance>;
    modelId?: string | null;
    thinking: ThinkingSettings;
  }): AgentHarness {
    const providerInstance = options.providerInstance ?? null;

    this.syncUsagePricingContext(providerInstance);

    const trackedProvider =
      options.provider && this.llmUsageTracker && options.modelId
        ? wrapProviderWithUsageTracking(
            options.provider,
            this.llmUsageTracker,
            options.modelId,
          )
        : options.provider;

    return createAgentHarness({
      provider: trackedProvider ?? undefined,
      chatOptions: this.resolveChatProviderOptions(
        providerInstance,
        options.thinking,
      ),
    });
  }

  private syncUsagePricingContext(
    active: ReturnType<typeof getActiveProviderInstance>,
  ): void {
    this.llmUsageTracker?.setPricingContext({
      provider: active?.type ?? null,
      providerInstance: active,
    });
  }

  getUsageStatusFields(): {
    displayName: string | null;
    costEstimated: boolean;
    currentModel: string | null;
  } {
    const active = getActiveProviderInstance(this.userConfig);
    const currentModel = active ? resolveDefaultModelForInstance(active) : null;

    return {
      displayName: active?.type === "openai_compatible" ? (active.label ?? null) : null,
      costEstimated: isCostEstimated(active?.type ?? null, currentModel, active),
      currentModel,
    };
  }

  private async requireProfile(orgId: string, profileId: string): Promise<StoredProfileRecord> {
    const profile = await this.db.getProfileForOrg(profileId, orgId);

    if (!profile) {
      throw new Error("Profile not found.");
    }

    return profile;
  }

  private async requireProfileRecord(profileId: string): Promise<StoredProfileRecord> {
    const profile = await this.db.getProfile(profileId);

    if (!profile?.orgId) {
      throw new Error("Profile not found.");
    }

    return profile;
  }

  private async resolveSessionProfile(orgId: string, profileId?: string): Promise<string> {
    if (profileId?.trim()) {
      const requestedProfile = await this.db.getProfileForOrg(profileId.trim(), orgId);

      if (requestedProfile) {
        return profileId.trim();
      }
    }

    const defaultProfile = await this.db.getDefaultProfileForOrg(orgId);

    if (defaultProfile) {
      return defaultProfile.id;
    }

    throw new Error(
      "No profiles exist for this organization. Create a profile in the web dashboard first.",
    );
  }

  private async resolveProfileTools(
    profile: StoredProfileRecord,
    options: {
      includeAutomationTools?: boolean;
      includeTodoTools?: boolean;
      includeQuestionTools?: boolean;
      includeSubAgentTool?: boolean;
      userId?: string | null;
    } = {},
  ): Promise<ToolDefinition[]> {
    const storedTools = await this.db.listToolsForProfile(profile.id);
    const tools = await resolveProfileStoredTools(storedTools, this.db);
    const includeAutomationTools = options.includeAutomationTools ?? true;
    const includeTodoTools = options.includeTodoTools ?? true;
    const includeQuestionTools = options.includeQuestionTools ?? true;
    const includeSubAgentTool = options.includeSubAgentTool ?? true;

    let resolved = [...tools];

    if (this.mcpClientManager) {
      const mcpServers = await this.db.listMcpServersForProfile(profile.id);
      const orgId = profile.orgId;

      if (!orgId) {
        throw new Error("Profile organization is missing.");
      }

      resolved = [
        ...resolved,
        ...buildMcpToolDefinitions(mcpServers, this.mcpClientManager, orgId, profile.id),
      ];
    }

    if (this.composioService && this.mcpClientManager && options.userId) {
      const orgId = profile.orgId;

      if (!orgId) {
        throw new Error("Profile organization is missing.");
      }

      resolved = [
        ...resolved,
        ...(await buildComposioConnectTools(
          orgId,
          options.userId,
          profile.id,
          this.composioService,
        )),
        ...(await buildComposioToolDefinitions(
          orgId,
          options.userId,
          profile.id,
          this.composioService,
          this.mcpClientManager,
        )),
      ];
    }

    if (includeAutomationTools && this.automationTools.length > 0) {
      resolved = [...resolved, ...this.automationTools];
    }

    if (includeTodoTools && this.todoTools.length > 0) {
      resolved = [...resolved, ...this.todoTools];
    }

    if (includeQuestionTools && this.questionTools.length > 0) {
      resolved = [...resolved, ...this.questionTools];
    }

    if (this.skillsService) {
      const orgId = profile.orgId;

      if (!orgId) {
        throw new Error("Profile organization is missing.");
      }

      const skillTools = await this.skillsService.loadToolsForProfile(orgId, profile.id);
      resolved = [...resolved, ...skillTools];
    }

    if (profile.isSuper) {
      resolved = [...resolved, ...this.superBotTools];
    }

    if (!includeSubAgentTool) {
      resolved = resolved.filter((tool) => tool.name !== SUB_AGENT_TOOL_NAME);
    }

    return resolved;
  }

  private async buildChatSession(
    channel: AgentChannel,
    orgId: string,
    profileId: string,
    sessionId: string,
    userId?: string | null,
  ): Promise<AgentChatSession> {
    await this.ensureVisionSettingsLoaded();
    const profile = await this.requireProfile(orgId, profileId);
    const tools = await this.resolveProfileTools(profile, { userId });
    const { systemPrompt, soulActive } = await this.resolveProfileSystemPrompt(
      orgId,
      profileId,
      profile.systemPrompt,
    );
    const resolvedSystemPrompt = profile.isSuper
      ? `${systemPrompt.trim()}\n\n${SUPER_BOT_TOOL_AUTHORING_RULES}`
      : systemPrompt;
    const initialHistory = await loadSessionHistory(this.db, sessionId);
    const userTimezone = await this.getUserTimezone();
    const userContext = await this.loadUserContextForUser(orgId, userId);
    const compaction = this.resolveCompactionConfig(profile);
    const harness = this.createHarnessForProfile(profile);
    const saveAttachment = createAttachmentSaver(this.db, {
      orgId,
      profileId,
      sessionId,
      channel,
    });
    const loadAttachment = createAttachmentLoader(this.db, { orgId, profileId });

    const session = harness.createChatSession({
      channel,
      tools,
      systemPrompt: resolvedSystemPrompt,
      userContext,
      enableToolLoop: true,
      soul: soulActive,
      initialHistory,
      userTimezone,
      compaction,
      toolContext: buildToolExecutionContext({
        orgId,
        profileId,
        sessionId,
        userId: userId ?? undefined,
      }),
      resolvePromptContext: async (context) => {
        const parts: string[] = [];
        const todoContext = await this.agentTodoState.formatForPrompt(sessionId);

        if (todoContext.trim()) {
          parts.push(todoContext.trim());
        }

        if (this.composioService && userId) {
          const composioContext = await this.composioService.formatProfileConnectionsContext(
            orgId,
            userId,
            profileId,
          );

          if (composioContext.trim()) {
            parts.push(composioContext.trim());
          }
        }

        if (this.skillsService && context?.userMessage?.trim()) {
          const skillContext = await this.skillsService.formatMatchedSkillsForPrompt(
            orgId,
            profileId,
            context.userMessage,
            {
              appendContext: async (matched) => {
                const parts: string[] = [];

                if (profile.isSuper && matched.some((skill) => skill.name === "create-profile")) {
                  parts.push(await this.formatProfileAuthoringToolContext());
                }

                if (matched.some((skill) => skill.name === "coding-delegation")) {
                  parts.push(await this.formatCodingDelegationContext(orgId, profileId));
                }

                return parts.filter(Boolean).join("\n\n");
              },
            },
          );

          if (skillContext.trim()) {
            parts.push(skillContext.trim());
          }
        }

        return parts.join("\n\n");
      },
      preprocessUserContent: async (content) => {
        content = await persistInlineAttachmentsInContent(content, saveAttachment);

        if (!messageContentHasImages(content)) {
          return content;
        }

        const forVision = await rehydrateAttachmentRefsInContent(content, loadAttachment);

        const primarySupportsVision = resolvePrimaryModelVisionSupport(
          this.userConfig,
          profile.model,
        );

        if (primarySupportsVision !== false) {
          return content;
        }

        const visionSelection = resolveVisionProviderSelection(this.userConfig);

        if (!visionSelection) {
          throw new NakamaApiError(VISION_MODEL_REQUIRED_MESSAGE, 400);
        }

        let visionProvider = createVisionFallbackProvider(visionSelection);

        if (this.llmUsageTracker) {
          visionProvider = wrapProviderWithUsageTracking(
            visionProvider,
            this.llmUsageTracker,
            visionSelection.model,
          );
        }

        const descriptions = await describeImagesWithVisionModel(
          visionProvider,
          extractImageParts(forVision),
        );

        return replaceImagePartsWithDescriptions(forVision, descriptions);
      },
      rehydrateMessagesForProvider: (messages) =>
        rehydrateAttachmentMessages(messages, loadAttachment),
    });

    return wrapPersistedSession(sessionId, session, this.db, {
      onBeginTurn: (id) => {
        this.superBotSessionState.beginTurn(id);
        void this.agentQuestionnaireState.clear(id);
      },
    });
  }

  private async formatProfileAuthoringToolContext(): Promise<string> {
    const { tools } = await this.profileService.listTools();
    const lines = tools
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((tool) => {
        const source = tool.handlerType === "builtin" ? "builtin" : "custom";
        return `- ${tool.name} (${source}, id: ${tool.id}) - ${tool.description}`;
      });

    if (lines.length === 0) {
      return "";
    }

    return [
      "# Available Tools for Profile Creation",
      "Use this current tool inventory to choose a small, relevant starter tool set. Do not assign every tool by default.",
      ...lines,
    ].join("\n");
  }

  private async formatCodingDelegationContext(
    orgId: string,
    profileId: string,
  ): Promise<string> {
    try {
      const harness = await resolveCodingAgentHarness(this.db);
      const workspaceRoot = getProfileSoulDir(orgId, profileId);
      const profile = await this.db.getProfile(profileId);
      const gatewayBaseUrl = getInferenceGatewayBaseUrl();
      let authToken: string | null = null;

      if (gatewayBaseUrl) {
        try {
          authToken = await loadLocalAuthToken();
        } catch {
          authToken = null;
        }
      }

      const template = buildCodingAgentCommandTemplate(
        harness,
        "<task prompt>",
        workspaceRoot,
        {
          model: normalizeCodingAgentModel(profile?.model),
          gatewayBaseUrl,
          authToken,
          orgId,
          profileId,
        },
      );
      const backendSkillName = getBackendSkillName(harness.kind);
      const backendSkill = await readBundledSkillBody(backendSkillName);

      return [
        formatCodingAgentCommandContext(template),
        "",
        "# Backend Guidance",
        backendSkill,
      ].join("\n");
    } catch {
      return [
        "# Coding Agent Harness",
        "No coding agent harness is ready. Configure and verify a harness in workspace settings before invoking a coding agent via `bash`.",
      ].join("\n");
    }
  }

  private async resolveProfileSystemPrompt(
    orgId: string,
    profileId: string,
    profilePrompt: string,
  ): Promise<{ systemPrompt: string; soulActive: boolean }> {
    const stack = await resolveSoulStackForProfile(orgId, profileId);
    let systemPrompt = stack
      ? composeSoulSystemPrompt(stack, { profilePrompt })
      : profilePrompt;

    if (this.skillsService) {
      const skillsCatalog = await this.skillsService.composeCatalogForProfile(orgId, profileId);

      if (skillsCatalog.trim()) {
        systemPrompt = `${systemPrompt.trim()}\n\n${skillsCatalog.trim()}`;
      }
    }

    const kbCatalog = await composeKnowledgeBaseCatalog(orgId, profileId);

    if (kbCatalog.trim()) {
      systemPrompt = `${systemPrompt.trim()}\n\n${kbCatalog.trim()}`;
    }

    return {
      systemPrompt,
      soulActive: Boolean(stack),
    };
  }

  private requireSkillsService(): SkillsService {
    if (!this.skillsService) {
      throw new Error("Skills service is not configured.");
    }

    return this.skillsService;
  }

  private createHarnessForProfile(profile: StoredProfileRecord): AgentHarness {
    const resolved = resolveProfileProviderSelection({
      providers: this.userConfig?.providers ?? [],
      defaultProviderId: this.userConfig?.defaultProviderId,
      profileModel: profile.model,
    });

    if (!resolved) {
      return this.createHarness({
        provider: null,
        providerInstance: null,
        modelId: null,
        thinking: this.resolveWorkspaceThinkingDefaults(),
      });
    }

    const provider = createProviderForInstance(resolved.instance, resolved.model);
    const primarySupportsVision = resolvePrimaryModelVisionSupport(
      this.userConfig,
      profile.model,
    );
    const resolvedProvider =
      primarySupportsVision === false ? wrapProviderForNonVision(provider) : provider;

    return this.createHarness({
      provider: resolvedProvider,
      providerInstance: resolved.instance,
      modelId: resolved.model,
      thinking: this.resolveWorkspaceThinkingDefaults(),
    });
  }

  private async resolvePlaygroundProfileId(orgId: string, toolId: string): Promise<string> {
    const profiles = await this.db.listProfilesForOrg(orgId);

    for (const profile of profiles) {
      const tools = await this.db.listToolsForProfile(profile.id);

      if (tools.some((tool) => tool.id === toolId)) {
        return profile.id;
      }
    }

    const defaultProfile = await this.db.getDefaultProfileForOrg(orgId);

    if (defaultProfile) {
      return defaultProfile.id;
    }

    if (profiles[0]) {
      return profiles[0].id;
    }

    throw new Error("No profile available for playground execution.");
  }

  private resolveCompactionConfig(
    profile: StoredProfileRecord,
  ): CompactionConfig | undefined {
    const resolved = resolveProfileProviderSelection({
      providers: this.userConfig?.providers ?? [],
      defaultProviderId: this.userConfig?.defaultProviderId,
      profileModel: profile.model,
    });

    if (!resolved) {
      return undefined;
    }

    const model = getModelById(resolved.model);

    if (!model) {
      return undefined;
    }

    return {
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
    };
  }

  private resolveWorkspaceThinkingDefaults(): ThinkingSettings {
    return {
      enabled: this.userConfig?.thinkingEnabled ?? DEFAULT_THINKING_ENABLED,
      effort: this.userConfig?.thinkingEffort ?? DEFAULT_THINKING_EFFORT,
    };
  }

}

function parseAgentChannel(value: string): AgentChannel | null {
  if (
    value === "cli" ||
    value === "web" ||
    value === "telegram" ||
    value === "whatsapp" ||
    value === "discord" ||
    value === "automation" ||
    value === "task" ||
    value === "subagent"
  ) {
    return value;
  }

  return null;
}

function clampSubAgentTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs == null || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_SUB_AGENT_TIMEOUT_MS;
  }

  return Math.min(Math.floor(timeoutMs), MAX_SUB_AGENT_TIMEOUT_MS);
}
