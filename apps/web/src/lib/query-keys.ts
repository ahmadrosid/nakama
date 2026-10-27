export const queryKeys = {
  acpAgentPresets: ["acpAgentPresets"] as const,
  acpSettings: {
    profile: (profileId: string, agentKey: string) =>
      ["acpSettings", "profile", profileId, agentKey] as const,
    session: (sessionId: string, agentKey: string) =>
      ["acpSettings", "session", sessionId, agentKey] as const,
  },
  agentBrowser: {
    settings: ["agentBrowser", "settings"] as const,
  },
  agentGroups: {
    all: ["agentGroups"] as const,
    detail: (groupId: string) => ["agentGroups", groupId] as const,
    files: (groupId: string, folder: string) =>
      ["agentGroups", groupId, "files", folder] as const,
    memory: (groupId: string) => ["agentGroups", groupId, "memory"] as const,
    session: (groupId: string, sessionId: string) =>
      ["agentGroups", groupId, "sessions", sessionId] as const,
    sessions: (groupId: string) =>
      ["agentGroups", groupId, "sessions"] as const,
    thread: (groupId: string, sessionId: string, messageId: number) =>
      [
        "agentGroups",
        groupId,
        "sessions",
        sessionId,
        "threads",
        messageId,
      ] as const,
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
  browserSessions: ["browserSessions"] as const,
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
    organization: (orgId: string) =>
      ["knowledgeBase", "organization", orgId] as const,
    profile: (profileId: string) => ["knowledgeBase", profileId] as const,
    published: (orgId: string, publicationId: string) =>
      ["knowledgeBase", "published", orgId, publicationId] as const,
  },
  mcp: {
    all: ["mcp", "servers"] as const,
    detail: (serverId: string) => ["mcp", "servers", serverId] as const,
  },
  models: ["models"] as const,
  modelsDev: ["modelsDev"] as const,
  notificationDestinations: (orgId: string) =>
    ["notificationDestinations", orgId] as const,
  openRouterModels: ["openRouterModels"] as const,
  organizationOverview: (parentOrgId: string, activeOrgId: string) =>
    ["organizationOverview", parentOrgId, activeOrgId] as const,
  organizationPublicationCatalog: (orgId: string, kind: string) =>
    ["organizationPublicationCatalog", orgId, kind] as const,
  // Under orgMembers, so a new invite refreshes this list too.
  orgInvites: (orgId: string) => ["orgMembers", orgId, "invites"] as const,
  orgMembers: (orgId: string) => ["orgMembers", orgId] as const,
  orgMemory: (orgId: string) => ["orgMemory", orgId] as const,
  orgMemoryHistory: (orgId: string) => ["orgMemoryHistory", orgId] as const,
  orgMemoryHistoryRevision: (orgId: string, revisionId: string) =>
    ["orgMemoryHistoryRevision", orgId, revisionId] as const,
  orgMemoryProposals: (orgId: string, status?: string) =>
    ["orgMemoryProposals", orgId, status ?? "all"] as const,
  orgParentMembers: (orgId: string) => ["orgParentMembers", orgId] as const,
  plugins: {
    all: (orgId: string) => ["plugins", orgId] as const,
    detail: (orgId: string, pluginId: string) =>
      ["plugins", orgId, pluginId] as const,
    releases: ["plugins", "releases"] as const,
    // Under releases so approving a release refreshes the check too.
    updates: ["plugins", "releases", "updates"] as const,
    // Under releases so removing a release refreshes who still uses it.
    usage: (pluginId: string) =>
      ["plugins", "releases", "usage", pluginId] as const,
  },
  profiles: {
    all: ["profiles"] as const,
    detail: (profileId: string) => ["profiles", profileId] as const,
    history: (profileId: string) => ["profiles", profileId, "history"] as const,
  },
  providerModelDiscovery: (providerId: string) =>
    ["providers", providerId, "modelDiscovery"] as const,
  providers: ["providers"] as const,
  railPins: ["railPins"] as const,
  remoteModelDiscovery: (options: {
    providerId?: string;
    baseUrl?: string;
    provider?: string;
    hostMode?: string;
    apiKey?: string;
  }) => ["remoteModelDiscovery", options] as const,
  // Outside "sessions", so invalidating the list does not also re-run its poll.
  sessionListHead: (profileId: string, search?: string) =>
    search
      ? (["sessionListHead", profileId, search] as const)
      : (["sessionListHead", profileId] as const),
  sessionSearch: (profileId: string, search: string) =>
    ["sessions", profileId, "search", search] as const,
  sessionSummary: (profileId: string, sessionId: string) =>
    ["sessions", profileId, sessionId] as const,
  sessions: (profileId: string) => ["sessions", profileId] as const,
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
    // Outside "skills" so invalidating installed skills does not refetch skills.sh.
    marketplace: (query: string) => ["skills-marketplace", query] as const,
    marketplacePreview: (command: string) =>
      ["skills-marketplace", "preview", command] as const,
    published: (orgId: string, publicationId: string) =>
      ["skills", "published", orgId, publicationId] as const,
  },
  slack: {
    settings: ["slack", "settings"] as const,
  },
  soul: {
    profile: (profileId: string) => ["soul", "profile", profileId] as const,
  },
  systemStatus: ["systemStatus"] as const,
  telegram: {
    requests: ["telegram", "requests"] as const,
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
    published: (orgId: string, publicationId: string) =>
      ["tools", "published", orgId, publicationId] as const,
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
  workflows: {
    all: ["workflows"] as const,
    database: {
      all: ["workflows", "database"] as const,
      table: (table: string | null) =>
        ["workflows", "database", table ?? ""] as const,
    },
    detail: (workflowId: string) => ["workflows", workflowId] as const,
    runs: (workflowId: string) => ["workflows", workflowId, "runs"] as const,
  },
} as const;
