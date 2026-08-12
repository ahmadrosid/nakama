import { CONTROL_ID, isOmniEnabled, OPTIMIZER_ID } from "@nakama/core";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgAdminFromContext,
} from "../org-guards";
import { json, readJson } from "../shared";
import type { HonoApp } from "../types";

const DAYS = 30;

/**
 * What this reports and what it deliberately does not.
 *
 * `bytesIn` and `bytesOut` are exact: what a tool produced, and what was written
 * into the conversation instead. They are **not** tokens and **not** money. A
 * shortened result is re-sent on later turns as a cache read billed at a fraction
 * of fresh input, so multiplying bytes by a price would invent a figure nobody
 * can support.
 *
 * Two arms are reported because one is not a measurement. `none` rows are turns
 * where nothing shortened the output, so the panel can show what a turn costs
 * unoptimised instead of comparing a number against a blank.
 */
export function registerTokenOptimizationRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  app.get("/v1/token-optimization", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const [rows, settings] = await Promise.all([
      options.databaseAdapter.listToolOutputSavings(orgId),
      options.databaseAdapter.getWorkspaceSettings(),
    ]);
    const enabled = settings?.tokenOptimizerEnabled ?? isOmniEnabled();

    const from = new Date(Date.now() - (DAYS - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const recent = rows.filter((row) => row.bucket >= from);

    const days = new Map<
      string,
      { bytesIn: number; bytesRemoved: number; day: string }
    >();
    for (let index = 0; index < DAYS; index += 1) {
      const day = new Date(Date.now() - (DAYS - 1 - index) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      days.set(day, { bytesIn: 0, bytesRemoved: 0, day });
    }
    for (const row of recent) {
      const day = days.get(row.bucket);
      if (day) {
        day.bytesIn += row.bytesIn;
        day.bytesRemoved += row.bytesIn - row.bytesOut;
      }
    }

    const byArm = (arm: string) => {
      const armRows = recent.filter((row) => row.optimizer === arm);
      return {
        arm,
        bytesIn: armRows.reduce((sum, row) => sum + row.bytesIn, 0),
        bytesOut: armRows.reduce((sum, row) => sum + row.bytesOut, 0),
        calls: armRows.reduce((sum, row) => sum + row.calls, 0),
      };
    };

    const byToolMap = new Map<
      string,
      { bytesIn: number; bytesOut: number; calls: number; tool: string }
    >();
    for (const row of recent.filter((r) => r.optimizer === OPTIMIZER_ID)) {
      const entry = byToolMap.get(row.tool) ?? {
        bytesIn: 0,
        bytesOut: 0,
        calls: 0,
        tool: row.tool,
      };
      entry.bytesIn += row.bytesIn;
      entry.bytesOut += row.bytesOut;
      entry.calls += row.calls;
      byToolMap.set(row.tool, entry);
    }

    const optimized = byArm(OPTIMIZER_ID);
    const control = byArm(CONTROL_ID);

    return json({
      arms: { control, optimized },
      byTool: [...byToolMap.values()].sort(
        (left, right) =>
          right.bytesIn - right.bytesOut - (left.bytesIn - left.bytesOut)
      ),
      days: [...days.values()],
      // One entry today. The shape is a list because a second optimiser attaches
      // in a different place and would appear beside this one, not replace it.
      optimizers: [{ enabled, id: OPTIMIZER_ID, tools: ["bash", "read_file"] }],
      totals: {
        bytesIn: optimized.bytesIn + control.bytesIn,
        bytesRemoved: optimized.bytesIn - optimized.bytesOut,
        calls: optimized.calls + control.calls,
      },
      trackedSince: rows.at(0)?.trackedSince ?? null,
      windowDays: DAYS,
    });
  });

  app.put("/v1/token-optimization", async (c) => {
    // Admin only: this changes what every session in the org does.
    requireOrgAdminFromContext(c);
    const body = await readJson<{ enabled: boolean }>(c.req.raw);
    const existing = await options.databaseAdapter.getWorkspaceSettings();

    await options.databaseAdapter.upsertWorkspaceSettings({
      codingAgentHarnesses: existing?.codingAgentHarnesses ?? [],
      id: existing?.id ?? "default",
      imageModel: existing?.imageModel ?? null,
      selectedCodingAgentHarness: existing?.selectedCodingAgentHarness ?? null,
      tokenOptimizerEnabled: Boolean(body.enabled),
      transcriptionModel: existing?.transcriptionModel ?? null,
      updatedAt: new Date().toISOString(),
      visionModel: existing?.visionModel ?? null,
    });

    return json({ enabled: Boolean(body.enabled) });
  });
}
