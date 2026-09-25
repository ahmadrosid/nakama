import { join } from "node:path";
import {
  type AgentChatSession,
  type AgentDependencies,
  type CompactionConfig,
  createAgentChatSession,
  createAutomationFromPrompt,
  executeToolCall,
  expandLearnInLastUserMessage,
  suggestToolParamsFromPrompt,
} from "@nakama/agent";
import type {
  AgentBrowserStatusResponse,
  AgentChannel,
  AgentQuestionnaire,
  AgentTodo,
  ApplyTelegramPairingRequest,
  AssignSkillRequest,
  AssignToolRequest,
  BranchSessionResponse,
  ChatContextUsage,
  ChatgptOAuthCredentials,
  ChatMessage,
  CloneProfileRequest,
  CompactionResponse,
  ComposioSettingsResponse,
  ConfigureProviderRequest,
  ConfigureProviderResponse,
  CreateProfileRequest,
  CreateProviderRequest,
  CreateProviderResponse,
  CreateSkillRequest,
  CreateToolRequest,
  DeleteArtifactResponse,
  DeleteKnowledgeBaseResponse,
  DeleteOrganizationKnowledgeBaseResponse,
  DeleteProviderResponse,
  DiscordSettingsResponse,
  DiscoverModelsRequest,
  DocumentAttachment,
  EmailSettingsResponse,
  ErrorTrackingSettingsResponse,
  GenerateImageRequest,
  GenerateImageResponse,
  ImageAttachment,
  ImageGenerationSettings,
  ImageGenerationSettingsResponse,
  InitSoulResponse,
  InitUserContextResponse,
  InstallSkillRequest,
  KnowledgeBaseDocument,
  KnowledgeBaseDuplicateAction,
  ListArtifactsOptions,
  ListArtifactsResponse,
  ListKnowledgeBaseResponse,
  ListProfilesResponse,
  ListProvidersResponse,
  ListSessionsResponse,
  ListSkillsResponse,
  ListToolsResponse,
  LoadedAttachmentBytes,
  ModelsResponse,
  MoveProfileRequest,
  PatchSkillRequest,
  ProfileResponse,
  ProviderChatOptions,
  ProviderClient,
  RunToolResponse,
  SaveInlineAttachment,
  SendEmailTestResponse,
  SendErrorTrackingTestResponse,
  SessionSummary,
  SkillResponse,
  SoulStackResponse,
  SoulStatusResponse,
  StartTelegramPairingRequest,
  SuggestToolParamsResponse,
  SyncSkillsResponse,
  TelegramPairingStartResponse,
  TelegramPairingStatusResponse,
  TelegramSettingsResponse,
  ThinkingSettings,
  ThinkingSettingsResponse,
  ToolContext,
  ToolDefinition,
  ToolResponse,
  ToolSourceResponse,
  TranscribeAudioRequest,
  TranscribeAudioResponse,
  TranscriptionSettings,
  TranscriptionSettingsResponse,
  UpdateArtifactResponse,
  UpdateComposioSettingsRequest,
  UpdateDiscordSettingsRequest,
  UpdateEmailSettingsRequest,
  UpdateErrorTrackingSettingsRequest,
  UpdateImageGenerationRequest,
  UpdateProfileRequest,
  UpdateProviderRequest,
  UpdateProviderResponse,
  UpdateSoulFileRequest,
  UpdateTelegramSettingsRequest,
  UpdateThinkingRequest,
  UpdateTranscriptionRequest,
  UpdateUserContextRequest,
  UpdateVisionRequest,
  UpdateWebSearchSettingsRequest,
  UpdateWhatsAppSettingsRequest,
  UploadKnowledgeBaseResponse,
  UploadOrganizationKnowledgeBaseResponse,
  UserConfig,
  UserContextStatusResponse,
  VisionSettings,
  VisionSettingsResponse,
  WebSearchSettingsResponse,
  WhatsAppSettingsResponse,
  XaiOAuthCredentials,
} from "@nakama/core";
import {
  apiKeyEnvVarForProvider,
  appendOrgMemorySection,
  applyChatgptOAuthToInstance,
  applyXaiOAuthToInstance,
  buildErrorReport,
  buildThinkingProviderOptions,
  buildToolExecutionContext,
  buildUserContextStatus,
  chatgptOAuthNeedsRefresh,
  composeKnowledgeBaseCatalog,
  composeSoulSystemPrompt,
  createErrorTrackingSink,
  createSmtpSender,
  DEFAULT_THINKING_EFFORT,
  DEFAULT_THINKING_ENABLED,
  defaultOllamaBaseUrl,
  deleteArtifactFile,
  deleteAttachmentBytes,
  ensureAppUserSoulDir,
  extractImageParts,
  findProviderInstance,
  getActiveProviderInstance,
  getProfileSoulDir,
  getSoulStatus,
  initSoulDirectory,
  isEmailConfigComplete,
  isProviderConfigured,
  isWritableSoulFileKey,
  listArtifacts,
  loadComposioSettingsPublic,
  loadDiscordSettingsPublic,
  loadEmailConfig,
  loadEmailSettingsPublic,
  loadErrorTrackingSettingsPublic,
  loadSoulStack,
  loadTelegramSettingsPublic,
  loadUserConfig,
  loadUserThinkingSettings,
  loadUserTimezone,
  loadUserTranscriptionSettings,
  loadUserVisionSettings,
  loadWebSearchSettingsPublic,
  loadWhatsAppSettingsPublic,
  messageContentHasImages,
  NakamaApiError,
  nanoid,
  normalizeUserContextContent,
  type OrgRole,
  ollamaRequiresApiKey,
  parseAgentChannel,
  parseSentryDsn,
  partitionTools,
  persistInlineAttachmentsInContent,
  readArtifactFile,
  readBundledSkillBody,
  readChatgptOAuthFromInstance,
  readEnvValue,
  readXaiOAuthFromInstance,
  refreshErrorTrackingEnabled,
  regenerateDiscordHandshake,
  regenerateTelegramHandshake,
  regenerateWhatsAppPairingCode,
  rehydrateMessagesForProvider as rehydrateAttachmentMessages,
  rehydrateAttachmentRefsInContent,
  replaceImagePartsWithDescriptions,
  resolveDiscordApplicationId,
  resolveOllamaHostMode,
  saveComposioConfig,
  saveDiscordConfig,
  saveEmailConfig,
  saveErrorTrackingDsn,
  saveTelegramConfig,
  saveUserConfig,
  saveUserThinkingSettings,
  saveUserTimezone,
  saveWebSearchConfig,
  saveWhatsAppConfig,
  toMailboxConfig,
  transcribeAudio,
  USER_CONTEXT_TEMPLATE,
  WRITABLE_SOUL_FILES,
  writeArtifactFile,
  writeSoulFile,
} from "@nakama/core";
import {
  type ChannelConfigScope,
  isChannelOwner,
} from "@nakama/core/channel-config-shared";
import { readTextIfExists } from "@nakama/core/fs";
import { canAccessSuperBotProfile } from "@nakama/core/profiles";
import {
  type DatabaseAdapter,
  mergeWorkspaceSettings,
  type StoredProfileRecord,
  type StoredSessionRecord,
  type StoredSessionSummaryRecord,
  SUPER_BOT_TOOL_AUTHORING_RULES,
} from "@nakama/db";
import {
  AVAILABLE_MODELS,
  catalogCustomModelsToCatalog,
  createProviderForInstance,
  createProviderFromActiveConfig,
  fetchFireworksGatewayModels,
  fetchOllamaModels,
  fetchRemoteOpenAIModels,
  getModelsForProviderInstance,
  isCostEstimated,
  resolveModelLimits,
} from "../providers";
import {
  fetchChatgptCodexModels,
  refreshChatgptOAuthToken,
} from "../providers/chatgpt/oauth";
import { isAllowedImageGenerationSelection } from "../providers/models";
import { wrapProviderForNonVision } from "../providers/non-vision-wrap";
import { wrapProviderWithUsageTracking } from "../providers/usage-tracking";
import {
  fetchXaiOAuthModels,
  resolveXaiOAuthCredentials,
} from "../providers/xai-oauth/oauth";
import { createAskUserQuestionTools } from "../tools/ask-user-question-tool";
import {
  createOrgMemoryTools,
  PROPOSE_ORG_MEMORY_TOOL_NAME,
} from "../tools/org-memory-tools";
import { createSendDiscordArtifactTools } from "../tools/send-discord-artifact-tool";
import {
  createSkillManageTools,
  SKILL_MANAGE_CHANNELS,
} from "../tools/skill-manage-tool";
import { formatToolActivityLabel } from "../tools/sub-agent-activity";
import {
  buildSubAgentPrompt,
  buildSubAgentResult,
  DEFAULT_SUB_AGENT_TIMEOUT_MS,
  failSubAgentResult,
  MAX_SUB_AGENT_TIMEOUT_MS,
  type SubAgentRunInput,
  type SubAgentRunResult,
} from "../tools/sub-agent-shared";
import { SUB_AGENT_TOOL_NAME } from "../tools/sub-agent-tool";
import { createSuperBotTools } from "../tools/super-bot-tools";
import { createTodoTools } from "../tools/todo-tools";
import { getAgentBrowserStatus } from "./agent-browser-service";
import { AgentQuestionnaireState } from "./agent-questionnaire-state";
import { AgentTodoState } from "./agent-todo-state";
import {
  createAttachmentLoader,
  createAttachmentSaver,
} from "./attachment-service";
import {
  resolveTranscriptionProviderSelection,
  TRANSCRIPTION_MODEL_REQUIRED_MESSAGE,
} from "./audio-transcription";
import type { AutomationRunner } from "./automation-runner";
import {
  buildCodingAgentCommandTemplate,
  formatCodingAgentCommandContext,
  getBackendSkillName,
} from "./coding-agent-command";
import {
  type CodingAgentHarnessStatus,
  getCodingHarnessInstallCommand,
  listInstalledCodingAgentHarnesses,
} from "./coding-agent-harness-service";
import type { ComposioService } from "./composio-service";
import {
  buildComposioConnectTools,
  buildComposioToolDefinitions,
} from "./composio-tool-bridge";
import {
  customToolTypesLabel,
  getCustomToolHandler,
} from "./custom-tool-handlers";
import {
  type EphemeralSession,
  EphemeralSessionStore,
} from "./ephemeral-session-store";
import {
  generateImageWithOpenAI,
  IMAGE_MODEL_REQUIRED_MESSAGE,
  resolveImageGenerationSelection,
} from "./image-generation";
import {
  describeImagesWithVisionModel,
  resolvePrimaryModelVisionSupport,
  resolveVisionProviderSelection,
  VISION_MODEL_REQUIRED_MESSAGE,
} from "./image-vision-fallback";
import type { LlmUsageTracker } from "./llm-usage-tracker";
import type { McpClientManager } from "./mcp-client-manager";
import type { McpService } from "./mcp-service";
import { buildMcpToolDefinitions } from "./mcp-tool-bridge";
import { MemoryBackendService } from "./memory-backend-service";
import { OrgMemoryService } from "./org-memory-service";
import { OrgUsageQuotaService } from "./org-usage-quota-service";
import type { PluginService } from "./plugin-service";
import type { ProfileChangeMeta } from "./profile-change-history";
import {
  recordProfileChangeEvent,
  soulFieldFromKey,
} from "./profile-change-history";
import { ProfileService } from "./profile-service";
import {
  applyProviderInstanceUpdate,
  buildProviderInstanceFromCreateRequest,
  countModelsForInstance,
  mergeModelsForConfig,
  modelExistsOnInstance,
  resolveConfiguredModelInstance,
  resolveDefaultModelForInstance,
  resolveInitialModel,
  resolveProfileProviderSelection,
  toProviderInstanceSummary,
} from "./provider-instance-helpers";
import {
  archiveSessionHistory,
  copySessionHistoryArchive,
  createReadSessionHistoryTool,
  deleteSessionHistoryArchive,
  loadSessionHistory,
  replaceSessionHistory,
  wrapPersistedSession,
} from "./session-persistence";
import { SessionTitleService } from "./session-title-service";
import { sessionTurnRegistry } from "./session-turn-registry";
import { SkillPostTurnReviewService } from "./skill-post-turn-review-service";
import type { SkillProposalService } from "./skill-proposal-service";
import type { SkillSuggestionService } from "./skill-suggestion-service";
import type { SkillsService } from "./skills-service";
import { SuperBotSessionState } from "./super-bot-session-state";
import { telegramManagedBotPairing } from "./telegram-managed-bot-pairing";
import {
  resolveProfileStoredTools,
  type ServerToolOverrides,
} from "./tool-resolver";
import type { WorkerManagerService } from "./worker-manager-service";

interface StoredSession {
  channel: AgentChannel;
  pluginRevision: string;
  profileId: string;
  session: AgentChatSession;
}

export type { SubAgentRunInput, SubAgentRunResult };

interface CognitoSessionOptions {
  /** Seeds a rebuild (model change) with the history held in memory. */
  initialHistory?: ChatMessage[];
}

export interface CreateSessionOptions {
  appUserId?: string | null;
  codingWorkspaceRoot?: string;
  cognito?: boolean;
  excludeSuperBot?: boolean;
  isPlatformAdmin?: boolean;
  model?: string | null;
  orgRole?: OrgRole | null;
}

type ChatProfileAccess = Pick<
  CreateSessionOptions,
  "excludeSuperBot" | "isPlatformAdmin" | "orgRole"
>;

export class AgentService {
  private harness: AgentDependencies;
  private userConfig: UserConfig | null;
  private readonly db: DatabaseAdapter;
  private readonly profileService: ProfileService;
  private readonly superBotSessionState = new SuperBotSessionState();
  private readonly agentTodoState: AgentTodoState;
  private readonly agentQuestionnaireState: AgentQuestionnaireState;
  private readonly superBotTools: ToolDefinition[];
  private readonly orgMemoryTools: ToolDefinition[];
  private automationTools: ToolDefinition[] = [];
  private automationRunHistoryTools: ToolDefinition[] = [];
  private questionTools: ToolDefinition[] = [];
  private todoTools: ToolDefinition[] = [];
  channelWorkers?: WorkerManagerService;

  setChannelOwnerCleanup(
    cleanup: (orgId: string, profileId: string) => Promise<void>
  ) {
    this.profileService.beforeChannelOwnerDelete = cleanup;
  }

  private automationRunner: AutomationRunner | null = null;

  private mcpClientManager: McpClientManager | null = null;
  private mcpService: McpService | null = null;
  private composioService: ComposioService | null = null;
  private pluginService: PluginService | null = null;
  private skillsService: SkillsService | null = null;
  private skillProposalService: SkillProposalService | null = null;
  private skillSuggestionService: SkillSuggestionService | null = null;
  private orgMemoryService: OrgMemoryService | null = null;
  private readonly memoryBackend: MemoryBackendService;
  private readonly sessions = new Map<string, StoredSession>();
  private readonly ephemeralSessions = new EphemeralSessionStore((entry) =>
    this.purgeEphemeralAttachments(entry)
  );
  private readonly sessionTitleService: SessionTitleService;
  private readonly orgUsageQuotaService: OrgUsageQuotaService;
  private skillPostTurnReviewService: SkillPostTurnReviewService;
  private serverTools: ServerToolOverrides = {};
  private _providerConfigured: boolean;
  private visionSettingsPromise: Promise<void> | null = null;
  private transcriptionSettingsPromise: Promise<void> | null = null;
  private imageGenerationSettingsPromise: Promise<void> | null = null;

