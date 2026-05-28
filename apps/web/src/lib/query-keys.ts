export const queryKeys = {
  health: ["health"] as const,
  models: ["models"] as const,
  systemStatus: ["systemStatus"] as const,
  profiles: {
    all: ["profiles"] as const,
    detail: (profileId: string) => ["profiles", profileId] as const,
  },
  tools: {
    all: ["tools"] as const,
  },
  automations: {
    all: ["automations"] as const,
    runs: (automationId: string) => ["automations", automationId, "runs"] as const,
  },
  tasks: {
    all: ["tasks"] as const,
    runs: (taskId: string) => ["tasks", taskId, "runs"] as const,
    messages: (taskId: string) => ["tasks", taskId, "messages"] as const,
  },
  sessions: (profileId: string, channel: string) => ["sessions", profileId, channel] as const,
  soul: {
    global: ["soul", "global"] as const,
    profile: (profileId: string) => ["soul", "profile", profileId] as const,
  },
  timezones: {
    catalog: ["timezones", "catalog"] as const,
    settings: ["timezones", "settings"] as const,
  },
  telegram: {
    settings: ["telegram", "settings"] as const,
  },
  userContext: ["userContext"] as const,
} as const;
