import { executeToolCall } from "@nakama/agent";
import {
  buildReceiptBag,
  executeAssert,
  executeCompare,
  executeTemplate,
  formatAutomationRunError,
  resolveWorkflowValue,
  type StoredWorkflow,
  type WorkflowStep,
} from "@nakama/core";
import type { AgentService } from "./agent-service";
import type { WorkflowService } from "./workflow-service";

export class WorkflowRunner {
  private readonly running = new Set<string>();

  constructor(
    private readonly workflowService: WorkflowService,
    private readonly agentService: AgentService
  ) {}

  async run(
    workflowId: string,
    runtimeInput: Record<string, unknown> = {}
  ): Promise<{ error?: string; output?: string; skipped?: boolean }> {
    if (this.running.has(workflowId)) {
      return { error: "Workflow is already running.", skipped: true };
    }

    const workflow = await this.workflowService.get(workflowId);
    if (!workflow) {
      throw new Error("Workflow not found.");
    }

    if (!workflow.enabled) {
      return { error: "Workflow is disabled.", skipped: true };
    }

    const orgId = workflow.orgId?.trim();
    if (!orgId) {
      throw new Error("Workflow organization is missing.");
    }

    this.running.add(workflowId);
    const run = await this.workflowService.createRun(workflowId, runtimeInput);

    try {
      const output = await this.executeWorkflow(
        orgId,
        workflow,
        run.id,
        runtimeInput
      );
      const completedRun = await this.workflowService.completeRun(
        run.id,
        workflowId,
        { output }
      );
      return { output: completedRun.output ?? output };
    } catch (error) {
      const message = formatAutomationRunError(error);
      await this.workflowService.completeRun(run.id, workflowId, {
        error: message,
      });
      return { error: message };
    } finally {
      this.running.delete(workflowId);
    }
  }

  private async executeWorkflow(
    orgId: string,
    workflow: StoredWorkflow,
    runId: string,
    runtimeInput: Record<string, unknown>
  ): Promise<string> {
    const tools = await this.agentService.resolveWorkflowExecutionTools(
      orgId,
      workflow.profileId
    );
    const stepOutputs: Record<string, unknown> = {};
    const bag = () => buildReceiptBag(runtimeInput, stepOutputs);

    for (const [position, step] of workflow.steps.entries()) {
      if (step.kind === "summarize") {
        continue;
      }

      const stepRecord = await this.workflowService.createRunStep(
        runId,
        step,
        position
      );

      try {
        const result = await this.executeDataStep(step, bag(), tools, orgId, {
          profileId: workflow.profileId,
          runId,
          workflowId: workflow.id,
        });
        stepOutputs[step.id] = result.output;
        await this.workflowService.updateRunStep(runId, stepRecord.id, {
          input: result.input,
          output: result.output,
          status: "completed",
        });
      } catch (error) {
        const message = formatAutomationRunError(error);
        await this.workflowService.updateRunStep(runId, stepRecord.id, {
          error: message,
          status: "failed",
        });
        throw new Error(message);
      }
    }

    const summarizeStep = workflow.steps.find(
      (step) => step.kind === "summarize"
    );
    if (!summarizeStep || summarizeStep.kind !== "summarize") {
      throw new Error("Workflow summarize step is missing.");
    }

    const summarizeRecord = await this.workflowService.createRunStep(
      runId,
      summarizeStep,
      workflow.steps.length - 1
    );

    try {
      const output = await this.agentService.runWorkflowSummarize(
        orgId,
        workflow.profileId,
        summarizeStep.prompt,
        bag()
      );
      await this.workflowService.updateRunStep(runId, summarizeRecord.id, {
        input: { prompt: summarizeStep.prompt },
        output: { output },
        status: "completed",
      });
      return output;
    } catch (error) {
      const message = formatAutomationRunError(error);
      await this.workflowService.updateRunStep(runId, summarizeRecord.id, {
        error: message,
        status: "failed",
      });
      throw new Error(message);
    }
  }

  private async executeDataStep(
    step: WorkflowStep,
    bag: ReturnType<typeof buildReceiptBag>,
    tools: Awaited<ReturnType<AgentService["resolveWorkflowExecutionTools"]>>,
    orgId: string,
    context: {
      profileId: string;
      runId: string;
      workflowId: string;
    }
  ): Promise<{ input: unknown; output: unknown }> {
    if (step.kind === "tool") {
      const input = resolveWorkflowValue(step.input, bag) as Record<
        string,
        unknown
      >;
      const output = await executeToolCall(
        tools,
        { arguments: input, name: step.tool },
        this.agentService.buildWorkflowToolContext(orgId, context)
      );
      return { input, output };
    }

    if (step.kind === "compare") {
      const left = resolveWorkflowValue(step.left, bag);
      const right = resolveWorkflowValue(step.right, bag);
      const result = executeCompare({
        left,
        op: step.op,
        right,
        tolerance: step.tolerance,
      });
      if (!result.ok) {
        throw new Error(
          `Compare step ${step.id} failed: ${JSON.stringify(result)}`
        );
      }
      return { input: { left, op: step.op, right }, output: result };
    }

    if (step.kind === "assert") {
      const expected = resolveWorkflowValue(step.expected, bag);
      const result = executeAssert({
        bag,
        expected,
        path: step.path,
      });
      if (!result.ok) {
        throw new Error(
          `Assert step ${step.id} failed: expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`
        );
      }
      return {
        input: { expected, path: step.path },
        output: result,
      };
    }

    if (step.kind === "template") {
      const output = executeTemplate(step.template, bag);
      return { input: { template: step.template }, output };
    }

    throw new Error(
      `Unsupported workflow step kind: ${(step as WorkflowStep).kind}`
    );
  }
}
