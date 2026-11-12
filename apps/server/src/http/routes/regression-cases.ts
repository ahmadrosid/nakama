import { createRoute, z } from "@hono/zod-openapi";
import { createId, getUserMessageText } from "@nakama/core";
import { findAgentQuestionnaireAnswers } from "@nakama/core/agent-questionnaire";
import {
  type ListRegressionCasesResponse,
  MAX_REGRESSION_EXPECTED_RESULT_LENGTH,
  type RegressionCase,
  type RegressionCaseResponse,
} from "@nakama/core/contract";
import type { StoredRegressionCaseRecord } from "@nakama/db";
import { DatabaseAutomationStore } from "@nakama/db";
import { sessionTurnRegistry } from "../../services/session-turn-registry";
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
import type { HonoApp } from "../types";

const MAX_CASE_PAGE_SIZE = 100;

const DEFAULT_CASE_PAGE_SIZE = 50;

const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");

const profileIdParam = z.object({
  profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
});

const caseIdParam = z.object({
  caseId: z.string().openapi({ param: { in: "path", name: "caseId" } }),
  profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
});

const listRegressionCasesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_CASE_PAGE_SIZE).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createRegressionCaseSchema = z
  .discriminatedUnion("sourceType", [
    z
      .object({
        expectedResult: z
          .string()
          .trim()
          .min(1)
          .max(MAX_REGRESSION_EXPECTED_RESULT_LENGTH),
        messageIndex: z.number().int().min(0),
        sourceId: z.string().trim().min(1),
        sourceType: z.literal("session"),
      })
      .strict(),
    z
      .object({
        automationId: z.string().trim().min(1),
        expectedResult: z
          .string()
          .trim()
          .min(1)
          .max(MAX_REGRESSION_EXPECTED_RESULT_LENGTH),
        sourceId: z.string().trim().min(1),
        sourceType: z.literal("automation_run"),
      })
      .strict(),
  ])
  .openapi("CreateRegressionCaseRequest");

const regressionCaseSchema = z
  .object({
    createdAt: z.string(),
    createdByUserId: z.string().nullable(),
    expectedResult: z.string(),
    id: z.string(),
    input: z.string(),
    profileId: z.string(),
    source: z.object({
      automationId: z.string().nullable(),
      id: z.string(),
      path: z.string(),
      type: z.enum(["session", "automation_run"]),
    }),
  })
  .openapi("RegressionCase");

const regressionCaseResponseSchema = z
  .object({ case: regressionCaseSchema })
  .openapi("RegressionCaseResponse");

const listRegressionCasesResponseSchema = z
  .object({
    cases: z.array(regressionCaseSchema),
    nextOffset: z.number().nullable(),
  })
  .openapi("ListRegressionCasesResponse");

/**
 * Stored rows use the `ChatMessage` shape. Only the role and the parts'
 * `type`/`text` are read, so a part type added later still parses.
 */
const storedMessagePartSchema = z
  .object({ text: z.string().optional(), type: z.string() })
  .passthrough();

const storedUserMessageSchema = z.object({
  content: z.union([z.string(), z.array(storedMessagePartSchema)]),
  role: z.literal("user"),
});

const storedRoleSchema = z.object({ role: z.string() });

/**
 * Automation runs have no per-run page yet, so their link opens the page that
 * lists runs for the automation.
 */
function sourcePath(record: StoredRegressionCaseRecord): string {
  if (record.sourceType === "session") {
    return `/chat/${encodeURIComponent(record.profileId)}/${encodeURIComponent(record.sourceId)}`;
  }

  return "/automations";
}

function toRegressionCase(record: StoredRegressionCaseRecord): RegressionCase {
  return {
    createdAt: record.createdAt,
    createdByUserId: record.createdByUserId,
    expectedResult: record.expectedResult,
    id: record.id,
    input: record.input,
    profileId: record.profileId,
    source: {
      automationId: record.sourceAutomationId,
      id: record.sourceId,
      path: sourcePath(record),
      type: record.sourceType,
    },
  };
}

/** Copied input from a private chat stays with that chat's owner. */
export function canReadRegressionCase(
  record: StoredRegressionCaseRecord,
  auth: RequestAuthContext
): boolean {
  return (
    record.privateToUserId === null ||
    auth.isPlatformAdmin ||
    record.privateToUserId === auth.user.id
  );
}

function parseLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") {
    return DEFAULT_CASE_PAGE_SIZE;
  }

  const value = Number(raw);

  return Number.isInteger(value) && value >= 1 && value <= MAX_CASE_PAGE_SIZE
    ? value
    : null;
}

function parseOffset(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") {
    return 0;
  }

  const value = Number(raw);

  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * The question behind the reply at `replyIndex`: the nearest user message
 * before it. Questionnaire answers continue that question, so they are skipped.
 */
function inputBeforeReply(
  payloads: unknown[],
  replyIndex: number
): string | null {
  for (let index = replyIndex - 1; index >= 0; index -= 1) {
    const parsed = storedUserMessageSchema.safeParse(payloads[index]);

    if (!parsed.success) {
      continue;
    }

    const text = getUserMessageText(parsed.data.content).trim();

    if (text && !findAgentQuestionnaireAnswers(text)) {
      return text;
    }
  }

  return null;
}

