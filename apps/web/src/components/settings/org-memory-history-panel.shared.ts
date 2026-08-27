export interface OrgMemoryHistoryState {
  canUndo: boolean;
  latestRevisionIsCurrent: boolean;
}

export function resolveOrgMemoryHistoryState(
  liveContent: string | undefined,
  latestRevisionContent: string | undefined,
  changeCount: number
): OrgMemoryHistoryState {
  if (liveContent === undefined || latestRevisionContent === undefined) {
    return { canUndo: false, latestRevisionIsCurrent: false };
  }

  const latestRevisionIsCurrent =
    liveContent.trim() === latestRevisionContent.trim();
  return {
    canUndo: changeCount >= (latestRevisionIsCurrent ? 2 : 1),
    latestRevisionIsCurrent,
  };
}
