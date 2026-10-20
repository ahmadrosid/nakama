import type {
  DeleteRetainedPluginDataRequest,
  InstallLocalPluginRequest,
  InstallOrgPluginRequest,
  InstallPluginPackageRequest,
  InstallPluginPackageResponse,
  InvokePluginActionRequest,
  InvokePluginActionResponse,
  ListOrgPluginsResponse,
  ListPluginReleasesResponse,
  ListPluginUpdatesResponse,
  LocalPluginDraftRequest,
  LocalPluginPreviewResponse,
  OrgPluginDetail,
  OrgPluginSummary,
  PluginContributionChangePreview,
  PluginPackagePreviewResponse,
  PluginPackageRequest,
  PluginRevisionRequest,
  PluginUsageResponse,
  ReadLocalPluginFileRequest,
  UpdateOrgPluginRequest,
} from "@nakama/core/contract";
import { withDisabledFetchIdle } from "@nakama/core/fetch-idle";
import { ChatClient } from "./client-chat";
import type { OfficialPluginInstallResponse } from "./client-helpers";

/** Plugins: packages, releases, org installs, actions. */
export class PluginsClient extends ChatClient {
  async listOfficialPlugins(): Promise<{
    plugins: Array<{
      icon?: string;
      id: string;
      name: string;
      description: string;
      version: string;
    }>;
  }> {
    return this.request("/v1/plugins/official");
  }
  async installOfficialPlugin(
    pluginId: string,
    orgId?: string
  ): Promise<OfficialPluginInstallResponse> {
    return this.request<OfficialPluginInstallResponse>(
      `/v1/plugins/official/${encodeURIComponent(pluginId)}/install`,
      {
        headers: orgId ? { "X-Org-Id": orgId } : undefined,
        method: "POST",
      }
    );
  }

  async reinstallOfficialPlugin(
    pluginId: string,
    expectedRevision: number,
    orgId?: string
  ): Promise<OfficialPluginInstallResponse> {
    return this.request<OfficialPluginInstallResponse>(
      `/v1/plugins/official/${encodeURIComponent(pluginId)}/reinstall`,
      {
        body: JSON.stringify({ expectedRevision }),
        headers: orgId ? { "X-Org-Id": orgId } : undefined,
        method: "POST",
      }
    );
  }

