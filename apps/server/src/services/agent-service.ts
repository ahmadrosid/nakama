import {
  type AgentChatSession,
  type AgentHarness,
  type CompactionConfig,
  createAgentHarness,
  draftTaskPromptFromFields,
  executeToolCall,
  suggestToolParamsFromPrompt,
} from "@nakama/agent";
import type {
  AgentBrowserStatusResponse,
  AgentChannel,
  AgentQuestionnaire,
  AgentTodo,
  AssignSkillRequest,
  AssignToolRequest,
  BranchSessionResponse,
  ChatContextUsage,
  ChatMessage,
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
  DeleteProviderResponse,
  DiscordSettingsResponse,
  DiscoverModelsRequest,
  DocumentAttachment,
  EmailSettingsResponse,
  GenerateImageRequest,
  GenerateImageResponse,
  ImageAttachment,
  ImageGenerationSettings,
  ImageGenerationSettingsResponse,
  InitSoulResponse,
  InitUserContextResponse,
  InstallSkillRequest,
  ListArtifactsOptions,
  ListArtifactsResponse,
  ListKnowledgeBaseResponse,
  ListProfilesResponse,
  ListProvidersResponse,
  ListSessionsResponse,
  ListSkillsResponse,
  ListToolsResponse,
  ModelsResponse,
  PatchSkillRequest,
  ProfileResponse,
  ProviderChatOptions,
  ProviderClient,
  RunToolResponse,
  SendEmailTestResponse,
  SkillResponse,
  SoulStackResponse,
  SoulStatusResponse,
  SuggestToolParamsResponse,
  SyncSkillsResponse,
  TelegramSettingsResponse,
  ThinkingSettings,
  ThinkingSettingsResponse,
  ToolDefinition,
  ToolResponse,
  ToolSourceResponse,
  TranscribeAudioRequest,
  TranscribeAudioResponse,
  TranscriptionSettings,
  TranscriptionSettingsResponse,
  UpdateComposioSettingsRequest,
  UpdateDiscordSettingsRequest,
  UpdateEmailSettingsRequest,
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
  UpdateWhatsAppSettingsRequest,
  UploadKnowledgeBaseResponse,
  UserConfig,
  UserContextStatusResponse,
  VisionSettings,
  VisionSettingsResponse,
  WhatsAppSettingsResponse,
} from "@nakama/core";
import {
  apiKeyEnvVarForProvider,
  appendOrgMemorySection,
  buildThinkingProviderOptions,
  buildToolExecutionContext,
  buildUserContextStatus,
  composeKnowledgeBaseCatalog,
  composeSoulSystemPrompt,
  createSmtpSender,
  DEFAULT_THINKING_EFFORT,
  DEFAULT_THINKING_ENABLED,
  defaultOllamaBaseUrl,
  deleteArtifactFile,
  emailConfigToMailboxConfig,
  extractImageParts,
  findProviderInstance,
  getActiveProviderInstance,
  getProfileSoulDir,
  getResolvedSoulStatus,
  initSoulDirectory,
  isEmailConfigComplete,
  isProviderConfigured,
  isWritableSoulFileKey,
  listArtifacts,
  loadComposioSettingsPublic,
  loadDiscordSettingsPublic,
  loadEmailConfig,
  loadEmailSettingsPublic,
  loadSoulStack,
  loadTelegramSettingsPublic,
  loadUserConfig,
  loadUserThinkingSettings,
  loadUserTimezone,
  loadUserTranscriptionSettings,
  loadUserVisionSettings,
  loadWhatsAppSettingsPublic,
  messageContentHasImages,
  NakamaApiError,
  nanoid,
  normalizeUserContextContent,
  type OrgRole,
  ollamaRequiresApiKey,
  persistInlineAttachmentsInContent,
  readArtifactFile,
  readBundledSkillBody,
  readEnvValue,
  regenerateDiscordHandshake,
  regenerateTelegramHandshake,
  regenerateWhatsAppPairingCode,
  rehydrateMessagesForProvider as rehydrateAttachmentMessages,
  rehydrateAttachmentRefsInContent,
  replaceImagePartsWithDescriptions,
  resolveOllamaHostMode,
  resolveSoulStackForProfile,
  saveComposioConfig,
  saveDiscordConfig,
  saveEmailConfig,
  saveTelegramConfig,
  saveUserConfig,
  saveUserThinkingSettings,
  saveUserTimezone,
  saveWhatsAppConfig,
  USER_CONTEXT_TEMPLATE,
  writeSoulFile,
} from "@nakama/core";
import { canAccessSuperBotProfile } from "@nakama/core/profiles";
import {
  type DatabaseAdapter,
  type StoredProfileRecord,
  type StoredTaskRunRecord,
  SUPER_BOT_TOOL_AUTHORING_RULES,
  WORKSPACE_SETTINGS_ID,
} from "@nakama/db";
import {
  AVAILABLE_MODELS,
  catalogCustomModelsToCatalog,
  createProviderForInstance,
  createProviderFromActiveConfig,
  createProviderFromSources,
  fetchFireworksGatewayModels,
  fetchOllamaModels,
  fetchRemoteOpenAIModels,
  getModelById,
  getModelsForProviderInstance,
  isCostEstimated,
} from "../providers";
import { isAllowedImageGenerationSelection } from "../providers/models";
import { wrapProviderForNonVision } from "../providers/non-vision-wrap";
import { wrapProviderWithUsageTracking } from "../providers/usage-tracking";
import { createAskUserQuestionTools } from "../tools/ask-user-question-tool";
import { createOrgMemoryTools } from "../tools/org-memory-tools";
import { createSendDiscordArtifactTools } from "../tools/send-discord-artifact-tool";
import { createSkillManageTools } from "../tools/skill-manage-tool";
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
  transcribeAudioWithOpenAI,
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
  generateImageWithOpenAI,
  IMAGE_MODEL_REQUIRED_MESSAGE,
  resolveImageGenerationSelection,
} from "./image-generation";
import {
  createVisionFallbackProvider,
  describeImagesWithVisionModel,
  resolvePrimaryModelVisionSupport,
  resolveVisionProviderSelection,
  VISION_MODEL_REQUIRED_MESSAGE,
} from "./image-vision-fallback";
import {
  invalidateJavascriptModuleCache,
  loadJavascriptTool,
  resolveJavascriptModulePath,
} from "./javascript-tool-loader";
import type { LlmUsageTracker } from "./llm-usage-tracker";
import type { McpClientManager } from "./mcp-client-manager";
import type { McpService } from "./mcp-service";
import { buildMcpToolDefinitions } from "./mcp-tool-bridge";
import { OrgMemoryService } from "./org-memory-service";
import { ProfileService } from "./profile-service";
import {
  applyProviderInstanceUpdate,
  buildProviderInstanceFromCreateRequest,
  countModelsForInstance,
  mergeModelsForConfig,
  resolveDefaultModelForInstance,
  resolveInitialModel,
  resolveProfileProviderSelection,
  toProviderInstanceSummary,
} from "./provider-instance-helpers";
import {
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
import type { TaskRunner } from "./task-runner";
import { resolveProfileStoredTools } from "./tool-resolver";

interface StoredSession {
  channel: AgentChannel;
  profileId: string;
  session: AgentChatSession;
}

export type { SubAgentRunInput, SubAgentRunResult };

export interface SessionAccessOptions {
  excludeSuperBot?: boolean;
  isPlatformAdmin?: boolean;
  orgRole?: OrgRole | null;
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
  private readonly orgMemoryTools: ToolDefinition[];
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
  private skillProposalService: SkillProposalService | null = null;
  private skillSuggestionService: SkillSuggestionService | null = null;
  private orgMemoryService: OrgMemoryService | null = null;
  private readonly sessions = new Map<string, StoredSession>();
  private readonly sessionTitleService: SessionTitleService;
  private skillPostTurnReviewService: SkillPostTurnReviewService;
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
    this.profileService = new ProfileService(db);
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
      this.superBotSessionState
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

  private async resolveOrgRole(
    orgId: string | null | undefined,
    userId: string | null | undefined
  ): Promise<OrgRole | null> {
    if (!(orgId && userId)) {
      return null;
    }
    const member = await this.db.getOrgMember(orgId, userId);
    return member?.role ?? null;
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
      provider: createProviderFromSources(process.env, this.userConfig),
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
    await this.db.upsertWorkspaceSettings({
      codingAgentHarnesses: existing?.codingAgentHarnesses ?? [],
      id: WORKSPACE_SETTINGS_ID,
      imageModel: existing?.imageModel ?? this.userConfig?.imageModel ?? null,
      selectedCodingAgentHarness: existing?.selectedCodingAgentHarness ?? null,
      transcriptionModel:
        existing?.transcriptionModel ??
        this.userConfig?.transcriptionModel ??
        null,
      updatedAt: new Date().toISOString(),
      visionModel: model,
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
    await this.db.upsertWorkspaceSettings({
      codingAgentHarnesses: existing?.codingAgentHarnesses ?? [],
      id: WORKSPACE_SETTINGS_ID,
      imageModel: existing?.imageModel ?? this.userConfig?.imageModel ?? null,
      selectedCodingAgentHarness: existing?.selectedCodingAgentHarness ?? null,
      transcriptionModel: model,
      updatedAt: new Date().toISOString(),
      visionModel:
        existing?.visionModel ?? this.userConfig?.visionModel ?? null,
    });

    if (this.userConfig) {
      this.userConfig = {
        ...this.userConfig,
        transcriptionModel: model,
      };
    }

    return { transcription };
  }

  async transcribeAudio(
    input: TranscribeAudioRequest
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

    const text = await transcribeAudioWithOpenAI(
      selection.instance.apiKey,
      selection.instance.baseUrl,
      selection.model,
      {
        bytes,
        filename: input.filename?.trim() || "audio.ogg",
        mediaType,
      }
    );

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

    await this.db.upsertWorkspaceSettings({
      codingAgentHarnesses: stored?.codingAgentHarnesses ?? [],
      id: WORKSPACE_SETTINGS_ID,
      imageModel: this.userConfig?.imageModel ?? null,
      selectedCodingAgentHarness: stored?.selectedCodingAgentHarness ?? null,
      transcriptionModel: legacyModel,
      updatedAt: new Date().toISOString(),
      visionModel: this.userConfig?.visionModel ?? null,
    });

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
    await this.db.upsertWorkspaceSettings({
      codingAgentHarnesses: existing?.codingAgentHarnesses ?? [],
      id: WORKSPACE_SETTINGS_ID,
      imageModel: model,
      selectedCodingAgentHarness: existing?.selectedCodingAgentHarness ?? null,
      transcriptionModel:
        existing?.transcriptionModel ??
        this.userConfig?.transcriptionModel ??
        null,
      updatedAt: new Date().toISOString(),
      visionModel:
        existing?.visionModel ?? this.userConfig?.visionModel ?? null,
    });

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

    await this.db.upsertWorkspaceSettings({
      codingAgentHarnesses: [],
      id: WORKSPACE_SETTINGS_ID,
      imageModel: legacyModel,
      selectedCodingAgentHarness: null,
      transcriptionModel: this.userConfig?.transcriptionModel ?? null,
      updatedAt: new Date().toISOString(),
      visionModel: this.userConfig?.visionModel ?? null,
    });

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

    await this.db.upsertWorkspaceSettings({
      codingAgentHarnesses: stored?.codingAgentHarnesses ?? [],
      id: WORKSPACE_SETTINGS_ID,
      imageModel: legacyImageModel,
      selectedCodingAgentHarness: stored?.selectedCodingAgentHarness ?? null,
      transcriptionModel: legacyTranscriptionModel,
      updatedAt: new Date().toISOString(),
      visionModel: legacyVisionModel,
    });

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

  async getTelegramSettings(): Promise<TelegramSettingsResponse> {
    return loadTelegramSettingsPublic();
  }

  async setTelegramSettings(
    input: UpdateTelegramSettingsRequest
  ): Promise<TelegramSettingsResponse> {
    const existing = await loadTelegramSettingsPublic();
    const botToken =
      input.botToken !== undefined && input.botToken.trim()
        ? input.botToken.trim()
        : undefined;

    if (!(botToken || existing.configured)) {
      throw new Error("Bot token is required.");
    }

    return saveTelegramConfig({
      ...(botToken ? { botToken } : {}),
      ...(input.allowedUserIds === undefined
        ? existing.allowedUserIds.length > 0
          ? { allowedUserIds: existing.allowedUserIds.join(",") }
          : {}
        : { allowedUserIds: input.allowedUserIds }),
      ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
    });
  }

  async regenerateTelegramHandshake(): Promise<TelegramSettingsResponse> {
    return regenerateTelegramHandshake();
  }

  async getDiscordSettings(): Promise<DiscordSettingsResponse> {
    return loadDiscordSettingsPublic();
  }

  async setDiscordSettings(
    input: UpdateDiscordSettingsRequest
  ): Promise<DiscordSettingsResponse> {
    const existing = await loadDiscordSettingsPublic();
    const botToken =
      input.botToken !== undefined && input.botToken.trim()
        ? input.botToken.trim()
        : undefined;

    if (!(botToken || existing.configured)) {
      throw new Error("Bot token is required.");
    }

    return saveDiscordConfig({
      ...(botToken ? { botToken } : {}),
      ...(input.allowedUserIds === undefined
        ? existing.allowedUserIds.length > 0
          ? { allowedUserIds: existing.allowedUserIds.join(",") }
          : {}
        : { allowedUserIds: input.allowedUserIds }),
      ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
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

  async getEmailSettings(): Promise<EmailSettingsResponse> {
    return loadEmailSettingsPublic();
  }

  async setEmailSettings(
    input: UpdateEmailSettingsRequest
  ): Promise<EmailSettingsResponse> {
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

  async getWhatsAppSettings(): Promise<WhatsAppSettingsResponse> {
    return loadWhatsAppSettingsPublic();
  }

  async setWhatsAppSettings(
    input: UpdateWhatsAppSettingsRequest
  ): Promise<WhatsAppSettingsResponse> {
    return saveWhatsAppConfig({
      ...(input.phoneNumber === undefined
        ? {}
        : { phoneNumber: input.phoneNumber.trim() }),
      ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
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

    const session = harness.createChatSession({
      channel: "automation",
      enableToolLoop: true,
      soul: soulActive,
      systemPrompt,
      toolContext: buildToolExecutionContext({
        automationId,
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
      "member"
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

    const session = harness.createChatSession({
      channel: "subagent",
      enableToolLoop: true,
      soul: soulActive,
      systemPrompt: childSystemPrompt,
      toolContext: buildToolExecutionContext({
        agentDepth: input.agentDepth,
        clientOrigin: input.clientOrigin,
        orgId: input.orgId,
        orgRole: "member",
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

  async runTaskPrompt(
    taskId: string,
    profileId: string,
    prompt: string
  ): Promise<string> {
    if (!this._providerConfigured) {
      throw new Error("Provider is not configured.");
    }

    const task = await this.db.getTask(taskId);

    if (!task?.orgId) {
      throw new Error("Task not found.");
    }

    const sessionId = await this.ensureTaskSession(
      taskId,
      profileId,
      task.orgId
    );
    const session = await this.resolveSession(sessionId);

    if (!session) {
      throw new Error("Session not found.");
    }

    return session.send(prompt);
  }

  async ensureTaskSession(
    taskId: string,
    profileId: string,
    orgId: string
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

    const sessionId = await this.createSession(
      orgId,
      "task",
      profileId,
      undefined,
      {
        orgRole: "member",
      }
    );

    await this.db.upsertTask({
      ...record,
      sessionId,
      updatedAt: new Date().toISOString(),
    });

    return sessionId;
  }

  async getTaskChatMessages(
    taskId: string,
    orgId?: string
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

    return { messages, sessionId };
  }

  private async seedTaskSessionFromRun(
    prompt: string,
    run: StoredTaskRunRecord,
    sessionId: string
  ): Promise<void> {
    const history: ChatMessage[] = [{ content: prompt, role: "user" }];

    if (run.status === "failed") {
      history.push({
        content: run.error ?? "Task run failed.",
        role: "assistant",
      });
    } else if (run.output) {
      history.push({
        content: run.output,
        role: "assistant",
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
    access?: SessionAccessOptions
  ): Promise<string> {
    const resolvedProfileId = await this.resolveSessionProfile(
      orgId,
      profileId
    );
    const profile = await this.requireProfile(orgId, resolvedProfileId);

    if (
      profile.isSuper &&
      (access?.excludeSuperBot ||
        !canAccessSuperBotProfile({
          isPlatformAdmin: access?.isPlatformAdmin,
          orgRole: access?.orgRole,
        }))
    ) {
      throw new NakamaApiError(
        "Super Bot is only available to org admins.",
        403
      );
    }

    const sessionId = nanoid();

    await this.db.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel,
      createdAt: new Date().toISOString(),
      id: sessionId,
      profileId: resolvedProfileId,
      title: null,
      userId: userId ?? null,
    });

    const session = await this.buildChatSession(
      channel,
      orgId,
      resolvedProfileId,
      sessionId,
      userId ?? null,
      access?.orgRole
    );

    this.sessions.set(sessionId, {
      channel,
      profileId: resolvedProfileId,
      session,
    });

    return sessionId;
  }

  async getSessionTodos(sessionId: string): Promise<AgentTodo[] | null> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return null;
    }

    return this.agentTodoState.listActive(sessionId);
  }

  async getSessionQuestionnaire(
    sessionId: string
  ): Promise<AgentQuestionnaire | null> {
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
    contextUsage: ChatContextUsage | null;
  } | null> {
    const record = await this.db.getSession(sessionId);

    if (!record) {
      return null;
    }

    const channel = parseAgentChannel(record.channel);

    if (!channel) {
      return null;
    }

    if (sessionTurnRegistry.isActive(sessionId)) {
      const liveSession = await this.resolveSession(sessionId);

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
        };
      }
    }

    const storedMessages = await this.db.listMessagesForSession(sessionId);
    const cached = this.sessions.get(sessionId)?.session;
    const contextUsage = cached
      ? cached.getContextUsage()
      : ((await this.resolveSession(sessionId))?.getContextUsage() ?? null);

    return {
      channel,
      contextUsage,
      messageMeta: storedMessages.map((message) => ({
        createdAt: message.createdAt,
        id: message.id,
        seq: message.seq,
      })),
      messages: storedMessages.map((message) => message.payload as ChatMessage),
    };
  }

  async branchSession(
    sessionId: string,
    messageIndex: number
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
    const branchTitle = sourceTitle
      ? `${sourceTitle} (Branch)`
      : "Untitled (Branch)";

    await this.db.upsertSession({
      agentQuestionnaire: null,
      agentTodos: [],
      channel: record.channel,
      createdAt: new Date().toISOString(),
      id: nextSessionId,
      profileId: record.profileId,
      title: null,
      userId: record.userId ?? null,
    });

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

    const { orgId } = await this.requireProfileRecord(record.profileId);

    const branchOrgRole = await this.resolveOrgRole(orgId, record.userId);
    const session = await this.buildChatSession(
      channel,
      orgId,
      record.profileId,
      nextSessionId,
      record.userId ?? null,
      branchOrgRole
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
    channel: AgentChannel
  ): Promise<ListSessionsResponse> {
    await this.requireProfile(orgId, profileId);

    const sessions = await this.db.listSessionSummaries(profileId, channel);

    return {
      sessions: sessions.map((session) => ({
        channel: parseAgentChannel(session.channel) ?? channel,
        createdAt: session.createdAt,
        id: session.id,
        messageCount: session.messageCount,
        preview: session.preview,
        profileId: session.profileId,
        title: session.title,
        updatedAt: session.updatedAt,
      })),
    };
  }

  scheduleSessionTitleGeneration(sessionId: string): void {
    this.sessionTitleService.scheduleSessionTitleGeneration(sessionId);
  }

  schedulePostTurnSkillReview(sessionId: string): void {
    this.skillPostTurnReviewService.schedulePostTurnSkillReview(sessionId);
  }

  getSkillPostTurnReviewService(): SkillPostTurnReviewService {
    return this.skillPostTurnReviewService;
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

    const resumeOrgRole = await this.resolveOrgRole(orgId, record.userId);
    const session = await this.buildChatSession(
      channel,
      orgId,
      record.profileId,
      sessionId,
      record.userId ?? null,
      resumeOrgRole
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
    options: { force?: boolean } = {}
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

    return this.harness.createAutomationFromPrompt({ channel, prompt });
  }

  async draftTaskPrompt(title: string, description?: string): Promise<string> {
    const provider = createProviderFromSources(process.env, this.userConfig);

    return draftTaskPromptFromFields(
      { description, title },
      { provider: provider ?? undefined }
    );
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
        throw new Error("API key is required to discover Fireworks models.");
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
      throw new Error("baseUrl or providerId is required.");
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
      throw new Error("Provider not found.");
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
        throw new Error(
          "Add an API key before discovering Ollama Cloud models."
        );
      }

      // Prefer an explicit baseUrl (e.g. unsaved Edit provider field) over the stored one.
      const baseUrl =
        overrides?.baseUrl ||
        instance.baseUrl?.trim() ||
        (instance.type === "ollama" ? defaultOllamaBaseUrl(hostMode!) : "");

      if (!baseUrl) {
        throw new Error("A base URL is required to discover models.");
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
        throw new Error("Add an API key before discovering Fireworks models.");
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

    if (instance.type !== "openai") {
      throw new Error(
        `Remote model discovery is not supported for ${instance.type}.`
      );
    }

    if (!instance.apiKey.trim()) {
      throw new Error("Add an API key before discovering models.");
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
    request: UpdateProfileRequest
  ): Promise<ProfileResponse> {
    const response = await this.profileService.updateProfile(
      orgId,
      profileId,
      request
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
    context: { orgId: string; userId: string }
  ): Promise<RunToolResponse> {
    const { tool } = await this.profileService.getTool(toolId);

    if (tool.handlerType !== "javascript") {
      throw new Error(
        "Only custom JavaScript tools can be run in the playground."
      );
    }

    const record = await this.db.getTool(toolId);

    if (!record) {
      throw new Error("Tool not found.");
    }

    const profileId = await this.resolvePlaygroundProfileId(
      context.orgId,
      toolId
    );

    const handlerConfig =
      typeof record.handlerConfig === "object" && record.handlerConfig !== null
        ? (record.handlerConfig as { modulePath?: string })
        : null;

    if (handlerConfig?.modulePath) {
      try {
        invalidateJavascriptModuleCache(
          resolveJavascriptModulePath(handlerConfig.modulePath)
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

    if (tool.handlerType !== "javascript") {
      throw new Error(
        "Only custom JavaScript tools support parameter suggestions."
      );
    }

    const record = await this.db.getTool(toolId);

    if (!record) {
      throw new Error("Tool not found.");
    }

    const loaded = await loadJavascriptTool(record);
    const provider = createProviderFromSources(process.env, this.userConfig);
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
    request: AssignToolRequest
  ): Promise<ProfileResponse> {
    return this.profileService.assignTool(orgId, profileId, request);
  }

  async unassignTool(
    orgId: string,
    profileId: string,
    toolId: string
  ): Promise<ProfileResponse> {
    return this.profileService.unassignTool(orgId, profileId, toolId);
  }

  async assignMcpServer(
    orgId: string,
    profileId: string,
    request: { serverId: string }
  ): Promise<ProfileResponse> {
    return this.profileService.assignMcpServer(orgId, profileId, request);
  }

  async unassignMcpServer(
    orgId: string,
    profileId: string,
    serverId: string
  ): Promise<ProfileResponse> {
    return this.profileService.unassignMcpServer(orgId, profileId, serverId);
  }

  async listSkills(): Promise<ListSkillsResponse> {
    return this.requireSkillsService().listSkills();
  }

  async getSkill(skillId: string): Promise<SkillResponse> {
    return this.requireSkillsService().getSkill(skillId);
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
    request: AssignSkillRequest
  ): Promise<ProfileResponse> {
    return this.profileService.assignSkill(orgId, profileId, request);
  }

  async unassignSkill(
    orgId: string,
    profileId: string,
    skillId: string
  ): Promise<ProfileResponse> {
    return this.profileService.unassignSkill(orgId, profileId, skillId);
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

  async getProfileAvatarByProfileId(
    profileId: string
  ): Promise<{ mediaType: string; bytes: Buffer }> {
    return this.profileService.getProfileAvatarByProfileId(profileId);
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
    document: DocumentAttachment
  ): Promise<UploadKnowledgeBaseResponse> {
    return this.profileService.uploadKnowledgeBaseDocument(
      orgId,
      profileId,
      document
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

  async getProfileSoulStatus(
    orgId: string,
    profileId: string,
    includeContents = false
  ): Promise<SoulStatusResponse> {
    const profile = await this.requireProfile(orgId, profileId);
    const status = await getResolvedSoulStatus(orgId, profileId);

    if (!includeContents) {
      return { ...status, profileId };
    }

    const stack = await loadSoulStack(getProfileSoulDir(orgId, profileId));
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
    const stack = await loadSoulStack(getProfileSoulDir(orgId, profileId));
    return { ...stack, profileId };
  }

  async writeProfileSoulFile(
    orgId: string,
    profileId: string,
    key: string,
    request: UpdateSoulFileRequest
  ): Promise<void> {
    await this.requireProfile(orgId, profileId);

    if (!isWritableSoulFileKey(key)) {
      throw new Error(`Invalid soul file key: ${key}`);
    }

    await writeSoulFile(
      getProfileSoulDir(orgId, profileId),
      key,
      request.content
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
    options: { render?: "markdown" } = {}
  ) {
    await this.requireProfile(orgId, profileId);
    return readArtifactFile({
      filename,
      orgId,
      profileId,
      render: options.render,
    });
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
  }): AgentHarness {
    const providerInstance = options.providerInstance ?? null;

    this.syncUsagePricingContext(providerInstance);

    const trackedProvider =
      options.provider && this.llmUsageTracker && options.modelId
        ? wrapProviderWithUsageTracking(
            options.provider,
            this.llmUsageTracker,
            options.modelId
          )
        : options.provider;

    return createAgentHarness({
      chatOptions: this.resolveChatProviderOptions(
        providerInstance,
        options.thinking
      ),
      provider: trackedProvider ?? undefined,
    });
  }

  private syncUsagePricingContext(
    active: ReturnType<typeof getActiveProviderInstance>
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

  private async requireProfile(
    orgId: string,
    profileId: string
  ): Promise<StoredProfileRecord> {
    const profile = await this.db.getProfileForOrg(profileId, orgId);

    if (!profile) {
      throw new Error("Profile not found.");
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
      includeAutomationTools?: boolean;
      includeTodoTools?: boolean;
      includeQuestionTools?: boolean;
      includeSubAgentTool?: boolean;
      includeSkillManageTools?: boolean;
      userId?: string | null;
    } = {}
  ): Promise<ToolDefinition[]> {
    const storedTools = await this.db.listToolsForProfile(profile.id);
    const tools = await resolveProfileStoredTools(storedTools, this.db, [], {
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

      const skillTools = await this.skillsService.loadToolsForProfile(
        orgId,
        profile.id
      );
      resolved = [...resolved, ...skillTools];

      // Interactive web/cli only: messaging, automation, task, and subagent omit this.
      if (includeSkillManageTools) {
        const assignedSkills = await this.skillsService.listSkillsForProfile(
          profile.id
        );
        if (assignedSkills.some((skill) => skill.name === "manage-skills")) {
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

    resolved = [...resolved, ...this.orgMemoryTools];

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
    orgRole?: OrgRole | null
  ): Promise<AgentChatSession> {
    await this.ensureVisionSettingsLoaded();
    const profile = await this.requireProfile(orgId, profileId);
    const includeSkillManageTools = channel === "web" || channel === "cli";
    let tools = await this.resolveProfileTools(profile, {
      includeSkillManageTools,
      userId,
    });
    if (channel === "discord") {
      tools = [...tools, ...createSendDiscordArtifactTools()];
    }
    const skillUsageContext =
      channel === "web" || channel === "cli"
        ? { seenCatalogSkillIds: new Set<string>(), sessionId }
        : undefined;
    const { systemPrompt, soulActive } = await this.resolveProfileSystemPrompt(
      orgId,
      profileId,
      profile.systemPrompt,
      orgRole,
      skillUsageContext
    );
    // Per-org override for the tool-output optimiser. Undefined leaves the
    // decision to the server's env var, so an operator who never opened the UI
    // keeps whatever they configured.
    const tokenOptimizerEnabled = (await this.db.getWorkspaceSettings())
      ?.tokenOptimizerEnabled;
    const resolvedSystemPrompt = profile.isSuper
      ? `${systemPrompt.trim()}\n\n${SUPER_BOT_TOOL_AUTHORING_RULES}`
      : systemPrompt;
    const initialHistory = await loadSessionHistory(this.db, sessionId);
    const userTimezone = await this.getUserTimezone();
    const userContext = await this.loadUserContextForUser(orgId, userId);
    const compaction = this.resolveCompactionConfig(profile);
    const harness = this.createHarnessForProfile(profile);
    const saveAttachment = createAttachmentSaver(this.db, {
      channel,
      orgId,
      profileId,
      sessionId,
    });
    const loadAttachment = createAttachmentLoader(this.db, {
      orgId,
      profileId,
    });
    const hasSkillManage = tools.some((tool) => tool.name === "skill_manage");

    const session = harness.createChatSession({
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
          profile.model
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
            visionSelection.model
          );
        }

        const descriptions = await describeImagesWithVisionModel(
          visionProvider,
          extractImageParts(forVision)
        );

        return replaceImagePartsWithDescriptions(forVision, descriptions);
      },
      rehydrateMessagesForProvider: (messages) =>
        rehydrateAttachmentMessages(messages, loadAttachment),
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
                    parts.push(await this.formatProfileAuthoringToolContext());
                  }

                  if (matched.some((skill) => skill.name === "coding-agent")) {
                    parts.push(
                      await this.formatCodingDelegationContext(orgId, profileId)
                    );
                  }

                  return parts.filter(Boolean).join("\n\n");
                },
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
        channel,
        forbidProfileSkillMarkdownWrites: hasSkillManage,
        loadAttachment,
        orgId,
        orgRole: orgRole ?? undefined,
        profileId,
        recordToolOutputSavings: this.savingsRecorderFor(orgId),
        recordTurnUsage: this.turnUsageRecorderFor(orgId),
        sessionId,
        tokenOptimizerEnabled: tokenOptimizerEnabled ?? undefined,
        userId: userId ?? undefined,
      }),
      tools,
      userContext,
      userTimezone,
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
    profileId: string
  ): Promise<string> {
    const profile = await this.db.getProfile(profileId);
    const installed = await listInstalledCodingAgentHarnesses(this.db);
    const workspaceRoot = getProfileSoulDir(orgId, profileId);
    const probeContext = {
      profileModel: profile?.model ?? null,
      userConfig: this.userConfig,
    };

    if (installed.length === 0) {
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

    if (installed.length > 1) {
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

    const harness = installed[0]!;
    return this.formatSingleCodingHarnessContext(
      harness,
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
    usageContext?: import("./skills-service").SkillUsageRecordingContext
  ): Promise<{ systemPrompt: string; soulActive: boolean }> {
    const stack = await resolveSoulStackForProfile(orgId, profileId);
    let systemPrompt = stack
      ? composeSoulSystemPrompt(stack, { profilePrompt })
      : profilePrompt;

    if (this.skillsService) {
      const skillsCatalog = await this.skillsService.composeCatalogForProfile(
        orgId,
        profileId,
        usageContext
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

  private createHarnessForProfile(profile: StoredProfileRecord): AgentHarness {
    const resolved = resolveProfileProviderSelection({
      defaultProviderId: this.userConfig?.defaultProviderId,
      profileModel: profile.model,
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
      resolved.model
    );
    const primarySupportsVision = resolvePrimaryModelVisionSupport(
      this.userConfig,
      profile.model
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
    profile: StoredProfileRecord
  ): CompactionConfig | undefined {
    const resolved = resolveProfileProviderSelection({
      defaultProviderId: this.userConfig?.defaultProviderId,
      profileModel: profile.model,
      providers: this.userConfig?.providers ?? [],
    });

    if (!resolved) {
      return;
    }

    const model = getModelById(resolved.model);

    return {
      contextWindow: model?.contextWindow ?? 128_000,
      maxOutputTokens: model?.maxOutputTokens ?? 8192,
    };
  }

  private resolveWorkspaceThinkingDefaults(): ThinkingSettings {
    return {
      effort: this.userConfig?.thinkingEffort ?? DEFAULT_THINKING_EFFORT,
      enabled: this.userConfig?.thinkingEnabled ?? DEFAULT_THINKING_ENABLED,
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
