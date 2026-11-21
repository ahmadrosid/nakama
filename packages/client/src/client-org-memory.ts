import type {
  ApplySkillSuggestionResponse,
  ApproveOrgMemoryProposalRequest,
  ListOrgMemoryHistoryResponse,
  ListOrgMemoryProposalsResponse,
  ListSkillProposalsResponse,
  ListSkillSuggestionsResponse,
  OrgMemoryHistoryRevisionResponse,
  OrgMemoryProposalResponse,
  OrgMemoryResponse,
  RestoreOrgMemoryHistoryResponse,
  SkillProposalResponse,
  UpdateOrgMemoryRequest,
} from "@nakama/core/contract";
import { OrgsClient } from "./client-orgs";

/** Org memory and its proposals, plus skill proposals and suggestions. */
export class OrgMemoryClient extends OrgsClient {
  async getOrgMemory(orgId: string): Promise<OrgMemoryResponse> {
    return this.request<OrgMemoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory`,
      {
        headers: { "X-Org-Id": orgId },
      }
    );
  }

  async updateOrgMemory(
    orgId: string,
    request: UpdateOrgMemoryRequest
  ): Promise<OrgMemoryResponse> {
    return this.request<OrgMemoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "PUT",
      }
    );
  }

  async listOrgMemoryHistory(
    orgId: string
  ): Promise<ListOrgMemoryHistoryResponse> {
    return this.request<ListOrgMemoryHistoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/history`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async getOrgMemoryHistoryRevision(
    orgId: string,
    revisionId: string
  ): Promise<OrgMemoryHistoryRevisionResponse> {
    return this.request<OrgMemoryHistoryRevisionResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/history/${encodeURIComponent(revisionId)}`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async restoreOrgMemoryHistory(
    orgId: string,
    revisionId: string
  ): Promise<RestoreOrgMemoryHistoryResponse> {
    return this.request<RestoreOrgMemoryHistoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/history/${encodeURIComponent(revisionId)}/restore`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async undoOrgMemoryChange(
    orgId: string
  ): Promise<RestoreOrgMemoryHistoryResponse> {
    return this.request<RestoreOrgMemoryHistoryResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/history/undo`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async listOrgMemoryProposals(
    orgId: string,
    status?: "pending" | "approved" | "rejected"
  ): Promise<ListOrgMemoryProposalsResponse> {
    const query = status ? `?status=${encodeURIComponent(status)}` : "";

    return this.request<ListOrgMemoryProposalsResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/proposals${query}`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async approveOrgMemoryProposal(
    orgId: string,
    proposalId: string,
    request: ApproveOrgMemoryProposalRequest = {}
  ): Promise<OrgMemoryProposalResponse> {
    return this.request<OrgMemoryProposalResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/proposals/${encodeURIComponent(proposalId)}/approve`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async rejectOrgMemoryProposal(
    orgId: string,
    proposalId: string
  ): Promise<OrgMemoryProposalResponse> {
    return this.request<OrgMemoryProposalResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/memory/proposals/${encodeURIComponent(proposalId)}/reject`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async listSkillProposals(
    orgId: string,
    options: {
      status?: "pending" | "approved" | "rejected";
      profileId?: string;
      sessionId?: string;
    } = {}
  ): Promise<ListSkillProposalsResponse> {
    const params = new URLSearchParams();

    if (options.status) {
      params.set("status", options.status);
    }

    if (options.profileId) {
      params.set("profileId", options.profileId);
    }

    if (options.sessionId) {
      params.set("sessionId", options.sessionId);
    }

    const query = params.toString();

    return this.request<ListSkillProposalsResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/skill-proposals${query ? `?${query}` : ""}`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async approveSkillProposal(
    orgId: string,
    proposalId: string
  ): Promise<SkillProposalResponse> {
    return this.request<SkillProposalResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/skill-proposals/${encodeURIComponent(proposalId)}/approve`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async rejectSkillProposal(
    orgId: string,
    proposalId: string
  ): Promise<SkillProposalResponse> {
    return this.request<SkillProposalResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/skill-proposals/${encodeURIComponent(proposalId)}/reject`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }

  async listSkillSuggestions(
    orgId: string,
    options: {
      sessionId?: string;
      status?: "pending" | "applied";
      profileId?: string;
    } = {}
  ): Promise<ListSkillSuggestionsResponse> {
    const params = new URLSearchParams();

    if (options.sessionId) {
      params.set("sessionId", options.sessionId);
    }

    if (options.status) {
      params.set("status", options.status);
    }

    if (options.profileId) {
      params.set("profileId", options.profileId);
    }

    const query = params.toString();

    return this.request<ListSkillSuggestionsResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/skill-suggestions${query ? `?${query}` : ""}`,
      { headers: { "X-Org-Id": orgId } }
    );
  }

  async applySkillSuggestion(
    orgId: string,
    suggestionId: string
  ): Promise<ApplySkillSuggestionResponse> {
    return this.request<ApplySkillSuggestionResponse>(
      `/v1/orgs/${encodeURIComponent(orgId)}/skill-suggestions/${encodeURIComponent(suggestionId)}/apply`,
      {
        headers: { "X-Org-Id": orgId },
        method: "POST",
      }
    );
  }
}
