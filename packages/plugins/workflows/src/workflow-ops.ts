import type { WorkflowCompareOp, WorkflowStep } from "@nakama/core/contract";

const TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g;

export type WorkflowValue =
  | boolean
  | null
  | number
  | string
  | undefined
  | WorkflowValue[]
  | WorkflowRecord;

export type WorkflowRecord = { [key: string]: WorkflowValue };

export type WorkflowBag = {
  input: WorkflowRecord;
  steps: WorkflowRecord;
};

export function parseWorkflowValue<Value>(value: Value): WorkflowValue {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new Error("Workflow values must be JSON serializable.");
  }

  const parsed: WorkflowValue = JSON.parse(serialized);

  return parsed;
}

export function parseWorkflowRecord<Value>(value: Value): WorkflowRecord {
  const parsed = parseWorkflowValue(value);

  if (!isWorkflowRecord(parsed)) {
    throw new Error("Workflow values must be JSON objects.");
  }

  return parsed;
}

type CompareResult = {
  diff?: WorkflowValue;
  left: WorkflowValue;
  ok: boolean;
  right: WorkflowValue;
};

type AssertResult = {
  actual: WorkflowValue;
  expected: WorkflowValue;
  ok: boolean;
};

export function getPathValue(bag: WorkflowBag, path: string): WorkflowValue {
  const trimmed = path.trim();

  if (!trimmed) {
    return;
  }

  const parts = trimmed.split(".").filter(Boolean);
  let current: WorkflowValue = { input: bag.input, steps: bag.steps };

  for (const part of parts) {
    if (!isWorkflowRecord(current)) {
      return;
    }

    current = current[part];
  }

  return current;
}

function requireTemplateValue(bag: WorkflowBag, path: string): WorkflowValue {
  const value = getPathValue(bag, path);

  if (value === undefined) {
    throw new Error(
      `Missing workflow data at ${path}. Check the referenced step output or run input.`
    );
  }

  return value;
}

export function resolveTemplateString(
  template: string,
  bag: WorkflowBag
): string {
  return template.replace(TEMPLATE_PATTERN, (_match, rawPath: string) => {
    const value = requireTemplateValue(bag, rawPath.trim());

    if (value === undefined || value === null) {
      return "";
    }

    const stringValue = readString(value);

    if (stringValue !== null) {
      return stringValue;
    }

    return JSON.stringify(value) ?? "";
  });
}

export function resolveWorkflowValue(
  value: WorkflowValue,
  bag: WorkflowBag
): WorkflowValue {
  const stringValue = readString(value);

  if (stringValue !== null) {
    if (!stringValue.includes("{{")) {
      return stringValue;
    }

    if (stringValue.match(/^\{\{[^}]+\}\}$/)) {
      const inner = stringValue.slice(2, -2).trim();

      return requireTemplateValue(bag, inner);
    }

    return resolveTemplateString(stringValue, bag);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveWorkflowValue(entry, bag));
  }

  if (isWorkflowRecord(value)) {
    const resolved: WorkflowRecord = {};

    for (const [key, entry] of Object.entries(value)) {
      resolved[key] = resolveWorkflowValue(entry, bag);
    }

    return resolved;
  }

  return value;
}

export function executeCompare(input: {
  left: WorkflowValue;
  op: WorkflowCompareOp;
  right: WorkflowValue;
  tolerance?: number;
}): CompareResult {
  const left = input.left;
  const right = input.right;

  if (input.op === "eq") {
    const ok = deepEqual(left, right);

    const result: CompareResult = { left, ok, right };

    if (!ok) {
      result.diff = { left, right };
    }

    return result;
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
  bag: WorkflowBag;
  expected: WorkflowValue;
  path: string;
}): AssertResult {
  const actual = getPathValue(input.bag, input.path);
  const expected = resolveWorkflowValue(input.expected, input.bag);
  const ok = deepEqual(actual, expected);

  return { actual, expected, ok };
}

export function buildReceiptBag(
  input: WorkflowRecord,
  stepOutputs: WorkflowRecord
): WorkflowBag {
  return {
    input,
    steps: stepOutputs,
  };
}

