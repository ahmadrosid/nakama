import { describe, expect, test } from "bun:test";
import { createSqliteDatabase } from "./adapters/sqlite";
import {
  isCodingAgentProviderPassthroughEnabled,
  mergeWorkspaceSettings,
} from "./workspace-settings";

describe("workspace settings merge", () => {
  test("passthrough defaults on when unset", () => {
    expect(isCodingAgentProviderPassthroughEnabled(null)).toBe(true);
    expect(
      isCodingAgentProviderPassthroughEnabled({
        codingAgentProviderPassthrough: true,
      })
    ).toBe(true);
    expect(
      isCodingAgentProviderPassthroughEnabled({
        codingAgentProviderPassthrough: false,
      })
    ).toBe(false);
  });

  test("merge keeps passthrough when another field is patched", () => {
    const merged = mergeWorkspaceSettings(
      {
        automationWorkerPollIntervalMs: 5 * 60 * 1000,
        codingAgentHarnesses: [],
        codingAgentProviderPassthrough: false,
        id: "default",
        imageModel: null,
        selectedCodingAgentHarness: null,
        transcriptionModel: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
        visionModel: "vision",
      },
      {
        updatedAt: "2026-01-02T00:00:00.000Z",
        visionModel: "other",
      }
    );

    expect(merged.codingAgentProviderPassthrough).toBe(false);
    expect(merged.visionModel).toBe("other");
  });

  test("merge keeps passthrough when token optimizer is patched", () => {
    const merged = mergeWorkspaceSettings(
      {
        automationWorkerPollIntervalMs: 5 * 60 * 1000,
        codingAgentHarnesses: [],
        codingAgentProviderPassthrough: false,
        id: "default",
        imageModel: null,
        selectedCodingAgentHarness: null,
        transcriptionModel: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
        visionModel: null,
      },
      {
        tokenOptimizerEnabled: true,
        updatedAt: "2026-01-02T00:00:00.000Z",
      }
    );

    expect(merged.codingAgentProviderPassthrough).toBe(false);
    expect(merged.tokenOptimizerEnabled).toBe(true);
  });

  test("merge can clear nullable fields to null", () => {
    const merged = mergeWorkspaceSettings(
      {
        automationWorkerPollIntervalMs: 5 * 60 * 1000,
        codingAgentHarnesses: [],
        codingAgentProviderPassthrough: true,
        id: "default",
        imageModel: "openai::gpt-image-2",
        selectedCodingAgentHarness: "coding-harness-codex",
        transcriptionModel: "whisper",
        updatedAt: "2026-01-01T00:00:00.000Z",
        visionModel: "vision",
      },
      {
        imageModel: null,
        selectedCodingAgentHarness: null,
        transcriptionModel: null,
        visionModel: null,
      }
    );

    expect(merged.imageModel).toBeNull();
    expect(merged.selectedCodingAgentHarness).toBeNull();
    expect(merged.transcriptionModel).toBeNull();
    expect(merged.visionModel).toBeNull();
  });

  test("persists the automation polling interval in SQLite", async () => {
    const database = await createSqliteDatabase(":memory:");
    try {
      const initial = await database.adapter.getWorkspaceSettings();
      await database.adapter.upsertWorkspaceSettings(
        mergeWorkspaceSettings(initial, {
          automationWorkerPollIntervalMs: 10 * 60 * 1000,
        })
      );
      expect(
        (await database.adapter.getWorkspaceSettings())
          ?.automationWorkerPollIntervalMs
      ).toBe(10 * 60 * 1000);
    } finally {
      database.close();
    }
  });

  test("defaults the automation polling interval for legacy direct writes", async () => {
    const database = await createSqliteDatabase(":memory:");
    try {
      await database.adapter.upsertWorkspaceSettings({
        codingAgentHarnesses: [],
        codingAgentProviderPassthrough: true,
        id: "workspace-settings",
        imageModel: null,
        selectedCodingAgentHarness: null,
        transcriptionModel: null,
        updatedAt: "2026-08-31T00:00:00.000Z",
        visionModel: null,
      } as never);

      expect(
        (await database.adapter.getWorkspaceSettings())
          ?.automationWorkerPollIntervalMs
      ).toBe(5 * 60 * 1000);
    } finally {
      database.close();
    }
  });

  test("merge output never carries an orgId key", () => {
    const merged = mergeWorkspaceSettings(null, {
      id: "default",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(merged).not.toHaveProperty("orgId");
  });
});