  constructor(
    userConfig: UserConfig | null,
    provider: ProviderClient | null,
    db: DatabaseAdapter,
    private readonly llmUsageTracker?: LlmUsageTracker
  ) {
    this.userConfig = userConfig;
    this.db = db;
    this.memoryBackend = new MemoryBackendService(db);
    this.profileService = new ProfileService(db);
    this.orgUsageQuotaService = new OrgUsageQuotaService(db);
    this.sessionTitleService = new SessionTitleService(
      db,
      () => this.userConfig
    );
    this.skillPostTurnReviewService = new SkillPostTurnReviewService(
      db,
      () => this.userConfig
    );
    this.agentTodoState = new AgentTodoState(db);
    this.agentQuestionnaireState = new AgentQuestionnaireState(db);
    this.questionTools = createAskUserQuestionTools(
      this.agentQuestionnaireState
    );
    this.todoTools = createTodoTools(this.agentTodoState);
    this.superBotTools = createSuperBotTools(
      this.profileService,
      this.superBotSessionState,
      async (profileModel, context) => {
        const session =
          context.sessionId && context.orgId
            ? await this.getSessionRecordForOrg(
                context.sessionId,
                context.orgId
              )
            : null;
        const selection = resolveProfileProviderSelection({
          defaultProviderId: this.userConfig?.defaultProviderId,
          profileModel:
            (session?.profileId === context.profileId
              ? session?.model
              : null) ?? profileModel,
          providers: this.userConfig?.providers ?? [],
        });
        return selection
          ? `${selection.instance.id}::${selection.model}`
          : profileModel;
      }
    );
    this.orgMemoryTools = createOrgMemoryTools(this.getOrgMemoryService());
    this._providerConfigured =
      isProviderConfigured(userConfig) && provider !== null;
    const activeInstance = getActiveProviderInstance(userConfig);
    this.harness = this.createHarness({
      modelId: activeInstance
        ? resolveDefaultModelForInstance(activeInstance)
        : null,
      provider,
      providerInstance: activeInstance,
      thinking: this.resolveWorkspaceThinkingDefaults(),
    });
  }

  /**
   * Binds a savings recorder to one org. Fire and forget on purpose: a counter
   * for a dashboard must never delay a tool result or fail a turn, so the write
   * is not awaited and a rejection is swallowed.
   */
  /** Same fire-and-forget shape as the savings recorder, for provider tokens. */
  private llmTurnQuotaCheckerFor(orgId: string | undefined) {
    if (!orgId?.trim()) {
      return;
    }

    const scopedOrgId = orgId.trim();
    return (reservedTokens: number) =>
      this.orgUsageQuotaService.assertCanStartLlmTurn(
        scopedOrgId,
        reservedTokens
      );
  }

  private turnUsageRecorderFor(orgId: string | undefined) {
    if (!orgId?.trim()) {
      return;
    }

    const scopedOrgId = orgId.trim();

    return (turn: {
      estimated: boolean;
      inputTokens: number;
      optimized: boolean;
      outputTokens: number;
    }): void => {
      void this.db
        .incrementLlmTurnUsage(scopedOrgId, turn)
        .catch(() => undefined);
    };
  }

  private savingsRecorderFor(orgId: string | undefined) {
    if (!orgId?.trim()) {
      return;
    }

    const scopedOrgId = orgId.trim();

    return (saving: {
      bytesIn: number;
      bytesOut: number;
      optimizer: string;
      tool: string;
    }): void => {
      void this.db
        .incrementToolOutputSavings(
          scopedOrgId,
          saving,
          new Date().toISOString()
        )
        .catch(() => undefined);
    };
  }

  get profiles(): ProfileService {
    return this.profileService;
  }

  private getOrgMemoryService(): OrgMemoryService {
    if (!this.orgMemoryService) {
      this.orgMemoryService = new OrgMemoryService(this.db);
    }
    return this.orgMemoryService;
  }

  private async resolveSessionAccess(
    orgId: string | null | undefined,
    userId: string | null | undefined
  ): Promise<{ isPlatformAdmin: boolean; orgRole: OrgRole | null }> {
    const orgRole =
      orgId && userId
        ? ((await this.db.getOrgMember(orgId, userId))?.role ?? null)
        : null;
    const isPlatformAdmin = userId
      ? Boolean((await this.db.getUserById(userId))?.isPlatformAdmin)
      : false;
    return { isPlatformAdmin, orgRole };
  }

  setAutomationTools(tools: ToolDefinition[]): void {
    this.automationTools = tools;
    this.sessions.clear();
  }

  setServerTools(tools: ServerToolOverrides): void {
    this.serverTools = tools;
  }

  setAutomationRunHistoryTools(tools: ToolDefinition[]): void {
    this.automationRunHistoryTools = tools;
  }

  setAutomationRunner(runner: AutomationRunner): void {
    this.automationRunner = runner;
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

  setPluginService(service: PluginService | null): void {
    this.pluginService = service;
    this.sessions.clear();
  }

  setSkillsService(service: SkillsService): void {
    this.skillsService = service;
    this.sessions.clear();
  }

  setSkillProposalService(service: SkillProposalService): void {
    this.skillProposalService = service;
    this.wireSkillPostTurnReviewOutcomeHandling();
  }

  setSkillSuggestionService(service: SkillSuggestionService): void {
    this.skillSuggestionService = service;
    this.wireSkillPostTurnReviewOutcomeHandling();
  }

  /**
   * U4: once both services are injected, review outcomes from the LLM runner
   * are turned into a staged proposal (write-approval gate on) or a pending
   * suggestion (gate off) instead of being discarded.
   */
  private wireSkillPostTurnReviewOutcomeHandling(): void {
    const proposals = this.skillProposalService;
    const suggestions = this.skillSuggestionService;
    if (!(proposals && suggestions)) {
      return;
    }

    this.skillPostTurnReviewService.setRunner(async (context) => {
      const outcome =
        await this.skillPostTurnReviewService.reviewTurnWithLlm(context);
      if (outcome.action === "noop") {
        return outcome;
      }

      try {
        const writeApprovalRequired = await proposals.isWriteApprovalRequired(
          context.orgId,
          context.profileId
        );

        if (writeApprovalRequired) {
          await proposals.stageProposal({
            action: outcome.action,
            content: outcome.action === "create" ? outcome.content : undefined,
            newString:
              outcome.action === "patch" ? outcome.newString : undefined,
            oldString:
              outcome.action === "patch" ? outcome.oldString : undefined,
            orgId: context.orgId,
            profileId: context.profileId,
            proposedByUserId: context.userId,
            sessionId: context.sessionId,
            skillName: outcome.name,
          });
        } else {
          await suggestions.createSuggestion({
            orgId: context.orgId,
            outcome,
            profileId: context.profileId,
            proposedByUserId: context.userId,
            sessionId: context.sessionId,
          });
        }
      } catch (error) {
        console.error(
          "Failed to record post-turn skill review outcome:",
          error
        );
      }

      return outcome;
    });
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

  // Widened to match saveUserTimezone: the route hands this straight from an
  // unvalidated request body.
  async setUserTimezone(timezone: string | undefined): Promise<string> {
    const saved = await saveUserTimezone(timezone);

    if (this.userConfig) {
      this.userConfig = { ...this.userConfig, timezone: saved };
    }

    return saved;
  }

  async getThinkingSettings(): Promise<ThinkingSettingsResponse> {
    const thinking = await this.resolveThinkingSettings();
    return { thinking };
  }

  async setThinkingSettings(
    input: UpdateThinkingRequest
  ): Promise<ThinkingSettingsResponse> {
    const effort =
      input.effort ?? (await this.resolveThinkingSettings()).effort;
    const thinking: ThinkingSettings = {
      effort,
      enabled: input.enabled,
    };

    await saveUserThinkingSettings(thinking);

    if (this.userConfig) {
      this.userConfig = {
        ...this.userConfig,
        thinkingEffort: thinking.effort,
        thinkingEnabled: thinking.enabled,
      };
    }

    this.harness = this.createHarness({
      modelId: (() => {
        const active = getActiveProviderInstance(this.userConfig);
        return active ? resolveDefaultModelForInstance(active) : null;
      })(),
      provider: createProviderFromActiveConfig(this.userConfig, process.env),
      providerInstance: getActiveProviderInstance(this.userConfig),
      thinking: this.resolveWorkspaceThinkingDefaults(),
    });
    this.sessions.clear();

    return { thinking };
  }

  async getVisionSettings(): Promise<VisionSettingsResponse> {
    await this.ensureVisionSettingsLoaded();
    const vision = await this.resolveVisionSettings();
    return { vision };
  }

  async setVisionSettings(
    input: UpdateVisionRequest
  ): Promise<VisionSettingsResponse> {
    await this.ensureVisionSettingsLoaded();
    const model = input.model?.trim() || null;

    if (model) {
      const resolved = resolveVisionProviderSelection({
        ...this.userConfig,
        defaultProviderId: this.userConfig?.defaultProviderId ?? null,
        providers: this.userConfig?.providers ?? [],
        visionModel: model,
      });

      if (!resolved) {
        throw new NakamaApiError(
          "Selected image parsing model is unavailable. Choose a vision-capable model.",
          400
        );
      }
    }

    const vision: VisionSettings = { model };
    const existing = await this.db.getWorkspaceSettings();
    await this.db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(existing, {
        imageModel: existing?.imageModel ?? this.userConfig?.imageModel ?? null,
        transcriptionModel:
          existing?.transcriptionModel ??
          this.userConfig?.transcriptionModel ??
          null,
        updatedAt: new Date().toISOString(),
        visionModel: model,
      })
    );

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
    input: UpdateTranscriptionRequest
  ): Promise<TranscriptionSettingsResponse> {
    await this.ensureTranscriptionSettingsLoaded();
    const model = input.model?.trim() || null;

    if (model) {
      const resolved = resolveTranscriptionProviderSelection({
        ...this.userConfig,
        defaultProviderId: this.userConfig?.defaultProviderId ?? null,
        providers: this.userConfig?.providers ?? [],
        transcriptionModel: model,
      });

      if (!resolved) {
        throw new NakamaApiError(
          "Selected audio transcription model is unavailable. Choose an OpenAI Whisper model.",
          400
        );
      }
    }

    const transcription: TranscriptionSettings = { model };
    const existing = await this.db.getWorkspaceSettings();
    await this.db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(existing, {
        imageModel: existing?.imageModel ?? this.userConfig?.imageModel ?? null,
        transcriptionModel: model,
        updatedAt: new Date().toISOString(),
        visionModel:
          existing?.visionModel ?? this.userConfig?.visionModel ?? null,
      })
    );

    if (this.userConfig) {
      this.userConfig = {
        ...this.userConfig,
        transcriptionModel: model,
      };
    }

    return { transcription };
  }

  async transcribeAudio(
    input: TranscribeAudioRequest,
    signal?: AbortSignal
  ): Promise<TranscribeAudioResponse> {
    await this.ensureTranscriptionSettingsLoaded();

    const data = input.data?.trim();
    const mediaType = input.mediaType?.trim();

    if (!(data && mediaType)) {
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

    const text = await transcribeAudio({
      audio: {
        bytes,
        filename: input.filename?.trim() || "audio.ogg",
        mediaType,
      },
      model: selection.model,
      provider: selection.instance,
      signal,
    });

    return { text };
  }

  async ensureTranscriptionSettingsLoaded(): Promise<void> {
    if (!this.transcriptionSettingsPromise) {
      this.transcriptionSettingsPromise =
        this.loadTranscriptionSettingsFromDatabase();
    }

    await this.transcriptionSettingsPromise;
  }

  private async loadTranscriptionSettingsFromDatabase(): Promise<void> {
    const stored = await this.db.getWorkspaceSettings();

    if (stored) {
      if (this.userConfig) {
        this.userConfig = {
          ...this.userConfig,
          imageModel: stored.imageModel ?? this.userConfig.imageModel,
          transcriptionModel: stored.transcriptionModel,
          visionModel: stored.visionModel ?? this.userConfig.visionModel,
        };
      }
      return;
    }

    const legacyModel =
      this.userConfig?.transcriptionModel ??
      (await loadUserTranscriptionSettings()).model ??
      null;

    await this.db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(stored, {
        imageModel: this.userConfig?.imageModel ?? null,
        transcriptionModel: legacyModel,
        updatedAt: new Date().toISOString(),
        visionModel: this.userConfig?.visionModel ?? null,
      })
    );

    if (this.userConfig) {
      this.userConfig = { ...this.userConfig, transcriptionModel: legacyModel };
    }
  }

  private async resolveTranscriptionSettings(): Promise<TranscriptionSettings> {
    return { model: this.userConfig?.transcriptionModel ?? null };
  }

  async getImageGenerationSettings(): Promise<ImageGenerationSettingsResponse> {
    await this.ensureImageGenerationSettingsLoaded();
    const imageGeneration = await this.resolveImageGenerationSettings();
    return { imageGeneration };
  }

  async setImageGenerationSettings(
    input: UpdateImageGenerationRequest
  ): Promise<ImageGenerationSettingsResponse> {
    await this.ensureImageGenerationSettingsLoaded();
    const model = input.model?.trim() || null;

    if (model && !isAllowedImageGenerationSelection(model)) {
      throw new NakamaApiError(
        "Only openai::gpt-image-2 is supported for image generation.",
        400
      );
    }

    const imageGeneration: ImageGenerationSettings = { model };
    const existing = await this.db.getWorkspaceSettings();
    await this.db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(existing, {
        imageModel: model,
        transcriptionModel:
          existing?.transcriptionModel ??
          this.userConfig?.transcriptionModel ??
          null,
        updatedAt: new Date().toISOString(),
        visionModel:
          existing?.visionModel ?? this.userConfig?.visionModel ?? null,
      })
    );

    if (this.userConfig) {
      this.userConfig = {
        ...this.userConfig,
        imageModel: model,
      };
    }

