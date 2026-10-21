import type {
  AgentGroup,
  AgentGroupMemory,
  AgentGroupSession,
  AgentGroupSessionDetail,
  AgentGroupThreadDetail,
  ListAgentGroupSessionsResponse,
  ListAgentGroupsResponse,
  ListRailPinsResponse,
} from "@nakama/core/agent-groups";
import type {
  DocumentAttachment,
  ImageAttachment,
  ListWorkspaceFilesResponse,
} from "@nakama/core/contract";
import { OrgMemoryClient } from "./client-org-memory";

interface AgentGroupInput {
  brief?: string;
  memberIds: string[];
  name: string;
}

function agentGroupPath(groupId: string): string {
  return `/v1/agent-groups/${encodeURIComponent(groupId)}`;
}

function agentGroupSessionPath(groupId: string, sessionId: string): string {
  return `${agentGroupPath(groupId)}/sessions/${encodeURIComponent(sessionId)}`;
}

function agentGroupThreadPath(
  groupId: string,
  sessionId: string,
  messageId: number
): string {
  return `${agentGroupSessionPath(groupId, sessionId)}/threads/${messageId}`;
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

  async getAgentGroupMemory(groupId: string): Promise<AgentGroupMemory> {
    return this.request<AgentGroupMemory>(`${agentGroupPath(groupId)}/memory`);
  }

  /** Fails with 409 when the memory is no longer `base`, what the editor opened. */
  async updateAgentGroupMemory(
    groupId: string,
    content: string,
    base: string
  ): Promise<AgentGroupMemory> {
    return this.request<AgentGroupMemory>(`${agentGroupPath(groupId)}/memory`, {
      body: JSON.stringify({ base, content }),
      method: "PUT",
    });
  }

  async listAgentGroupFiles(
    groupId: string,
    folder = ""
  ): Promise<ListWorkspaceFilesResponse> {
    const query = new URLSearchParams({ folder });

    return this.request<ListWorkspaceFilesResponse>(
      `${agentGroupPath(groupId)}/files?${query}`
    );
  }

  async readAgentGroupFile(
    groupId: string,
    filename: string,
    options: { render?: "markdown" } = {}
  ): Promise<Blob> {
    const query = new URLSearchParams({ path: filename });

    if (options.render) {
      query.set("render", options.render);
    }

    const response = await this.fetchRaw(
      `${agentGroupPath(groupId)}/files/content?${query}`
    );

    return response.blob();
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
    content: string,
    documents: DocumentAttachment[] = []
  ): Promise<AgentGroupSession> {
    return this.request<AgentGroupSession>(
      `${agentGroupPath(groupId)}/sessions`,
      { body: JSON.stringify({ content, documents }), method: "POST" }
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
    content: string,
    documents: DocumentAttachment[] = []
  ): Promise<void> {
    await this.request(
      `${agentGroupSessionPath(groupId, sessionId)}/messages`,
      {
        body: JSON.stringify({ content, documents }),
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

  async getAgentGroupThread(
    groupId: string,
    sessionId: string,
    messageId: number
  ): Promise<AgentGroupThreadDetail> {
    return this.request<AgentGroupThreadDetail>(
      agentGroupThreadPath(groupId, sessionId, messageId)
    );
  }

  async sendAgentGroupThreadMessage(
    groupId: string,
    sessionId: string,
    messageId: number,
    content: string,
    documents: DocumentAttachment[] = []
  ): Promise<void> {
    await this.request(
      `${agentGroupThreadPath(groupId, sessionId, messageId)}/messages`,
      { body: JSON.stringify({ content, documents }), method: "POST" }
    );
  }

  async stopAgentGroupThread(
    groupId: string,
    sessionId: string,
    messageId: number
  ): Promise<void> {
    await this.request(
      `${agentGroupThreadPath(groupId, sessionId, messageId)}/stop`,
      { method: "POST" }
    );
  }
}
