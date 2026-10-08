import type { StoredWorkflow, WorkflowStep } from "@nakama/core/contract";
import {
  buildReceiptBag,
  executeAssert,
  executeCompare,
  parseWorkflowRecord,
  parseWorkflowValue,
  resolveTemplateString,
  resolveWorkflowValue,
  type WorkflowBag,
  type WorkflowRecord,
  type WorkflowValue,
} from "./workflow-ops";

type WorkflowRunResult = {
  error?: string;
  output?: string;
  runId?: string;
  skipped?: boolean;
};

type DataStepResult = { input: WorkflowValue; output: WorkflowValue };

export interface WorkflowHost {
  executeTool(
    profileId: string,
    name: string,
    input: WorkflowRecord,
    runId: string,
    workflowId: string
  ): Promise<WorkflowValue>;
  runWorkflowSummarize(
    orgId: string,
    profileId: string,
    prompt: string,
    bag: WorkflowBag
  ): Promise<string>;
}

import type { WorkflowService } from "./workflow-service";

type WorkflowRunnerService = Pick<
  WorkflowService,
  "completeRun" | "createRun" | "createRunStep" | "get" | "updateRunStep"
>;

export class WorkflowRunner {
  constructor(
    private readonly workflowService: WorkflowRunnerService,
    private readonly agentService: WorkflowHost
  ) {}

  async run(
    workflowId: string,
    runtimeInput: WorkflowRecord = {}
  ): Promise<WorkflowRunResult> {
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
    runtimeInput: WorkflowRecord
  ): Promise<string> {
    const stepOutputs: WorkflowRecord = {};
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
    bag: WorkflowBag,
    context: {
      profileId: string;
      runId: string;
      workflowId: string;
    }
  ): Promise<DataStepResult> {
    if (step.kind === "tool") {
      const input = parseWorkflowRecord(
        resolveWorkflowValue(parseWorkflowValue(step.input), bag)
      );

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
        left: parseWorkflowValue(left),
        op: step.op,
        right: parseWorkflowValue(right),
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
        expected: parseWorkflowValue(step.expected),
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

    throw new Error("Unsupported workflow step kind.");
  }
}

function readToolError(output: WorkflowValue): string | null {
  if (!(output instanceof Object) || Array.isArray(output)) {
    return null;
  }

  const record = parseWorkflowRecord(output);
  const error = record.error;

  if (
    error === undefined ||
    error === null ||
    error !== String(error) ||
    !error.trim()
  ) {
    return null;
  }

  return Object.keys(record).length === 1 ? error : null;
}
