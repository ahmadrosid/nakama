import { describe, expect, test } from "bun:test";
import {
  AUTOMATION_RUN_READ_EPOCH,
  isAutomationRunUnread,
  summarizeAutomationUnreadCounts,
} from "./automation-run-read";

describe("isAutomationRunUnread", () => {
  test("running runs are never unread", () => {
    expect(
      isAutomationRunUnread(
        {
          status: "running",
          startedAt: "2026-06-29T10:00:00.000Z",
          completedAt: null,
        },
        null,
      ),
    ).toBe(false);
  });

  test("completed run after read watermark is unread", () => {
    expect(
      isAutomationRunUnread(
        {
          status: "completed",
          startedAt: "2026-06-29T10:00:00.000Z",
          completedAt: "2026-06-29T10:01:00.000Z",
        },
        "2026-06-29T09:00:00.000Z",
      ),
    ).toBe(true);
  });

  test("completed run before read watermark is read", () => {
    expect(
      isAutomationRunUnread(
        {
          status: "completed",
          startedAt: "2026-06-29T08:00:00.000Z",
          completedAt: "2026-06-29T08:01:00.000Z",
        },
        "2026-06-29T09:00:00.000Z",
      ),
    ).toBe(false);
  });

  test("uses epoch when read watermark is missing", () => {
    expect(
      isAutomationRunUnread(
        {
          status: "failed",
          startedAt: "2026-06-29T08:00:00.000Z",
          completedAt: "2026-06-29T08:01:00.000Z",
        },
        null,
      ),
    ).toBe(true);
    expect(AUTOMATION_RUN_READ_EPOCH).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("summarizeAutomationUnreadCounts", () => {
  test("sums unread counts and skips zero entries", () => {
    expect(
      summarizeAutomationUnreadCounts([
        { automationId: "automation_1", unreadCount: 2 },
        { automationId: "automation_2", unreadCount: 0 },
        { automationId: "automation_3", unreadCount: 1 },
      ]),
    ).toEqual({
      totalUnread: 3,
      byAutomationId: {
        automation_1: 2,
        automation_3: 1,
      },
    });
  });
});
