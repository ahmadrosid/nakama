import {
  COMPOSIO_TOOLKIT_SLUG_PATTERN,
  type EnableComposioToolkitRequest,
  type UpdateProfileComposioToolkitsRequest,
} from "./contract";

function normalizeToolkitSlug(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  const slug = value.trim().toLowerCase();

  if (!COMPOSIO_TOOLKIT_SLUG_PATTERN.test(slug)) {
    throw new Error(`${fieldName} must use lowercase letters, numbers, underscores, or hyphens.`);
  }

  return slug;
}

function normalizeActionSlugList(value: unknown, fieldName: string): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of action slugs or null.`);
  }

  const slugs: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new Error(`${fieldName} entries must be non-empty strings.`);
    }

    const slug = entry.trim().toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(slug)) {
      throw new Error(`${fieldName} entries must use uppercase letters, numbers, or underscores.`);
    }

    slugs.push(slug);
  }

  return slugs.length > 0 ? slugs : null;
}

export function normalizeEnableComposioToolkitRequest(
  value: unknown,
): EnableComposioToolkitRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("toolkit request must be an object.");
  }

  const record = value as Record<string, unknown>;

  return {
    toolkitSlug: normalizeToolkitSlug(record.toolkitSlug, "toolkitSlug"),
  };
}

export function normalizeUpdateProfileComposioToolkitsRequest(
  value: unknown,
): UpdateProfileComposioToolkitsRequest {
  if (typeof value !== "object" || value === null) {
    throw new Error("profile composio assignment request must be an object.");
  }

  const record = value as Record<string, unknown>;
  const assignments = record.assignments;

  if (!Array.isArray(assignments)) {
    throw new Error("assignments must be an array.");
  }

  return {
    assignments: assignments.map((entry, index) => {
      if (typeof entry !== "object" || entry === null) {
        throw new Error(`assignments[${index}] must be an object.`);
      }

      const assignment = entry as Record<string, unknown>;
      const toolkitId = assignment.toolkitId;

      if (typeof toolkitId !== "string" || !toolkitId.trim()) {
        throw new Error(`assignments[${index}].toolkitId must be a non-empty string.`);
      }

      return {
        toolkitId: toolkitId.trim(),
        allowedActions: normalizeActionSlugList(
          assignment.allowedActions,
          `assignments[${index}].allowedActions`,
        ),
      };
    }),
  };
}