    return { imageGeneration };
  }

  async generateImage(
    input: GenerateImageRequest
  ): Promise<GenerateImageResponse> {
    await this.ensureImageGenerationSettingsLoaded();

    const prompt = input.prompt?.trim();
    if (!prompt) {
      throw new NakamaApiError("Image prompt is required.", 400);
    }

    const selection = resolveImageGenerationSelection(this.userConfig);

    if (!selection) {
      throw new NakamaApiError(IMAGE_MODEL_REQUIRED_MESSAGE, 400);
    }

    const result = await generateImageWithOpenAI({
      apiKey: selection.apiKey,
      model: selection.model,
      prompt,
      size: input.size,
    });

    const usage = result.usage ?? {
      inputTokens: 0,
      outputTokens: 0,
    };
    this.llmUsageTracker?.record(
      result.model,
      usage.inputTokens,
      usage.outputTokens
    );

    return {
      data: Buffer.from(result.data).toString("base64"),
      mediaType: result.mediaType,
      model: result.model,
      size: result.size,
      sizeBytes: result.data.byteLength,
      ...(result.revisedPrompt ? { revisedPrompt: result.revisedPrompt } : {}),
    };
  }

  async ensureImageGenerationSettingsLoaded(): Promise<void> {
    if (!this.imageGenerationSettingsPromise) {
      this.imageGenerationSettingsPromise =
        this.loadImageGenerationSettingsFromDatabase();
    }

    await this.imageGenerationSettingsPromise;
  }

  private async loadImageGenerationSettingsFromDatabase(): Promise<void> {
    const stored = await this.db.getWorkspaceSettings();

    if (stored) {
      if (this.userConfig) {
        this.userConfig = {
          ...this.userConfig,
          imageModel: stored.imageModel,
          transcriptionModel:
            stored.transcriptionModel ?? this.userConfig.transcriptionModel,
          visionModel: stored.visionModel ?? this.userConfig.visionModel,
        };
      }
      return;
    }

    const legacyModel = this.userConfig?.imageModel ?? null;

    await this.db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(null, {
        imageModel: legacyModel,
        transcriptionModel: this.userConfig?.transcriptionModel ?? null,
        updatedAt: new Date().toISOString(),
        visionModel: this.userConfig?.visionModel ?? null,
      })
    );

    if (this.userConfig) {
      this.userConfig = { ...this.userConfig, imageModel: legacyModel };
    }
  }

  private async resolveImageGenerationSettings(): Promise<ImageGenerationSettings> {
    return { model: this.userConfig?.imageModel ?? null };
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
          imageModel: stored.imageModel,
          transcriptionModel: stored.transcriptionModel,
          visionModel: stored.visionModel,
        };
      }
      return;
    }

    const legacyVisionModel =
      this.userConfig?.visionModel ??
      (await loadUserVisionSettings()).model ??
      null;
    const legacyTranscriptionModel =
      this.userConfig?.transcriptionModel ??
      (await loadUserTranscriptionSettings()).model ??
      null;
    const legacyImageModel = this.userConfig?.imageModel ?? null;

    await this.db.upsertWorkspaceSettings(
      mergeWorkspaceSettings(stored, {
        imageModel: legacyImageModel,
        transcriptionModel: legacyTranscriptionModel,
        updatedAt: new Date().toISOString(),
        visionModel: legacyVisionModel,
      })
    );

    if (this.userConfig) {
      this.userConfig = {
        ...this.userConfig,
        imageModel: legacyImageModel,
        transcriptionModel: legacyTranscriptionModel,
        visionModel: legacyVisionModel,
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
        effort: this.userConfig.thinkingEffort ?? "medium",
        enabled: this.userConfig.thinkingEnabled ?? true,
      };
    }

    return loadUserThinkingSettings();
  }

  private resolveChatProviderOptions(
    providerInstance: ReturnType<typeof getActiveProviderInstance>,
    thinkingSettings: ThinkingSettings,
    overrides?: Partial<ProviderChatOptions>
  ): ProviderChatOptions | undefined {
    const thinking = buildThinkingProviderOptions({
      thinkingEffort: thinkingSettings.effort,
      thinkingEnabled: thinkingSettings.enabled,
    });
    const webSearch = overrides?.webSearch;
    const mergedThinking = overrides?.thinking ?? thinking;

    if (!(webSearch || mergedThinking)) {
      return;
    }

    return {
      ...(webSearch ? { webSearch } : {}),
      ...(mergedThinking ? { thinking: mergedThinking } : {}),
    };
  }

  async getTelegramSettings(
    orgId: ChannelConfigScope
  ): Promise<TelegramSettingsResponse> {
    return loadTelegramSettingsPublic(orgId);
  }

  async setTelegramSettings(
    orgId: ChannelConfigScope,
    input: UpdateTelegramSettingsRequest
  ): Promise<TelegramSettingsResponse> {
    const existing = await loadTelegramSettingsPublic(orgId);
    const botToken =
      input.botToken !== undefined && input.botToken.trim()
        ? input.botToken.trim()
        : undefined;

    if (!(botToken || existing.configured)) {
      throw new Error("Bot token is required.");
    }

    if (botToken) {
      try {
        const path = [`bot${botToken}`, "getMe"]
          .map(encodeURIComponent)
          .join("/");
        const response = await fetch(`https://api.telegram.org/${path}`, {
          signal: AbortSignal.timeout(5000),
        });
        const payload = response.ok
          ? ((await response.json()) as {
              ok?: boolean;
              result?: { is_bot?: boolean };
            })
          : null;

        if (!(payload?.ok === true && payload.result?.is_bot === true)) {
          throw new Error("Telegram rejected the bot token.");
        }
      } catch {
        throw new Error("Telegram bot token could not be validated.");
      }
    }

    const save = () =>
      saveTelegramConfig(orgId, {
        ...(botToken ? { botToken } : {}),
        ...(input.allowedUserIds === undefined
          ? existing.allowedUserIds.length > 0
            ? { allowedUserIds: existing.allowedUserIds.join(",") }
            : {}
          : { allowedUserIds: input.allowedUserIds }),
        ...(input.pairedUserIds === undefined
          ? existing.pairedUserIds.length > 0
            ? { pairedUserIds: existing.pairedUserIds.join(",") }
            : {}
          : { pairedUserIds: input.pairedUserIds }),
        ...(input.profileId === undefined
          ? {}
          : { profileId: input.profileId }),
      });
    return isChannelOwner(orgId) && this.channelWorkers
      ? this.channelWorkers.saveChannelConfig("telegram", orgId, save)
      : save();
  }
  async startTelegramPairing(
    orgId: string,
    userId: string,
    input: StartTelegramPairingRequest
  ): Promise<TelegramPairingStartResponse> {
    return telegramManagedBotPairing.start(orgId, userId, input.profileId);
  }

  async getTelegramPairingStatus(
    orgId: string,
    userId: string,
    pairingId: string,
    profileId?: string
  ): Promise<TelegramPairingStatusResponse> {
    return telegramManagedBotPairing.status(
      pairingId,
      orgId,
      userId,
      profileId
    );
  }

  cancelTelegramPairing(
    orgId: string,
    userId: string,
    pairingId: string,
    profileId?: string
  ): Promise<TelegramPairingStatusResponse> {
    return telegramManagedBotPairing.cancel(
      pairingId,
      orgId,
      userId,
      profileId
    );
  }

  async applyTelegramPairing(
    orgId: string,
    userId: string,
    pairingId: string,
    input: ApplyTelegramPairingRequest
  ): Promise<TelegramPairingStatusResponse> {
    const settings = await telegramManagedBotPairing.apply(
      pairingId,
      orgId,
      userId,
      input.profileId,
      async (saveInput) => {
        await this.setTelegramSettings(
          { orgId, profileId: input.profileId },
          saveInput
        );
      }
    );
    return settings;
  }

  async regenerateTelegramHandshake(
    orgId: ChannelConfigScope
  ): Promise<TelegramSettingsResponse> {
    return isChannelOwner(orgId) && this.channelWorkers
      ? this.channelWorkers.saveChannelConfig("telegram", orgId, () =>
          regenerateTelegramHandshake(orgId)
        )
      : regenerateTelegramHandshake(orgId);
  }

  async getDiscordSettings(
    scope: ChannelConfigScope = null
  ): Promise<DiscordSettingsResponse> {
    return loadDiscordSettingsPublic(scope);
  }

  async setDiscordSettings(
    input: UpdateDiscordSettingsRequest,
    scope: ChannelConfigScope = null
  ): Promise<DiscordSettingsResponse> {
    const existing = await loadDiscordSettingsPublic(scope);
    const botToken =
      input.botToken !== undefined && input.botToken.trim()
        ? input.botToken.trim()
        : undefined;

    if (!(botToken || existing.configured)) {
      throw new Error("Bot token is required.");
    }

    if (
      botToken &&
      !(await resolveDiscordApplicationId(botToken, { forceRefresh: true }))
    ) {
      throw new Error("Discord bot token could not be validated.");
    }

    const save = () =>
      saveDiscordConfig(
        {
          ...(botToken ? { botToken } : {}),
          ...(input.allowedUserIds === undefined
            ? existing.allowedUserIds.length > 0
              ? { allowedUserIds: existing.allowedUserIds.join(",") }
              : {}
            : { allowedUserIds: input.allowedUserIds }),
          ...(input.profileId === undefined
            ? {}
            : { profileId: input.profileId }),
        },
        scope
      );
    return isChannelOwner(scope) && this.channelWorkers
      ? this.channelWorkers.saveChannelConfig("discord", scope, save)
      : save();
  }

  async regenerateDiscordHandshake(
    scope: ChannelConfigScope = null
  ): Promise<DiscordSettingsResponse> {
    return isChannelOwner(scope) && this.channelWorkers
      ? this.channelWorkers.saveChannelConfig("discord", scope, () =>
          regenerateDiscordHandshake(scope)
        )
      : regenerateDiscordHandshake(scope);
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
    input: UpdateComposioSettingsRequest
  ): Promise<ComposioSettingsResponse> {
    const existing = await loadComposioSettingsPublic();
    const apiKey =
      input.apiKey !== undefined && input.apiKey.trim()
        ? input.apiKey.trim()
        : undefined;

    if (!(apiKey || existing.configured)) {
      throw new Error("Composio API key is required.");
    }

    if (apiKey) {
      await this.composioService?.validateConfiguration(apiKey);
      await saveComposioConfig({ apiKey });
      this.composioService?.reloadConfiguration();
    }

    return this.getComposioSettings();
  }

  async getErrorTrackingSettings(): Promise<ErrorTrackingSettingsResponse> {
    return loadErrorTrackingSettingsPublic();
  }

  async setErrorTrackingSettings(
    input: UpdateErrorTrackingSettingsRequest
  ): Promise<ErrorTrackingSettingsResponse> {
    const dsn = input.dsn?.trim() ?? "";

    if (dsn && !parseSentryDsn(dsn)) {
      throw new NakamaApiError(
        "That does not look like a Sentry-compatible DSN.",
        400
      );
    }

    await saveErrorTrackingDsn(dsn || null);
    // The flag gates whether anything is recorded at all, so it has to move with the
    // DSN or saving one would need a restart to take effect.
    await refreshErrorTrackingEnabled();
    return this.getErrorTrackingSettings();
  }

  /**
   * Sends one event immediately rather than through reportError, so a failed test does
   * not leave a fake crash sitting in the delivery queue.
   */
  async sendErrorTrackingTest(): Promise<SendErrorTrackingTestResponse> {
    const { configured } = await loadErrorTrackingSettingsPublic();

    if (!configured) {
      throw new NakamaApiError("Save a DSN first.", 400);
    }

    const delivered = await createErrorTrackingSink()(
      buildErrorReport(new Error("Test event from nakama"), {
        kind: "test",
        source: "settings",
      })
    );

    return { delivered };
  }

  async getEmailSettings(): Promise<EmailSettingsResponse> {
    return loadEmailSettingsPublic();
  }

  async setEmailSettings(
    input: UpdateEmailSettingsRequest
  ): Promise<EmailSettingsResponse> {
    return saveEmailConfig(input);
  }

  async getWebSearchSettings(): Promise<WebSearchSettingsResponse> {
    return loadWebSearchSettingsPublic();
  }

  async setWebSearchSettings(
    input: UpdateWebSearchSettingsRequest
  ): Promise<WebSearchSettingsResponse> {
    const settings = await saveWebSearchConfig(input);

    // Sessions cache their resolved tool list, so the swap between hosted and
    // custom search only takes effect once they are rebuilt.
    this.sessions.clear();

    return settings;
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

    const sender = createSmtpSender(toMailboxConfig(config));
    const result = await sender.send({
      subject: "Nakama test email",
      text: "This is a test email from your Nakama deployment.",
      to,
    });

    return {
      messageId: result.messageId,
      ok: true,
      to,
    };
  }

  async getAgentBrowserStatus(): Promise<AgentBrowserStatusResponse> {
    return getAgentBrowserStatus();
  }

  async getWhatsAppSettings(
    orgId: ChannelConfigScope
  ): Promise<WhatsAppSettingsResponse> {
    return loadWhatsAppSettingsPublic(orgId);
  }

  async setWhatsAppSettings(
    orgId: ChannelConfigScope,
    input: UpdateWhatsAppSettingsRequest
  ): Promise<WhatsAppSettingsResponse> {
    const profileId = isChannelOwner(orgId)
      ? orgId.profileId
      : input.profileId?.trim();
    const resolvedProfileId =
      profileId === "default"
        ? await this.resolveSessionProfile(
            isChannelOwner(orgId) ? orgId.orgId : orgId!
          )
        : profileId;
    if (resolvedProfileId) {
      await this.requireProfile(
        isChannelOwner(orgId) ? orgId.orgId : orgId!,
        resolvedProfileId
      );
    }
    const save = () =>
      saveWhatsAppConfig(
        {
          ...(input.allowedPhones === undefined
            ? {}
            : { allowedPhones: input.allowedPhones }),
          ...(input.phoneNumber === undefined
            ? {}
            : { phoneNumber: input.phoneNumber.trim() }),
          ...(resolvedProfileId === undefined
            ? {}
            : { profileId: resolvedProfileId }),
          ...(input.requireGroupMention === undefined
            ? {}
            : { requireGroupMention: input.requireGroupMention }),
        },
        orgId
      );
    return isChannelOwner(orgId) && this.channelWorkers
      ? this.channelWorkers.saveChannelConfig("whatsapp", orgId, save)
      : save();
  }

  async regenerateWhatsAppPairingCode(
    orgId: ChannelConfigScope
  ): Promise<WhatsAppSettingsResponse> {
    return isChannelOwner(orgId) && this.channelWorkers
      ? this.channelWorkers.saveChannelConfig("whatsapp", orgId, () =>
          regenerateWhatsAppPairingCode(orgId)
        )
      : regenerateWhatsAppPairingCode(orgId);
  }

  async runAutomationPrompt(
    orgId: string,
    profileId: string,
    prompt: string,
    automationId?: string,
    automationRunId?: string
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
      "member"
    );
    const userTimezone = await this.getUserTimezone();
    const userContext = await this.loadUserContextForUser(orgId, undefined);
    const harness = this.createHarnessForProfile(profile);

    const session = createAgentChatSession(harness, {
      channel: "automation",
      enableToolLoop: true,
      soul: soulActive,
      systemPrompt,
      toolContext: buildToolExecutionContext({
        assertCanStartLlmTurn: this.llmTurnQuotaCheckerFor(orgId),
        automationId,
        ...this.memoryBackend.toolContext(orgId, profileId),
        automationRunId,
        orgId,
        orgRole: "member",
        profileId,
        recordToolOutputSavings: this.savingsRecorderFor(orgId),
        recordTurnUsage: this.turnUsageRecorderFor(orgId),
      }),
      tools,
      userContext,
      userTimezone,
    });

    return session.send(prompt);
  }

  async resolvePluginExecutionTools(
    orgId: string,
    profileId: string
  ): Promise<ToolDefinition[]> {
    const profile = await this.requireProfile(orgId, profileId);
    const tools = await this.resolveProfileTools(profile, {
      includeAutomationTools: false,
      includeSkillManageTools: false,
      includeTodoTools: false,
    });
    return partitionTools(tools).localTools;
  }

  buildPluginToolContext(
    orgId: string,
    context: {
      profileId: string;
      runId: string;
      workflowId: string;
    }
  ): ToolContext {
    return buildToolExecutionContext({
      ...this.memoryBackend.toolContext(orgId, context.profileId),
      assertCanStartLlmTurn: this.llmTurnQuotaCheckerFor(orgId),
      orgId,
      orgRole: "member",
      profileId: context.profileId,
      recordToolOutputSavings: this.savingsRecorderFor(orgId),
      recordTurnUsage: this.turnUsageRecorderFor(orgId),
      workflowId: context.workflowId,
      workflowRunId: context.runId,
    });
  }

  async runPluginSummarize(
    orgId: string,
    profileId: string,
    prompt: string,
    receiptBag: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string> {
    if (!this._providerConfigured) {
      throw new Error("Provider is not configured.");
    }

    const profile = await this.requireProfile(orgId, profileId);
    const { systemPrompt, soulActive } = await this.resolveProfileSystemPrompt(
      orgId,
      profileId,
      profile.systemPrompt,
      "member"
    );
    const userTimezone = await this.getUserTimezone();
    const userContext = await this.loadUserContextForUser(orgId, undefined);
    const harness = this.createHarnessForProfile(profile);
    const userMessage = [
      "Workflow receipts (only source of truth — do not invent values):",
      "```json",
      JSON.stringify(receiptBag, null, 2),
      "```",
      "",
      prompt.trim(),
    ].join("\n");

    const session = createAgentChatSession(harness, {
      channel: "automation",
      enableToolLoop: false,
      soul: soulActive,
      systemPrompt,
      toolContext: buildToolExecutionContext({
        assertCanStartLlmTurn: this.llmTurnQuotaCheckerFor(orgId),
        orgId,
        orgRole: "member",
        profileId,
        recordToolOutputSavings: this.savingsRecorderFor(orgId),
        recordTurnUsage: this.turnUsageRecorderFor(orgId),
      }),
      tools: [],
      userContext,
      userTimezone,
    });

    return session.sendStream(userMessage, { onChunk() {} }, { signal });
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
      includeQuestionTools: false,
      includeSubAgentTool: false,
      includeTodoTools: false,
      userId: input.userId,
    });
    const { systemPrompt, soulActive } = await this.resolveProfileSystemPrompt(
      input.orgId,
      input.profileId,
      profile.systemPrompt,
      input.orgRole
    );
    const childSystemPrompt = [
      systemPrompt.trim(),
      "",
      "You are running as a focused sub-agent delegated from a parent conversation.",
      "Complete the assigned task and return a clear final answer.",
      "Do not spawn sub-agents.",
    ].join("\n");
    const userTimezone = await this.getUserTimezone();
    const userContext = await this.loadUserContextForUser(
      input.orgId,
      input.userId
    );
    const harness = this.createHarnessForProfile(profile);
    const prompt = buildSubAgentPrompt(task, input.context);

    const session = createAgentChatSession(harness, {
      channel: "subagent",
      enableToolLoop: true,
      soul: soulActive,
      systemPrompt: childSystemPrompt,
      toolContext: buildToolExecutionContext({
        agentDepth: input.agentDepth,
        ...this.memoryBackend.toolContext(input.orgId, input.profileId),
        assertCanStartLlmTurn: this.llmTurnQuotaCheckerFor(input.orgId),
        clientOrigin: input.clientOrigin,
        orgId: input.orgId,
        orgRole: input.orgRole,
        profileId: input.profileId,
        recordToolOutputSavings: this.savingsRecorderFor(input.orgId),
        recordTurnUsage: this.turnUsageRecorderFor(input.orgId),
        sessionId: input.sessionId,
        userId: input.userId,
      }),
      tools,
      userContext,
      userTimezone,
    });

    let sawPlanning = false;
    let sawWriting = false;

    const emitActivity = (label: string) => {
      input.onActivity?.(label);
    };

    emitActivity("Starting…");

    const sendPromise = session
      .sendStream(prompt, {
        onChunk: () => {
          if (sawWriting) {
            return;
          }

          sawWriting = true;
          emitActivity("Writing answer…");
        },
        onThinking: () => {
          if (sawPlanning) {
            return;
          }

          sawPlanning = true;
          emitActivity("Planning…");
        },
        onToolStart: (event) => {
          emitActivity(formatToolActivityLabel(event.tool, event.input));
        },
      })
      .then((reply) => ({
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
        `[sub_agent] timeout org=${input.orgId} profile=${input.profileId} durationMs=${durationMs}`
      );
      return buildSubAgentResult("timeout", "", "Sub-agent timed out.");
    }

    if (!outcome.reply) {
      console.info(
        `[sub_agent] fail org=${input.orgId} profile=${input.profileId} durationMs=${durationMs} reason=empty_reply`
      );
      return buildSubAgentResult(
        "fail",
        "",
        "Sub-agent returned no final reply."
      );
    }

    console.info(
      `[sub_agent] success org=${input.orgId} profile=${input.profileId} durationMs=${durationMs}`
    );
    return buildSubAgentResult("success", outcome.reply);
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
    orgId: string,
    channel: AgentChannel,
    profileId?: string,
    userId?: string | null,
    options?: CreateSessionOptions
  ): Promise<string> {
    const resolvedProfileId = await this.resolveSessionProfile(
      orgId,
      profileId
    );
    const profile = await this.requireProfile(orgId, resolvedProfileId);
    this.assertChatProfileAccess(profile, options ?? {});

    const sessionId = nanoid();
    const modelOverride = this.normalizeSessionModelOverride(options?.model);
    const cognito = options?.cognito;
    const record: StoredSessionRecord = {
      agentQuestionnaire: null,
      agentTodos: [],
      appUserId: options?.appUserId ?? null,
      channel,
      createdAt: new Date().toISOString(),
      id: sessionId,
      model: modelOverride,
      profileId: resolvedProfileId,
      title: null,
      userId: userId ?? null,
    };

    // A cognito session skips this row on purpose. Without it there is nothing
    // for session_messages to hang off, so the conversation cannot be
    // persisted even by a path that forgets to check.
    if (!cognito) {
      await this.db.upsertSession(record);
    }

    const session = await this.buildChatSession(
      channel,
      orgId,
      resolvedProfileId,
      sessionId,
      modelOverride,
      userId ?? null,
      options?.orgRole,
      options?.isPlatformAdmin,
      options?.codingWorkspaceRoot,
      cognito ? {} : undefined,
      options?.appUserId
    );

    if (cognito) {
      await this.ephemeralSessions.set({
        attachmentIds: new Set(),
        lastActiveAt: Date.now(),
        record,
        session,
      });

      return sessionId;
    }

    this.sessions.set(sessionId, {
      channel,
      pluginRevision: await this.pluginCapabilityRevision(orgId),
      profileId: resolvedProfileId,
      session,
    });

    return sessionId;
  }

  async assertSessionProfileAccess(
    sessionId: string,
    orgId: string,
    access: ChatProfileAccess,
    appUserId?: string,
    requireAppUser = false
  ): Promise<void> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);
    if (
      record &&
      requireAppUser &&
      (!appUserId || record.appUserId !== appUserId)
    ) {
      throw new NakamaApiError("Session not found", 404);
    }
    // A missing session is left to the route, which still answers 404.
    if (record) {
      this.assertChatProfileAccess(
        await this.requireProfile(orgId, record.profileId),
        access
      );
    }
  }

  async readChatImageAttachment(
    orgId: string,
    attachmentId: string,
    access: ChatProfileAccess
  ): Promise<LoadedAttachmentBytes | null> {
    const record = await this.db.getAttachment(attachmentId);
    if (!record || record.orgId !== orgId || record.kind !== "image") {
      return null;
    }
    this.assertChatProfileAccess(
      await this.requireProfile(orgId, record.profileId),
      access
    );
    return createAttachmentLoader(this.db, {
      orgId,
      profileId: record.profileId,
    })(attachmentId);
  }

  private assertChatProfileAccess(
    profile: StoredProfileRecord,
    access: ChatProfileAccess
  ): void {
    if (
      profile.isSuper &&
      (access.excludeSuperBot || !canAccessSuperBotProfile(access))
    ) {
      throw new NakamaApiError(
        "Super Bot is only available to org admins.",
        403
      );
    }
  }

  /**
   * Cognito attachments carry a null session_id, so the tracked ids are the
   * only handle on them. Runs when the session is deleted and when an idle
   * one is evicted.
   */
  private async purgeEphemeralAttachments(
    entry: EphemeralSession
  ): Promise<void> {
    entry.session.clear();
    this.superBotSessionState.clearSession(entry.record.id);
    this.agentTodoState.clearSession(entry.record.id);
    this.agentQuestionnaireState.clearSession(entry.record.id);

    for (const attachmentId of entry.attachmentIds) {
      const attachment = await this.db.getAttachment(attachmentId);

      if (!attachment) {
        continue;
      }

      await deleteAttachmentBytes(
        attachment.orgId ?? "",
        attachment.profileId,
        attachment.id
      );
      await this.db.deleteAttachment(attachment.id);
    }
  }

  /**
   * A model change needs a new provider, which means a new session object. The
   * conversation only exists in the old one, so it is carried across by hand.
   */
  private async rebuildEphemeralSession(
    entry: EphemeralSession,
    orgId: string,
    model: string | null
  ): Promise<boolean> {
    const channel = parseAgentChannel(entry.record.channel);

    if (!channel) {
      return false;
    }

    const { isPlatformAdmin, orgRole } = await this.resolveSessionAccess(
      orgId,
      entry.record.userId
    );
    const session = await this.buildChatSession(
      channel,
      orgId,
      entry.record.profileId,
      entry.record.id,
      model,
      entry.record.userId ?? null,
      orgRole,
      isPlatformAdmin,
      undefined,
      { initialHistory: [...entry.session.getHistory()] },
      entry.record.appUserId
    );

    entry.record.model = model;
    entry.session = session;
    await this.ephemeralSessions.set(entry);
    return true;
  }

  /**
   * A hard restart drops the in-memory map before its entries can be evicted,
   * which leaves attachment rows and files nothing will ever claim.
   */
  async sweepEphemeralAttachments(): Promise<number> {
    const leftovers = await this.db.listEphemeralAttachments();

    for (const attachment of leftovers) {
      await deleteAttachmentBytes(
        attachment.orgId ?? "",
        attachment.profileId,
        attachment.id
      );
      await this.db.deleteAttachment(attachment.id);
    }

    return leftovers.length;
  }

  async getSessionTodos(
    sessionId: string,
    orgId: string
  ): Promise<AgentTodo[] | null> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);

    if (!record) {
      return null;
    }

    return this.agentTodoState.listActive(sessionId);
  }

  async getSessionQuestionnaire(
    sessionId: string,
    orgId: string
  ): Promise<AgentQuestionnaire | null> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);

    if (!record) {
      return null;
    }

    return this.agentQuestionnaireState.get(sessionId);
  }

  async getSessionMessages(
    sessionId: string,
    orgId: string,
    options?: { persistedOnly?: boolean }
  ): Promise<{
    channel: AgentChannel;
    messages: ChatMessage[];
    messageMeta: Array<{ id: string; seq: number; createdAt: string }>;
    contextUsage: ChatContextUsage | null;
    model: string | null;
    profileId: string;
  } | null> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);

    if (!record) {
      return null;
    }

    const channel = parseAgentChannel(record.channel);

    if (!channel) {
      return null;
    }

    // Live history is the only history a cognito session has, so it answers
    // here whether or not a turn is in flight.
    if (
      this.ephemeralSessions.has(sessionId) ||
      (!options?.persistedOnly && sessionTurnRegistry.isActive(sessionId))
    ) {
      const liveSession = await this.resolveSession(sessionId, orgId);

      if (liveSession) {
        const history = liveSession.getHistory();
        const startedAt =
          sessionTurnRegistry.getStatus(sessionId).startedAt ??
          new Date().toISOString();

        return {
          channel,
          contextUsage: liveSession.getContextUsage(),
          messageMeta: history.map((_, index) => ({
            createdAt: startedAt,
            id: `live-${index}`,
            seq: index,
          })),
          messages: [...history],
          model: record.model,
          profileId: record.profileId,
        };
      }
    }

    const storedMessages = await this.db.listMessagesForSession(sessionId);
    const cached = this.sessions.get(sessionId)?.session;
    const contextUsage = options?.persistedOnly
      ? null
      : cached
        ? cached.getContextUsage()
        : ((await this.resolveSession(sessionId, orgId))?.getContextUsage() ??
          null);

    return {
      channel,
      contextUsage,
      messageMeta: storedMessages.map((message) => ({
        createdAt: message.createdAt,
        id: message.id,
        seq: message.seq,
      })),
      messages: storedMessages.map((message) => message.payload as ChatMessage),
      model: record.model,
      profileId: record.profileId,
    };
  }

  async branchSession(
    sessionId: string,
    messageIndex: number,
    orgId: string
  ): Promise<BranchSessionResponse | null> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);

    if (!record) {
      return null;
    }

    if (!Number.isInteger(messageIndex) || messageIndex < 0) {
      throw new NakamaApiError(
        "messageIndex must be a non-negative integer.",
        400
      );
    }

    const sourceMessages = await loadSessionHistory(this.db, sessionId);

    if (messageIndex >= sourceMessages.length) {
      throw new NakamaApiError("messageIndex is out of bounds.", 400);
    }

    const nextSessionId = nanoid();
    const sourceTitle = record.title?.trim();
    const branchTitle = sourceTitle
      ? `${sourceTitle} (Branch)`
      : "Untitled (Branch)";

    await this.db.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      appUserId: record.appUserId ?? null,
      channel: record.channel,
      createdAt: new Date().toISOString(),
      id: nextSessionId,
      model: record.model,
      profileId: record.profileId,
      title: null,
      userId: record.userId ?? null,
    });

    await copySessionHistoryArchive(this.db, orgId, sessionId, nextSessionId);
    await replaceSessionHistory(
      this.db,
      nextSessionId,
      sourceMessages.slice(0, messageIndex + 1)
    );
    await this.db.updateSessionTitle(nextSessionId, branchTitle);

    const channel = parseAgentChannel(record.channel);

    if (!channel) {
      throw new Error("Session channel is invalid.");
    }

    const { orgId: profileOrgId } = await this.requireProfileRecord(
      record.profileId
    );

    const { isPlatformAdmin: branchIsPlatformAdmin, orgRole: branchOrgRole } =
      await this.resolveSessionAccess(profileOrgId, record.userId);
    const session = await this.buildChatSession(
      channel,
      profileOrgId,
      record.profileId,
      nextSessionId,
      record.model,
      record.userId ?? null,
      branchOrgRole,
      branchIsPlatformAdmin,
      undefined,
      undefined,
      record.appUserId
    );
    this.sessions.set(nextSessionId, {
      channel,
      pluginRevision: await this.pluginCapabilityRevision(profileOrgId),
      profileId: record.profileId,
      session,
    });

    return { sessionId: nextSessionId };
  }

  async listSessions(
    orgId: string,
    profileId: string,
    channels: AgentChannel | readonly AgentChannel[],
    access: ChatProfileAccess,
    appUserId?: string,
    page?: { cursor?: string; limit: number },
    query?: string
  ): Promise<ListSessionsResponse> {
    this.assertChatProfileAccess(
      await this.requireProfile(orgId, profileId),
      access
    );

    const cursor = page?.cursor ? decodeSessionCursor(page.cursor) : undefined;
    const rows = await this.db.listSessionSummaries(
      profileId,
      typeof channels === "string" ? [channels] : channels,
      {
        after: cursor,
        appUserId,
        // One row past the page tells whether another page follows.
        limit: page ? page.limit + 1 : undefined,
        query,
      }
    );

    if (!page) {
      return { sessions: rows.map(toSessionSummary) };
    }

    const sessions = rows.slice(0, page.limit);
    const last = sessions.at(-1);
    return {
      nextCursor:
        rows.length > page.limit && last ? encodeSessionCursor(last) : null,
      sessions: sessions.map(toSessionSummary),
      // A cursor is issued only with a row after it, and the rows above it keep
      // their count while none cross it. Anything else means chats moved across
      // it since the previous page, which then no longer joins this one.
      stale: cursor ? sessions[0]?.position !== cursor.position + 1 : false,
    };
  }

  async getSessionSummary(
    sessionId: string,
    orgId: string
  ): Promise<SessionSummary | null> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);
    if (!record) {
      return null;
    }

    const [session] = await this.db.listSessionSummaries(
      record.profileId,
      [record.channel],
      { sessionId }
    );
    return session ? toSessionSummary(session) : null;
  }

  scheduleSessionTitleGeneration(sessionId: string): void {
    // A cognito session has no row to title, and generating one would spend a
    // turn summarising a conversation that is meant to leave no trace.
    if (this.ephemeralSessions.has(sessionId)) {
      return;
    }

    this.sessionTitleService.scheduleSessionTitleGeneration(sessionId);
  }

  schedulePostTurnSkillReview(sessionId: string): void {
    // The review writes skill suggestions, which is exactly the write-back a
    // cognito session promises not to do.
    if (this.ephemeralSessions.has(sessionId)) {
      return;
    }

    this.skillPostTurnReviewService.schedulePostTurnSkillReview(sessionId);
  }

  getSkillPostTurnReviewService(): SkillPostTurnReviewService {
    return this.skillPostTurnReviewService;
  }

  async purgeSession(sessionId: string, orgId: string): Promise<boolean> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);

    if (!record) {
      return false;
    }

    if (await this.ephemeralSessions.delete(sessionId)) {
      return true;
    }

    this.sessions.get(sessionId)?.session.clear();
    this.sessions.delete(sessionId);
    this.superBotSessionState.clearSession(sessionId);
    this.agentTodoState.clearSession(sessionId);
    this.agentQuestionnaireState.clearSession(sessionId);
    await deleteSessionHistoryArchive(orgId, sessionId);
    const attachments = await this.db.listAttachmentsForSession(sessionId);
    for (const attachment of attachments) {
      await deleteAttachmentBytes(orgId, attachment.profileId, attachment.id);
      await this.db.deleteAttachment(attachment.id);
    }
    await this.db.deleteSession(sessionId);
    return true;
  }

  async resolveSession(
    sessionId: string,
    orgId: string
  ): Promise<AgentChatSession | null> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);

    if (!record) {
      return null;
    }

    // Never rebuilt: the history only exists inside this object, so dropping
    // it to pick up a config change would silently empty the conversation.
    const ephemeral = this.ephemeralSessions.get(sessionId);

    if (ephemeral) {
      return ephemeral.session;
    }

    const stored = this.sessions.get(sessionId);
    const pluginRevision = await this.pluginCapabilityRevision(orgId);

    if (stored && stored.pluginRevision === pluginRevision) {
      return stored.session;
    }

    if (stored) {
      this.sessions.delete(sessionId);
    }

    const channel = parseAgentChannel(record.channel);

    if (!channel) {
      return null;
    }

    const { orgId: profileOrgId } = await this.requireProfileRecord(
      record.profileId
    );

    const { isPlatformAdmin: resumeIsPlatformAdmin, orgRole: resumeOrgRole } =
      await this.resolveSessionAccess(profileOrgId, record.userId);
    const session = await this.buildChatSession(
      channel,
      profileOrgId,
      record.profileId,
      sessionId,
      record.model,
      record.userId ?? null,
      resumeOrgRole,
      resumeIsPlatformAdmin,
      undefined,
      undefined,
      record.appUserId
    );

    this.sessions.set(sessionId, {
      channel,
      pluginRevision,
      profileId: record.profileId,
      session,
    });

    return session;
  }

  async updateSessionModel(
    sessionId: string,
    orgId: string,
    model: string | null
  ): Promise<boolean> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);

    if (!record) {
      return false;
    }

    const turn = sessionTurnRegistry.beginTurn(sessionId);
    if (!turn.started) {
      throw new NakamaApiError(
        "Wait for the current response before changing models.",
        409
      );
    }

    try {
      const normalizedModel = this.normalizeSessionModelOverride(model);
      if (record.model === normalizedModel) {
        return true;
      }

      const ephemeral = this.ephemeralSessions.get(sessionId);

      if (ephemeral) {
        return await this.rebuildEphemeralSession(
          ephemeral,
          orgId,
          normalizedModel
        );
      }

      const updated = await this.db.updateSessionModel(
        sessionId,
        normalizedModel
      );

      if (updated) {
        this.sessions.delete(sessionId);
      }

      return updated;
    } finally {
      sessionTurnRegistry.cancelTurn(sessionId);
    }
  }
  async renameSession(
    sessionId: string,
    orgId: string,
    title: string
  ): Promise<boolean> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);
    if (!record) {
      return false;
    }

    return this.db.renameSessionTitle(sessionId, title.trim());
  }

  async updateSessionPinned(
    sessionId: string,
    orgId: string,
    pinned: boolean
  ): Promise<boolean> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);
    if (!record) {
      return false;
    }

    return this.db.updateSessionPinned(sessionId, pinned);
  }

  async beginSessionTurn(
    sessionId: string,
    orgId: string
  ): Promise<boolean | null> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);
    if (!record) {
      return null;
    }

    const cached = this.sessions.get(sessionId);
    const pluginRevision = await this.pluginCapabilityRevision(orgId);
    if (cached && cached.pluginRevision !== pluginRevision) {
      this.sessions.delete(sessionId);
    }

    return sessionTurnRegistry.beginTurn(sessionId).started;
  }

  async clearSession(sessionId: string, orgId: string): Promise<boolean> {
    const record = await this.getSessionRecordForOrg(sessionId, orgId);

    if (!record) {
      return false;
    }

    // Clearing a cognito session is the same as ending it: there is no
    // durable copy to keep the id pointing at.
    if (await this.ephemeralSessions.delete(sessionId)) {
      await this.agentQuestionnaireState.clear(sessionId);
      return true;
    }

    const stored = this.sessions.get(sessionId);

    if (stored) {
      stored.session.clear();
    }

    await deleteSessionHistoryArchive(orgId, sessionId);
    await this.db.deleteMessagesForSession(sessionId);
    await this.agentQuestionnaireState.clear(sessionId);
    return true;
  }

  async compactSession(
    sessionId: string,
    options: { force?: boolean } = {},
    orgId: string
  ): Promise<CompactionResponse | null> {
    const session = await this.resolveSession(sessionId, orgId);

    if (!session) {
      return null;
    }

    return session.compact(options);
  }

  async draftAutomation(prompt: string, channel: AgentChannel) {
    if (!this._providerConfigured) {
      throw new Error("Provider is not configured.");
    }

    return createAutomationFromPrompt(this.harness, { channel, prompt });
  }

  async discoverModels(
    request: DiscoverModelsRequest
  ): Promise<ModelsResponse> {
    const providerId = request.providerId?.trim();
    if (providerId) {
      return this.discoverModelsForProvider(providerId, {
        apiKey: request.apiKey,
        baseUrl: request.baseUrl?.trim() || undefined,
        hostMode: request.hostMode,
      });
    }

    if (request.provider === "fireworks") {
      const apiKey = request.apiKey?.trim() ?? "";

      if (!apiKey) {
        throw new NakamaApiError(
          "API key is required to discover Fireworks models.",
          400
        );
      }

      const entries = await fetchFireworksGatewayModels(apiKey);
      const staticModels = AVAILABLE_MODELS.filter(
        (model) => model.provider === "fireworks"
      );
      const models = catalogCustomModelsToCatalog(
        entries,
        staticModels,
        "fireworks"
      );
      const probeInstance = {
        apiKey,
        createdAt: new Date(0).toISOString(),
        customModels: entries,
        id: "discover",
        label: "Fireworks",
        type: "fireworks" as const,
      };

      return {
        catalog: AVAILABLE_MODELS,
        currentProviderId: null,
        customModels: entries,
        displayName: null,
        models: models.length
          ? models
          : getModelsForProviderInstance(probeInstance),
        provider: "fireworks",
        providers: [],
      };
    }

    const baseUrl = request.baseUrl?.trim();
    if (!baseUrl) {
      throw new NakamaApiError("baseUrl or providerId is required.", 400);
    }

    const entries =
      request.provider === "ollama"
        ? await fetchOllamaModels(baseUrl, request.apiKey ?? "")
        : await fetchRemoteOpenAIModels(baseUrl, request.apiKey ?? "");

    const probeType =
      request.provider === "ollama"
        ? ("ollama" as const)
        : ("openai_compatible" as const);
    const probeInstance = {
      apiKey: request.apiKey ?? "",
      baseUrl,
      id: "discover",
      label: probeType === "ollama" ? "Ollama" : "Discover",
      type: probeType,
      ...(request.hostMode ? { hostMode: request.hostMode } : {}),
      createdAt: new Date(0).toISOString(),
      customModels: entries,
    };
    const models = getModelsForProviderInstance(probeInstance);

    return {
      catalog: AVAILABLE_MODELS,
      currentProviderId: null,
      customModels: entries,
      displayName: null,
      models,
      provider: probeType,
      providers: [],
    };
  }

  async discoverModelsForProvider(
    providerId: string,
    overrides?: {
      baseUrl?: string;
      apiKey?: string;
      hostMode?: DiscoverModelsRequest["hostMode"];
    }
  ): Promise<ModelsResponse> {
    const instance = findProviderInstance(
      this.userConfig ?? { defaultProviderId: null, providers: [] },
      providerId
    );

    if (!instance) {
      throw new NakamaApiError("Provider not found.", 404);
    }

    if (instance.type === "ollama" || instance.type === "openai_compatible") {
      const hostMode =
        instance.type === "ollama"
          ? (overrides?.hostMode ?? resolveOllamaHostMode(instance))
          : undefined;
      const apiKey =
        overrides?.apiKey?.trim() ||
        instance.apiKey.trim() ||
        (instance.type === "ollama"
          ? readEnvValue(
              process.env,
              apiKeyEnvVarForProvider("ollama") ?? ""
            ) || ""
          : "");

      if (
        instance.type === "ollama" &&
        ollamaRequiresApiKey(hostMode!) &&
        !apiKey.trim()
      ) {
        throw new NakamaApiError(
          "Add an API key before discovering Ollama Cloud models.",
          400
        );
      }

      // Prefer an explicit baseUrl (e.g. unsaved Edit provider field) over the stored one.
      const baseUrl =
        overrides?.baseUrl ||
        instance.baseUrl?.trim() ||
        (instance.type === "ollama" ? defaultOllamaBaseUrl(hostMode!) : "");

      if (!baseUrl) {
        throw new NakamaApiError(
          "A base URL is required to discover models.",
          400
        );
      }

      const entries =
        instance.type === "ollama"
          ? await fetchOllamaModels(baseUrl, apiKey)
          : await fetchRemoteOpenAIModels(baseUrl, apiKey);
      const remoteInstance = { ...instance, baseUrl, customModels: entries };
      const models = getModelsForProviderInstance(remoteInstance);

      return {
        baseUrl,
        catalog: AVAILABLE_MODELS,
        currentProviderId: providerId,
        customModels: entries,
        displayName: instance.label,
        models,
        provider: instance.type,
        providers: [],
      };
    }

    if (instance.type === "fireworks") {
      const apiKey =
        instance.apiKey.trim() ||
        readEnvValue(process.env, apiKeyEnvVarForProvider("fireworks") ?? "") ||
        "";

      if (!apiKey.trim()) {
        throw new NakamaApiError(
          "Add an API key before discovering Fireworks models.",
          400
        );
      }

      const entries = await fetchFireworksGatewayModels(apiKey);
      const remoteInstance = { ...instance, customModels: entries };
      const models = getModelsForProviderInstance(remoteInstance);

      return {
        catalog: AVAILABLE_MODELS,
        currentProviderId: providerId,
        customModels: entries,
        displayName: instance.label,
        models,
        provider: "fireworks",
        providers: [],
      };
    }

    if (instance.type === "xai_oauth") {
      const oauth = await resolveXaiOAuthCredentials(
        () =>
          readXaiOAuthFromInstance(
            findProviderInstance(this.userConfig, providerId)
          ),
        (refreshed) => this.persistXaiOAuth(providerId, refreshed)
      );

      const entries = await fetchXaiOAuthModels(oauth);
      const models = catalogCustomModelsToCatalog(entries, [], "xai_oauth");

      return {
        catalog: AVAILABLE_MODELS,
        currentProviderId: providerId,
        customModels: entries,
        displayName: instance.label,
        models,
        provider: "xai_oauth",
        providers: [],
      };
    }
    if (instance.type === "chatgpt") {
      let oauth = readChatgptOAuthFromInstance(instance);

      if (!oauth) {
        throw new NakamaApiError(
          "Sign in with ChatGPT before discovering models.",
          400
        );
      }

      if (chatgptOAuthNeedsRefresh(oauth)) {
        oauth = await refreshChatgptOAuthToken(oauth.refreshToken);
        await this.persistChatgptOAuth(providerId, oauth);
      }

      const entries = await fetchChatgptCodexModels(oauth, (refreshed) =>
        this.persistChatgptOAuth(providerId, refreshed)
      );
      const models = catalogCustomModelsToCatalog(entries, [], "chatgpt");

      return {
        catalog: AVAILABLE_MODELS,
        currentProviderId: providerId,
        customModels: entries,
        displayName: instance.label,
        models,
        provider: "chatgpt",
        providers: [],
      };
    }

    if (instance.type !== "openai") {
      throw new NakamaApiError(
        `Remote model discovery is not supported for ${instance.type}.`,
        400
      );
    }

    if (!instance.apiKey.trim()) {
      throw new NakamaApiError(
        "Add an API key before discovering models.",
        400
      );
    }

    const baseUrl = instance.baseUrl?.trim() || "https://api.openai.com/v1";
    const entries = await fetchRemoteOpenAIModels(baseUrl, instance.apiKey);
    const staticModels = AVAILABLE_MODELS.filter(
      (model) => model.provider === "openai"
    );
    const models = catalogCustomModelsToCatalog(
      entries,
      staticModels,
      "openai"
    );

    return {
      catalog: AVAILABLE_MODELS,
      currentProviderId: providerId,
      displayName: null,
      models,
      provider: "openai",
      providers: [],
    };
  }

  async listProviders(): Promise<ListProvidersResponse> {
    const providers = this.userConfig?.providers ?? [];

    return {
      defaultProviderId: this.userConfig?.defaultProviderId ?? null,
      providers: providers.map((instance) =>
        toProviderInstanceSummary(instance, countModelsForInstance(instance))
      ),
    };
  }

  async createProvider(
    request: CreateProviderRequest
  ): Promise<CreateProviderResponse> {
    const existing = this.userConfig?.providers ?? [];
    const instance = buildProviderInstanceFromCreateRequest(request, existing);
    const model = resolveInitialModel(instance, request.model);
    if (instance.type === "gemini") {
      const provider = createProviderForInstance(instance, model);
      if (!provider) {
        throw new Error("Gemini provider could not be initialized.");
      }
      await provider.generateText({
        format: "text",
        prompt: "Reply with OK.",
        system: "Reply with OK.",
      });
    }
    const providers = [...existing, instance];
    const isFirst = providers.length === 1;
    const thinking = await this.resolveThinkingSettings();
    const baseConfig = this.userConfig ?? {
      defaultProviderId: null,
      providers: [],
      thinkingEffort: thinking.effort,
      thinkingEnabled: thinking.enabled,
    };

    this.userConfig = {
      ...baseConfig,
      defaultProviderId:
        isFirst || !baseConfig.defaultProviderId
          ? instance.id
          : baseConfig.defaultProviderId,
      providers,
    };

    await saveUserConfig(this.userConfig);
    this.refreshHarness();

    if (isFirst) {
      await this.ensureSoulScaffolded();
    }

    return {
      defaultProviderId: this.userConfig.defaultProviderId!,
      initialModel: model,
      provider: toProviderInstanceSummary(
        instance,
        countModelsForInstance(instance)
      ),
    };
  }

  async updateProvider(
    providerId: string,
    request: UpdateProviderRequest
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
      instance.id === providerId ? updated : instance
    );

    this.userConfig = { ...this.userConfig, providers };
    await saveUserConfig(this.userConfig);
    this.refreshHarness();

    return {
      provider: toProviderInstanceSummary(
        updated,
        countModelsForInstance(updated)
      ),
    };
  }

  async deleteProvider(providerId: string): Promise<DeleteProviderResponse> {
    if (!this.userConfig) {
      throw new Error("Provider is not configured.");
    }

    const providers = this.userConfig.providers.filter(
      (instance) => instance.id !== providerId
    );

    if (providers.length === this.userConfig.providers.length) {
      throw new Error("Provider not found.");
    }

    let defaultProviderId = this.userConfig.defaultProviderId;

    if (defaultProviderId === providerId) {
      defaultProviderId = providers[0]?.id ?? null;
    }

    this.userConfig = {
      ...this.userConfig,
      defaultProviderId,
      providers,
    };

    await saveUserConfig(this.userConfig);
    this.refreshHarness();

    return { defaultProviderId };
  }

  async persistXaiOAuth(
    providerId: string,
    oauth: XaiOAuthCredentials
  ): Promise<void> {
    if (!this.userConfig) {
      throw new Error("Provider is not configured.");
    }

    const current = findProviderInstance(this.userConfig, providerId);

    if (!current || current.type !== "xai_oauth") {
      throw new Error("Grok provider not found.");
    }

    const updated = applyXaiOAuthToInstance(current, oauth);
    this.userConfig = {
      ...this.userConfig,
      providers: this.userConfig.providers.map((instance) =>
        instance.id === providerId ? updated : instance
      ),
    };
    await saveUserConfig(this.userConfig);
    this.refreshHarness();
  }
  async persistChatgptOAuth(
    providerId: string,
    oauth: ChatgptOAuthCredentials
  ): Promise<void> {
    if (!this.userConfig) {
      throw new Error("Provider is not configured.");
    }

    const current = findProviderInstance(this.userConfig, providerId);

    if (!current || current.type !== "chatgpt") {
      throw new Error("ChatGPT provider not found.");
    }

    const updated = applyChatgptOAuthToInstance(current, oauth);
    this.userConfig = {
      ...this.userConfig,
      providers: this.userConfig.providers.map((instance) =>
        instance.id === providerId ? updated : instance
      ),
    };
    await saveUserConfig(this.userConfig);
    this.refreshHarness();
  }

  async getModels(
    options: { source?: "catalog" | "remote" } = {}
  ): Promise<ModelsResponse> {
    const active = getActiveProviderInstance(this.userConfig);
    const currentProviderId = this.userConfig?.defaultProviderId ?? null;
    const configuredProviders = this.userConfig?.providers ?? [];
    const providers = configuredProviders.map((instance) =>
      toProviderInstanceSummary(instance, countModelsForInstance(instance))
    );

    if (configuredProviders.length === 0) {
      return this.buildModelsResponse({
        active: null,
        currentProviderId: null,
        models: AVAILABLE_MODELS,
        providers: [],
      });
    }

    if (
      options.source === "remote" &&
      active?.type === "openai_compatible" &&
      active.baseUrl
    ) {
      const remote = await fetchRemoteOpenAIModels(
        active.baseUrl,
        active.apiKey
      );
      const remoteInstance = { ...active, customModels: remote };
      const models = mergeModelsForConfig(
        (this.userConfig?.providers ?? []).map((instance) =>
          instance.id === active.id ? remoteInstance : instance
        )
      );

      return this.buildModelsResponse({
        active,
        currentProviderId,
        customModels: remote,
        models,
        providers,
      });
    }

    const models = mergeModelsForConfig(this.userConfig?.providers ?? []);

    return this.buildModelsResponse({
      active,
      currentProviderId,
      models,
      providers,
    });
  }

  private buildModelsResponse(options: {
    active: ReturnType<typeof getActiveProviderInstance>;
    currentProviderId: string | null;
    providers: ReturnType<typeof toProviderInstanceSummary>[];
    models: ModelsResponse["models"];
    customModels?: ModelsResponse["customModels"];
  }): ModelsResponse {
    const { active, currentProviderId, providers, models, customModels } =
      options;

    return {
      baseUrl:
        active?.type === "openai_compatible" ? (active.baseUrl ?? null) : null,
      catalog: AVAILABLE_MODELS,
      currentProviderId,
      customModels:
        customModels ??
        (active &&
        (active.type === "openrouter" || active.type === "openai_compatible")
          ? active.customModels
          : undefined),
      displayName: active?.type === "openai_compatible" ? active.label : null,
      models,
      provider: active?.type ?? null,
      providers,
    };
  }

  getLlmUsageStats() {
    return (
      this.llmUsageTracker?.getStats() ?? {
        estimatedCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        requestCount: 0,
        totalTokens: 0,
        trackedSince: new Date().toISOString(),
      }
    );
  }

  getLlmUsageStatsByModel() {
    return this.llmUsageTracker?.getStatsByModel() ?? [];
  }

  async configureProvider(
    request: ConfigureProviderRequest
  ): Promise<ConfigureProviderResponse> {
    const result = await this.createProvider({
      apiKey: request.apiKey,
      baseUrl: request.baseUrl,
      customModels: request.customModels,
      hostMode: request.hostMode,
      label: request.displayName,
      model: request.model,
      type: request.provider,
    });

    const instance = findProviderInstance(
      this.userConfig,
      result.defaultProviderId
    );

    return {
      currentModel: result.initialModel,
      displayName:
        instance?.type === "openai_compatible"
          ? (instance.label ?? null)
          : null,
      provider: result.provider.type,
    };
  }

  private refreshHarness(): void {
    const provider = createProviderFromActiveConfig(this.userConfig);
    const active = getActiveProviderInstance(this.userConfig);
    this._providerConfigured =
      isProviderConfigured(this.userConfig) && provider !== null;
    this.harness = this.createHarness({
      modelId: active ? resolveDefaultModelForInstance(active) : null,
      provider,
      providerInstance: active,
      thinking: this.resolveWorkspaceThinkingDefaults(),
    });
    this.sessions.clear();
  }

  /** After a data-root restore, reload provider config and clear in-memory session state. */
  async reloadAfterDataRestore(): Promise<void> {
    this.userConfig = await loadUserConfig();
    this.refreshHarness();
    this.composioService?.reloadConfiguration();
    await this.llmUsageTracker?.reloadFromDatabase();
    this.visionSettingsPromise = null;
    this.transcriptionSettingsPromise = null;
    await this.ensureVisionSettingsLoaded();
    await this.ensureTranscriptionSettingsLoaded();
  }

  async listProfiles(orgId: string): Promise<ListProfilesResponse> {
    return this.profileService.listProfiles(orgId);
  }

  async getProfile(orgId: string, profileId: string): Promise<ProfileResponse> {
    return this.profileService.getProfile(orgId, profileId);
  }

  async createProfile(
    orgId: string,
    request: CreateProfileRequest
  ): Promise<ProfileResponse> {
    return this.profileService.createProfile(orgId, request);
  }

  async updateProfile(
    orgId: string,
    profileId: string,
    request: UpdateProfileRequest,
    meta?: ProfileChangeMeta
  ): Promise<ProfileResponse> {
    const response = await this.profileService.updateProfile(
      orgId,
      profileId,
      request,
      meta
    );

    if (request.model !== undefined) {
      for (const [sessionId, record] of this.sessions.entries()) {
        if (record.profileId === profileId) {
          this.sessions.delete(sessionId);
        }
      }
    }

    return response;
  }

  async moveProfile(
    orgId: string,
    profileId: string,
    request: MoveProfileRequest
  ): Promise<ProfileResponse> {
    const result = await this.profileService.moveProfile(
      orgId,
      profileId,
      request
    );
    for (const [sessionId, record] of this.sessions) {
      if (record.profileId === profileId) {
        this.sessions.delete(sessionId);
      }
    }
    return result;
  }

  async deleteProfile(orgId: string, profileId: string): Promise<void> {
    await this.profileService.deleteProfile(orgId, profileId);
    for (const [sessionId, record] of this.sessions) {
      if (record.profileId === profileId) {
        record.session.clear();
        this.sessions.delete(sessionId);
      }
    }
  }

  async listTools(orgId: string): Promise<ListToolsResponse> {
    return this.profileService.listTools(orgId);
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
    context: { orgId: string; userId: string }
  ): Promise<RunToolResponse> {
    const { tool } = await this.profileService.getTool(toolId);
    const handler = getCustomToolHandler(tool.handlerType);

    if (!handler) {
      throw new Error(
        `Only custom ${customToolTypesLabel()} tools can be run in the playground.`
      );
    }

    const record = await this.db.getTool(toolId);

    if (!record) {
      throw new NakamaApiError("Tool not found.", 404);
    }

    const profileId = await this.resolvePlaygroundProfileId(
      context.orgId,
      toolId
    );

    const loaded = await handler.load(record);

    if (!loaded) {
      throw new Error(`Failed to load tool "${tool.name}".`);
    }

    const toolContext = buildToolExecutionContext({
      ...this.memoryBackend.toolContext(context.orgId, profileId),
      orgId: context.orgId,
      profileId,
      userId: context.userId,
    });

    const raw = await executeToolCall(
      [loaded],
      { arguments: parameters, name: loaded.name },
      toolContext
    );

    if (
      raw !== null &&
      typeof raw === "object" &&
      "error" in raw &&
      typeof (raw as { error?: unknown }).error === "string"
    ) {
      return { error: (raw as { error: string }).error, ok: false };
    }

    return { ok: true, result: raw };
  }

  async suggestToolPlaygroundParams(
    toolId: string,
    prompt: string
  ): Promise<SuggestToolParamsResponse> {
    const { tool } = await this.profileService.getTool(toolId);
    const handler = getCustomToolHandler(tool.handlerType);

    if (!handler) {
      throw new Error(
        `Only custom ${customToolTypesLabel()} tools support parameter suggestions.`
      );
    }

    const record = await this.db.getTool(toolId);

    if (!record) {
      throw new NakamaApiError("Tool not found.", 404);
    }

    const loaded = await handler.load(record);
    const provider = createProviderFromActiveConfig(
      this.userConfig,
      process.env
    );
    const parameters = await suggestToolParamsFromPrompt(
      {
        description: tool.description,
        parameters: loaded?.parameters,
        prompt,
        toolName: tool.name,
      },
      { provider: provider ?? undefined }
    );

    return { parameters };
  }

  async listProfileTools(
    orgId: string,
    profileId: string
  ): Promise<ListToolsResponse> {
    return this.profileService.listProfileTools(orgId, profileId);
  }

  async assignTool(
    orgId: string,
    profileId: string,
    request: AssignToolRequest,
    meta?: ProfileChangeMeta
  ): Promise<ProfileResponse> {
    return this.profileService.assignTool(orgId, profileId, request, meta);
  }

  async unassignTool(
    orgId: string,
    profileId: string,
    toolId: string,
    meta?: ProfileChangeMeta
  ): Promise<ProfileResponse> {
    return this.profileService.unassignTool(orgId, profileId, toolId, meta);
  }

  async assignMcpServer(
    orgId: string,
    profileId: string,
    request: { serverId: string },
    meta?: ProfileChangeMeta
  ): Promise<ProfileResponse> {
    return this.profileService.assignMcpServer(orgId, profileId, request, meta);
  }

  async unassignMcpServer(
    orgId: string,
    profileId: string,
    serverId: string,
    meta?: ProfileChangeMeta
  ): Promise<ProfileResponse> {
    return this.profileService.unassignMcpServer(
      orgId,
      profileId,
      serverId,
      meta
    );
  }

  async listSkills(orgId?: string): Promise<ListSkillsResponse> {
    return this.requireSkillsService().listSkills(orgId);
  }

  async getSkill(skillId: string, orgId?: string): Promise<SkillResponse> {
    return this.requireSkillsService().getSkill(skillId, orgId);
  }

  async listSkillFiles(orgId: string, skillId: string) {
    return this.requireSkillsService().listSkillFiles(orgId, skillId);
  }

  async readSkillFile(orgId: string, skillId: string, filePath: string) {
    return this.requireSkillsService().readSkillFile(orgId, skillId, filePath);
  }

  async cloneProfile(
    orgId: string,
    sourceId: string,
    request: CloneProfileRequest
  ): Promise<ProfileResponse> {
    return this.profileService.cloneProfile(orgId, sourceId, request);
  }

  async createSkill(
    orgId: string,
    request: CreateSkillRequest
  ): Promise<SkillResponse> {
    return this.requireSkillsService().createSkill(orgId, request);
  }

  async installSkillFromGitHub(
    orgId: string,
    request: InstallSkillRequest
  ): Promise<SkillResponse> {
    return this.requireSkillsService().installSkillFromGitHub(orgId, request);
  }

  async patchSkill(
    orgId: string,
    skillId: string,
    request: PatchSkillRequest,
    options?: { profileId?: string }
  ): Promise<SkillResponse> {
    return this.requireSkillsService().patchSkill(
      orgId,
      skillId,
      request,
      options
    );
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
    meta?: ProfileChangeMeta
  ): Promise<ProfileResponse> {
    const profile = await this.profileService.assignSkill(
      orgId,
      profileId,
      request,
      meta
    );
    await this.skillsService?.materializeAssignedPluginSkills(orgId, profileId);
    return profile;
  }

  async unassignSkill(
    orgId: string,
    profileId: string,
    skillId: string,
    meta?: ProfileChangeMeta
  ): Promise<ProfileResponse> {
    const profile = await this.profileService.unassignSkill(
      orgId,
      profileId,
      skillId,
      meta
    );
    await this.skillsService?.materializeAssignedPluginSkills(orgId, profileId);
    return profile;
  }

  async uploadProfileAvatar(
    orgId: string,
    profileId: string,
    attachment: ImageAttachment
  ): Promise<ProfileResponse> {
    return this.profileService.uploadProfileAvatar(
      orgId,
      profileId,
      attachment
    );
  }

  async getProfileAvatar(
    orgId: string,
    profileId: string
  ): Promise<{ mediaType: string; bytes: Buffer }> {
    return this.profileService.getProfileAvatar(orgId, profileId);
  }

  async deleteProfileAvatar(orgId: string, profileId: string): Promise<void> {
    return this.profileService.deleteProfileAvatar(orgId, profileId);
  }

  async listKnowledgeBase(
    orgId: string,
    profileId: string
  ): Promise<ListKnowledgeBaseResponse> {
    return this.profileService.listKnowledgeBase(orgId, profileId);
  }

  async uploadKnowledgeBaseDocument(
    orgId: string,
    profileId: string,
    document: DocumentAttachment,
    onDuplicate?: KnowledgeBaseDuplicateAction
  ): Promise<UploadKnowledgeBaseResponse> {
    return this.profileService.uploadKnowledgeBaseDocument(
      orgId,
      profileId,
      document,
      onDuplicate
    );
  }

  async deleteKnowledgeBaseDocument(
    orgId: string,
    profileId: string,
    documentId: string
  ): Promise<DeleteKnowledgeBaseResponse> {
    return this.profileService.deleteKnowledgeBaseDocument(
      orgId,
      profileId,
      documentId
    );
  }

  async readKnowledgeBaseDocument(
    orgId: string,
    profileId: string,
    documentId: string,
    options: { render?: "text" } = {}
  ): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
    return this.profileService.readKnowledgeBaseDocument(
      orgId,
      profileId,
      documentId,
      options
    );
  }

  async listOrganizationKnowledgeBase(
    orgId: string
  ): Promise<{ documents: KnowledgeBaseDocument[] }> {
    return this.profileService.listOrganizationKnowledgeBase(orgId);
  }

  async uploadOrganizationKnowledgeBaseDocument(
    orgId: string,
    document: DocumentAttachment,
    onDuplicate?: KnowledgeBaseDuplicateAction
  ): Promise<UploadOrganizationKnowledgeBaseResponse> {
    return this.profileService.uploadOrganizationKnowledgeBaseDocument(
      orgId,
      document,
      onDuplicate
    );
  }

  async deleteOrganizationKnowledgeBaseDocument(
    orgId: string,
    documentId: string
  ): Promise<DeleteOrganizationKnowledgeBaseResponse> {
    return this.profileService.deleteOrganizationKnowledgeBaseDocument(
      orgId,
      documentId
    );
  }

  async readOrganizationKnowledgeBaseDocument(
    orgId: string,
    documentId: string,
    options: { render?: "text" } = {}
  ): Promise<{ bytes: Buffer; contentType: string; filename: string }> {
    return this.profileService.readOrganizationKnowledgeBaseDocument(
      orgId,
      documentId,
      options
    );
  }

  async getProfileSoulStatus(
    orgId: string,
    profileId: string,
    includeContents = false
  ): Promise<SoulStatusResponse> {
    const profile = await this.requireProfile(orgId, profileId);
    const status = await getSoulStatus(getProfileSoulDir(orgId, profileId));

    if (!includeContents) {
      return { ...status, profileId };
    }

    const stack = await loadSoulStack(
      getProfileSoulDir(orgId, profileId),
      (content) =>
        this.memoryBackend.readMemory(orgId, profileId, "MEMORY.md", content)
    );
    return { ...status, contents: stack.files, profileId };
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

  async initProfileSoul(
    orgId: string,
    profileId: string
  ): Promise<InitSoulResponse> {
    await this.requireProfile(orgId, profileId);
    const result = await initSoulDirectory(getProfileSoulDir(orgId, profileId));
    return { ...result, profileId };
  }

  async getProfileSoulStack(
    orgId: string,
    profileId: string
  ): Promise<SoulStackResponse> {
    await this.requireProfile(orgId, profileId);
    const stack = await loadSoulStack(
      getProfileSoulDir(orgId, profileId),
      (content) =>
        this.memoryBackend.readMemory(orgId, profileId, "MEMORY.md", content)
    );
    return { ...stack, profileId };
  }

  async writeProfileSoulFile(
    orgId: string,
    profileId: string,
    key: string,
    request: UpdateSoulFileRequest,
    meta?: ProfileChangeMeta
  ): Promise<void> {
    await this.requireProfile(orgId, profileId);

    if (!isWritableSoulFileKey(key)) {
      throw new Error(`Invalid soul file key: ${key}`);
    }

    const field = soulFieldFromKey(key);
    const soulDir = getProfileSoulDir(orgId, profileId);
    const before =
      (await readTextIfExists(join(soulDir, WRITABLE_SOUL_FILES[key]))) ?? null;

    if (key === "memory") {
      await this.memoryBackend.readMemory(
        orgId,
        profileId,
        "MEMORY.md",
        request.content
      );
    }
    await writeSoulFile(soulDir, key, request.content);

    if (meta && field && before !== request.content) {
      await recordProfileChangeEvent(this.db, {
        actorUserId: meta.actorUserId,
        afterValue: request.content,
        beforeValue: before,
        field,
        orgId,
        profileId,
        source: meta.source,
      });
    }
  }

  async listProfileChangeHistory(
    orgId: string,
    profileId: string,
    options: { limit?: number; offset?: number } = {}
  ) {
    return this.profileService.listProfileChangeHistory(
      orgId,
      profileId,
      options
    );
  }

  async listProfileArtifacts(
    orgId: string,
    profileId: string,
    options: ListArtifactsOptions = {}
  ): Promise<ListArtifactsResponse> {
    await this.requireProfile(orgId, profileId);
    return listArtifacts(orgId, profileId, options);
  }

  async readProfileArtifact(
    orgId: string,
    profileId: string,
    filename: string,
    options: { appUserId?: string | null; render?: "markdown" } = {}
  ) {
    await this.requireProfile(orgId, profileId);
    return readArtifactFile({
      appUserId: options.appUserId,
      filename,
      orgId,
      profileId,
      render: options.render,
    });
  }

  async writeProfileArtifact(
    orgId: string,
    profileId: string,
    filename: string,
    content: string
  ): Promise<UpdateArtifactResponse> {
    await this.requireProfile(orgId, profileId);
    return writeArtifactFile({ content, filename, orgId, profileId });
  }

  async deleteProfileArtifact(
    orgId: string,
    profileId: string,
    filename: string
  ): Promise<DeleteArtifactResponse> {
    await this.requireProfile(orgId, profileId);
    return deleteArtifactFile({ filename, orgId, profileId });
  }

  async getUserContext(
    orgId: string,
    userId: string,
    includeContent = false
  ): Promise<UserContextStatusResponse> {
    const raw = await this.db.getUserContext(orgId, userId);
    return buildUserContextStatus(raw, includeContent);
  }

  async initUserContext(
    orgId: string,
    userId: string
  ): Promise<InitUserContextResponse> {
    const existing = normalizeUserContextContent(
      await this.db.getUserContext(orgId, userId)
    );
    if (existing !== undefined) {
      return { created: false };
    }

    await this.db.setUserContext(
      orgId,
      userId,
      USER_CONTEXT_TEMPLATE,
      new Date().toISOString()
    );
    return { created: true };
  }

  async writeUserContext(
    orgId: string,
    userId: string,
    request: UpdateUserContextRequest
  ): Promise<void> {
    await this.db.setUserContext(
      orgId,
      userId,
      request.content,
      new Date().toISOString()
    );
  }

  private async loadUserContextForUser(
    orgId: string,
    userId?: string | null
  ): Promise<string | undefined> {
    if (!userId) {
      return;
    }

    return normalizeUserContextContent(
      await this.db.getUserContext(orgId, userId)
    );
  }

  private createHarness(options: {
    provider: ProviderClient | null;
    providerInstance?: ReturnType<typeof getActiveProviderInstance>;
    modelId?: string | null;
    thinking: ThinkingSettings;
  }): AgentDependencies {
    const providerInstance = options.providerInstance ?? null;

    const trackedProvider =
      options.provider && this.llmUsageTracker && options.modelId
        ? wrapProviderWithUsageTracking(
            options.provider,
            this.llmUsageTracker,
            options.modelId,
            {
              provider: providerInstance?.type ?? options.provider.name,
              providerInstance,
            }
          )
        : options.provider;

    return {
      chatOptions: this.resolveChatProviderOptions(
        providerInstance,
        options.thinking
      ),
      provider: trackedProvider ?? undefined,
    };
  }

  getUsageStatusFields(): {
    displayName: string | null;
    costEstimated: boolean;
    currentModel: string | null;
  } {
    const active = getActiveProviderInstance(this.userConfig);
    const currentModel = active ? resolveDefaultModelForInstance(active) : null;

    return {
      costEstimated: isCostEstimated(
        active?.type ?? null,
        currentModel,
        active
      ),
      currentModel,
      displayName:
        active?.type === "openai_compatible" ? (active.label ?? null) : null,
    };
  }

  private async pluginCapabilityRevision(orgId: string): Promise<string> {
    if (!this.pluginService) {
      return "";
    }
    return this.pluginService.capabilityRevisionForOrg(orgId);
  }

  /**
   * Sessions carry no org column; the org is only reachable through their
   * profile. Every by-id session operation resolves scope here so a caller in
   * one org cannot name a session id belonging to another.
   */
  private async getSessionRecordForOrg(
    sessionId: string,
    orgId: string
  ): Promise<StoredSessionRecord | null> {
    // Cognito sessions have no row, so the map answers first. Everything that
    // reaches a session funnels through here, which is why the rest of the
    // file needs no branch of its own.
    const ephemeral = this.ephemeralSessions.get(sessionId);
    const record = ephemeral?.record ?? (await this.db.getSession(sessionId));

    if (!record) {
      return null;
    }

    const profile = await this.db.getProfileForOrg(record.profileId, orgId);

    return profile ? record : null;
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

  private async requireProfileRecord(
    profileId: string
  ): Promise<StoredProfileRecord> {
    const profile = await this.db.getProfile(profileId);

    if (!profile?.orgId) {
      throw new Error("Profile not found.");
    }

    return profile;
  }

  private async resolveSessionProfile(
    orgId: string,
    profileId?: string
  ): Promise<string> {
    if (profileId?.trim()) {
      const requestedProfile = await this.db.getProfileForOrg(
        profileId.trim(),
        orgId
      );

      if (requestedProfile) {
        return profileId.trim();
      }
    }

    const defaultProfile = await this.db.getDefaultProfileForOrg(orgId);

    if (defaultProfile) {
      return defaultProfile.id;
    }

    throw new Error(
      "No profiles exist for this organization. Create a profile in the web dashboard first."
    );
  }

  private async resolveProfileTools(
    profile: StoredProfileRecord,
    options: {
      actorRole?: "admin" | "member" | "viewer" | null;
      includeAutomationTools?: boolean;
      includeTodoTools?: boolean;
      includeQuestionTools?: boolean;
      includeSubAgentTool?: boolean;
      includeSkillManageTools?: boolean;
      /** False in a cognito session: proposing org memory is a write-back. */
      includeMemoryWriteTools?: boolean;
      userId?: string | null;
    } = {}
  ): Promise<ToolDefinition[]> {
    const storedTools = await this.db.listToolsForProfile(profile.id);
    const tools = await resolveProfileStoredTools(storedTools, this.db, [], {
      actorRole: options.actorRole ?? undefined,
      pluginService: this.pluginService,
      serverTools: this.serverTools,
      userConfig: this.userConfig,
    });
    const includeAutomationTools = options.includeAutomationTools ?? true;
    const includeTodoTools = options.includeTodoTools ?? true;
    const includeQuestionTools = options.includeQuestionTools ?? true;
    const includeSubAgentTool = options.includeSubAgentTool ?? true;
    // Default follows interactive automation-tool gate; messaging channels pass false.
    const includeSkillManageTools =
      options.includeSkillManageTools ?? includeAutomationTools;

    let resolved = [...tools];

    if (this.mcpClientManager) {
      const mcpServers = await this.db.listMcpServersForProfile(profile.id);
      const orgId = profile.orgId;

      if (!orgId) {
        throw new Error("Profile organization is missing.");
      }

      resolved = [
        ...resolved,
        ...buildMcpToolDefinitions(
          mcpServers,
          this.mcpClientManager,
          this.db,
          orgId,
          profile.id
        ),
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
          this.composioService
        )),
        ...(await buildComposioToolDefinitions(
          orgId,
          options.userId,
          profile.id,
          this.composioService,
          this.mcpClientManager
        )),
      ];
    }

    // A profile with no tools of its own (builtin, MCP, and Composio all
    // empty) answers without tools.  Skip the platform groups below so an
    // admin who stripped every tool from a profile actually gets an empty tool
    // list on chat turns — injecting 16 helpers here makes small local models
    // print a fake tool call as plain text instead of doing the work.
    const hasOwnTools = resolved.length > 0;

    if (
      hasOwnTools &&
      includeAutomationTools &&
      profile.automationsEnabled !== false &&
      this.automationTools.length > 0
    ) {
      resolved = [...resolved, ...this.automationTools];
    }

    if (hasOwnTools && includeTodoTools && this.todoTools.length > 0) {
      resolved = [...resolved, ...this.todoTools];
    }

    if (hasOwnTools && includeQuestionTools && this.questionTools.length > 0) {
      resolved = [...resolved, ...this.questionTools];
    }

    if (this.skillsService) {
      const orgId = profile.orgId;

      if (!orgId) {
        throw new Error("Profile organization is missing.");
      }

      const skillTools = await this.skillsService.loadToolsForProfile(
        orgId,
        profile.id
      );
      resolved = [...resolved, ...skillTools];

      // Interactive web/cli only: messaging, automation, task, and subagent omit this.
      if (hasOwnTools && includeSkillManageTools) {
        const assignedSkills = await this.skillsService.listSkillsForProfile(
          profile.id
        );
        if (
          assignedSkills.some(
            (skill) =>
              skill.name === "manage-skills" || skill.name === "skill-installer"
          )
        ) {
          resolved = [
            ...resolved,
            ...createSkillManageTools({
              skillProposalService: this.skillProposalService,
              skillsService: this.skillsService,
            }),
          ];
        }
      }
    }

    if (profile.isSuper) {
      resolved = [...resolved, ...this.superBotTools];
    }

    if (hasOwnTools) {
      resolved = [...resolved, ...this.orgMemoryTools];
    }

    if (options.includeMemoryWriteTools === false) {
      resolved = resolved.filter(
        (tool) => tool.name !== PROPOSE_ORG_MEMORY_TOOL_NAME
      );
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
    modelOverride: string | null,
    userId?: string | null,
    orgRole?: OrgRole | null,
    isPlatformAdmin?: boolean,
    codingWorkspaceRoot?: string,
    cognito?: CognitoSessionOptions,
    appUserId?: string | null
  ): Promise<AgentChatSession> {
    await this.ensureVisionSettingsLoaded();
    const profile = await this.requireProfile(orgId, profileId);
    const workspaceRoot = appUserId
      ? await ensureAppUserSoulDir(orgId, profileId, appUserId)
      : undefined;
    // skill_manage writes skills and expands /learn, both of which outlive the
    // chat, so a cognito session never gets it whatever the channel allows.
    const includeSkillManageTools =
      !(cognito || appUserId) && SKILL_MANAGE_CHANNELS[channel];
    const pluginOrgRole =
      channel === "telegram" ||
      channel === "whatsapp" ||
      channel === "discord" ||
      channel === "slack"
        ? "member"
        : orgRole;
    let tools = await this.resolveProfileTools(profile, {
      actorRole:
        pluginOrgRole === "admin" ||
        pluginOrgRole === "member" ||
        pluginOrgRole === "viewer"
          ? pluginOrgRole
          : undefined,
      includeMemoryWriteTools: !cognito,
      includeSkillManageTools,
      userId,
    });
    if (channel === "discord" && tools.length > 0) {
      tools = [...tools, ...createSendDiscordArtifactTools()];
    }
    // Same table as the tools above on purpose: a channel that can manage
    // skills is a channel that needs the catalog to track what it has seen.
    // Splitting them later means splitting the table, which is a visible edit.
    const skillUsageContext = SKILL_MANAGE_CHANNELS[channel]
      ? { seenCatalogSkillIds: new Set<string>(), sessionId }
      : undefined;
    const { systemPrompt, soulActive } = await this.resolveProfileSystemPrompt(
      orgId,
      profileId,
      profile.systemPrompt,
      orgRole,
      skillUsageContext,
      !cognito,
      workspaceRoot
    );
    // Per-org override for the tool-output optimiser. Undefined leaves the
    // decision to the server's env var, so an operator who never opened the UI
    // keeps whatever they configured.
    const tokenOptimizerEnabled = (await this.db.getWorkspaceSettings())
      ?.tokenOptimizerEnabled;
    const resolvedSystemPrompt = profile.isSuper
      ? `${systemPrompt.trim()}\n\n${SUPER_BOT_TOOL_AUTHORING_RULES}`
      : systemPrompt;
    // A cognito session has nothing stored to load. On a model change it is
    // handed the live history instead, so the conversation survives the
    // rebuild that a new provider needs.
    const initialHistory = cognito
      ? (cognito.initialHistory ?? [])
      : await loadSessionHistory(this.db, sessionId);
    const userTimezone = await this.getUserTimezone();
    const userContext = appUserId
      ? undefined
      : await this.loadUserContextForUser(orgId, userId);
    const selectedModel = modelOverride
      ? this.normalizeSessionModelOverride(modelOverride)
      : profile.model;
    const compaction = this.resolveCompactionConfig(profile, selectedModel);
    const harness = this.createHarnessForProfile(profile, selectedModel);
    // Part of the "no tools" contract: session-history and channel-artifact
    // helpers are also platform groups, so a profile that resolved to zero
    // tools must not receive them either.
    if (tools.length > 0) {
      tools = [...tools, createReadSessionHistoryTool(orgId, sessionId)];
    }
    const persistAttachment = createAttachmentSaver(this.db, {
      channel,
      ephemeral: Boolean(cognito),
      orgId,
      profileId,
      // No `sessions` row exists for a cognito session, and the column is a
      // foreign key, so it has to be null rather than the session id.
      sessionId: cognito ? null : sessionId,
    });
    const trackEphemeralAttachment = cognito
      ? (attachmentId: string) =>
          this.ephemeralSessions.trackAttachment(sessionId, attachmentId)
      : undefined;
    const saveAttachment: SaveInlineAttachment = trackEphemeralAttachment
      ? async (input) => {
          const saved = await persistAttachment(input);
          trackEphemeralAttachment(saved.attachmentId);
          return saved;
        }
      : persistAttachment;
    const loadAttachment = createAttachmentLoader(this.db, {
      orgId,
      profileId,
    });
    const hasSkillManage = tools.some((tool) => tool.name === "skill_manage");

    const session = createAgentChatSession(harness, {
      archiveHistory: (history) => {
        if (this.sessions.get(sessionId)?.session !== persistedSession) {
          throw new Error("Session changed during compaction. Try again.");
        }
        return archiveSessionHistory(this.db, orgId, sessionId, history);
      },
      channel,
      compaction,
      enableToolLoop: true,
      initialHistory,
      preprocessUserContent: async (content) => {
        content = await persistInlineAttachmentsInContent(
          content,
          saveAttachment
        );

        if (!messageContentHasImages(content)) {
          return content;
        }

        const forVision = await rehydrateAttachmentRefsInContent(
          content,
          loadAttachment
        );

        const primarySupportsVision = resolvePrimaryModelVisionSupport(
          this.userConfig,
          selectedModel
        );

        if (primarySupportsVision !== false) {
          return content;
        }

        const visionSelection = resolveVisionProviderSelection(this.userConfig);

        if (!visionSelection) {
          throw new NakamaApiError(VISION_MODEL_REQUIRED_MESSAGE, 400);
        }

        let visionProvider = createProviderForInstance(
          visionSelection.instance,
          visionSelection.model,
          process.env,
          {
            onChatgptTokenRefresh: (instanceId, oauth) =>
              this.persistChatgptOAuth(instanceId, oauth),
            onXaiTokenRefresh: (instanceId, oauth) =>
              this.persistXaiOAuth(instanceId, oauth),
            resolveInstance: (instanceId) =>
              findProviderInstance(this.userConfig, instanceId),
          }
        );

        if (this.llmUsageTracker) {
          visionProvider = wrapProviderWithUsageTracking(
            visionProvider,
            this.llmUsageTracker,
            visionSelection.model,
            {
              provider: visionSelection.instance.type,
              providerInstance: visionSelection.instance,
            }
          );
        }

        const descriptions = await describeImagesWithVisionModel(
          visionProvider,
          extractImageParts(forVision)
        );

        return replaceImagePartsWithDescriptions(forVision, descriptions);
      },
      rehydrateMessagesForProvider: async (messages) => {
        const rehydrated = await rehydrateAttachmentMessages(
          messages,
          loadAttachment
        );

        // Expand /learn only for the provider. History stays raw so skill
        // matching, the web UI, and later turns keep the short command.
        if (includeSkillManageTools && hasSkillManage) {
          return expandLearnInLastUserMessage(rehydrated);
        }

        return rehydrated;
      },
      resolvePromptContext: async (context) => {
        const parts: string[] = [];
        const todoContext =
          await this.agentTodoState.formatForPrompt(sessionId);

        if (todoContext.trim()) {
          parts.push(todoContext.trim());
        }

        if (this.composioService && userId) {
          const composioContext =
            await this.composioService.formatProfileConnectionsContext(
              orgId,
              userId,
              profileId
            );

          if (composioContext.trim()) {
            parts.push(composioContext.trim());
          }
        }

        if (this.skillsService && context?.userMessage?.trim()) {
          const skillContext =
            await this.skillsService.formatMatchedSkillsForPrompt(
              orgId,
              profileId,
              context.userMessage,
              {
                appendContext: async (matched) => {
                  const parts: string[] = [];

                  if (
                    profile.isSuper &&
                    matched.some((skill) => skill.name === "create-profile")
                  ) {
                    parts.push(
                      await this.formatProfileAuthoringToolContext(orgId)
                    );
                  }

                  if (matched.some((skill) => skill.name === "coding-agent")) {
                    parts.push(
                      await this.formatCodingDelegationContext(
                        orgId,
                        profileId,
                        codingWorkspaceRoot
                      )
                    );
                  }

                  return parts.filter(Boolean).join("\n\n");
                },
                recordUsage: !cognito,
                usageContext: skillUsageContext,
              }
            );

          if (skillContext.trim()) {
            parts.push(skillContext.trim());
          }
        }

        return parts.join("\n\n");
      },
      soul: soulActive,
      systemPrompt: resolvedSystemPrompt,
      toolContext: buildToolExecutionContext({
        assertCanStartLlmTurn: this.llmTurnQuotaCheckerFor(orgId),
        channel,
        ...this.memoryBackend.toolContext(orgId, profileId, workspaceRoot),
        codingWorkspaceRoot,
        forbidMemoryWrites: cognito ? true : undefined,
        forbidProfileSkillMarkdownWrites: hasSkillManage,
        isPlatformAdmin: isPlatformAdmin || undefined,
        loadAttachment,
        onSkillCatalogChange: () => {
          this.sessions.delete(sessionId);
        },
        orgId,
        orgRole: orgRole ?? undefined,
        profileId,
        recordToolOutputSavings: this.savingsRecorderFor(orgId),
        recordTurnUsage: this.turnUsageRecorderFor(orgId),
        sessionId,
        tokenOptimizerEnabled: tokenOptimizerEnabled ?? undefined,
        trackEphemeralAttachment,
        userId: userId ?? undefined,
        workspaceRoot,
      }),
      tools,
      userContext,
      userTimezone,
    });

    if (cognito) {
      // Deliberately unwrapped: wrapPersistedSession is what writes every turn
      // into session_messages.
      return session;
    }

    const persistedSession = wrapPersistedSession(sessionId, session, this.db, {
      onBeginTurn: (id) => {
        this.superBotSessionState.beginTurn(id);
        void this.agentQuestionnaireState.clear(id);
      },
    });
    return persistedSession;
  }

  private async formatProfileAuthoringToolContext(
    orgId: string
  ): Promise<string> {
    const { tools } = await this.profileService.listTools(orgId);
    const lines = tools
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((tool) => {
        const source =
          tool.handlerType === "builtin"
            ? "builtin"
            : tool.handlerType === "plugin"
              ? "plugin"
              : "custom";
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
    codingWorkspaceRoot?: string
  ): Promise<string> {
    const profile = await this.db.getProfile(profileId);
    const installed = await listInstalledCodingAgentHarnesses(this.db);
    const workspaceRoot =
      codingWorkspaceRoot ?? getProfileSoulDir(orgId, profileId);
    const probeContext = {
      profileModel: profile?.model ?? null,
      userConfig: this.userConfig,
    };
    const [firstInstalled, secondInstalled] = installed;

    if (!firstInstalled) {
      const installLines = [
        "# Coding Agent Harness",
        "No coding agent CLI is installed on this host.",
        "Install one with bash (shared host — confirm with the operator before global installs), then retry:",
        "",
        `- Codex: \`${getCodingHarnessInstallCommand("codex")}\``,
        `- Claude Code: \`${getCodingHarnessInstallCommand("claude_code")}\``,
        `- OpenCode: \`${getCodingHarnessInstallCommand("opencode")}\``,
        `- pi: \`${getCodingHarnessInstallCommand("pi")}\``,
        "",
        "Cursor Agent CLI (`agent`) cannot be auto-installed. Tell the user to install and authenticate it on the host themselves, then verify with `agent --version`.",
      ];
      return installLines.join("\n");
    }

    if (secondInstalled) {
      const names = installed
        .map((harness) => `- ${harness.name} (\`${harness.command}\`)`)
        .join("\n");
      return [
        "# Coding Agent Harness",
        "Multiple coding agent CLIs are installed. Ask the user which one to use before running a coding task.",
        "Do not pick one silently.",
        "",
        "Installed:",
        names,
        "",
        "After the user chooses, run that CLI via `bash` with `codingAgent: true` (or a command that starts with the harness binary).",
      ].join("\n");
    }

    return this.formatSingleCodingHarnessContext(
      firstInstalled,
      workspaceRoot,
      probeContext
    );
  }

  private async formatSingleCodingHarnessContext(
    harness: CodingAgentHarnessStatus,
    workspaceRoot: string,
    probeContext: {
      userConfig: typeof this.userConfig;
      profileModel: string | null;
    }
  ): Promise<string> {
    try {
      const template = await buildCodingAgentCommandTemplate(
        harness,
        "<task prompt>",
        workspaceRoot,
        probeContext
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
        `${harness.name} is installed (\`${harness.command}\`) but is not ready yet.`,
        "Check Settings → Provider for passthrough compatibility, or retry after the CLI finishes installing.",
      ].join("\n");
    }
  }

  private async resolveProfileSystemPrompt(
    orgId: string,
    profileId: string,
    profilePrompt: string,
    orgRole?: OrgRole | null,
    usageContext?: import("./skills-service").SkillUsageRecordingContext,
    recordSkillUsage = true,
    workspaceRoot?: string
  ): Promise<{ systemPrompt: string; soulActive: boolean }> {
    const stack = await loadSoulStack(
      workspaceRoot ?? getProfileSoulDir(orgId, profileId),
      (content) =>
        this.memoryBackend.readMemory(
          orgId,
          profileId,
          "MEMORY.md",
          content,
          workspaceRoot
        ),
      workspaceRoot ? getProfileSoulDir(orgId, profileId) : undefined
    );
    let systemPrompt = stack
      ? composeSoulSystemPrompt(stack, { profilePrompt })
      : profilePrompt;

    if (this.skillsService) {
      const skillsCatalog = await this.skillsService.composeCatalogForProfile(
        orgId,
        profileId,
        usageContext,
        recordSkillUsage
      );

      if (skillsCatalog.trim()) {
        systemPrompt = `${systemPrompt.trim()}\n\n${skillsCatalog.trim()}`;
      }

      const agentBrowserCapability =
        await this.skillsService.composeAgentBrowserCapabilityForProfile(
          orgId,
          profileId
        );

      if (agentBrowserCapability.trim()) {
        systemPrompt = `${systemPrompt.trim()}\n\n${agentBrowserCapability.trim()}`;
      }
    }

    const kbCatalog = await composeKnowledgeBaseCatalog(orgId, profileId);

    if (kbCatalog.trim()) {
      systemPrompt = `${systemPrompt.trim()}\n\n${kbCatalog.trim()}`;
    }

    if (orgRole !== "viewer") {
      const orgMemorySummary =
        await this.getOrgMemoryService().getSummary(orgId);
      systemPrompt = appendOrgMemorySection(
        systemPrompt,
        orgMemorySummary,
        orgRole
      );
    }

    return {
      soulActive: Boolean(stack),
      systemPrompt,
    };
  }

  private requireSkillsService(): SkillsService {
    if (!this.skillsService) {
      throw new Error("Skills service is not configured.");
    }

    return this.skillsService;
  }

  private createHarnessForProfile(
    profile: StoredProfileRecord,
    selectedModel: string | null = profile.model
  ): AgentDependencies {
    const resolved = resolveProfileProviderSelection({
      defaultProviderId: this.userConfig?.defaultProviderId,
      profileModel: selectedModel,
      providers: this.userConfig?.providers ?? [],
    });

    if (!resolved) {
      return this.createHarness({
        modelId: null,
        provider: null,
        providerInstance: null,
        thinking: this.resolveWorkspaceThinkingDefaults(),
      });
    }

    const provider = createProviderForInstance(
      resolved.instance,
      resolved.model,
      process.env,
      {
        onChatgptTokenRefresh: (instanceId, oauth) =>
          this.persistChatgptOAuth(instanceId, oauth),
        onXaiTokenRefresh: (instanceId, oauth) =>
          this.persistXaiOAuth(instanceId, oauth),
        resolveInstance: (instanceId) =>
          findProviderInstance(this.userConfig, instanceId),
      }
    );
    const primarySupportsVision = resolvePrimaryModelVisionSupport(
      this.userConfig,
      selectedModel
    );
    const resolvedProvider =
      primarySupportsVision === false
        ? wrapProviderForNonVision(provider)
        : provider;

    return this.createHarness({
      modelId: resolved.model,
      provider: resolvedProvider,
      providerInstance: resolved.instance,
      thinking: this.resolveWorkspaceThinkingDefaults(),
    });
  }

  private normalizeSessionModelOverride(
    model: string | null | undefined
  ): string | null {
    const normalizedModel = model?.trim();
    if (!normalizedModel) {
      return null;
    }

    const resolved = resolveConfiguredModelInstance(
      this.userConfig,
      normalizedModel,
      {
        invalid: "Select a configured model.",
        missingProvider: "The selected model provider is no longer available.",
      }
    );

    if (
      !(resolved && modelExistsOnInstance(resolved.instance, resolved.modelId))
    ) {
      throw new NakamaApiError("Select a configured model.", 400);
    }

    return `${resolved.instance.id}::${resolved.modelId}`;
  }

  private async resolvePlaygroundProfileId(
    orgId: string,
    toolId: string
  ): Promise<string> {
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
    selectedModel: string | null = profile.model
  ): CompactionConfig | undefined {
    const resolved = resolveProfileProviderSelection({
      defaultProviderId: this.userConfig?.defaultProviderId,
      profileModel: selectedModel,
      providers: this.userConfig?.providers ?? [],
    });

    if (!resolved) {
      return;
    }

    return resolveModelLimits(
      resolved.instance.type,
      resolved.model,
      resolved.instance.customModels
    );
  }

  private resolveWorkspaceThinkingDefaults(): ThinkingSettings {
    return {
      effort: this.userConfig?.thinkingEffort ?? DEFAULT_THINKING_EFFORT,
      enabled: this.userConfig?.thinkingEnabled ?? DEFAULT_THINKING_ENABLED,
    };
  }
}

function clampSubAgentTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs == null || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_SUB_AGENT_TIMEOUT_MS;
  }

  return Math.min(Math.floor(timeoutMs), MAX_SUB_AGENT_TIMEOUT_MS);
}

