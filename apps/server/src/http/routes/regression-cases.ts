import { z } from "@hono/zod-openapi";
import { createId, getUserMessageText, NakamaApiError } from "@nakama/core";
import type {
  ListRegressionCasesResponse,
  RegressionCase,
  RegressionCaseResponse,
} from "@nakama/core/contract";
import type {
  StoredRegressionCaseRecord,
  StoredSessionMessageRecord,
} from "@nakama/db";
import { DatabaseAutomationStore } from "@nakama/db";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgMemberFromContext,
} from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

const MAX_EXPECTED_RESULT_LENGTH = 20_000;

const createRegressionCaseSchema = z.discriminatedUnion("sourceType", [
  z
    .object({
      expectedResult: z.string().trim().min(1).max(MAX_EXPECTED_RESULT_LENGTH),
      sourceId: z.string().trim().min(1),
      sourceType: z.literal("session"),
    })
    .strict(),
  z
    .object({
      automationId: z.string().trim().min(1),
      expectedResult: z.string().trim().min(1).max(MAX_EXPECTED_RESULT_LENGTH),
      sourceId: z.string().trim().min(1),
      sourceType: z.literal("automation_run"),
    })
    .strict(),
]);

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

const messageContentPartSchema = z.discriminatedUnion("type", [
  z.object({ text: z.string(), type: z.literal("text") }),
  z.object({
    data: z.string(),
    description: z.string().optional(),
    mediaType: z.string(),
    type: z.literal("image"),
  }),
  z.object({
    data: z.string(),
    filename: z.string(),
    mediaType: z.string(),
    type: z.literal("document"),
  }),
  z.object({
    attachmentId: z.string(),
    mediaType: z.string(),
    size: z.number(),
    type: z.literal("image_ref"),
  }),
  z.object({
    attachmentId: z.string(),
    filename: z.string(),
    mediaType: z.string(),
    size: z.number(),
    type: z.literal("document_ref"),
  }),
]);

/** Session rows store a `ChatMessage`; only the user turn becomes the input. */
const storedUserMessageSchema = z.object({
  content: z.union([z.string(), z.array(messageContentPartSchema)]),
  role: z.literal("user"),
});

function lastUserMessageText(
  messages: StoredSessionMessageRecord[]
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = storedUserMessageSchema.safeParse(messages[index]?.payload);

    if (message.success) {
      return getUserMessageText(message.data.content).trim();
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

  const requireProfile = async (
    orgId: string,
    profileId: string
  ): Promise<boolean> =>
    (await databaseAdapter.getProfileForOrg(profileId, orgId)) !== null;

  app.post("/v1/profiles/:profileId/regression-cases", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId") ?? "");
    const body = await readJson(c.req.raw, createRegressionCaseSchema);

    if (!(await requireProfile(orgId, profileId))) {
      return errorResponse("Profile not found", 404);
    }

    let input: string;
    let sourceAutomationId: string | null = null;

    if (body.sourceType === "session") {
      try {
        await options.agent.assertSessionProfileAccess(
          body.sourceId,
          orgId,
          auth
        );
      } catch (error) {
        // Another org or a private session answers the same 404.
        if (error instanceof NakamaApiError && error.status === 404) {
          return errorResponse("Source run not found", 404);
        }

        throw error;
      }

      const session = await databaseAdapter.getSession(body.sourceId);

      if (!session || session.profileId !== profileId) {
        return errorResponse("Source run not found", 404);
      }

      const text = lastUserMessageText(
        await databaseAdapter.listMessagesForSession(body.sourceId)
      );

      if (!text) {
        return errorResponse("Source session has no user message.", 400);
      }

      input = text;
    } else {
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
    requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId") ?? "");

    if (!(await requireProfile(orgId, profileId))) {
      return errorResponse("Profile not found", 404);
    }

    const cases = await databaseAdapter.listRegressionCasesForProfile(
      orgId,
      profileId
    );

    return json<ListRegressionCasesResponse>({
      cases: cases.map(toRegressionCase),
    });
  });

  app.get("/v1/profiles/:profileId/regression-cases/:caseId", async (c) => {
    requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId") ?? "");
    const caseId = decodeURIComponent(c.req.param("caseId") ?? "");

    if (!(await requireProfile(orgId, profileId))) {
      return errorResponse("Profile not found", 404);
    }

    const record = await databaseAdapter.getRegressionCase(
      orgId,
      profileId,
      caseId
    );

    if (!record) {
      return errorResponse("Regression case not found", 404);
    }

    return json<RegressionCaseResponse>({ case: toRegressionCase(record) });
  });
}
