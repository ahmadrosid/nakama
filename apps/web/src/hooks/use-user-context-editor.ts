import type { UserContextStatusResponse } from "@nakama/core";
import { renderUserContext } from "@nakama/core/user-context";
import { useState } from "react";

const DRAFT_PREFIX = "nakama:user-context-draft:";

function readDraft(orgId: string | null | undefined): string | null {
  if (!orgId) {
    return null;
  }
  try {
    return localStorage.getItem(DRAFT_PREFIX + orgId);
  } catch {
    return null;
  }
}

export function writeUserContextDraft(
  orgId: string | null | undefined,
  content: string
): void {
  if (!orgId) {
    return;
  }
  try {
    localStorage.setItem(DRAFT_PREFIX + orgId, content);
  } catch {}
}

export function clearUserContextDraft(orgId: string | null | undefined): void {
  if (!orgId) {
    return;
  }
  try {
    localStorage.removeItem(DRAFT_PREFIX + orgId);
  } catch {}
}

/** Mount a new editor for each organization and each dialog opening. */
export function useUserContextEditor(input: {
  defaultName: string | null | undefined;
  orgId: string | null | undefined;
  status: UserContextStatusResponse | undefined;
}) {
  const [editedContent, setContent] = useState<string | null>(null);
  const [savedOverride, setSavedContent] = useState<string | null>(null);
  const savedContent = savedOverride ?? input.status?.content ?? "";
  const draft = savedContent === "" ? readDraft(input.orgId) : null;
  const name = input.defaultName?.trim() ?? "";
  const fallback =
    savedContent === "" && name !== ""
      ? renderUserContext({ name })
      : savedContent;
  const content = editedContent ?? draft ?? fallback;
  return { content, savedContent, setContent, setSavedContent };
}
