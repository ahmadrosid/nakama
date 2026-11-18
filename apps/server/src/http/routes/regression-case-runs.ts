import { createRoute, z } from "@hono/zod-openapi";
import { createId } from "@nakama/core";
import type {
  RegressionCaseRun,
  RegressionCaseRunResponse,
} from "@nakama/core/contract";
import type {
  StoredRegressionCaseRecord,
  StoredRegressionCaseRunRecord,
} from "@nakama/db";
import type { Context } from "hono";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgMemberFromContext,
} from "../org-guards";
import {
  errorResponse,
  json,
  type RequestAuthContext,
  readJson,
} from "../shared";
import type { AppEnv, HonoApp } from "../types";
import { canReadRegressionCase } from "./regression-cases";

const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");

const caseIdParam = z.object({
  caseId: z.string().openapi({ param: { in: "path", name: "caseId" } }),
  profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
});

const runIdParam = caseIdParam.extend({
  runId: z.string().openapi({ param: { in: "path", name: "runId" } }),
});

const markRegressionCaseRunSchema = z
  .object({ verdict: z.enum(["pass", "fail"]) })
  .strict()
  .openapi("MarkRegressionCaseRunRequest");

const regressionCaseRunResponseSchema = z
  .object({
    run: z.object({
      caseId: z.string(),
      createdAt: z.string(),
      createdByUserId: z.string().nullable(),
      error: z.string().nullable(),
      id: z.string(),
      output: z.string().nullable(),
      status: z.enum(["completed", "failed"]),
      verdict: z.enum(["pass", "fail"]).nullable(),
      verdictAt: z.string().nullable(),
      verdictByUserId: z.string().nullable(),
    }),
  })
  .openapi("RegressionCaseRunResponse");

const errorResponses = Object.fromEntries(
  [400, 403, 404, 409].map((status) => [
    status,
    {
      content: { "application/json": { schema: errorSchema } },
      description: "Error",
    },
  ])
);

function toRegressionCaseRun({
  orgId: _orgId,
  ...run
}: StoredRegressionCaseRunRecord): RegressionCaseRun {
  return run;
}

export function registerRegressionCaseRunRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const databaseAdapter = options.databaseAdapter;

  if (!databaseAdapter) {
    return;
  }

  const runningCases = new Set<string>();

  /** The case the caller may read in the active org, or null for a 404. */
  const readableCase = async (
    c: Context<AppEnv>
  ): Promise<{
    auth: RequestAuthContext;
    record: StoredRegressionCaseRecord | null;
  }> => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId") ?? "");
    const caseId = decodeURIComponent(c.req.param("caseId") ?? "");

    await options.agent.assertProfileChatAccess(orgId, profileId, auth);

    const record = await databaseAdapter.getRegressionCase(
      orgId,
      profileId,
      caseId
    );

    return {
      auth,
      record: record && canReadRegressionCase(record, auth) ? record : null,
    };
  };

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "rerunRegressionCase",
      path: "/v1/profiles/{profileId}/regression-cases/{caseId}/runs",
      request: { params: caseIdParam },
      responses: {
        201: {
          content: {
            "application/json": { schema: regressionCaseRunResponseSchema },
          },
          description: "The rerun's stored result",
        },
        ...errorResponses,
      },
      summary: "Rerun a regression case against its profile",
      tags: ["Regression cases"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "patch",
      operationId: "markRegressionCaseRun",
      path: "/v1/profiles/{profileId}/regression-cases/{caseId}/runs/{runId}",
      request: {
        body: {
          content: {
            "application/json": { schema: markRegressionCaseRunSchema },
          },
          required: true,
        },
        params: runIdParam,
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: regressionCaseRunResponseSchema },
          },
          description: "The marked run",
        },
        ...errorResponses,
      },
      summary: "Mark a regression case run pass or fail",
      tags: ["Regression cases"],
    })
  );

  app.post(
    "/v1/profiles/:profileId/regression-cases/:caseId/runs",
    async (c) => {
      const { auth, record } = await readableCase(c);

      if (!record) {
        return errorResponse("Regression case not found", 404);
      }

      // One rerun per case at a time, so repeat clicks do not stack runs.
      const runKey = `${record.orgId}:${record.id}`;

      if (runningCases.has(runKey)) {
        return errorResponse("This case is already rerunning.", 409);
      }

      runningCases.add(runKey);

      const createdAt = new Date().toISOString();
      let result: Awaited<ReturnType<typeof options.agent.runRegressionCase>>;

      try {
        result = await options.agent.runRegressionCase({
          input: record.input,
          orgId: record.orgId,
          profileId: record.profileId,
          signal: c.req.raw.signal,
          userId: auth.user.id,
        });
      } finally {
        runningCases.delete(runKey);
      }

      const run: StoredRegressionCaseRunRecord = {
        caseId: record.id,
        createdAt,
        createdByUserId: auth.user.id,
        error: result.error,
        id: createId("regrun"),
        orgId: record.orgId,
        output: result.output,
        status: result.error === null ? "completed" : "failed",
        verdict: null,
        verdictAt: null,
        verdictByUserId: null,
      };

      await databaseAdapter.createRegressionCaseRun(run);

      return json<RegressionCaseRunResponse>(
        { run: toRegressionCaseRun(run) },
        201
      );
    }
  );

  app.patch(
    "/v1/profiles/:profileId/regression-cases/:caseId/runs/:runId",
    async (c) => {
      const { auth, record } = await readableCase(c);
      const body = await readJson(c.req.raw, markRegressionCaseRunSchema);

      const runId = decodeURIComponent(c.req.param("runId") ?? "");

      const existing =
        record &&
        (await databaseAdapter.getRegressionCaseRun(
          record.orgId,
          record.id,
          runId
        ));

      if (!(record && existing)) {
        return errorResponse("Regression case run not found", 404);
      }

      // A failed run has no answer to judge.
      if (existing.status === "failed") {
        return errorResponse("A failed run cannot be marked.", 409);
      }

      const marked = await databaseAdapter.setRegressionCaseRunVerdict(
        record.orgId,
        record.id,
        runId,
        {
          at: new Date().toISOString(),
          userId: auth.user.id,
          verdict: body.verdict,
        }
      );

      if (!marked) {
        return errorResponse("Regression case run not found", 404);
      }

      return json<RegressionCaseRunResponse>({
        run: toRegressionCaseRun(marked),
      });
    }
  );
}
