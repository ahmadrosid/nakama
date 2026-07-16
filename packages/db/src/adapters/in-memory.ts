import { getUserMessageText, type MessageContentPart } from "@nakama/core";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { LLM_USAGE_STATS_ID, WORKSPACE_SETTINGS_ID } from "../constants";
import type {
  DatabaseAdapter,
  StoredBrowserSessionRecord,
  LlmUsageStatsDelta,
  StoredAutomationRecord,
  StoredAutomationRunRecord,
  StoredLlmUsageModelStatsRecord,
  StoredLlmUsageStatsRecord,
  StoredMcpServerRecord,
  StoredSkillRecord,
  StoredOrgMemberRecord,
  StoredOrgInviteRecord,
  StoredArtifactShareRecord,
  StoredOrganizationRecord,
  StoredUserOrganizationRecord,
  StoredProfileRecord,
  StoredAttachmentRecord,
  StoredSessionMessageRecord,
  StoredSessionRecord,
  StoredSessionSummaryRecord,
  StoredTaskRecord,
  StoredTaskRunRecord,
  StoredToolRecord,
  StoredUserRecord,
  StoredNotificationDestinationRecord,
  StoredComposioToolkitRecord,
  StoredComposioUserConnectionRecord,
  StoredProfileComposioToolkitRecord,
  StoredWorkspaceSettingsRecord,
} from "../types";

