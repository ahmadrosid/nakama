import type {
  AddOrgMemberRequest,
  AddOrgMemberResponse,
  AuthUserResponse,
  CreateOrganizationRequest,
  CreateOrganizationResponse,
  CreateTeamRequest,
  InviteOrgMemberRequest,
  ListOrganizationsResponse,
  ListOrgMembersResponse,
  ListOrgSharedResourcesResponse,
  ListSkillCuratorOrgsResponse,
  OrganizationOverviewResponse,
  OrganizationResponse,
  OrgInviteCreatedResponse,
  OrgLlmQuotaStatusResponse,
  OrgMemberResponse,
  OrgSharedResourceResponse,
  OrgUsageSummaryResponse,
  ProfileResponse,
  PublishedSkillResponse,
  PublishOrgSharedResourceRequest,
  RunSkillCuratorInternalRequest,
  RunSkillCuratorRequest,
  SetActiveOrgRequest,
  SkillCuratorLatestResponse,
  SkillCuratorRunResponse,
  SkillFileResponse,
  SkillFilesResponse,
  UpdateOrganizationRequest,
  UpdateOrgMemberRequest,
} from "@nakama/core/contract";
import { AuthClient } from "./client-auth";

/** Organizations, teams, members, shared resources, and the skill curator. */
export class OrgsClient extends AuthClient {
  async runOrgSkillCurator(
    orgId: string,
    request: RunSkillCuratorRequest = {}
  ): Promise<SkillCuratorRunResponse> {
    return this.request<SkillCuratorRunResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/curator/run`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async getOrgSkillCuratorLatest(
    orgId: string
  ): Promise<SkillCuratorLatestResponse> {
    return this.request<SkillCuratorLatestResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/curator/latest`,
      {
        headers: { "X-Org-Id": orgId },
      }
    );
  }

  async listSkillCuratorOrgs(): Promise<ListSkillCuratorOrgsResponse> {
    return this.request<ListSkillCuratorOrgsResponse>(
      "/v1/internal/curator/orgs"
    );
  }

  async runSkillCuratorInternal(
    orgId: string,
    request: RunSkillCuratorInternalRequest
  ): Promise<SkillCuratorRunResponse> {
    return this.request<SkillCuratorRunResponse>(
      `/v1/internal/curator/orgs/${encodeURIComponent(orgId)}/run`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async getOrganizationUsageSummary(
    orgId: string
  ): Promise<OrgUsageSummaryResponse> {
    return this.request<OrgUsageSummaryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/usage-summary`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async getOrganizationLlmQuotaStatus(
    orgId: string
  ): Promise<OrgLlmQuotaStatusResponse> {
    return this.request<OrgLlmQuotaStatusResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/llm-quota`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async updateOrganization(
    orgId: string,
    request: UpdateOrganizationRequest
  ): Promise<OrganizationResponse> {
    return this.request<OrganizationResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "PATCH",
      }
    );
  }

  async updatePlatformOrganization(
    orgId: string,
    request: UpdateOrganizationRequest
  ): Promise<OrganizationResponse> {
    return this.request<OrganizationResponse>(
      `/v1/platform/orgs/${encodeURIComponent(orgId)}`,
      {
        body: JSON.stringify(request),
        method: "PATCH",
      }
    );
  }

  async archivePlatformOrganization(
    orgId: string
  ): Promise<OrganizationResponse> {
    return this.request<OrganizationResponse>(
      `/v1/platform/orgs/${encodeURIComponent(orgId)}`,
      {
        method: "DELETE",
      }
    );
  }

  async setActiveOrg(orgId: string): Promise<AuthUserResponse> {
    const scopeRevision = this.orgScopeRevision;
    const requestRevision = ++this.activeOrgRequestRevision;

    const response = await this.request<AuthUserResponse>(
      "/v1/auth/active-org",
      {
        body: JSON.stringify({ orgId } satisfies SetActiveOrgRequest),
        method: "POST",
      }
    );

    if (
      scopeRevision === this.orgScopeRevision &&
      requestRevision === this.activeOrgRequestRevision
    ) {
      this.applyAuthUserResponse(response);
    }

    return response;
  }

  async listPlatformOrganizations(): Promise<ListOrganizationsResponse> {
    return this.request<ListOrganizationsResponse>("/v1/platform/orgs");
  }

  async createPlatformOrganization(
    request: CreateOrganizationRequest
  ): Promise<CreateOrganizationResponse> {
    return this.request<CreateOrganizationResponse>("/v1/platform/orgs", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async listOrgMembers(orgId: string): Promise<ListOrgMembersResponse> {
    return this.request<ListOrgMembersResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/members`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async setPlatformOrgMemberDisabled(
    orgId: string,
    userId: string,
    disabled: boolean
  ): Promise<void> {
    await this.request<void>(
      `/v1/platform/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}/${disabled ? "disable" : "enable"}`,
      { method: "POST" }
    );
  }

  async listParentOrgMembers(orgId: string): Promise<ListOrgMembersResponse> {
    return this.request<ListOrgMembersResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/parent-members`
    );
  }

  async getOrganizationOverview(
    orgId: string
  ): Promise<OrganizationOverviewResponse> {
    return this.request<OrganizationOverviewResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/overview`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async createTeam(
    orgId: string,
    request: CreateTeamRequest
  ): Promise<CreateOrganizationResponse> {
    return this.request<CreateOrganizationResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/teams`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async listOrgSharedResources(
    orgId: string
  ): Promise<ListOrgSharedResourcesResponse> {
    return this.request<ListOrgSharedResourcesResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/shared-resources`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async getPublishedSkill(
    orgId: string,
    publicationId: string
  ): Promise<PublishedSkillResponse> {
    return this.request(
      `/v1/orgs/${encodeURIComponent(orgId)}/shared-resources/${encodeURIComponent(publicationId)}/skill`,
      {
        headers: { "X-Org-Id": orgId },
      }
    );
  }

  async readPublishedKnowledgeBaseDocument(
    orgId: string,
    publicationId: string,
    options: { render?: "text" } = {}
  ): Promise<{ contentType: string; data: ArrayBuffer }> {
    const query = options.render === "text" ? "?render=text" : "";

    const response = await this.fetchRaw(
      `/v1/orgs/${encodeURIComponent(orgId)}/shared-resources/${encodeURIComponent(publicationId)}/content${query}`,
      { headers: { "X-Org-Id": orgId } }
    );

    return {
      contentType:
        response.headers.get("Content-Type") ?? "application/octet-stream",
      data: await response.arrayBuffer(),
    };
  }

  async publishOrgSharedResource(
    orgId: string,
    request: PublishOrgSharedResourceRequest
  ): Promise<OrgSharedResourceResponse> {
    return this.request<OrgSharedResourceResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/shared-resources`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async listPublishedSkillFiles(
    orgId: string,
    publicationId: string
  ): Promise<SkillFilesResponse> {
    return this.request(
      `/v1/orgs/${encodeURIComponent(orgId)}/shared-resources/${encodeURIComponent(publicationId)}/skill/files`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async readPublishedSkillFile(
    orgId: string,
    publicationId: string,
    filePath: string
  ): Promise<SkillFileResponse> {
    return this.request(
      `/v1/orgs/${encodeURIComponent(orgId)}/shared-resources/${encodeURIComponent(publicationId)}/skill/file?${new URLSearchParams({ path: filePath })}`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async unpublishOrgSharedResource(
    orgId: string,
    publicationId: string
  ): Promise<void> {
    await this.request(
      `/v1/orgs/${encodeURIComponent(orgId)}/shared-resources/${encodeURIComponent(publicationId)}`,
      { headers: { "X-Org-Id": orgId }, method: "DELETE" }
    );
  }

  async createSharedAgentInstance(
    orgId: string,
    publicationId: string
  ): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/shared-agents/${encodeURIComponent(publicationId)}/instance`,
      { headers: { "X-Org-Id": orgId }, method: "POST" }
    );
  }

  async addOrgMember(
    orgId: string,
    request: AddOrgMemberRequest
  ): Promise<AddOrgMemberResponse> {
    return this.request<AddOrgMemberResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/members`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async inviteOrgMember(
    orgId: string,
    request: InviteOrgMemberRequest
  ): Promise<OrgInviteCreatedResponse> {
    return this.request<OrgInviteCreatedResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/invites`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  async updateOrgMember(
    orgId: string,
    userId: string,
    request: UpdateOrgMemberRequest
  ): Promise<OrgMemberResponse> {
    return this.request<OrgMemberResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      {
        body: JSON.stringify(request),
        method: "PATCH",
      }
    );
  }

  async removeOrgMember(orgId: string, userId: string): Promise<void> {
    await this.request(
      `/v1/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" }
    );
  }
}
