import { z } from "zod";
import type { JsonValue } from "./contract";
import {
  COMPOSIO_TOOLKIT_SLUG_PATTERN,
  type EnableComposioToolkitRequest,
  type UpdateProfileComposioToolkitsRequest,
} from "./contract";

function normalizeToolkitSlug(
  value: JsonValue | undefined,
  fieldName: string
): string {
  const parsed = z.string().trim().min(1).safeParse(value);

  if (!parsed.success) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  const slug = parsed.data.toLowerCase();

  if (!COMPOSIO_TOOLKIT_SLUG_PATTERN.test(slug)) {
    throw new Error(
      `${fieldName} must use lowercase letters, numbers, underscores, or hyphens.`
    );
  }

  return slug;
}

function normalizeActionSlugList(
  value: JsonValue | undefined,
  fieldName: string
): string[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = z.array(z.string().trim().min(1)).safeParse(value);

  if (!parsed.success) {
    throw new Error(`${fieldName} must be an array of action slugs or null.`);
  }

  const slugs: string[] = [];

  for (const entry of parsed.data) {
    const slug = entry.toUpperCase();

    if (!/^[A-Z0-9_]+$/.test(slug)) {
      throw new Error(
        `${fieldName} entries must use uppercase letters, numbers, or underscores.`
      );
    }

    slugs.push(slug);
  }

  return slugs.length > 0 ? slugs : null;
}

export function normalizeEnableComposioToolkitRequest(
  value: JsonValue
): EnableComposioToolkitRequest {
  const parsed = z
    .object({ toolkitSlug: z.json().optional() })
    .safeParse(value);

  if (!parsed.success) {
    throw new Error("toolkit request must be an object.");
  }

  return {
    toolkitSlug: normalizeToolkitSlug(parsed.data.toolkitSlug, "toolkitSlug"),
  };
}

export function normalizeUpdateProfileComposioToolkitsRequest(
  value: JsonValue
): UpdateProfileComposioToolkitsRequest {
  const parsed = z.object({ assignments: z.array(z.json()) }).safeParse(value);

  if (!parsed.success) {
    throw new Error("profile composio assignment request must be an object.");
  }

  return {
    assignments: parsed.data.assignments.map((entry, index) => {
      const assignmentResult = z
        .object({
          allowedActions: z.json().optional(),
          toolkitId: z.string().trim().min(1),
        })
        .safeParse(entry);

      if (!assignmentResult.success) {
        throw new Error(`assignments[${index}] must be an object.`);
      }

      const assignment = assignmentResult.data;

      return {
        allowedActions: normalizeActionSlugList(
          assignment.allowedActions,
          `assignments[${index}].allowedActions`
        ),
        toolkitId: assignment.toolkitId,
      };
    }),
  };
}
