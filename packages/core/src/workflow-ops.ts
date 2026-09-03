import type {
  WorkflowCompareOp,
  WorkflowReceiptBag,
  WorkflowStep,
} from "./contract";

const TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g;

export function getPathValue(bag: WorkflowReceiptBag, path: string): unknown {
  const trimmed = path.trim();
  if (!trimmed) {
    return;
  }

  const parts = trimmed.split(".").filter(Boolean);
  let current: unknown = bag;

  for (const part of parts) {
    if (current == null || typeof current !== "object") {
      return;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

export function resolveTemplateString(
  template: string,
  bag: WorkflowReceiptBag
): string {
  return template.replace(TEMPLATE_PATTERN, (_match, rawPath: string) => {
    const value = getPathValue(bag, rawPath.trim());
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value === "string") {
      return value;
    }

    return JSON.stringify(value);
  });
}

export function resolveWorkflowValue(
  value: unknown,
  bag: WorkflowReceiptBag
): unknown {
  if (typeof value === "string") {
    if (!value.includes("{{")) {
      return value;
    }

    if (value.match(/^\{\{[^}]+\}\}$/)) {
      const inner = value.slice(2, -2).trim();
      return getPathValue(bag, inner);
    }

    return resolveTemplateString(value, bag);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveWorkflowValue(entry, bag));
  }

  if (value && typeof value === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      resolved[key] = resolveWorkflowValue(entry, bag);
    }
    return resolved;
  }

  return value;
}

export function executeCompare(input: {
  left: unknown;
  op: WorkflowCompareOp;
  right: unknown;
  tolerance?: number;
}): { diff?: unknown; left: unknown; ok: boolean; right: unknown } {
  const left = input.left;
  const right = input.right;

  if (input.op === "eq") {
    const ok = deepEqual(left, right);
    return { left, ok, right, ...(ok ? {} : { diff: { left, right } }) };
  }

  if (input.op === "near") {
    const leftNum = toNumber(left);
    const rightNum = toNumber(right);
    const tolerance = input.tolerance ?? 0;

    if (leftNum === null || rightNum === null) {
      return {
        diff: { left, reason: "non-numeric", right },
        left,
        ok: false,
        right,
      };
    }

    const ok = Math.abs(leftNum - rightNum) <= tolerance;
    return {
      diff: ok ? undefined : { delta: leftNum - rightNum, left, right },
      left,
      ok,
      right,
    };
  }

  const ok = containsValue(left, right);
  return {
    diff: ok ? undefined : { left, right },
    left,
    ok,
    right,
  };
}

export function executeAssert(input: {
  bag: WorkflowReceiptBag;
  expected: unknown;
  path: string;
}): { actual: unknown; expected: unknown; ok: boolean } {
  const actual = getPathValue(input.bag, input.path);
  const expected = resolveWorkflowValue(input.expected, input.bag);
  const ok = deepEqual(actual, expected);
  return { actual, expected, ok };
}

export function executeTemplate(
  template: string,
  bag: WorkflowReceiptBag
): string {
  return resolveTemplateString(template, bag);
}

export function buildReceiptBag(
  input: Record<string, unknown>,
  stepOutputs: Record<string, unknown>
): WorkflowReceiptBag {
  return {
    input,
    steps: stepOutputs,
  };
}

export function collectTemplateRefs(value: unknown): string[] {
  const refs: string[] = [];

  const visit = (current: unknown): void => {
    if (typeof current === "string") {
      for (const match of current.matchAll(TEMPLATE_PATTERN)) {
        refs.push(match[1]?.trim() ?? "");
      }
      return;
    }

    if (Array.isArray(current)) {
      for (const entry of current) {
        visit(entry);
      }
      return;
    }

    if (current && typeof current === "object") {
      for (const entry of Object.values(current)) {
        visit(entry);
      }
    }
  };

  visit(value);
  return refs.filter(Boolean);
}

export function validateWorkflowSteps(
  steps: WorkflowStep[],
  allowedTools: Set<string>
): void {
  if (steps.length === 0) {
    throw new Error("Workflow must include at least one step.");
  }

  const seenStepIds = new Set<string>();
  const priorStepIds = new Set<string>();
  let summarizeCount = 0;

  for (const [index, step] of steps.entries()) {
    const id = step.id.trim();
    if (!id) {
      throw new Error(`Step ${index + 1} is missing an id.`);
    }

    if (seenStepIds.has(id)) {
      throw new Error(`Duplicate workflow step id: ${id}`);
    }

    seenStepIds.add(id);

    if (step.kind === "summarize") {
      summarizeCount += 1;
      if (!step.prompt.trim()) {
        throw new Error("Summarize step prompt is required.");
      }
      continue;
    }

    if (step.kind === "tool") {
      const tool = step.tool.trim();
      if (!tool) {
        throw new Error(`Tool step ${id} is missing a tool name.`);
      }

      if (!allowedTools.has(tool)) {
        throw new Error(`Tool step ${id} references unknown tool: ${tool}`);
      }
    }

    if (
      step.kind === "compare" &&
      !["eq", "near", "contains"].includes(step.op)
    ) {
      throw new Error(`Compare step ${id} has invalid op: ${step.op}`);
    }

    if (step.kind === "assert" && !step.path.trim()) {
      throw new Error(`Assert step ${id} is missing a path.`);
    }

    if (step.kind === "template" && !step.template.trim()) {
      throw new Error(`Template step ${id} is missing template text.`);
    }

    const refs = collectTemplateRefs(step);
    for (const ref of refs) {
      validateTemplateRef(ref, priorStepIds, id);
    }

    priorStepIds.add(id);
  }

  if (summarizeCount > 1) {
    throw new Error("Workflow may include at most one summarize step.");
  }

  if (summarizeCount === 1 && steps.at(-1)?.kind !== "summarize") {
    throw new Error("Summarize step must be the last step.");
  }

  if (summarizeCount === 0) {
    throw new Error("Workflow must end with a summarize step.");
  }
}

function validateTemplateRef(
  ref: string,
  priorStepIds: Set<string>,
  currentStepId: string
): void {
  if (ref.startsWith("input.")) {
    return;
  }

  if (ref.startsWith("steps.")) {
    const [, stepId] = ref.split(".");
    if (!stepId) {
      throw new Error(`Invalid template reference: ${ref}`);
    }

    if (stepId === currentStepId) {
      throw new Error(
        `Step ${currentStepId} cannot reference its own output (${ref}).`
      );
    }

    if (!priorStepIds.has(stepId)) {
      throw new Error(
        `Step ${currentStepId} references unknown step in template: ${ref}`
      );
    }
    return;
  }

  throw new Error(`Invalid template reference: ${ref}`);
}

function containsValue(haystack: unknown, needle: unknown): boolean {
  if (typeof haystack === "string" && typeof needle === "string") {
    return haystack.includes(needle);
  }

  if (Array.isArray(haystack)) {
    return haystack.some((entry) => deepEqual(entry, needle));
  }

  return false;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!(Array.isArray(left) && Array.isArray(right))) {
      return false;
    }

    if (left.length !== right.length) {
      return false;
    }

    return left.every((entry, index) => deepEqual(entry, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([
    ...Object.keys(leftRecord),
    ...Object.keys(rightRecord),
  ]);

  for (const key of keys) {
    if (!deepEqual(leftRecord[key], rightRecord[key])) {
      return false;
    }
  }

  return true;
}