function toSessionSummary(session: StoredSessionSummaryRecord): SessionSummary {
  return {
    active: sessionTurnRegistry.isActive(session.id),
    // The query returns only the channels it was asked for, all of them valid.
    channel: parseAgentChannel(session.channel) ?? "web",
    createdAt: session.createdAt,
    id: session.id,
    messageCount: session.messageCount,
    pinned: session.pinned,
    preview: session.preview,
    profileId: session.profileId,
    title: session.title,
    updatedAt: session.updatedAt,
  };
}

type SessionCursor = Pick<
  StoredSessionSummaryRecord,
  "createdAt" | "id" | "pinned" | "position" | "updatedAt"
>;

/** Opaque to clients: the sort key and place of the last row on a page. */
function encodeSessionCursor(session: SessionCursor): string {
  return Buffer.from(
    JSON.stringify([
      session.pinned,
      session.updatedAt,
      session.createdAt,
      session.id,
      session.position,
    ])
  ).toString("base64url");
}

function decodeSessionCursor(cursor: string): SessionCursor {
  try {
    const [pinned, updatedAt, createdAt, id, position] = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    );
    if (
      typeof pinned === "boolean" &&
      typeof updatedAt === "string" &&
      typeof createdAt === "string" &&
      typeof id === "string" &&
      Number.isInteger(position)
    ) {
      return { createdAt, id, pinned, position, updatedAt };
    }
  } catch {
    // Not base64url JSON, so it is not one of ours either.
  }
  throw new NakamaApiError("Invalid cursor.", 400);
}
