import type { StoredWorkflow, WorkflowStep } from "@nakama/core/contract";
import {
  buildReceiptBag,
  executeAssert,
  executeCompare,
  resolveTemplateString,
  resolveWorkflowValue,
} from "./workflow-ops";
export interface WorkflowHost {
  executeTool(
    profileId: string,
    name: string,
    input: Record<string, unknown>,
    runId: string,
    workflowId: string
  ): Promise<unknown>;
  runWorkflowSummarize(
    orgId: string,
    profileId: string,
    prompt: string,
    bag: Record<string, unknown>
  ): Promise<string>;
}

import type { WorkflowService } from "./workflow-service";

export class WorkflowRunner {
  constructor(
    private readonly workflowService: WorkflowService,
    private readonly agentService: WorkflowHost
  ) {}

  async run(
    workflowId: string,
    runtimeInput: Record<string, unknown> = {}
  ): Promise<{
    error?: string;
    output?: string;
    skipped?: boolean;
    runId?: string;
  }> {
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
      return { output: completedRun.output ?? output, runId: run.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.workflowService.completeRun(run.id, workflowId, {
        error: message,
      });
      return { error: message, runId: run.id };
    }
  }

  private async executeWorkflow(
    orgId: string,
    workflow: StoredWorkflow,
    runId: string,
    runtimeInput: Record<string, unknown>
  ): Promise<string> {
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
        const result = await this.executeDataStep(step, bag(), {
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
        const message = error instanceof Error ? error.message : String(error);
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
      const message = error instanceof Error ? error.message : String(error);
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
      const output = await this.agentService.executeTool(
        context.profileId,
        step.tool,
        input,
        context.runId,
        context.workflowId
      );
      const toolError = readToolError(output);
      if (toolError) {
        throw new Error(toolError);
      }
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
      const result = executeAssert({
        bag,
        expected: step.expected,
        path: step.path,
      });
      if (!result.ok) {
        throw new Error(
          `Assert step ${step.id} failed: expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)}`
        );
      }
      return {
        input: { expected: result.expected, path: step.path },
        output: result,
      };
    }

    if (step.kind === "template") {
      const output = resolveTemplateString(step.template, bag);
      return { input: { template: step.template }, output };
    }

    throw new Error(
      `Unsupported workflow step kind: ${(step as WorkflowStep).kind}`
    );
  }
}

function readToolError(output: unknown): string | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }

  const record = output as Record<string, unknown>;
  if (typeof record.error !== "string" || !record.error.trim()) {
    return null;
  }

  return Object.keys(record).length === 1 ? record.error : null;
}
