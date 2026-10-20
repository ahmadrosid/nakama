import type {
  AgentGroup,
  AgentGroupSession,
  AgentGroupSessionDetail,
  ListAgentGroupSessionsResponse,
  ListAgentGroupsResponse,
  ListRailPinsResponse,
} from "@nakama/core/agent-groups";
import type { ImageAttachment } from "@nakama/core/contract";
import { OrgMemoryClient } from "./client-org-memory";

interface AgentGroupInput {
  memberIds: string[];
  name: string;
}

function agentGroupPath(groupId: string): string {
  return `/v1/agent-groups/${encodeURIComponent(groupId)}`;
}

function agentGroupSessionPath(groupId: string, sessionId: string): string {
  return `${agentGroupPath(groupId)}/sessions/${encodeURIComponent(sessionId)}`;
}

/** Agent groups, their sessions, and the agents and groups pinned in the rail. */
export class AgentGroupsClient extends OrgMemoryClient {
  async listAgentGroups(): Promise<ListAgentGroupsResponse> {
    return this.request<ListAgentGroupsResponse>("/v1/agent-groups");
  }

  async createAgentGroup(request: AgentGroupInput): Promise<AgentGroup> {
    return this.request<AgentGroup>("/v1/agent-groups", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async getAgentGroup(groupId: string): Promise<AgentGroup> {
    return this.request<AgentGroup>(agentGroupPath(groupId));
  }

  async updateAgentGroup(
    groupId: string,
    request: AgentGroupInput
  ): Promise<AgentGroup> {
    return this.request<AgentGroup>(agentGroupPath(groupId), {
      body: JSON.stringify(request),
      method: "PUT",
    });
  }

  async deleteAgentGroup(groupId: string): Promise<void> {
    await this.request(agentGroupPath(groupId), { method: "DELETE" });
  }

  async uploadAgentGroupAvatar(
    groupId: string,
    image: ImageAttachment
  ): Promise<void> {
    await this.request(`${agentGroupPath(groupId)}/avatar`, {
      body: JSON.stringify(image),
      method: "PUT",
    });
  }

  async deleteAgentGroupAvatar(groupId: string): Promise<void> {
    await this.request(`${agentGroupPath(groupId)}/avatar`, {
      method: "DELETE",
    });
  }

  async listAgentGroupSessions(
    groupId: string
  ): Promise<ListAgentGroupSessionsResponse> {
    return this.request<ListAgentGroupSessionsResponse>(
      `${agentGroupPath(groupId)}/sessions`
    );
  }

  /** Opens a session with its first message; the agents start replying. */
  async createAgentGroupSession(
    groupId: string,
    content: string
  ): Promise<AgentGroupSession> {
    return this.request<AgentGroupSession>(
      `${agentGroupPath(groupId)}/sessions`,
      { body: JSON.stringify({ content }), method: "POST" }
    );
  }

  async getAgentGroupSession(
    groupId: string,
    sessionId: string
  ): Promise<AgentGroupSessionDetail> {
    return this.request<AgentGroupSessionDetail>(
      agentGroupSessionPath(groupId, sessionId)
    );
  }

  async updateAgentGroupSession(
    groupId: string,
    sessionId: string,
    changes: { pinned?: boolean; title?: string }
  ): Promise<void> {
    await this.request(agentGroupSessionPath(groupId, sessionId), {
      body: JSON.stringify(changes),
      method: "PATCH",
    });
  }

  async deleteAgentGroupSession(
    groupId: string,
    sessionId: string
  ): Promise<void> {
    await this.request(agentGroupSessionPath(groupId, sessionId), {
      method: "DELETE",
    });
  }

  async sendAgentGroupMessage(
    groupId: string,
    sessionId: string,
    content: string
  ): Promise<void> {
    await this.request(
      `${agentGroupSessionPath(groupId, sessionId)}/messages`,
      {
        body: JSON.stringify({ content }),
        method: "POST",
      }
    );
  }

  async stopAgentGroupSession(
    groupId: string,
    sessionId: string
  ): Promise<void> {
    await this.request(`${agentGroupSessionPath(groupId, sessionId)}/stop`, {
      method: "POST",
    });
  }

  async listRailPins(): Promise<ListRailPinsResponse> {
    return this.request<ListRailPinsResponse>("/v1/rail-pins");
  }

  async setRailPin(itemId: string, pinned: boolean): Promise<void> {
    await this.request(`/v1/rail-pins/${encodeURIComponent(itemId)}`, {
      method: pinned ? "PUT" : "DELETE",
    });
  }
}