export function createInMemoryDatabaseAdapter(): DatabaseAdapter {
  const automations = new Map<string, StoredAutomationRecord>();
  const automationRuns = new Map<string, StoredAutomationRunRecord[]>();
  const automationRunReadState = new Map<
    string,
    { userId: string; orgId: string; automationId: string; readThroughAt: string }
  >();
  const tasks = new Map<string, StoredTaskRecord>();
  const taskRuns = new Map<string, StoredTaskRunRecord[]>();
  const profiles = new Map<string, StoredProfileRecord>();
  const tools = new Map<string, StoredToolRecord>();
  const toolsByName = new Map<string, StoredToolRecord>();
  const profileTools = new Map<string, Set<string>>();
  const mcpServers = new Map<string, StoredMcpServerRecord>();
  const mcpServersByName = new Map<string, StoredMcpServerRecord>();
  const profileMcpServers = new Map<string, Set<string>>();
  const skills = new Map<string, StoredSkillRecord>();
  const skillsByName = new Map<string, StoredSkillRecord>();
  const skillsBySourcePath = new Map<string, StoredSkillRecord>();
  const profileSkills = new Map<string, Set<string>>();
  const sessions = new Map<string, StoredSessionRecord>();
  const sessionMessages = new Map<string, StoredSessionMessageRecord[]>();
  const attachments = new Map<string, StoredAttachmentRecord>();
  const usersById = new Map<string, StoredUserRecord>();
  const usersByEmail = new Map<string, StoredUserRecord>();
  const browserSessionsByHash = new Map<string, StoredBrowserSessionRecord>();
  const organizations = new Map<string, StoredOrganizationRecord>();
  const organizationsBySlug = new Map<string, StoredOrganizationRecord>();
  const orgMembers = new Map<string, StoredOrgMemberRecord>();
  const orgInvites = new Map<string, StoredOrgInviteRecord>();
  const orgInvitesByTokenHash = new Map<string, StoredOrgInviteRecord>();
  const artifactShares = new Map<string, StoredArtifactShareRecord>();
  const artifactSharesByTokenHash = new Map<string, StoredArtifactShareRecord>();
  let llmUsageStats: StoredLlmUsageStatsRecord | null = null;
  const llmUsageByModel = new Map<string, StoredLlmUsageModelStatsRecord>();
  let workspaceSettings: StoredWorkspaceSettingsRecord | null = null;
  const notificationDestinations = new Map<string, StoredNotificationDestinationRecord>();
  const composioToolkits = new Map<string, StoredComposioToolkitRecord>();
  const composioUserConnections = new Map<string, StoredComposioUserConnectionRecord>();
  const profileComposioToolkits = new Map<string, StoredProfileComposioToolkitRecord[]>();

  return {
    async getUserByEmail(email) {
      return usersByEmail.get(email) ?? null;
    },

    async getUserById(id) {
      return usersById.get(id) ?? null;
    },

    async createUser(record) {
      usersById.set(record.id, record);
      usersByEmail.set(record.email, record);
    },

    async updateUserProfile(id, profile, updatedAt) {
      const user = usersById.get(id);
      if (!user) {
        return;
      }

      const updated = {
        ...user,
        name: profile.name,
        phone: profile.phone,
        updatedAt,
      };
      usersById.set(id, updated);
      usersByEmail.set(updated.email, updated);
    },

    async updateUserPassword(id, passwordHash, updatedAt) {
      const user = usersById.get(id);
      if (!user) {
        return;
      }

      const updated = { ...user, passwordHash, updatedAt };
      usersById.set(id, updated);
      usersByEmail.set(updated.email, updated);
    },

    async getUserContext(orgId, userId) {
      return orgMembers.get(`${orgId}:${userId}`)?.userContext ?? null;
    },

    async setUserContext(orgId, userId, content, updatedAt) {
      const memberKey = `${orgId}:${userId}`;
      const member = orgMembers.get(memberKey);
      if (member) {
        orgMembers.set(memberKey, { ...member, userContext: content });
      }

      const user = usersById.get(userId);
      if (!user) {
        return;
      }

      const updated = { ...user, updatedAt };
      usersById.set(userId, updated);
      usersByEmail.set(updated.email, updated);
    },

    async countUsers() {
      return usersById.size;
    },

    async countHumanUsers() {
      return [...usersById.values()].filter((user) => user.id !== LOCAL_CLIENT_USER_ID).length;
    },

    async createBrowserSession(record) {
      browserSessionsByHash.set(record.sessionTokenHash, record);
    },

    async getBrowserSessionBySessionTokenHash(sessionTokenHash) {
      return browserSessionsByHash.get(sessionTokenHash) ?? null;
    },

    async revokeBrowserSessionBySessionTokenHash(sessionTokenHash, revokedAt) {
      const session = browserSessionsByHash.get(sessionTokenHash);

      if (!session || session.revokedAt) {
        return false;
      }

      browserSessionsByHash.set(sessionTokenHash, { ...session, revokedAt });
      return true;
    },

    async updateBrowserSessionLastUsedAt(id, lastUsedAt) {
      for (const [hash, session] of browserSessionsByHash.entries()) {
        if (session.id === id) {
          browserSessionsByHash.set(hash, { ...session, lastUsedAt });
          return;
        }
      }
    },

    async updateBrowserSessionActiveOrgId(id, activeOrgId) {
      for (const [hash, session] of browserSessionsByHash.entries()) {
        if (session.id === id) {
          browserSessionsByHash.set(hash, { ...session, activeOrgId });
          return;
        }
      }
    },

    async upsertOrganization(record) {
      organizations.set(record.id, record);
      organizationsBySlug.set(record.slug, record);
    },

    async listOrganizations() {
      return Array.from(organizations.values()).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    },

    async getOrganizationById(id) {
      return organizations.get(id) ?? null;
    },

    async getOrganizationBySlug(slug) {
      return organizationsBySlug.get(slug) ?? null;
    },

    async upsertOrgMember(record) {
      orgMembers.set(`${record.orgId}:${record.userId}`, record);
    },

    async getOrgMember(orgId, userId) {
      return orgMembers.get(`${orgId}:${userId}`) ?? null;
    },

    async listOrgMembers(orgId) {
      return Array.from(orgMembers.values())
        .filter((member) => member.orgId === orgId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },

    async listUserOrganizations(userId) {
      return Array.from(orgMembers.values())
        .filter((member) => member.userId === userId)
        .map((member) => {
          const organization = organizations.get(member.orgId);
          if (!organization) {
            return null;
          }

          return {
            organization,
            role: member.role,
            joinedAt: member.createdAt,
          } satisfies StoredUserOrganizationRecord;
        })
        .filter((record): record is StoredUserOrganizationRecord => record !== null)
        .sort((left, right) => left.organization.name.localeCompare(right.organization.name));
    },

    async deleteOrgMember(orgId, userId) {
      return orgMembers.delete(`${orgId}:${userId}`);
    },

    async createOrgInvite(record) {
      orgInvites.set(record.id, record);
      orgInvitesByTokenHash.set(record.tokenHash, record);
    },

    async getOrgInviteByTokenHash(tokenHash) {
      return orgInvitesByTokenHash.get(tokenHash) ?? null;
    },

    async getPendingOrgInvite(orgId, email) {
      const normalizedEmail = email.trim().toLowerCase();
      for (const invite of orgInvites.values()) {
        if (
          invite.orgId === orgId &&
          invite.email === normalizedEmail &&
          !invite.acceptedAt &&
          !invite.revokedAt
        ) {
          return invite;
        }
      }

      return null;
    },

    async markOrgInviteAccepted(id, acceptedAt) {
      const invite = orgInvites.get(id);
      if (!invite) {
        return;
      }

      const updated = { ...invite, acceptedAt };
      orgInvites.set(id, updated);
      orgInvitesByTokenHash.set(updated.tokenHash, updated);
    },

    async createArtifactShare(record) {
      artifactShares.set(record.id, record);
      if (!record.revokedAt) {
        artifactSharesByTokenHash.set(record.tokenHash, record);
      }
    },

    async updateArtifactShareSnapshot(id, snapshot) {
      const existing = artifactShares.get(id);
      if (!existing) {
        return;
      }

      const updated = { ...existing, ...snapshot };
      artifactShares.set(id, updated);
      if (!updated.revokedAt) {
        artifactSharesByTokenHash.set(updated.tokenHash, updated);
      }
    },

    async getArtifactShareByTokenHash(tokenHash) {
      const share = artifactSharesByTokenHash.get(tokenHash);
      return share && !share.revokedAt ? share : null;
    },

    async getActiveArtifactShareByPath(orgId, profileId, sourcePath) {
      for (const share of artifactShares.values()) {
        if (
          share.orgId === orgId &&
          share.profileId === profileId &&
          share.sourcePath === sourcePath &&
          !share.revokedAt
        ) {
          return share;
        }
      }

      return null;
    },

    async getArtifactShareById(orgId, profileId, shareId) {
      const share = artifactShares.get(shareId);
      if (!share || share.orgId !== orgId || share.profileId !== profileId) {
        return null;
      }

      return share;
    },

    async revokeArtifactShare(id, revokedAt) {
      const share = artifactShares.get(id);
      if (!share || share.revokedAt) {
        return false;
      }

      const updated = { ...share, revokedAt };
      artifactShares.set(id, updated);
      artifactSharesByTokenHash.delete(updated.tokenHash);
      return true;
    },

    async listAutomations() {
      return Array.from(automations.values());
    },

    async listAutomationsForOrg(orgId) {
      return Array.from(automations.values()).filter(
        (automation) => automation.orgId === orgId,
      );
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

    async deleteAutomationRun(automationId, runId) {
      const existing = automationRuns.get(automationId) ?? [];
      const filtered = existing.filter((run) => run.id !== runId);
      automationRuns.set(automationId, filtered);
      return filtered.length !== existing.length;
    },

    async getAutomationRunReadThrough(userId, orgId, automationId) {
      const key = `${userId}:${orgId}:${automationId}`;
      return automationRunReadState.get(key)?.readThroughAt ?? null;
    },

    async upsertAutomationRunReadThrough(userId, orgId, automationId, readThroughAt) {
      const key = `${userId}:${orgId}:${automationId}`;
      automationRunReadState.set(key, { userId, orgId, automationId, readThroughAt });
    },

    async countUnreadAutomationRunsByOrg(userId, orgId) {
      const orgAutomations = Array.from(automations.values()).filter(
        (automation) => automation.orgId === orgId,
      );
      const counts = new Map<string, number>();

      for (const automation of orgAutomations) {
        const readThroughAt =
          automationRunReadState.get(`${userId}:${orgId}:${automation.id}`)?.readThroughAt ??
          "1970-01-01T00:00:00.000Z";
        const runs = automationRuns.get(automation.id) ?? [];

        for (const run of runs) {
          if (run.status !== "completed" && run.status !== "failed") {
            continue;
          }

          const timestamp = run.completedAt ?? run.startedAt;
          if (timestamp > readThroughAt) {
            counts.set(automation.id, (counts.get(automation.id) ?? 0) + 1);
          }
        }
      }

      return Array.from(counts.entries()).map(([automationId, unreadCount]) => ({
        automationId,
        unreadCount,
      }));
    },

    async listProfiles() {
      return Array.from(profiles.values());
    },

    async listProfilesForOrg(orgId) {
      return Array.from(profiles.values())
        .filter((profile) => profile.orgId === orgId)
        .sort((left, right) => {
          if (left.isDefault !== right.isDefault) {
            return left.isDefault ? -1 : 1;
          }

          return left.name.localeCompare(right.name);
        });
    },

    async getProfile(id) {
      return profiles.get(id) ?? null;
    },

    async getProfileForOrg(id, orgId) {
      const profile = profiles.get(id);
      return profile?.orgId === orgId ? profile : null;
    },

    async getDefaultProfileForOrg(orgId) {
      return (
        Array.from(profiles.values()).find(
          (profile) => profile.orgId === orgId && profile.isDefault,
        ) ?? null
      );
    },

    async upsertProfile(record) {
      if (record.isDefault && record.orgId) {
        for (const profile of profiles.values()) {
          if (profile.orgId === record.orgId && profile.id !== record.id && profile.isDefault) {
            profiles.set(profile.id, { ...profile, isDefault: false });
          }
        }
      }

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

    async getSessionQuestionnaire(sessionId) {
      return sessions.get(sessionId)?.agentQuestionnaire ?? null;
    },

    async updateSessionQuestionnaire(sessionId, questionnaire) {
      const session = sessions.get(sessionId);

      if (!session) {
        return;
      }

      sessions.set(sessionId, { ...session, agentQuestionnaire: questionnaire });
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

    async insertAttachment(record) {
      attachments.set(record.id, { ...record });
    },

    async getAttachment(id) {
      return attachments.get(id) ?? null;
    },

    async deleteAttachment(id) {
      return attachments.delete(id);
    },

    async listTasks() {
      return Array.from(tasks.values()).sort((left, right) => {
        const statusCompare = left.status.localeCompare(right.status);
        return statusCompare !== 0 ? statusCompare : left.position - right.position;
      });
    },

    async listTasksForOrg(orgId) {
      return Array.from(tasks.values())
        .filter((task) => task.orgId === orgId)
        .sort((left, right) => {
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

    async listLlmUsageStatsByModel() {
      return [...llmUsageByModel.values()].sort((left, right) => {
        if (right.requestCount !== left.requestCount) {
          return right.requestCount - left.requestCount;
        }

        const rightTotal = right.inputTokens + right.outputTokens;
        const leftTotal = left.inputTokens + left.outputTokens;
        if (rightTotal !== leftTotal) {
          return rightTotal - leftTotal;
        }

        return left.modelId.localeCompare(right.modelId);
      });
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

    async incrementLlmUsageStatsByModel(
      modelId: string,
      delta: LlmUsageStatsDelta,
      trackedSince: string,
    ) {
      const updatedAt = new Date().toISOString();
      const existing = llmUsageByModel.get(modelId);

      if (!existing) {
        llmUsageByModel.set(modelId, {
          modelId,
          requestCount: delta.requestCount,
          inputTokens: delta.inputTokens,
          outputTokens: delta.outputTokens,
          estimatedCostUsd: delta.estimatedCostUsd,
          trackedSince,
          updatedAt,
        });
        return;
      }

      llmUsageByModel.set(modelId, {
        ...existing,
        requestCount: existing.requestCount + delta.requestCount,
        inputTokens: existing.inputTokens + delta.inputTokens,
        outputTokens: existing.outputTokens + delta.outputTokens,
        estimatedCostUsd: existing.estimatedCostUsd + delta.estimatedCostUsd,
        updatedAt,
      });
    },

    async getWorkspaceSettings() {
      return workspaceSettings
        ? {
            ...workspaceSettings,
            codingAgentHarnesses: workspaceSettings.codingAgentHarnesses.map((harness) => ({
              ...harness,
              args: [...harness.args],
            })),
          }
        : null;
    },

    async upsertWorkspaceSettings(record) {
      workspaceSettings = {
        ...record,
        codingAgentHarnesses: record.codingAgentHarnesses.map((harness) => ({
          ...harness,
          args: [...harness.args],
        })),
      };
    },

    async listNotificationDestinationsForOrg(orgId) {
      return Array.from(notificationDestinations.values()).filter(
        (record) => record.orgId === orgId,
      );
    },

    async getNotificationDestination(id) {
      return notificationDestinations.get(id) ?? null;
    },

    async upsertNotificationDestination(record) {
      notificationDestinations.set(record.id, record);
    },

    async deleteNotificationDestination(id) {
      return notificationDestinations.delete(id);
    },

    async listComposioToolkitsForOrg(orgId) {
      return Array.from(composioToolkits.values()).filter((record) => record.orgId === orgId);
    },

    async getComposioToolkit(id) {
      return composioToolkits.get(id) ?? null;
    },

    async getComposioToolkitBySlug(orgId, toolkitSlug) {
      return (
        Array.from(composioToolkits.values()).find(
          (record) => record.orgId === orgId && record.toolkitSlug === toolkitSlug,
        ) ?? null
      );
    },

    async upsertComposioToolkit(record) {
      composioToolkits.set(record.id, record);
    },

    async deleteComposioToolkit(id) {
      return composioToolkits.delete(id);
    },

    async listComposioUserConnectionsForUser(orgId, userId) {
      return Array.from(composioUserConnections.values()).filter(
        (record) => record.orgId === orgId && record.userId === userId,
      );
    },

    async getComposioUserConnection(userId, toolkitId) {
      return (
        Array.from(composioUserConnections.values()).find(
          (record) => record.userId === userId && record.toolkitId === toolkitId,
        ) ?? null
      );
    },

    async getComposioUserConnectionById(id) {
      return composioUserConnections.get(id) ?? null;
    },

    async upsertComposioUserConnection(record) {
      composioUserConnections.set(record.id, record);
    },

    async deleteComposioUserConnection(id) {
      return composioUserConnections.delete(id);
    },

    async listProfileComposioToolkits(profileId) {
      return profileComposioToolkits.get(profileId) ?? [];
    },

    async replaceProfileComposioToolkits(profileId, assignments) {
      profileComposioToolkits.set(
        profileId,
        assignments.map((assignment) => ({ ...assignment, profileId })),
      );
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

    async listProfilesForMcpServer(serverId) {
      const matches: StoredProfileRecord[] = [];

      for (const [profileId, assigned] of profileMcpServers) {
        if (!assigned.has(serverId)) {
          continue;
        }

        const profile = profiles.get(profileId);

        if (profile) {
          matches.push(profile);
        }
      }

      return matches.sort((left, right) => left.name.localeCompare(right.name));
    },

    async listMcpServerProfileCounts() {
      const counts: Record<string, number> = {};

      for (const assigned of profileMcpServers.values()) {
        for (const serverId of assigned) {
          counts[serverId] = (counts[serverId] ?? 0) + 1;
        }
      }

      return counts;
    },

    async listSkills() {
      return Array.from(skills.values()).sort((left, right) =>
        left.name.localeCompare(right.name),
      );
    },

    async getSkill(id) {
      return skills.get(id) ?? null;
    },

    async getSkillByName(name) {
      return skillsByName.get(name) ?? null;
    },

    async getSkillBySourcePath(sourcePath) {
      return skillsBySourcePath.get(sourcePath) ?? null;
    },

    async upsertSkill(record) {
      const existing = skills.get(record.id);

      if (existing) {
        skillsByName.delete(existing.name);
        skillsBySourcePath.delete(existing.sourcePath);
      }

      skills.set(record.id, record);
      skillsByName.set(record.name, record);
      skillsBySourcePath.set(record.sourcePath, record);
    },

    async deleteSkill(id) {
      const existing = skills.get(id);

      if (!existing) {
        return false;
      }

      skills.delete(id);
      skillsByName.delete(existing.name);
      skillsBySourcePath.delete(existing.sourcePath);

      for (const assigned of profileSkills.values()) {
        assigned.delete(id);
      }

      return true;
    },

    async listSkillsForProfile(profileId) {
      const assigned = profileSkills.get(profileId);

      if (!assigned) {
        return [];
      }

      return Array.from(assigned)
        .map((skillId) => skills.get(skillId))
        .filter((skill): skill is StoredSkillRecord => skill !== undefined)
        .sort((left, right) => left.name.localeCompare(right.name));
    },

    async assignSkillToProfile(profileId, skillId) {
      const assigned = profileSkills.get(profileId) ?? new Set<string>();
      assigned.add(skillId);
      profileSkills.set(profileId, assigned);
    },

    async unassignSkillFromProfile(profileId, skillId) {
      const assigned = profileSkills.get(profileId);

      if (!assigned?.delete(skillId)) {
        return false;
      }

      return true;
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
