import type {
  AgentChannel,
  AutomationDefinition,
  AutomationResponse,
  AutomationRunRecord,
  AutomationSchedule,
  CreateAutomationRequest,
  CreateWorkflowRequest,
  DraftAutomationResponse,
  GetWorkflowRunResponse,
  ListAutomationRunsResponse,
  ListAutomationsResponse,
  ListWorkflowRunsResponse,
  ListWorkflowsResponse,
  MarkAutomationRunsReadResponse,
  RunAutomationResponse,
  RunWorkflowRequest,
  RunWorkflowResponse,
  StoredAutomation,
  StoredWorkflow,
  UpdateAutomationRequest,
  UpdateWorkflowRequest,
  WorkflowSqliteInspectResponse,
} from "@nakama/core/contract";
import { withDisabledFetchIdle } from "@nakama/core/fetch-idle";
import { PluginsClient } from "./client-plugins";

/** Automations and workflows. */
export class AutomationsClient extends PluginsClient {
  async draftAutomation(
    prompt: string,
    channel: AgentChannel
  ): Promise<AutomationDefinition> {
    const response = await this.request<DraftAutomationResponse>(
      "/v1/automations/draft",
      {
        body: JSON.stringify({ channel, prompt }),
        method: "POST",
      }
    );

    return response.automation;
  }

  async listAutomations(): Promise<ListAutomationsResponse> {
    return this.request<ListAutomationsResponse>("/v1/automations");
  }

  async getAutomation(automationId: string): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}`
    );

    return response.automation;
  }

  async createAutomation(
    request: CreateAutomationRequest
  ): Promise<StoredAutomation> {
    const response = await this.request<AutomationResponse>("/v1/automations", {
      body: JSON.stringify(request),
      method: "POST",
    });

    return response.automation;
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

  async listAutomationSchedules(): Promise<AutomationSchedule[]> {
    return this.request<AutomationSchedule[]>(
      "/v1/internal/automations/schedules"
    );
  }

  async runAutomationInternal(
    automationId: string,
    orgId: string
  ): Promise<void> {
    await this.request(
      `/v1/internal/automations/${encodeURIComponent(automationId)}/run?orgId=${encodeURIComponent(orgId)}`,
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

  async markAutomationRunsRead(automationId: string): Promise<string> {
    const response = await this.request<MarkAutomationRunsReadResponse>(
      `/v1/automations/${encodeURIComponent(automationId)}/runs/mark-read`,
      { method: "POST" }
    );

    return response.readThroughAt;
  }

  async inspectWorkflowSqlite(
    table?: string
  ): Promise<WorkflowSqliteInspectResponse> {
    const { result } =
      await this.invokePluginAction<WorkflowSqliteInspectResponse>(
        "workflows",
        "database",
        { input: { table } }
      );

    return result;
  }
  async listWorkflows(): Promise<ListWorkflowsResponse> {
    const { result } = await this.invokePluginAction<StoredWorkflow[]>(
      "workflows",
      "list_workflows"
    );

    return {
      workflows: result,
    };
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
  async createWorkflow(
    request: CreateWorkflowRequest
  ): Promise<StoredWorkflow> {
    const { profileId, ...input } = request;

    const { result } = await this.invokePluginAction<StoredWorkflow>(
      "workflows",
      "create_workflow",
      { input: { ...input, agentId: profileId } }
    );

    return result;
  }
  async updateWorkflow(
    workflowId: string,
    request: UpdateWorkflowRequest
  ): Promise<StoredWorkflow> {
    const { profileId, ...input } = request;

    const { result } = await this.invokePluginAction<StoredWorkflow>(
      "workflows",
      "update_workflow",
      { input: { ...input, agentId: profileId, workflowId } }
    );

    return result;
  }
  async deleteWorkflow(workflowId: string): Promise<void> {
    await this.invokePluginAction("workflows", "delete_workflow", {
      input: { workflowId },
    });
  }
  async runWorkflow(
    workflowId: string,
    request: RunWorkflowRequest = {}
  ): Promise<RunWorkflowResponse["run"]> {
    const { result } = await this.invokePluginAction<RunWorkflowResponse>(
      "workflows",
      "run_workflow",
      { input: { workflowId, ...request } }
    );

    return result.run;
  }
  async listWorkflowRuns(
    workflowId: string
  ): Promise<ListWorkflowRunsResponse["runs"]> {
    const { result } = await this.invokePluginAction<
      ListWorkflowRunsResponse["runs"]
    >("workflows", "runs", { input: { workflowId } });

    return result;
  }
  async getWorkflowRun(
    workflowId: string,
    runId: string
  ): Promise<GetWorkflowRunResponse["run"]> {
    const { result: run } = await this.invokePluginAction<
      GetWorkflowRunResponse["run"] | null
    >("workflows", "get_run", { input: { runId, workflowId } });

    if (!run) {
      throw new Error("Workflow run not found.");
    }

    return run;
  }
  async deleteWorkflowRun(workflowId: string, runId: string): Promise<void> {
    await this.invokePluginAction("workflows", "delete_run", {
      input: { runId, workflowId },
    });
  }
}
