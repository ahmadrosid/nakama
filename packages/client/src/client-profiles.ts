import type {
  AssignMcpServerRequest,
  AssignSkillRequest,
  AssignToolRequest,
  CloneProfileRequest,
  CreateMcpServerRequest,
  CreateProfileRequest,
  CreateProfileWithSuperNakamaRequest,
  CreateSkillRequest,
  CreateToolRequest,
  ImageAttachment,
  InstallSkillRequest,
  ListMcpServersResponse,
  ListProfileChangeHistoryResponse,
  ListProfilesResponse,
  ListSkillsResponse,
  ListSkillVersionsResponse,
  ListToolsResponse,
  McpServerResponse,
  MoveProfileRequest,
  PatchSkillRequest,
  ProfileResponse,
  RunToolRequest,
  RunToolResponse,
  SkillFileResponse,
  SkillFilesResponse,
  SkillInstallPreviewResponse,
  SkillResponse,
  SkillsMarketplaceResponse,
  SuggestToolParamsRequest,
  SuggestToolParamsResponse,
  SyncSkillsResponse,
  TestMcpServerResponse,
  ToolCredentialStatus,
  ToolResponse,
  ToolSetupPlan,
  ToolSourceResponse,
  UpdateMcpServerRequest,
  UpdateProfileRequest,
} from "@nakama/core/contract";
import { SettingsClient } from "./client-settings";

/** Agents and what they carry: tools, MCP servers, skills. */
export class ProfilesClient extends SettingsClient {
  async listProfiles(orgId?: string): Promise<ListProfilesResponse> {
    return this.request<ListProfilesResponse>(
      "/v1/profiles",
      orgId ? { headers: { "X-Org-Id": orgId } } : undefined
    );
  }

