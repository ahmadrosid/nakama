export function validateWorkflowInput(input: {
  name: string | undefined;
  steps: unknown;
}): void {
  const name = input.name?.trim() ?? "";

  if (!name) {
    throw new Error("Workflow name is required.");
  }

  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    throw new Error("Workflow steps are required.");
  }
}
