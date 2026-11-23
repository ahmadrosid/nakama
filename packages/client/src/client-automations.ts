import type {
  AutomationResponse,
  AutomationRunRecord,
  AutomationSchedule,
  CreateAutomationWebhookSecretResponse,
  GetAutomationRunResponse,
  ListAutomationRunsResponse,
  ListAutomationsResponse,
  ListWorkflowRunsResponse,
  MarkAutomationRunsReadResponse,
  RunAutomationResponse,
  StoredAutomation,
  StoredWorkflow,
  UpdateAutomationRequest,
} from "@nakama/core/contract";
import { withDisabledFetchIdle } from "@nakama/core/fetch-idle";
import { PluginsClient } from "./client-plugins";

/** Automations and workflows. */
export class AutomationsClient extends PluginsClient {
  async listAutomations(): Promise<ListAutomationsResponse> {
    return this.request<ListAutomationsResponse>("/v1/automations");
  }

  async updateAutomation(
    automationId: string,
    request: UpdateAutomationRequest
  ): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}`,
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );

    return response.automation;
  }

  async deleteAutomation(automationId: string): Promise<void> {
    await this.request(`/v1/automations/${encodeURIComponent(automationId)}`, {
      method: "DELETE",
    });
  }

  async runAutomation(automationId: string): Promise<AutomationRunRecord> {
    const response = await this.request<RunAutomationResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/run`,
      withDisabledFetchIdle({ method: "POST" })
    );

    return response.run;
  }

  /** The secret is returned only here; a new call replaces the old one. */
  async createAutomationWebhookSecret(automationId: string): Promise<string> {
    const response = await this.request<CreateAutomationWebhookSecretResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/webhook-secret`,
      { method: "POST" }
    );

    return response.secret;
  }

  async listAutomationSchedules(): Promise<AutomationSchedule[]> {
    return this.request<AutomationSchedule[]>(
      "/v1/internal/automations/schedules"
    );
  }

  async runAutomationInternal(
    automationId: string,
    orgId: string,
    runAt?: string
  ): Promise<void> {
    const query = new URLSearchParams({ orgId });

    if (runAt !== undefined) {
      query.set("runAt", runAt);
    }

    await this.request(
      `/v1/internal/automations/${encodeURIComponent(automationId)}/run?${query}`,
      withDisabledFetchIdle({
        method: "POST",
      })
    );
  }

  async listAutomationRuns(
    automationId: string
  ): Promise<AutomationRunRecord[]> {
    const response = await this.request<ListAutomationRunsResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/runs`
    );

    return response.runs;
  }

  async getAutomationRun(
    automationId: string,
    runId: string
  ): Promise<AutomationRunRecord> {
    const response = await this.request<GetAutomationRunResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/runs/${encodeURIComponent(runId)}`
    );

    return response.run;
  }

  async markAutomationRunsRead(automationId: string): Promise<string> {
    const response = await this.request<MarkAutomationRunsReadResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/runs/mark-read`,
      { method: "POST" }
    );

    return response.readThroughAt;
  }
  async getWorkflow(workflowId: string): Promise<StoredWorkflow> {
    const { result } = await this.invokePluginAction<StoredWorkflow | null>(
      "workflows",
      "get_workflow",
      { input: { workflowId } }
    );

    if (!result) {
      throw new Error("Workflow not found.");
    }

    return result;
  }
  async listWorkflowRuns(
    workflowId: string
  ): Promise<ListWorkflowRunsResponse["runs"]> {
    const { result } = await this.invokePluginAction<
      ListWorkflowRunsResponse["runs"]
    >("workflows", "runs", { input: { workflowId } });

    return result;
  }
}