  async getProfile(
    profileId: string,
    orgId?: string
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}`,
      orgId ? { headers: { "X-Org-Id": orgId } } : undefined
    );
  }

  async listProfileChangeHistory(
    profileId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ListProfileChangeHistoryResponse> {
    const query = new URLSearchParams();

    if (options.limit !== undefined) {
      query.set("limit", String(options.limit));
    }

    if (options.offset !== undefined) {
      query.set("offset", String(options.offset));
    }

    const suffix = query.size > 0 ? `?${query.toString()}` : "";

    return this.request<ListProfileChangeHistoryResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/history${suffix}`
    );
  }

  async createProfile(request: CreateProfileRequest): Promise<ProfileResponse> {
    return this.request<ProfileResponse>("/v1/profiles", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async createProfileWithSuperNakama(
    request: CreateProfileWithSuperNakamaRequest
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>("/v1/profiles/with-super-nakama", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async updateProfile(
    profileId: string,
    request: UpdateProfileRequest
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
  }

  async moveProfile(
    profileId: string,
    request: MoveProfileRequest
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/move`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async deleteProfile(profileId: string): Promise<void> {
    await this.request(`/v1/profiles/${encodeURIComponent(profileId)}`, {
      method: "DELETE",
    });
  }

  async uploadProfileAvatar(
    profileId: string,
    attachment: ImageAttachment
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/avatar`,
      {
        body: JSON.stringify(attachment),
        method: "PUT",
      }
    );
  }

  async deleteProfileAvatar(profileId: string): Promise<void> {
    await this.request(`/v1/profiles/${encodeURIComponent(profileId)}/avatar`, {
      method: "DELETE",
    });
  }

  async listTools(orgId?: string): Promise<ListToolsResponse> {
    return this.request<ListToolsResponse>(
      "/v1/tools",
      orgId ? { headers: { "X-Org-Id": orgId } } : undefined
    );
  }

  async getTool(toolId: string, orgId?: string): Promise<ToolResponse> {
    return this.request<ToolResponse>(
      `/v1/tools/${encodeURIComponent(toolId)}`,
      orgId ? { headers: { "X-Org-Id": orgId } } : undefined
    );
  }

  async getToolSource(toolId: string): Promise<ToolSourceResponse> {
    return this.request<ToolSourceResponse>(
      `/v1/tools/${encodeURIComponent(toolId)}/source`
    );
  }

  async getToolCredentialStatus(toolId: string): Promise<ToolCredentialStatus> {
    return this.request(`/v1/tools/${encodeURIComponent(toolId)}/credentials`);
  }

  async getToolSetup(setupId: string): Promise<ToolSetupPlan> {
    return this.request(`/v1/tool-setups/${encodeURIComponent(setupId)}`);
  }

  async approveToolSetup(
    setupId: string,
    input: { apiKey?: string; profileId?: string }
  ): Promise<ToolSetupPlan> {
    return this.request(`/v1/tool-setups/${encodeURIComponent(setupId)}`, {
      body: JSON.stringify(input),
      method: "POST",
    });
  }

  async rejectToolSetup(setupId: string): Promise<ToolSetupPlan> {
    return this.request(`/v1/tool-setups/${encodeURIComponent(setupId)}`, {
      method: "DELETE",
    });
  }

  async saveToolCredential(
    toolId: string,
    apiKey: string
  ): Promise<ToolCredentialStatus> {
    return this.request(`/v1/tools/${encodeURIComponent(toolId)}/credentials`, {
      body: JSON.stringify({ apiKey }),
      method: "PUT",
    });
  }

  async manageToolCredential(
    toolId: string,
    action: "clear" | "use-stored"
  ): Promise<ToolCredentialStatus> {
    return this.request(
      `/v1/tools/${encodeURIComponent(toolId)}/credentials${action === "use-stored" ? "/use-stored" : ""}`,
      { method: action === "clear" ? "DELETE" : "POST" }
    );
  }

  async saveToolEnv(
    toolId: string,
    env: Record<string, string>
  ): Promise<ToolCredentialStatus> {
    return this.request(`/v1/tools/${encodeURIComponent(toolId)}/credentials`, {
      body: JSON.stringify({ env }),
      method: "PUT",
    });
  }

  async createTool(request: CreateToolRequest) {
    return this.request<{ tool: ListToolsResponse["tools"][number] }>(
      "/v1/tools",
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async deleteTool(toolId: string): Promise<void> {
    await this.request(`/v1/tools/${encodeURIComponent(toolId)}`, {
      method: "DELETE",
    });
  }

  async runTool(
    toolId: string,
    request: RunToolRequest
  ): Promise<RunToolResponse> {
    return this.request<RunToolResponse>(
      `/v1/tools/${encodeURIComponent(toolId)}/run`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async suggestToolParams(
    toolId: string,
    request: SuggestToolParamsRequest
  ): Promise<SuggestToolParamsResponse> {
    return this.request<SuggestToolParamsResponse>(
      `/v1/tools/${encodeURIComponent(toolId)}/params/suggest`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async assignTool(
    profileId: string,
    request: AssignToolRequest,
    orgId?: string
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/tools`,
      {
        body: JSON.stringify(request),
        headers: orgId ? { "X-Org-Id": orgId } : undefined,
        method: "POST",
      }
    );
  }

  async unassignTool(
    profileId: string,
    toolId: string,
    orgId?: string
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/tools/${encodeURIComponent(toolId)}`,
      {
        headers: orgId ? { "X-Org-Id": orgId } : undefined,
        method: "DELETE",
      }
    );
  }

  async listMcpServers(): Promise<ListMcpServersResponse> {
    return this.request<ListMcpServersResponse>("/v1/mcp/servers");
  }

  async getMcpServer(serverId: string): Promise<McpServerResponse> {
    return this.request<McpServerResponse>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}`
    );
  }

  async createMcpServer(
    request: CreateMcpServerRequest
  ): Promise<McpServerResponse> {
    return this.request<McpServerResponse>("/v1/mcp/servers", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async updateMcpServer(
    serverId: string,
    request: UpdateMcpServerRequest
  ): Promise<McpServerResponse> {
    return this.request<McpServerResponse>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}`,
      {
        body: JSON.stringify(request),
        method: "PATCH",
      }
    );
  }

  async deleteMcpServer(serverId: string, force = false): Promise<void> {
    const query = force ? "?force=true" : "";
    await this.request(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}${query}`,
      { method: "DELETE" }
    );
  }

  async connectMcpServer(serverId: string): Promise<McpServerResponse> {
    return this.request<McpServerResponse>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}/connect`,
      { method: "POST" }
    );
  }

  async syncMcpServer(serverId: string): Promise<McpServerResponse> {
    return this.request<McpServerResponse>(
      `/v1/mcp/servers/${encodeURIComponent(serverId)}/sync`,
      { method: "POST" }
    );
  }

  async testMcpServer(
    request: CreateMcpServerRequest
  ): Promise<TestMcpServerResponse> {
    return this.request<TestMcpServerResponse>("/v1/mcp/servers/test", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async assignMcpServer(
    profileId: string,
    request: AssignMcpServerRequest
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/mcp-servers`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async unassignMcpServer(
    profileId: string,
    serverId: string
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/mcp-servers/${encodeURIComponent(serverId)}`,
      { method: "DELETE" }
    );
  }

  async listSkills(orgId?: string): Promise<ListSkillsResponse> {
    return this.request<ListSkillsResponse>(
      "/v1/skills",
      orgId ? { headers: { "X-Org-Id": orgId } } : undefined
    );
  }

  async listSkillFiles(
    skillId: string,
    orgId: string
  ): Promise<SkillFilesResponse> {
    return this.request<SkillFilesResponse>(
      `/v1/skills/${encodeURIComponent(skillId)}/files`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async listSkillVersions(
    skillId: string,
    orgId: string
  ): Promise<ListSkillVersionsResponse> {
    return this.request<ListSkillVersionsResponse>(
      `/v1/skills/${encodeURIComponent(skillId)}/versions`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async restoreSkillVersion(
    skillId: string,
    versionId: string,
    orgId: string
  ): Promise<SkillResponse> {
    return this.request<SkillResponse>(
      `/v1/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(versionId)}/restore`,
      { headers: { "X-Org-Id": orgId }, method: "POST" }
    );
  }

  async installSkillPythonPackages(
    skillId: string,
    orgId: string
  ): Promise<{ output: string }> {
    return this.request<{ output: string }>(
      `/v1/skills/${encodeURIComponent(skillId)}/python-packages`,
      { headers: { "X-Org-Id": orgId }, method: "POST" }
    );
  }

  async readSkillFile(
    skillId: string,
    filePath: string,
    orgId: string
  ): Promise<SkillFileResponse> {
    return this.request<SkillFileResponse>(
      `/v1/skills/${encodeURIComponent(skillId)}/file?${new URLSearchParams({ path: filePath })}`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async cloneProfile(
    profileId: string,
    request: CloneProfileRequest = {}
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/clone`,
      { body: JSON.stringify(request), method: "POST" }
    );
  }

  async createSkill(request: CreateSkillRequest): Promise<SkillResponse> {
    return this.request<SkillResponse>("/v1/skills", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async installSkill(request: InstallSkillRequest): Promise<SkillResponse> {
    return this.request<SkillResponse>("/v1/skills/install", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async searchSkillsMarketplace(
    query: string
  ): Promise<SkillsMarketplaceResponse> {
    return this.request<SkillsMarketplaceResponse>(
      `/v1/skills/marketplace?${new URLSearchParams({ q: query })}`
    );
  }

  async previewSkillInstall(
    command: string
  ): Promise<SkillInstallPreviewResponse> {
    return this.request<SkillInstallPreviewResponse>(
      "/v1/skills/install/preview",
      { body: JSON.stringify({ command }), method: "POST" }
    );
  }

  async getSkill(skillId: string): Promise<SkillResponse> {
    return this.request<SkillResponse>(
      `/v1/skills/${encodeURIComponent(skillId)}`
    );
  }

  async patchSkill(
    skillId: string,
    request: PatchSkillRequest,
    options?: { profileId?: string }
  ): Promise<SkillResponse> {
    const params = new URLSearchParams();

    if (options?.profileId) {
      params.set("profileId", options.profileId);
    }

    const query = params.toString();
    const path = `/v1/skills/${encodeURIComponent(skillId)}${query ? `?${query}` : ""}`;

    return this.request<SkillResponse>(path, {
      body: JSON.stringify(request),
      method: "PATCH",
    });
  }

  async deleteSkill(skillId: string): Promise<void> {
    await this.request(`/v1/skills/${encodeURIComponent(skillId)}`, {
      method: "DELETE",
    });
  }

  async syncSkills(): Promise<SyncSkillsResponse> {
    return this.request<SyncSkillsResponse>("/v1/skills/sync", {
      method: "POST",
    });
  }

  async assignSkill(
    profileId: string,
    request: AssignSkillRequest,
    orgId?: string
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/skills`,
      {
        body: JSON.stringify(request),
        headers: orgId ? { "X-Org-Id": orgId } : undefined,
        method: "POST",
      }
    );
  }

  async unassignSkill(
    profileId: string,
    skillId: string,
    orgId?: string
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/skills/${encodeURIComponent(skillId)}`,
      {
        headers: orgId ? { "X-Org-Id": orgId } : undefined,
        method: "DELETE",
      }
    );
  }
}
