export const queryKeys = {
  agentBrowser: {
    settings: ["agentBrowser", "settings"] as const,
  },
  artifacts: {
    profile: (profileId: string) => ["artifacts", profileId] as const,
    shareStatus: (profileId: string, path: string) =>
      ["artifacts", profileId, "share", path] as const,
  },
  automations: {
    all: ["automations"] as const,
    runs: (automationId: string) =>
      ["automations", automationId, "runs"] as const,
  },
  cerebrasModels: ["cerebrasModels"] as const,
  composio: {
    profileToolkits: (profileId: string) =>
      ["composio", "profiles", profileId] as const,
    settings: ["composio", "settings"] as const,
    toolkits: ["composio", "toolkits"] as const,
  },
  discord: {
    settings: ["discord", "settings"] as const,
  },
  email: {
    settings: ["email", "settings"] as const,
  },
  errorTracking: {
    settings: ["error-tracking", "settings"] as const,
  },
  health: ["health"] as const,
  imageGenerationSettings: ["imageGeneration", "settings"] as const,
  knowledgeBase: {
    profile: (profileId: string) => ["knowledgeBase", profileId] as const,
  },
  mcp: {
    all: ["mcp", "servers"] as const,
    detail: (serverId: string) => ["mcp", "servers", serverId] as const,
  },
  models: ["models"] as const,
  modelsDev: ["modelsDev"] as const,
  notificationDestinations: {
    all: ["notificationDestinations"] as const,
  },
  openRouterModels: ["openRouterModels"] as const,
  orgMembers: (orgId: string) => ["orgMembers", orgId] as const,
  orgMemory: (orgId: string) => ["orgMemory", orgId] as const,
  orgMemoryHistory: (orgId: string) => ["orgMemoryHistory", orgId] as const,
  orgMemoryHistoryRevision: (orgId: string, revisionId: string) =>
    ["orgMemoryHistoryRevision", orgId, revisionId] as const,
  orgMemoryProposals: (orgId: string, status?: string) =>
    ["orgMemoryProposals", orgId, status ?? "all"] as const,
  profiles: {
    all: ["profiles"] as const,
    detail: (profileId: string) => ["profiles", profileId] as const,
    history: (profileId: string) => ["profiles", profileId, "history"] as const,
  },
  providerModelDiscovery: (providerId: string) =>
    ["providers", providerId, "modelDiscovery"] as const,
  providers: ["providers"] as const,
  remoteModelDiscovery: (options: {
    providerId?: string;
    baseUrl?: string;
    provider?: string;
    hostMode?: string;
    apiKey?: string;
  }) => ["remoteModelDiscovery", options] as const,
  sessions: (profileId: string, channel: string) =>
    ["sessions", profileId, channel] as const,
  skillProposals: (orgId: string, status?: string, profileId?: string) =>
    ["skillProposals", orgId, status ?? "all", profileId ?? "all"] as const,
  skillSuggestions: (
    orgId: string,
    options: { status?: string; sessionId?: string; profileId?: string } = {}
  ) =>
    [
      "skillSuggestions",
      orgId,
      options.status ?? "all",
      options.sessionId ?? "all",
      options.profileId ?? "all",
    ] as const,
  skills: {
    all: ["skills"] as const,
    detail: (skillId: string) => ["skills", skillId] as const,
  },
  soul: {
    profile: (profileId: string) => ["soul", "profile", profileId] as const,
  },
  systemStatus: ["systemStatus"] as const,
  tasks: {
    all: ["tasks"] as const,
    messages: (taskId: string) => ["tasks", taskId, "messages"] as const,
  },
  telegram: {
    settings: ["telegram", "settings"] as const,
  },
  thinkingSettings: ["thinking", "settings"] as const,
  timezones: {
    catalog: ["timezones", "catalog"] as const,
    settings: ["timezones", "settings"] as const,
  },
  tools: {
    all: ["tools"] as const,
    detail: (toolId: string) => ["tools", toolId] as const,
    source: (toolId: string) => ["tools", toolId, "source"] as const,
  },
  transcriptionSettings: ["transcription", "settings"] as const,
  userContext: ["userContext"] as const,
  visionSettings: ["vision", "settings"] as const,
  webPublicUrl: ["system", "webPublicUrl"] as const,
  webSearchSettings: ["webSearch", "settings"] as const,
  whatsapp: {
    settings: ["whatsapp", "settings"] as const,
  },
  workerLogs: ["workerLogs"] as const,
} as const;