export function registerRegressionCaseRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const databaseAdapter = options.databaseAdapter;

  if (!databaseAdapter) {
    return;
  }

  const automationStore = new DatabaseAutomationStore(databaseAdapter);

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createRegressionCase",
      path: "/v1/profiles/{profileId}/regression-cases",
      request: {
        body: {
          content: {
            "application/json": { schema: createRegressionCaseSchema },
          },
          required: true,
        },
        params: profileIdParam,
      },
      responses: {
        201: {
          content: {
            "application/json": { schema: regressionCaseResponseSchema },
          },
          description: "Regression case created",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Save a finished run as a regression case",
      tags: ["Regression cases"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listRegressionCases",
      path: "/v1/profiles/{profileId}/regression-cases",
      request: {
        params: profileIdParam,
        query: listRegressionCasesQuerySchema,
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: listRegressionCasesResponseSchema },
          },
          description: "Regression cases for the profile",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "List a profile's regression cases",
      tags: ["Regression cases"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getRegressionCase",
      path: "/v1/profiles/{profileId}/regression-cases/{caseId}",
      request: { params: caseIdParam },
      responses: {
        200: {
          content: {
            "application/json": { schema: regressionCaseResponseSchema },
          },
          description: "Regression case",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get a regression case",
      tags: ["Regression cases"],
    })
  );

  app.post("/v1/profiles/:profileId/regression-cases", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId") ?? "");
    const body = await readJson(c.req.raw, createRegressionCaseSchema);

    let input: string;
    let privateToUserId: string | null = null;
    let sourceAutomationId: string | null = null;

    if (body.sourceType === "session") {
      await options.agent.assertSessionProfileAccess(
        body.sourceId,
        orgId,
        auth
      );

      const session = await databaseAdapter.getSession(body.sourceId);

      if (!session || session.profileId !== profileId) {
        return errorResponse("Source run not found", 404);
      }

      if (sessionTurnRegistry.isActive(body.sourceId)) {
        return errorResponse("Source chat is still running.", 409);
      }

      // Same index space as branching: the web sends the reply's historyIndex.
      const payloads = (
        await databaseAdapter.listMessagesForSession(body.sourceId)
      ).map((message) => message.payload);

      const reply = storedRoleSchema.safeParse(payloads[body.messageIndex]);

      if (!reply.success || reply.data.role !== "assistant") {
        return errorResponse("messageIndex must point at a reply.", 400);
      }

      const text = inputBeforeReply(payloads, body.messageIndex);

      if (!text) {
        return errorResponse(
          "Source session has no readable user message.",
          400
        );
      }

      const privacy = await options.agent.sessionHistoryPrivacy(session);

      input = text;
      privateToUserId = privacy.isPrivate
        ? (privacy.ownerUserId ?? auth.user.id)
        : null;
    } else {
      await options.agent.assertProfileChatAccess(orgId, profileId, auth);

      const automation = await automationStore.get(body.automationId);

      if (
        !automation ||
        automation.orgId !== orgId ||
        automation.profileId !== profileId
      ) {
        return errorResponse("Source run not found", 404);
      }

      const run = await databaseAdapter.getAutomationRun(
        body.automationId,
        body.sourceId
      );

      if (!run) {
        return errorResponse("Source run not found", 404);
      }

      if (run.status === "running") {
        return errorResponse("Source automation run is still running.", 409);
      }

      input = automation.prompt.trim();

      if (!input) {
        return errorResponse("Source automation has no prompt.", 400);
      }

      sourceAutomationId = body.automationId;
    }

    const record: StoredRegressionCaseRecord = {
      createdAt: new Date().toISOString(),
      createdByUserId: auth.user.id,
      expectedResult: body.expectedResult,
      id: createId("regcase"),
      input,
      orgId,
      privateToUserId,
      profileId,
      sourceAutomationId,
      sourceId: body.sourceId,
      sourceType: body.sourceType,
    };

    await databaseAdapter.createRegressionCase(record);

    return json<RegressionCaseResponse>(
      { case: toRegressionCase(record) },
      201
    );
  });

  app.get("/v1/profiles/:profileId/regression-cases", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId") ?? "");

    await options.agent.assertProfileChatAccess(orgId, profileId, auth);

    const limit = parseLimit(c.req.query("limit"));
    const offset = parseOffset(c.req.query("offset"));

    if (limit === null) {
      return errorResponse(
        `limit must be an integer from 1 to ${MAX_CASE_PAGE_SIZE}.`,
        400
      );
    }

    if (offset === null) {
      return errorResponse("offset must be a non-negative integer.", 400);
    }

    const records = await databaseAdapter.listRegressionCasesForProfile(
      orgId,
      profileId,
      { limit, offset }
    );

    return json<ListRegressionCasesResponse>({
      cases: records
        .filter((record) => canReadRegressionCase(record, auth))
        .map(toRegressionCase),
      nextOffset: records.length === limit ? offset + records.length : null,
    });
  });

  app.get("/v1/profiles/:profileId/regression-cases/:caseId", async (c) => {
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

    if (!(record && canReadRegressionCase(record, auth))) {
      return errorResponse("Regression case not found", 404);
    }

    return json<RegressionCaseResponse>({ case: toRegressionCase(record) });
  });
}
