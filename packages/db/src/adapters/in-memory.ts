import { getUserMessageText, type MessageContentPart } from "@tinyclaw/core";
import { LLM_USAGE_STATS_ID } from "../constants";
import type {
  DatabaseAdapter,
  LlmUsageStatsDelta,
  StoredAutomationRecord,
  StoredAutomationRunRecord,
  StoredLlmUsageStatsRecord,
  StoredMcpServerRecord,
  StoredProfileRecord,
  StoredSessionMessageRecord,
  StoredSessionRecord,
  StoredSessionSummaryRecord,
  StoredTaskRecord,
  StoredTaskRunRecord,
  StoredToolRecord,
} from "../types";

export function createInMemoryDatabaseAdapter(): DatabaseAdapter {
  const automations = new Map<string, StoredAutomationRecord>();
  const automationRuns = new Map<string, StoredAutomationRunRecord[]>();
  const tasks = new Map<string, StoredTaskRecord>();
  const taskRuns = new Map<string, StoredTaskRunRecord[]>();
  const profiles = new Map<string, StoredProfileRecord>();
  const tools = new Map<string, StoredToolRecord>();
  const toolsByName = new Map<string, StoredToolRecord>();
  const profileTools = new Map<string, Set<string>>();
  const mcpServers = new Map<string, StoredMcpServerRecord>();
  const mcpServersByName = new Map<string, StoredMcpServerRecord>();
  const profileMcpServers = new Map<string, Set<string>>();
  const sessions = new Map<string, StoredSessionRecord>();
  const sessionMessages = new Map<string, StoredSessionMessageRecord[]>();
  let llmUsageStats: StoredLlmUsageStatsRecord | null = null;

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
      profileMcpServers.delete(id);
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

    async updateSessionTitle(sessionId, title) {
      const session = sessions.get(sessionId);

      if (!session || session.title !== null) {
        return false;
      }

      sessions.set(sessionId, { ...session, title });
      return true;
    },

    async getSessionTodos(sessionId) {
      return sessions.get(sessionId)?.agentTodos ?? [];
    },

    async updateSessionTodos(sessionId, todos) {
      const session = sessions.get(sessionId);

      if (!session) {
        return;
      }

      sessions.set(sessionId, { ...session, agentTodos: todos });
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

    async replaceMessagesForSession(sessionId, messages) {
      sessionMessages.set(sessionId, [...messages]);
    },

    async deleteMessagesForSession(sessionId) {
      sessionMessages.delete(sessionId);
    },

    async listTasks() {
      return Array.from(tasks.values()).sort((left, right) => {
        const statusCompare = left.status.localeCompare(right.status);
        return statusCompare !== 0 ? statusCompare : left.position - right.position;
      });
    },

    async getTask(id) {
      return tasks.get(id) ?? null;
    },

    async upsertTask(record) {
      tasks.set(record.id, record);
    },

    async deleteTask(id) {
      taskRuns.delete(id);
      return tasks.delete(id);
    },

    async listTaskRuns(taskId, limit = 20) {
      return [...(taskRuns.get(taskId) ?? [])]
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .slice(0, limit);
    },

    async getActiveTaskRun(taskId) {
      return (
        [...(taskRuns.get(taskId) ?? [])]
          .filter((run) => run.status === "running")
          .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null
      );
    },

    async insertTaskRun(record) {
      const existing = taskRuns.get(record.taskId) ?? [];
      taskRuns.set(record.taskId, [...existing, record]);
    },

    async updateTaskRun(record) {
      const existing = taskRuns.get(record.taskId) ?? [];
      taskRuns.set(
        record.taskId,
        existing.map((run) => (run.id === record.id ? record : run)),
      );
    },

    async getLlmUsageStats() {
      return llmUsageStats;
    },

    async incrementLlmUsageStats(delta: LlmUsageStatsDelta, trackedSince: string) {
      const updatedAt = new Date().toISOString();

      if (!llmUsageStats) {
        llmUsageStats = {
          id: LLM_USAGE_STATS_ID,
          requestCount: delta.requestCount,
          inputTokens: delta.inputTokens,
          outputTokens: delta.outputTokens,
          estimatedCostUsd: delta.estimatedCostUsd,
          trackedSince,
          updatedAt,
        };
        return;
      }

      llmUsageStats = {
        ...llmUsageStats,
        requestCount: llmUsageStats.requestCount + delta.requestCount,
        inputTokens: llmUsageStats.inputTokens + delta.inputTokens,
        outputTokens: llmUsageStats.outputTokens + delta.outputTokens,
        estimatedCostUsd: llmUsageStats.estimatedCostUsd + delta.estimatedCostUsd,
        updatedAt,
      };
    },

    async listMcpServers() {
      return Array.from(mcpServers.values());
    },

    async getMcpServer(id) {
      return mcpServers.get(id) ?? null;
    },

    async getMcpServerByName(name) {
      return mcpServersByName.get(name) ?? null;
    },

    async upsertMcpServer(record) {
      const existing = mcpServers.get(record.id);

      if (existing) {
        mcpServersByName.delete(existing.name);
      }

      mcpServers.set(record.id, record);
      mcpServersByName.set(record.name, record);
    },

    async deleteMcpServer(id) {
      const existing = mcpServers.get(id);

      if (!existing) {
        return false;
      }

      mcpServers.delete(id);
      mcpServersByName.delete(existing.name);

      for (const assigned of profileMcpServers.values()) {
        assigned.delete(id);
      }

      return true;
    },

    async listMcpServersForProfile(profileId) {
      const assigned = profileMcpServers.get(profileId);

      if (!assigned) {
        return [];
      }

      return Array.from(assigned)
        .map((serverId) => mcpServers.get(serverId))
        .filter((server): server is StoredMcpServerRecord => server !== undefined);
    },

    async assignMcpServerToProfile(profileId, serverId) {
      const assigned = profileMcpServers.get(profileId) ?? new Set<string>();
      assigned.add(serverId);
      profileMcpServers.set(profileId, assigned);
    },

    async unassignMcpServerFromProfile(profileId, serverId) {
      const assigned = profileMcpServers.get(profileId);

      if (!assigned?.delete(serverId)) {
        return false;
      }

      return true;
    },

    async countProfileMcpAssignments() {
      let count = 0;

      for (const assigned of profileMcpServers.values()) {
        count += assigned.size;
      }

      return count;
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
    (firstUser.payload as { role?: string }).role === "user"
      ? (() => {
          const content = (firstUser.payload as { content: string | unknown[] }).content;
          const text = getUserMessageText(content as string | MessageContentPart[]).trim();
          return text || (Array.isArray(content) ? "[image]" : null);
        })()
      : null;

  return {
    id: session.id,
    profileId: session.profileId,
    channel: session.channel,
    createdAt: session.createdAt,
    updatedAt,
    messageCount: sorted.length,
    title: session.title ?? null,
    preview,
  };
}
