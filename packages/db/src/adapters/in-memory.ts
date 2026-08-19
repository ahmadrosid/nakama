import { getUserMessageText, type MessageContentPart } from "@nakama/core";
import { LOCAL_CLIENT_USER_ID } from "@nakama/core/local-auth";
import { LLM_USAGE_STATS_ID } from "../constants";
import type {
  DatabaseAdapter,
  LlmUsageStatsDelta,
  StoredArtifactShareRecord,
  StoredAttachmentRecord,
  StoredAutomationRecord,
  StoredAutomationRunRecord,
  StoredBrowserSessionRecord,
  StoredComposioToolkitRecord,
  StoredComposioUserConnectionRecord,
  StoredLlmTurnUsageRecord,
  StoredLlmUsageModelStatsRecord,
  StoredLlmUsageStatsRecord,
  StoredMcpServerRecord,
  StoredNotificationDestinationRecord,
  StoredOrganizationRecord,
  StoredOrgInviteRecord,
  StoredOrgMemberRecord,
  StoredOrgMemoryProposal,
  StoredProfileComposioToolkitRecord,
  StoredProfileRecord,
  StoredSessionMessageRecord,
  StoredSessionRecord,
  StoredSessionSummaryRecord,
  StoredSkillProposal,
  StoredSkillRecord,
  StoredSkillSuggestion,
  StoredSkillUsageRecord,
  StoredTaskRecord,
  StoredTaskRunRecord,
  StoredToolOutputSavingsRecord,
  StoredToolRecord,
  StoredUserOrganizationRecord,
  StoredUserRecord,
  StoredWorkspaceSettingsRecord,
} from "../types";