  async previewPluginPackage(
    request: PluginPackageRequest
  ): Promise<PluginPackagePreviewResponse> {
    return this.request("/v1/platform/plugins/releases/preview", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async previewLocalPlugin(
    input: LocalPluginDraftRequest
  ): Promise<LocalPluginPreviewResponse> {
    return this.request("/v1/platform/plugins/preview-local", {
      body: JSON.stringify(input),
      method: "POST",
    });
  }

  async readLocalPluginFile(input: ReadLocalPluginFileRequest): Promise<{
    path: string;
    content: string;
    encoding: "base64";
    nextOffset: number | null;
  }> {
    return this.request("/v1/platform/plugins/local-file", {
      body: JSON.stringify(input),
      method: "POST",
    });
  }

  async installLocalPlugin(
    input: InstallLocalPluginRequest
  ): Promise<{ install: OrgPluginSummary }> {
    return this.request("/v1/platform/plugins/install-local", {
      body: JSON.stringify(input),
      method: "POST",
    });
  }

  async installPluginPackage(
    request: InstallPluginPackageRequest
  ): Promise<InstallPluginPackageResponse> {
    return this.request("/v1/platform/plugins/releases", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async listPluginReleases(): Promise<ListPluginReleasesResponse> {
    return this.request<ListPluginReleasesResponse>(
      "/v1/platform/plugins/releases"
    );
  }

  async listPluginUpdates(): Promise<ListPluginUpdatesResponse> {
    return this.request<ListPluginUpdatesResponse>(
      "/v1/platform/plugins/updates"
    );
  }

  async getPluginUsage(pluginId: string): Promise<PluginUsageResponse> {
    return this.request<PluginUsageResponse>(
      `/v1/platform/plugins/${encodeURIComponent(pluginId)}/usage`
    );
  }

  async removePluginRelease(pluginId: string, version: string): Promise<void> {
    await this.request(
      `/v1/platform/plugins/releases/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}`,
      { method: "DELETE" }
    );
  }

  async listOrgPlugins(orgId?: string): Promise<ListOrgPluginsResponse> {
    return this.request<ListOrgPluginsResponse>(
      "/v1/plugins",
      orgId ? { headers: { "X-Org-Id": orgId } } : undefined
    );
  }

  async getOrgPlugin(
    pluginId: string,
    orgId?: string
  ): Promise<OrgPluginDetail> {
    return this.request<OrgPluginDetail>(
      `/v1/plugins/${encodeURIComponent(pluginId)}`,
      orgId ? { headers: { "X-Org-Id": orgId } } : undefined
    );
  }

  async installOrgPlugin(
    pluginId: string,
    request: InstallOrgPluginRequest = {},
    orgId?: string
  ): Promise<OrgPluginDetail> {
    return this.request<OrgPluginDetail>(
      `/v1/plugins/${encodeURIComponent(pluginId)}/install`,
      {
        body: JSON.stringify(request),
        headers: orgId ? { "X-Org-Id": orgId } : undefined,
        method: "POST",
        ...withDisabledFetchIdle({}),
      }
    );
  }

  private async postPluginRevision(
    pluginId: string,
    action: "disable" | "enable" | "uninstall",
    expectedRevision: number,
    orgId?: string
  ): Promise<OrgPluginDetail> {
    const request: PluginRevisionRequest = { expectedRevision };

    return this.request<OrgPluginDetail>(
      `/v1/plugins/${encodeURIComponent(pluginId)}/${action}`,
      {
        body: JSON.stringify(request),
        headers: orgId ? { "X-Org-Id": orgId } : undefined,
        method: "POST",
        ...withDisabledFetchIdle({}),
      }
    );
  }

  async enableOrgPlugin(
    pluginId: string,
    expectedRevision: number,
    orgId?: string
  ): Promise<OrgPluginDetail> {
    return this.postPluginRevision(pluginId, "enable", expectedRevision, orgId);
  }

  async disableOrgPlugin(
    pluginId: string,
    expectedRevision: number,
    orgId?: string
  ): Promise<OrgPluginDetail> {
    return this.postPluginRevision(
      pluginId,
      "disable",
      expectedRevision,
      orgId
    );
  }

  async previewOrgPluginUpdate(
    pluginId: string,
    targetVersion: string,
    orgId?: string
  ): Promise<PluginContributionChangePreview> {
    const query = new URLSearchParams({ targetVersion });

    return this.request<PluginContributionChangePreview>(
      `/v1/plugins/${encodeURIComponent(pluginId)}/update/preview?${query}`,
      orgId ? { headers: { "X-Org-Id": orgId } } : undefined
    );
  }

  async updateOrgPlugin(
    pluginId: string,
    request: UpdateOrgPluginRequest,
    orgId?: string
  ): Promise<OrgPluginDetail> {
    return this.request<OrgPluginDetail>(
      `/v1/plugins/${encodeURIComponent(pluginId)}/update`,
      {
        body: JSON.stringify(request),
        headers: orgId ? { "X-Org-Id": orgId } : undefined,
        method: "POST",
        ...withDisabledFetchIdle({}),
      }
    );
  }

  async uninstallOrgPlugin(
    pluginId: string,
    expectedRevision: number,
    orgId?: string
  ): Promise<OrgPluginDetail> {
    return this.postPluginRevision(
      pluginId,
      "uninstall",
      expectedRevision,
      orgId
    );
  }

  async deleteRetainedPluginData(
    request: DeleteRetainedPluginDataRequest
  ): Promise<void> {
    await this.request(
      `/v1/plugins/${encodeURIComponent(request.pluginId)}/retained-data/delete`,
      {
        body: JSON.stringify(request),
        headers: { "X-Org-Id": request.orgId },
        method: "POST",
      }
    );
  }

  async invokePluginAction<Result = unknown>(
    pluginId: string,
    actionKey: string,
    request: InvokePluginActionRequest = {},
    orgId?: string,
    signal?: AbortSignal
  ): Promise<Omit<InvokePluginActionResponse, "result"> & { result: Result }> {
    return this.request<
      Omit<InvokePluginActionResponse, "result"> & { result: Result }
    >(
      `/v1/plugins/${encodeURIComponent(pluginId)}/actions/${encodeURIComponent(actionKey)}`,
      {
        body: JSON.stringify(request),
        method: "POST",
        signal,
        ...withDisabledFetchIdle({}),
        headers: orgId ? { "X-Org-Id": orgId } : undefined,
      }
    );
  }
}
