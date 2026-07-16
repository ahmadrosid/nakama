export const queryKeys = {
  health: ["health"] as const,
  models: ["models"] as const,
  providers: ["providers"] as const,
  providerModelDiscovery: (providerId: string) =>
    ["providers", providerId, "modelDiscovery"] as const,
  systemStatus: ["systemStatus"] as const,
  webPublicUrl: ["system", "webPublicUrl"] as const,
  profiles: {
    all: ["profiles"] as const,
    detail: (profileId: string) => ["profiles", profileId] as const,
  },
  tools: {
    all: ["tools"] as const,
    detail: (toolId: string) => ["tools", toolId] as const,
    source: (toolId: string) => ["tools", toolId, "source"] as const,
  },
  mcp: {
    all: ["mcp", "servers"] as const,
    detail: (serverId: string) => ["mcp", "servers", serverId] as const,
  },
  skills: {
    all: ["skills"] as const,
    detail: (skillId: string) => ["skills", skillId] as const,
  },
  automations: {
    all: ["automations"] as const,
    runs: (automationId: string) => ["automations", automationId, "runs"] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    messages: (taskId: string) => ["tasks", taskId, "messages"] as const,
  },
  sessions: (profileId: string, channel: string) => ["sessions", profileId, channel] as const,
  soul: {
    profile: (profileId: string) => ["soul", "profile", profileId] as const,
  },
  knowledgeBase: {
    profile: (profileId: string) => ["knowledgeBase", profileId] as const,
  },
  artifacts: {
    profile: (profileId: string) => ["artifacts", profileId] as const,
    shareStatus: (profileId: string, path: string) =>
      ["artifacts", profileId, "share", path] as const,
  },
  timezones: {
    catalog: ["timezones", "catalog"] as const,
    settings: ["timezones", "settings"] as const,
  },
  thinkingSettings: ["thinking", "settings"] as const,
  visionSettings: ["vision", "settings"] as const,
  transcriptionSettings: ["transcription", "settings"] as const,
  telegram: {
    settings: ["telegram", "settings"] as const,
  },
  notificationDestinations: {
    all: ["notificationDestinations"] as const,
  },
  composio: {
    toolkits: ["composio", "toolkits"] as const,
    settings: ["composio", "settings"] as const,
    profileToolkits: (profileId: string) => ["composio", "profiles", profileId] as const,
  },
  email: {
    settings: ["email", "settings"] as const,
  },
  codingHarnesses: {
    settings: ["codingHarnesses", "settings"] as const,
  },
  whatsapp: {
    settings: ["whatsapp", "settings"] as const,
  },
  discord: {
    settings: ["discord", "settings"] as const,
  },
  userContext: ["userContext"] as const,
  modelsDev: ["modelsDev"] as const,
  openRouterModels: ["openRouterModels"] as const,
  workerLogs: ["workerLogs"] as const,
  orgMembers: (orgId: string) => ["orgMembers", orgId] as const,
} as const;