function collectTemplateRefs(value: WorkflowValue): string[] {
  const refs: string[] = [];

  const visit = (current: WorkflowValue): void => {
    const stringValue = readString(current);

    if (stringValue !== null) {
      for (const match of stringValue.matchAll(TEMPLATE_PATTERN)) {
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

    if (isWorkflowRecord(current)) {
      for (const entry of Object.values(current)) {
        visit(entry);
      }
    }
  };

  visit(value);

  return refs.filter(Boolean);
}

const WORKFLOW_STEP_KINDS = [
  "tool",
  "compare",
  "assert",
  "template",
  "summarize",
] as const;

const WORKFLOW_COMPARE_OPS = ["eq", "near", "contains"] as const;

export function validateWorkflowSteps(
  steps: WorkflowStep[] | WorkflowValue[],
  allowedTools: Set<string>
): void {
  if (steps.length === 0) {
    throw new Error("Workflow must include at least one step.");
  }

  const seenStepIds = new Set<string>();
  const priorStepIds = new Set<string>();
  let summarizeCount = 0;

  for (const [index, step] of steps.entries()) {
    const record = asStepRecord(step, index);
    const id = readStepId(record, index);
    const kind = readStepKind(record, id);

    if (seenStepIds.has(id)) {
      throw new Error(`Duplicate workflow step id: ${id}`);
    }

    seenStepIds.add(id);

    if (kind === "summarize") {
      if (index !== steps.length - 1) {
        throw new Error(
          "Summarize step must be the last step. Use a tool for intermediate extraction or analysis."
        );
      }

      summarizeCount += 1;
      readRequiredStepString(record, "prompt", `Summarize step ${id}`, {
        alias: "instruction",
      });
      continue;
    }

    if (kind === "tool") {
      const tool = readRequiredStepString(record, "tool", `Tool step ${id}`, {
        label: "a tool name",
      });

      if (!allowedTools.has(tool)) {
        throw new Error(`Tool step ${id} references unknown tool: ${tool}`);
      }

      if (!isWorkflowRecord(record.input)) {
        throw new Error(
          `Tool step ${id} requires an input object. Use input, not args; use {} for tools without arguments.`
        );
      }
    }

    if (kind === "compare") {
      const opValue = record.op;
      const op = readString(opValue);

      if (op === null || !isWorkflowCompareOp(op)) {
        throw new Error(
          `Compare step ${id} has invalid op: ${String(opValue)}. Use ${WORKFLOW_COMPARE_OPS.join(" | ")}.`
        );
      }

      if (!("left" in record) || record.left === undefined) {
        throw new Error(`Compare step ${id} is missing left.`);
      }

      if (!("right" in record) || record.right === undefined) {
        throw new Error(`Compare step ${id} is missing right.`);
      }
    }

    if (kind === "assert") {
      readRequiredStepString(record, "path", `Assert step ${id}`);
    }

    if (kind === "template") {
      readRequiredStepString(record, "template", `Template step ${id}`, {
        label: "template text",
      });
    }

    const refs = collectTemplateRefs(record);

    for (const ref of refs) {
      validateTemplateRef(ref, priorStepIds, id);
    }

    priorStepIds.add(id);
  }

  if (summarizeCount === 0) {
    throw new Error("Workflow must end with a summarize step.");
  }
}

function asStepRecord(
  step: WorkflowStep | WorkflowValue,
  index: number
): WorkflowRecord {
  const record: WorkflowValue = JSON.parse(JSON.stringify(step));

  if (!isWorkflowRecord(record)) {
    throw new Error(`Step ${index + 1} must be an object.`);
  }

  return record;
}

function readStepId(step: WorkflowRecord, index: number): string {
  const id = readString(step.id)?.trim() ?? "";

  if (!id) {
    throw new Error(`Step ${index + 1} is missing an id.`);
  }

  return id;
}

function readStepKind(
  step: WorkflowRecord,
  id: string
): (typeof WORKFLOW_STEP_KINDS)[number] {
  const kind = readString(step.kind)?.trim() ?? "";

  if (!kind) {
    if (readString(step.type)?.trim()) {
      throw new Error(
        `Step ${id} uses type; use kind instead (${WORKFLOW_STEP_KINDS.join(" | ")}).`
      );
    }

    throw new Error(
      `Step ${id} is missing kind (${WORKFLOW_STEP_KINDS.join(" | ")}).`
    );
  }

  if (!isWorkflowStepKind(kind)) {
    throw new Error(
      `Step ${id} has invalid kind: ${kind}. Use ${WORKFLOW_STEP_KINDS.join(" | ")}.`
    );
  }

  return kind;
}

function readString(value: WorkflowValue): string | null {
  return value === String(value) ? value : null;
}

function isWorkflowRecord(value: WorkflowValue): value is WorkflowRecord {
  return value instanceof Object && !Array.isArray(value);
}

function isWorkflowStepKind(
  value: string
): value is (typeof WORKFLOW_STEP_KINDS)[number] {
  return WORKFLOW_STEP_KINDS.some((kind) => kind === value);
}

function isWorkflowCompareOp(value: string): value is WorkflowCompareOp {
  return WORKFLOW_COMPARE_OPS.some((op) => op === value);
}

function readRequiredStepString(
  step: WorkflowRecord,
  key: string,
  prefix: string,
  options?: { alias?: string; label?: string }
): string {
  const value = readString(step[key])?.trim() ?? "";

  if (value) {
    return value;
  }

  const alias = options?.alias;

  if (alias && readString(step[alias])?.trim()) {
    throw new Error(`${prefix} uses ${alias}; use ${key} instead.`);
  }

  throw new Error(`${prefix} is missing ${options?.label ?? key}.`);
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

function containsValue(
  haystack: WorkflowValue,
  needle: WorkflowValue
): boolean {
  const haystackString = readString(haystack);
  const needleString = readString(needle);

  if (haystackString !== null && needleString !== null) {
    return haystackString.includes(needleString);
  }

  if (Array.isArray(haystack)) {
    return haystack.some((entry) => deepEqual(entry, needle));
  }

  return false;
}

function toNumber(value: WorkflowValue): number | null {
  const numberValue = Number(value);

  if (value === numberValue && Number.isFinite(numberValue)) {
    return numberValue;
  }

  const stringValue = readString(value);

  if (stringValue !== null && stringValue.trim()) {
    const parsed = Number(stringValue);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function deepEqual(left: WorkflowValue, right: WorkflowValue): boolean {
  if (Object.is(left, right)) {
    return true;
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

  if (!(isWorkflowRecord(left) && isWorkflowRecord(right))) {
    return false;
  }

  const leftRecord = left;
  const rightRecord = right;

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
