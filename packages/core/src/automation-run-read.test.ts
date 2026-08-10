import { describe, expect, test } from "bun:test";
import {
  isAutomationRunUnread,
  summarizeAutomationUnreadCounts,
} from "./automation-run-read";

describe("isAutomationRunUnread", () => {
  test("running runs are never unread", () => {
    expect(
      isAutomationRunUnread(
        {
          completedAt: null,
          startedAt: "2026-06-29T10:00:00.000Z",
          status: "running",
        },
        null
      )
    ).toBe(false);
  });

  test("completed run after read watermark is unread", () => {
    expect(
      isAutomationRunUnread(
        {
          completedAt: "2026-06-29T10:01:00.000Z",
          startedAt: "2026-06-29T10:00:00.000Z",
          status: "completed",
        },
        "2026-06-29T09:00:00.000Z"
      )
    ).toBe(true);
  });

  test("completed run before read watermark is read", () => {
    expect(
      isAutomationRunUnread(
        {
          completedAt: "2026-06-29T08:01:00.000Z",
          startedAt: "2026-06-29T08:00:00.000Z",
          status: "completed",
        },
        "2026-06-29T09:00:00.000Z"
      )
    ).toBe(false);
  });

  test("uses epoch when read watermark is missing", () => {
    expect(
      isAutomationRunUnread(
        {
          completedAt: "2026-06-29T08:01:00.000Z",
          startedAt: "2026-06-29T08:00:00.000Z",
          status: "failed",
        },
        null
      )
    ).toBe(true);
  });
});

describe("summarizeAutomationUnreadCounts", () => {
  test("sums unread counts and skips zero entries", () => {
    expect(
      summarizeAutomationUnreadCounts([
        { automationId: "automation_1", unreadCount: 2 },
        { automationId: "automation_2", unreadCount: 0 },
        { automationId: "automation_3", unreadCount: 1 },
      ])
    ).toEqual({
      byAutomationId: {
        automation_1: 2,
        automation_3: 1,
      },
      totalUnread: 3,
    });
  });
});
