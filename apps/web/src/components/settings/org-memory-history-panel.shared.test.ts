import { describe, expect, test } from "bun:test";
import { resolveOrgMemoryHistoryState } from "./org-memory-history-panel.shared";

describe("resolveOrgMemoryHistoryState", () => {
  test("disables undo while either snapshot is unavailable", () => {
    expect(resolveOrgMemoryHistoryState(undefined, "snapshot", 2)).toEqual({
      canUndo: false,
      latestRevisionIsCurrent: false,
    });
    expect(resolveOrgMemoryHistoryState("live", undefined, 2)).toEqual({
      canUndo: false,
      latestRevisionIsCurrent: false,
    });
  });

  test("marks a matching sole revision as current without enabling undo", () => {
    expect(resolveOrgMemoryHistoryState("same\n", "same", 1)).toEqual({
      canUndo: false,
      latestRevisionIsCurrent: true,
    });
  });

  test("enables undo when a matching current revision has history", () => {
    expect(resolveOrgMemoryHistoryState("same", "same", 2)).toEqual({
      canUndo: true,
      latestRevisionIsCurrent: true,
    });
  });

  test("enables undo for a single revision when live memory diverged", () => {
    expect(resolveOrgMemoryHistoryState("live", "snapshot", 1)).toEqual({
      canUndo: true,
      latestRevisionIsCurrent: false,
    });
  });
});
