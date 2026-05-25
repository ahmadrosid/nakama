import type {
  DatabaseAdapter,
  StoredAutomationRecord,
  StoredAutomationRunRecord,
  StoredProfileRecord,
  StoredSessionMessageRecord,
  StoredSessionRecord,
  StoredSessionSummaryRecord,
  StoredToolRecord,
} from "../types";

export function createInMemoryDatabaseAdapter(): DatabaseAdapter {
  const automations = new Map<string, StoredAutomationRecord>();
  const automationRuns = new Map<string, StoredAutomationRunRecord[]>();
  const profiles = new Map<string, StoredProfileRecord>();
  const tools = new Map<string, StoredToolRecord>();
  const toolsByName = new Map<string, StoredToolRecord>();
  const profileTools = new Map<string, Set<string>>();
  const sessions = new Map<string, StoredSessionRecord>();
  const sessionMessages = new Map<string, StoredSessionMessageRecord[]>();

  return {
    async listAutomations() {
      return Array.from(automations.values());
    },

    async getAutomation(id) {
      return automations.get(id) ?? null;
    },

    async upsertAutomation(record) {
      automations.set(record.id, record);
    },

    async deleteAutomation(id) {
      automationRuns.delete(id);
      return automations.delete(id);
    },

    async listAutomationRuns(automationId, limit = 20) {
      return [...(automationRuns.get(automationId) ?? [])]
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .slice(0, limit);
    },

    async getActiveAutomationRun(automationId) {
      return (
        [...(automationRuns.get(automationId) ?? [])]
          .filter((run) => run.status === "running")
          .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null
      );
    },

    async insertAutomationRun(record) {
      const existing = automationRuns.get(record.automationId) ?? [];
      automationRuns.set(record.automationId, [...existing, record]);
    },

    async updateAutomationRun(record) {
      const existing = automationRuns.get(record.automationId) ?? [];
      automationRuns.set(
        record.automationId,
        existing.map((run) => (run.id === record.id ? record : run)),
      );
    },

    async listProfiles() {
      return Array.from(profiles.values());
    },

    async getProfile(id) {
      return profiles.get(id) ?? null;
    },

    async upsertProfile(record) {
      profiles.set(record.id, record);
    },

    async deleteProfile(id) {
      if (!profiles.delete(id)) {
        return false;
      }

      profileTools.delete(id);
      return true;
    },

    async listTools() {
      return Array.from(tools.values());
    },

    async getTool(id) {
      return tools.get(id) ?? null;
    },

    async getToolByName(name) {
      return toolsByName.get(name) ?? null;
    },

    async upsertTool(record) {
      const existing = tools.get(record.id);

      if (existing) {
        toolsByName.delete(existing.name);
      }

      tools.set(record.id, record);
      toolsByName.set(record.name, record);
    },

    async deleteTool(id) {
      const existing = tools.get(id);

      if (!existing) {
        return false;
      }

      tools.delete(id);
      toolsByName.delete(existing.name);

      for (const assigned of profileTools.values()) {
        assigned.delete(id);
      }

      return true;
    },

    async listToolsForProfile(profileId) {
      const assigned = profileTools.get(profileId);

      if (!assigned) {
        return [];
      }

      return Array.from(assigned)
        .map((toolId) => tools.get(toolId))
        .filter((tool): tool is StoredToolRecord => tool !== undefined);
    },

    async assignToolToProfile(profileId, toolId) {
      const assigned = profileTools.get(profileId) ?? new Set<string>();
      assigned.add(toolId);
      profileTools.set(profileId, assigned);
    },

    async unassignToolFromProfile(profileId, toolId) {
      const assigned = profileTools.get(profileId);

      if (!assigned?.delete(toolId)) {
        return false;
      }

      return true;
    },

    async listSessions() {
      return Array.from(sessions.values());
    },

    async listSessionSummaries(profileId, channel) {
      return Array.from(sessions.values())
        .filter((session) => session.profileId === profileId && session.channel === channel)
        .map((session) => summarizeSession(session, sessionMessages.get(session.id) ?? []))
        .filter((summary) => summary.messageCount > 0)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    async getSession(id) {
      return sessions.get(id) ?? null;
    },

    async upsertSession(record) {
      sessions.set(record.id, record);
    },

    async deleteSession(id) {
      sessionMessages.delete(id);
      return sessions.delete(id);
    },

    async listMessagesForSession(sessionId) {
      return [...(sessionMessages.get(sessionId) ?? [])].sort((left, right) => left.seq - right.seq);
    },

    async appendMessagesForSession(sessionId, messages) {
      const existing = sessionMessages.get(sessionId) ?? [];
      sessionMessages.set(sessionId, [...existing, ...messages]);
    },

    async deleteMessagesForSession(sessionId) {
      sessionMessages.delete(sessionId);
    },
  };
}

function summarizeSession(
  session: StoredSessionRecord,
  messages: StoredSessionMessageRecord[],
): StoredSessionSummaryRecord {
  const sorted = [...messages].sort((left, right) => left.seq - right.seq);
  const updatedAt =
    sorted.length > 0
      ? sorted[sorted.length - 1]!.createdAt
      : session.createdAt;
  const firstUser = sorted.find(
    (message) =>
      typeof message.payload === "object" &&
      message.payload !== null &&
      (message.payload as { role?: string }).role === "user",
  );
  const preview =
    typeof firstUser?.payload === "object" &&
    firstUser.payload !== null &&
    typeof (firstUser.payload as { content?: unknown }).content === "string"
      ? ((firstUser.payload as { content: string }).content.trim() || null)
      : null;

  return {
    id: session.id,
    profileId: session.profileId,
    channel: session.channel,
    createdAt: session.createdAt,
    updatedAt,
    messageCount: sorted.length,
    preview,
  };
}