export function createInMemoryDatabaseAdapter(): DatabaseAdapter {
  const automations = new Map<string, StoredAutomationRecord>();
  const automationRuns = new Map<string, StoredAutomationRunRecord[]>();
  const automationRunReadState = new Map<
    string,
    {
      userId: string;
      orgId: string;
      automationId: string;
      readThroughAt: string;
    }
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
  const skillsBySourcePath = new Map<string, StoredSkillRecord>();
  const profileSkills = new Map<string, Set<string>>();
  const skillUsage = new Map<string, StoredSkillUsageRecord>();
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
  const orgMemoryProposals = new Map<string, StoredOrgMemoryProposal>();
  const skillProposals = new Map<string, StoredSkillProposal>();
  const skillSuggestions = new Map<string, StoredSkillSuggestion>();
  const artifactShares = new Map<string, StoredArtifactShareRecord>();
  const artifactSharesByTokenHash = new Map<
    string,
    StoredArtifactShareRecord
  >();
  let llmUsageStats: StoredLlmUsageStatsRecord | null = null;
  const llmUsageByModel = new Map<string, StoredLlmUsageModelStatsRecord>();
  const toolOutputSavings = new Map<string, StoredToolOutputSavingsRecord>();
  const llmTurnUsage = new Map<string, StoredLlmTurnUsageRecord>();
  let workspaceSettings: StoredWorkspaceSettingsRecord | null = null;
  const notificationDestinations = new Map<
    string,
    StoredNotificationDestinationRecord
  >();
  const composioToolkits = new Map<string, StoredComposioToolkitRecord>();
  const composioUserConnections = new Map<
    string,
    StoredComposioUserConnectionRecord
  >();
  const profileComposioToolkits = new Map<
    string,
    StoredProfileComposioToolkitRecord[]
  >();

  return {
    async appendMessagesForSession(sessionId, messages) {
      const existing = sessionMessages.get(sessionId) ?? [];
      sessionMessages.set(sessionId, [...existing, ...messages]);
    },

    async assignMcpServerToProfile(profileId, serverId) {
      const assigned = profileMcpServers.get(profileId) ?? new Set<string>();
      assigned.add(serverId);
      profileMcpServers.set(profileId, assigned);
    },

    async assignSkillToProfile(profileId, skillId) {
      const assigned = profileSkills.get(profileId) ?? new Set<string>();
      assigned.add(skillId);
      profileSkills.set(profileId, assigned);
    },

    async assignToolToProfile(profileId, toolId) {
      const assigned = profileTools.get(profileId) ?? new Set<string>();
      assigned.add(toolId);
      profileTools.set(profileId, assigned);
    },

    async countHumanUsers() {
      return [...usersById.values()].filter(
        (user) => user.id !== LOCAL_CLIENT_USER_ID
      ).length;
    },

    async countOrgMemoryProposals(orgId, status) {
      let count = 0;
      for (const proposal of orgMemoryProposals.values()) {
        if (proposal.orgId === orgId && proposal.status === status) {
          count += 1;
        }
      }
      return count;
    },

    async countPendingSkillProposals(orgId, profileId) {
      let count = 0;
      for (const proposal of skillProposals.values()) {
        if (proposal.orgId !== orgId || proposal.status !== "pending") {
          continue;
        }
        if (profileId && proposal.profileId !== profileId) {
          continue;
        }
        count += 1;
      }
      return count;
    },

    async countProfileMcpAssignments() {
      let count = 0;

      for (const assigned of profileMcpServers.values()) {
        count += assigned.size;
      }

      return count;
    },

    async countUnreadAutomationRunsByOrg(userId, orgId) {
      const orgAutomations = Array.from(automations.values()).filter(
        (automation) => automation.orgId === orgId
      );
      const counts = new Map<string, number>();

      for (const automation of orgAutomations) {
        const readThroughAt =
          automationRunReadState.get(`${userId}:${orgId}:${automation.id}`)
            ?.readThroughAt ?? "1970-01-01T00:00:00.000Z";
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

      return Array.from(counts.entries()).map(
        ([automationId, unreadCount]) => ({
          automationId,
          unreadCount,
        })
      );
    },

    async countUsers() {
      return usersById.size;
    },

    async createArtifactShare(record) {
      artifactShares.set(record.id, record);
      if (!record.revokedAt) {
        artifactSharesByTokenHash.set(record.tokenHash, record);
      }
    },

    async createBrowserSession(record) {
      browserSessionsByHash.set(record.sessionTokenHash, record);
    },

    async createOrgInvite(record) {
      orgInvites.set(record.id, record);
      orgInvitesByTokenHash.set(record.tokenHash, record);
    },

    async createOrgMemoryProposal(record) {
      orgMemoryProposals.set(record.id, record);
    },

    async createSkillProposal(record) {
      skillProposals.set(record.id, record);
    },

    async createSkillSuggestion(record) {
      skillSuggestions.set(record.id, record);
    },

    async createUser(record) {
      usersById.set(record.id, record);
      usersByEmail.set(record.email, record);
    },

    async deleteAttachment(id) {
      return attachments.delete(id);
    },

    async deleteAutomation(id) {
      automationRuns.delete(id);
      return automations.delete(id);
    },

    async deleteAutomationRun(automationId, runId) {
      const existing = automationRuns.get(automationId) ?? [];
      const filtered = existing.filter((run) => run.id !== runId);
      automationRuns.set(automationId, filtered);
      return filtered.length !== existing.length;
    },

    async deleteComposioToolkit(id) {
      return composioToolkits.delete(id);
    },

    async deleteComposioUserConnection(id) {
      return composioUserConnections.delete(id);
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

    async deleteMessagesForSession(sessionId) {
      sessionMessages.delete(sessionId);
    },

    async deleteNotificationDestination(id) {
      return notificationDestinations.delete(id);
    },

    async deleteOrgMember(orgId, userId) {
      return orgMembers.delete(`${orgId}:${userId}`);
    },

    async deleteProfile(id) {
      if (!profiles.delete(id)) {
        return false;
      }

      profileTools.delete(id);
      profileMcpServers.delete(id);
      return true;
    },

    async deleteSession(id) {
      sessionMessages.delete(id);
      return sessions.delete(id);
    },

    async deleteSkill(id) {
      const existing = skills.get(id);

      if (!existing) {
        return false;
      }

      skills.delete(id);
      skillsBySourcePath.delete(existing.sourcePath);

      for (const assigned of profileSkills.values()) {
        assigned.delete(id);
      }

      return true;
    },

    async deleteTask(id) {
      taskRuns.delete(id);
      return tasks.delete(id);
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

    async getActiveAutomationRun(automationId) {
      return (
        [...(automationRuns.get(automationId) ?? [])]
          .filter((run) => run.status === "running")
          .sort((left, right) =>
            right.startedAt.localeCompare(left.startedAt)
          )[0] ?? null
      );
    },

    async getActiveTaskRun(taskId) {
      return (
        [...(taskRuns.get(taskId) ?? [])]
          .filter((run) => run.status === "running")
          .sort((left, right) =>
            right.startedAt.localeCompare(left.startedAt)
          )[0] ?? null
      );
    },

    async getArtifactShareById(orgId, profileId, shareId) {
      const share = artifactShares.get(shareId);
      if (!share || share.orgId !== orgId || share.profileId !== profileId) {
        return null;
      }

      return share;
    },

    async getArtifactShareByTokenHash(tokenHash) {
      const share = artifactSharesByTokenHash.get(tokenHash);
      return share && !share.revokedAt ? share : null;
    },

    async getAttachment(id) {
      return attachments.get(id) ?? null;
    },

    async getAutomation(id) {
      return automations.get(id) ?? null;
    },

    async getAutomationRunReadThrough(userId, orgId, automationId) {
      const key = `${userId}:${orgId}:${automationId}`;
      return automationRunReadState.get(key)?.readThroughAt ?? null;
    },

    async getBrowserSessionBySessionTokenHash(sessionTokenHash) {
      return browserSessionsByHash.get(sessionTokenHash) ?? null;
    },

    async getComposioToolkit(id) {
      return composioToolkits.get(id) ?? null;
    },

    async getComposioToolkitBySlug(orgId, toolkitSlug) {
      return (
        Array.from(composioToolkits.values()).find(
          (record) =>
            record.orgId === orgId && record.toolkitSlug === toolkitSlug
        ) ?? null
      );
    },

    async getComposioUserConnection(userId, toolkitId) {
      return (
        Array.from(composioUserConnections.values()).find(
          (record) => record.userId === userId && record.toolkitId === toolkitId
        ) ?? null
      );
    },

    async getComposioUserConnectionById(id) {
      return composioUserConnections.get(id) ?? null;
    },

    async getDefaultProfileForOrg(orgId) {
      return (
        Array.from(profiles.values()).find(
          (profile) => profile.orgId === orgId && profile.isDefault
        ) ?? null
      );
    },

    async getLlmUsageStats() {
      return llmUsageStats;
    },

    async getMcpServer(id) {
      return mcpServers.get(id) ?? null;
    },

    async getMcpServerByName(name) {
      return mcpServersByName.get(name) ?? null;
    },

    async getNotificationDestination(id) {
      return notificationDestinations.get(id) ?? null;
    },

    async getOrganizationById(id) {
      return organizations.get(id) ?? null;
    },

    async getOrganizationBySlug(slug) {
      return organizationsBySlug.get(slug) ?? null;
    },

    async getOrgInviteByTokenHash(tokenHash) {
      return orgInvitesByTokenHash.get(tokenHash) ?? null;
    },

    async getOrgMember(orgId, userId) {
      return orgMembers.get(`${orgId}:${userId}`) ?? null;
    },

    async getOrgMemoryProposal(orgId, id) {
      const proposal = orgMemoryProposals.get(id);
      if (!proposal || proposal.orgId !== orgId) {
        return null;
      }
      return proposal;
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

    async getPendingOrgMemoryProposalByBullet(orgId, bullet) {
      for (const proposal of orgMemoryProposals.values()) {
        if (
          proposal.orgId === orgId &&
          proposal.bullet === bullet &&
          proposal.status === "pending"
        ) {
          return proposal;
        }
      }
      return null;
    },

    async getPendingSkillProposalForCreate(orgId, profileId, skillName) {
      for (const proposal of skillProposals.values()) {
        if (
          proposal.orgId === orgId &&
          proposal.profileId === profileId &&
          proposal.skillName === skillName &&
          proposal.action === "create" &&
          proposal.status === "pending"
        ) {
          return proposal;
        }
      }
      return null;
    },

    async getPendingSkillProposalForPatch(
      orgId,
      profileId,
      skillName,
      patchOldString,
      patchNewString
    ) {
      for (const proposal of skillProposals.values()) {
        if (
          proposal.orgId === orgId &&
          proposal.profileId === profileId &&
          proposal.skillName === skillName &&
          proposal.action === "patch" &&
          proposal.patchOldString === patchOldString &&
          proposal.patchNewString === patchNewString &&
          proposal.status === "pending"
        ) {
          return proposal;
        }
      }
      return null;
    },

    async getPendingSkillProposalForSkill(orgId, profileId, skillName) {
      for (const proposal of skillProposals.values()) {
        if (
          proposal.orgId === orgId &&
          proposal.profileId === profileId &&
          proposal.skillName === skillName &&
          proposal.status === "pending"
        ) {
          return proposal;
        }
      }
      return null;
    },

    async getProfile(id) {
      return profiles.get(id) ?? null;
    },

    async getProfileForOrg(id, orgId) {
      const profile = profiles.get(id);
      return profile?.orgId === orgId ? profile : null;
    },

    async getSession(id) {
      return sessions.get(id) ?? null;
    },

    async getSessionQuestionnaire(sessionId) {
      return sessions.get(sessionId)?.agentQuestionnaire ?? null;
    },

    async getSessionTodos(sessionId) {
      return sessions.get(sessionId)?.agentTodos ?? [];
    },

    async getSkill(id) {
      return skills.get(id) ?? null;
    },

    async getSkillByName(name, orgId) {
      const matches = Array.from(skills.values()).filter(
        (skill) => skill.name === name
      );

      return (
        matches.find((skill) => Boolean(orgId) && skill.orgId === orgId) ??
        matches.find((skill) => !skill.orgId) ??
        null
      );
    },

    async getSkillBySourcePath(sourcePath) {
      return skillsBySourcePath.get(sourcePath) ?? null;
    },

    async getSkillProposal(orgId, id) {
      const proposal = skillProposals.get(id);
      if (!proposal || proposal.orgId !== orgId) {
        return null;
      }
      return proposal;
    },

    async getSkillSuggestion(orgId, id) {
      const suggestion = skillSuggestions.get(id);
      if (!suggestion || suggestion.orgId !== orgId) {
        return null;
      }
      return suggestion;
    },

    async getSkillUsage(profileId, skillId) {
      return skillUsage.get(`${profileId}:${skillId}`) ?? null;
    },

    async getTask(id) {
      return tasks.get(id) ?? null;
    },

    async getTool(id) {
      return tools.get(id) ?? null;
    },

    async getToolByName(name) {
      return toolsByName.get(name) ?? null;
    },
    async getUserByEmail(email) {
      return usersByEmail.get(email) ?? null;
    },

    async getUserById(id) {
      return usersById.get(id) ?? null;
    },

    async getUserContext(orgId, userId) {
      return orgMembers.get(`${orgId}:${userId}`)?.userContext ?? null;
    },

    async getWorkspaceSettings() {
      return workspaceSettings
        ? {
            ...workspaceSettings,
            codingAgentHarnesses: workspaceSettings.codingAgentHarnesses.map(
              (harness) => ({
                ...harness,
                args: [...harness.args],
              })
            ),
          }
        : null;
    },

    async incrementLlmTurnUsage(orgId, delta) {
      const updatedAt = new Date().toISOString();
      const bucket = updatedAt.slice(0, 10);
      const arm = delta.optimized ? "omni" : "none";
      const key = `${orgId}\u0000${bucket}\u0000${arm}`;
      const existing = llmTurnUsage.get(key);

      llmTurnUsage.set(key, {
        arm,
        bucket,
        estimatedTurns:
          (existing?.estimatedTurns ?? 0) + (delta.estimated ? 1 : 0),
        inputTokens: (existing?.inputTokens ?? 0) + delta.inputTokens,
        orgId,
        outputTokens: (existing?.outputTokens ?? 0) + delta.outputTokens,
        turns: (existing?.turns ?? 0) + 1,
      });
    },

    async incrementLlmUsageStats(
      delta: LlmUsageStatsDelta,
      trackedSince: string
    ) {
      const updatedAt = new Date().toISOString();

      if (!llmUsageStats) {
        llmUsageStats = {
          estimatedCostUsd: delta.estimatedCostUsd,
          id: LLM_USAGE_STATS_ID,
          inputTokens: delta.inputTokens,
          outputTokens: delta.outputTokens,
          requestCount: delta.requestCount,
          trackedSince,
          updatedAt,
        };
        return;
      }

      llmUsageStats = {
        ...llmUsageStats,
        estimatedCostUsd:
          llmUsageStats.estimatedCostUsd + delta.estimatedCostUsd,
        inputTokens: llmUsageStats.inputTokens + delta.inputTokens,
        outputTokens: llmUsageStats.outputTokens + delta.outputTokens,
        requestCount: llmUsageStats.requestCount + delta.requestCount,
        updatedAt,
      };
    },

    async incrementLlmUsageStatsByModel(
      modelId: string,
      delta: LlmUsageStatsDelta,
      trackedSince: string
    ) {
      const updatedAt = new Date().toISOString();
      const existing = llmUsageByModel.get(modelId);

      if (!existing) {
        llmUsageByModel.set(modelId, {
          estimatedCostUsd: delta.estimatedCostUsd,
          inputTokens: delta.inputTokens,
          modelId,
          outputTokens: delta.outputTokens,
          requestCount: delta.requestCount,
          trackedSince,
          updatedAt,
        });
        return;
      }

      llmUsageByModel.set(modelId, {
        ...existing,
        estimatedCostUsd: existing.estimatedCostUsd + delta.estimatedCostUsd,
        inputTokens: existing.inputTokens + delta.inputTokens,
        outputTokens: existing.outputTokens + delta.outputTokens,
        requestCount: existing.requestCount + delta.requestCount,
        updatedAt,
      });
    },

    async incrementSkillUsage(input) {
      const key = `${input.profileId}:${input.skillId}`;
      const now = new Date().toISOString();
      const existing = skillUsage.get(key);

      if (!existing) {
        skillUsage.set(key, {
          createdAt: now,
          lastPatchedAt: input.patchedAt ?? null,
          lastUsedAt: input.usedAt ?? null,
          lastViewedAt: input.viewedAt ?? null,
          orgId: input.orgId,
          patchCount: input.patchDelta ?? 0,
          profileId: input.profileId,
          skillId: input.skillId,
          updatedAt: now,
          useCount: input.useDelta ?? 0,
          viewCount: input.viewDelta ?? 0,
        });
        return;
      }

      skillUsage.set(key, {
        ...existing,
        lastPatchedAt: input.patchedAt ?? existing.lastPatchedAt,
        lastUsedAt: input.usedAt ?? existing.lastUsedAt,
        lastViewedAt: input.viewedAt ?? existing.lastViewedAt,
        patchCount: existing.patchCount + (input.patchDelta ?? 0),
        updatedAt: now,
        useCount: existing.useCount + (input.useDelta ?? 0),
        viewCount: existing.viewCount + (input.viewDelta ?? 0),
      });
    },

    async incrementToolOutputSavings(orgId, delta, trackedSince) {
      const updatedAt = new Date().toISOString();
      const bucket = updatedAt.slice(0, 10);
      const key = `${orgId}\u0000${bucket}\u0000${delta.optimizer}\u0000${delta.tool}`;
      const existing = toolOutputSavings.get(key);

      toolOutputSavings.set(key, {
        bucket,
        bytesIn: (existing?.bytesIn ?? 0) + delta.bytesIn,
        bytesOut: (existing?.bytesOut ?? 0) + delta.bytesOut,
        calls: (existing?.calls ?? 0) + 1,
        optimizer: delta.optimizer,
        orgId,
        tool: delta.tool,
        trackedSince: existing?.trackedSince ?? trackedSince,
        updatedAt,
      });
    },

    async insertAttachment(record) {
      attachments.set(record.id, { ...record });
    },

    async insertAutomationRun(record) {
      const existing = automationRuns.get(record.automationId) ?? [];
      automationRuns.set(record.automationId, [...existing, record]);
    },

    async insertTaskRun(record) {
      const existing = taskRuns.get(record.taskId) ?? [];
      taskRuns.set(record.taskId, [...existing, record]);
    },

    async listAutomationRuns(automationId, limit = 20) {
      return [...(automationRuns.get(automationId) ?? [])]
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .slice(0, limit);
    },

    async listAutomations() {
      return Array.from(automations.values());
    },

    async listAutomationsForOrg(orgId) {
      return Array.from(automations.values()).filter(
        (automation) => automation.orgId === orgId
      );
    },

    async listComposioToolkitsForOrg(orgId) {
      return Array.from(composioToolkits.values()).filter(
        (record) => record.orgId === orgId
      );
    },

    async listComposioUserConnectionsForUser(orgId, userId) {
      return Array.from(composioUserConnections.values()).filter(
        (record) => record.orgId === orgId && record.userId === userId
      );
    },

    async listLlmTurnUsage(orgId) {
      return [...llmTurnUsage.values()]
        .filter((row) => row.orgId === orgId)
        .sort((left, right) => left.bucket.localeCompare(right.bucket));
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

    async listMcpServerProfileCounts() {
      const counts: Record<string, number> = {};

      for (const assigned of profileMcpServers.values()) {
        for (const serverId of assigned) {
          counts[serverId] = (counts[serverId] ?? 0) + 1;
        }
      }

      return counts;
    },

    async listMcpServers() {
      return Array.from(mcpServers.values());
    },

    async listMcpServersForProfile(profileId) {
      const assigned = profileMcpServers.get(profileId);

      if (!assigned) {
        return [];
      }

      return Array.from(assigned)
        .map((serverId) => mcpServers.get(serverId))
        .filter(
          (server): server is StoredMcpServerRecord => server !== undefined
        );
    },

    async listMessagesForSession(sessionId) {
      return [...(sessionMessages.get(sessionId) ?? [])].sort(
        (left, right) => left.seq - right.seq
      );
    },

    async listNotificationDestinationsForOrg(orgId) {
      return Array.from(notificationDestinations.values()).filter(
        (record) => record.orgId === orgId
      );
    },

    async listOrganizations() {
      return Array.from(organizations.values()).sort((left, right) =>
        left.name.localeCompare(right.name)
      );
    },

    async listOrgMembers(orgId) {
      return Array.from(orgMembers.values())
        .filter((member) => member.orgId === orgId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },

    async listOrgMemoryProposals(orgId, status) {
      const proposals = [...orgMemoryProposals.values()].filter(
        (proposal) => proposal.orgId === orgId
      );
      const filtered = status
        ? proposals.filter((proposal) => proposal.status === status)
        : proposals;
      return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async listProfileComposioToolkits(profileId) {
      return profileComposioToolkits.get(profileId) ?? [];
    },

    async listProfiles() {
      return Array.from(profiles.values());
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

    async listSessionSummaries(profileId, channel) {
      return Array.from(sessions.values())
        .filter(
          (session) =>
            session.profileId === profileId && session.channel === channel
        )
        .map((session) =>
          summarizeSession(session, sessionMessages.get(session.id) ?? [])
        )
        .filter((summary) => summary.messageCount > 0)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },

    async listSessions() {
      return Array.from(sessions.values());
    },

    async listSkillProposals(orgId, options = {}) {
      const { status, profileId, sessionId } = options;
      const proposals = [...skillProposals.values()].filter((proposal) => {
        if (proposal.orgId !== orgId) {
          return false;
        }
        if (status && proposal.status !== status) {
          return false;
        }
        if (profileId && proposal.profileId !== profileId) {
          return false;
        }
        if (sessionId && proposal.sessionId !== sessionId) {
          return false;
        }
        return true;
      });
      return proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async listSkillSuggestions(orgId, options = {}) {
      const { sessionId, status, profileId } = options;
      const suggestions = [...skillSuggestions.values()].filter(
        (suggestion) => {
          if (suggestion.orgId !== orgId) {
            return false;
          }
          if (sessionId && suggestion.sessionId !== sessionId) {
            return false;
          }
          if (status && suggestion.status !== status) {
            return false;
          }
          if (profileId && suggestion.profileId !== profileId) {
            return false;
          }
          return true;
        }
      );
      return suggestions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async listSkills() {
      return Array.from(skills.values()).sort((left, right) =>
        left.name.localeCompare(right.name)
      );
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

    async listSkillUsageForProfile(profileId) {
      return Array.from(skillUsage.values())
        .filter((usage) => usage.profileId === profileId)
        .sort((left, right) => left.skillId.localeCompare(right.skillId));
    },

    async listTaskRuns(taskId, limit = 20) {
      return [...(taskRuns.get(taskId) ?? [])]
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
        .slice(0, limit);
    },

    async listTasks() {
      return Array.from(tasks.values()).sort((left, right) => {
        const statusCompare = left.status.localeCompare(right.status);
        return statusCompare === 0
          ? left.position - right.position
          : statusCompare;
      });
    },

    async listTasksForOrg(orgId) {
      return Array.from(tasks.values())
        .filter((task) => task.orgId === orgId)
        .sort((left, right) => {
          const statusCompare = left.status.localeCompare(right.status);
          return statusCompare === 0
            ? left.position - right.position
            : statusCompare;
        });
    },

    async listToolOutputSavings(orgId) {
      return [...toolOutputSavings.values()]
        .filter((row) => row.orgId === orgId)
        .sort((left, right) =>
          left.bucket === right.bucket
            ? right.bytesIn - right.bytesOut - (left.bytesIn - left.bytesOut)
            : left.bucket.localeCompare(right.bucket)
        );
    },

    async listTools() {
      return Array.from(tools.values());
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

    async listUserOrganizations(userId) {
      return Array.from(orgMembers.values())
        .filter((member) => member.userId === userId)
        .map((member) => {
          const organization = organizations.get(member.orgId);
          if (!organization) {
            return null;
          }

          return {
            joinedAt: member.createdAt,
            organization,
            role: member.role,
          } satisfies StoredUserOrganizationRecord;
        })
        .filter(
          (record): record is StoredUserOrganizationRecord => record !== null
        )
        .sort((left, right) =>
          left.organization.name.localeCompare(right.organization.name)
        );
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

    async markSkillSuggestionApplied(orgId, id, appliedAt) {
      const suggestion = skillSuggestions.get(id);
      if (!suggestion || suggestion.orgId !== orgId) {
        return false;
      }
      skillSuggestions.set(id, {
        ...suggestion,
        appliedAt,
        status: "applied",
      });
      return true;
    },

    async replaceMessagesForSession(sessionId, messages) {
      sessionMessages.set(sessionId, [...messages]);
    },

    async replaceProfileComposioToolkits(profileId, assignments) {
      profileComposioToolkits.set(
        profileId,
        assignments.map((assignment) => ({ ...assignment, profileId }))
      );
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

    async revokeBrowserSessionBySessionTokenHash(sessionTokenHash, revokedAt) {
      const session = browserSessionsByHash.get(sessionTokenHash);

      if (!session || session.revokedAt) {
        return false;
      }

      browserSessionsByHash.set(sessionTokenHash, { ...session, revokedAt });
      return true;
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

    async unassignMcpServerFromProfile(profileId, serverId) {
      const assigned = profileMcpServers.get(profileId);

      if (!assigned?.delete(serverId)) {
        return false;
      }

      return true;
    },

    async unassignSkillFromProfile(profileId, skillId) {
      const assigned = profileSkills.get(profileId);

      if (!assigned?.delete(skillId)) {
        return false;
      }

      return true;
    },

    async unassignToolFromProfile(profileId, toolId) {
      const assigned = profileTools.get(profileId);

      if (!assigned?.delete(toolId)) {
        return false;
      }

      return true;
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

    async updateAutomationRun(record) {
      const existing = automationRuns.get(record.automationId) ?? [];
      automationRuns.set(
        record.automationId,
        existing.map((run) => (run.id === record.id ? record : run))
      );
    },

    async updateBrowserSessionActiveOrgId(id, activeOrgId) {
      for (const [hash, session] of browserSessionsByHash.entries()) {
        if (session.id === id) {
          browserSessionsByHash.set(hash, { ...session, activeOrgId });
          return;
        }
      }
    },

    async updateBrowserSessionLastUsedAt(id, lastUsedAt) {
      for (const [hash, session] of browserSessionsByHash.entries()) {
        if (session.id === id) {
          browserSessionsByHash.set(hash, { ...session, lastUsedAt });
          return;
        }
      }
    },

    async updateOrgMemoryProposalStatus(orgId, id, update) {
      const proposal = orgMemoryProposals.get(id);
      if (!proposal || proposal.orgId !== orgId) {
        return false;
      }
      orgMemoryProposals.set(id, {
        ...proposal,
        pinned: update.pinned ?? proposal.pinned,
        reviewedAt: update.reviewedAt,
        reviewerUserId: update.reviewerUserId,
        status: update.status,
      });
      return true;
    },

    async updateSessionQuestionnaire(sessionId, questionnaire) {
      const session = sessions.get(sessionId);

      if (!session) {
        return;
      }

      sessions.set(sessionId, {
        ...session,
        agentQuestionnaire: questionnaire,
      });
    },

    async updateSessionTitle(sessionId, title) {
      const session = sessions.get(sessionId);

      if (!session || session.title !== null) {
        return false;
      }

      sessions.set(sessionId, { ...session, title });
      return true;
    },

    async updateSessionTodos(sessionId, todos) {
      const session = sessions.get(sessionId);

      if (!session) {
        return;
      }

      sessions.set(sessionId, { ...session, agentTodos: todos });
    },

    async updateSkillProposalStatus(orgId, id, update) {
      const proposal = skillProposals.get(id);
      if (!proposal || proposal.orgId !== orgId) {
        return false;
      }
      skillProposals.set(id, {
        ...proposal,
        reviewedAt: update.reviewedAt,
        reviewerUserId: update.reviewerUserId,
        status: update.status,
      });
      return true;
    },

    async updateTaskRun(record) {
      const existing = taskRuns.get(record.taskId) ?? [];
      taskRuns.set(
        record.taskId,
        existing.map((run) => (run.id === record.id ? record : run))
      );
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

    async updateUserProfile(id, profile, updatedAt) {
      const user = usersById.get(id);
      if (!user) {
        return;
      }

      const nextEmail = profile.email ?? user.email;
      if (nextEmail !== user.email) {
        usersByEmail.delete(user.email);
      }

      const updated = {
        ...user,
        email: nextEmail,
        name: profile.name,
        phone: profile.phone,
        updatedAt,
      };
      usersById.set(id, updated);
      usersByEmail.set(updated.email, updated);
    },

    async upsertAutomation(record) {
      automations.set(record.id, record);
    },

    async upsertAutomationRunReadThrough(
      userId,
      orgId,
      automationId,
      readThroughAt
    ) {
      const key = `${userId}:${orgId}:${automationId}`;
      automationRunReadState.set(key, {
        automationId,
        orgId,
        readThroughAt,
        userId,
      });
    },

    async upsertComposioToolkit(record) {
      composioToolkits.set(record.id, record);
    },

    async upsertComposioUserConnection(record) {
      composioUserConnections.set(record.id, record);
    },

    async upsertMcpServer(record) {
      const existing = mcpServers.get(record.id);

      if (existing) {
        mcpServersByName.delete(existing.name);
      }

      mcpServers.set(record.id, record);
      mcpServersByName.set(record.name, record);
    },

    async upsertNotificationDestination(record) {
      notificationDestinations.set(record.id, record);
    },

    async upsertOrganization(record) {
      organizations.set(record.id, record);
      organizationsBySlug.set(record.slug, record);
    },

    async upsertOrgMember(record) {
      orgMembers.set(`${record.orgId}:${record.userId}`, record);
    },

    async upsertProfile(record) {
      if (record.isDefault && record.orgId) {
        for (const profile of profiles.values()) {
          if (
            profile.orgId === record.orgId &&
            profile.id !== record.id &&
            profile.isDefault
          ) {
            profiles.set(profile.id, { ...profile, isDefault: false });
          }
        }
      }

      profiles.set(record.id, record);
    },

    async upsertSession(record) {
      sessions.set(record.id, record);
    },

    async upsertSkill(record) {
      const existing = skills.get(record.id);

      if (existing) {
        skillsBySourcePath.delete(existing.sourcePath);
      }

      skills.set(record.id, record);
      skillsBySourcePath.set(record.sourcePath, record);
    },

    async upsertTask(record) {
      tasks.set(record.id, record);
    },

    async upsertTool(record) {
      const existing = tools.get(record.id);

      if (existing) {
        toolsByName.delete(existing.name);
      }

      tools.set(record.id, record);
      toolsByName.set(record.name, record);
    },

    async upsertWorkspaceSettings(record) {
      workspaceSettings = {
        ...record,
        codingAgentHarnesses: record.codingAgentHarnesses.map((harness) => ({
          ...harness,
          args: [...harness.args],
        })),
        codingAgentProviderPassthrough:
          record.codingAgentProviderPassthrough !== false,
      };
    },
  };
}

function summarizeSession(
  session: StoredSessionRecord,
  messages: StoredSessionMessageRecord[]
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
      (message.payload as { role?: string }).role === "user"
  );
  const preview =
    typeof firstUser?.payload === "object" &&
    firstUser.payload !== null &&
    (firstUser.payload as { role?: string }).role === "user"
      ? (() => {
          const content = (firstUser.payload as { content: string | unknown[] })
            .content;
          const text = getUserMessageText(
            content as string | MessageContentPart[]
          ).trim();
          return text || (Array.isArray(content) ? "[image]" : null);
        })()
      : null;

  return {
    channel: session.channel,
    createdAt: session.createdAt,
    id: session.id,
    messageCount: sorted.length,
    preview,
    profileId: session.profileId,
    title: session.title ?? null,
    updatedAt,
  };
}
