import { createRoute, z } from "@hono/zod-openapi";
import type { CreateAutomationWebhookSecretResponse } from "@nakama/core";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgMemberFromContext,
} from "../org-guards";
import { errorResponse, getRequestAuth, json } from "../shared";
import type { HonoApp } from "../types";

const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

const WEBHOOK_MAX_DELIVERY_ID_LENGTH = 128;

/** Webhook secret and signed webhook routes; schemas are shared with the automation routes. */
export function registerAutomationWebhookRoutes(
  app: HonoApp,
  options: ServerOptions,
  schemas: {
    automationIdParam: z.ZodObject<{ automationId: z.ZodString }>;
    errorSchema: z.ZodTypeAny;
  }
): void {
  const { agent, automationService } = options;
  const { automationIdParam, errorSchema } = schemas;

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createAutomationWebhookSecret",
      path: "/v1/automations/{automationId}/webhook-secret",
      request: { params: automationIdParam },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z
                .object({ secret: z.string() })
                .openapi("AutomationWebhookSecretResponse"),
            },
          },
          description: "New webhook secret, shown only once",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Create or rotate an automation webhook secret",
      tags: ["Automations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "triggerAutomationWebhook",
      path: "/v1/automations/{automationId}/webhook",
      request: { params: automationIdParam },
      responses: {
        200: { description: "GitHub ping accepted; no run started" },
        202: {
          content: {
            "application/json": {
              schema: z
                .object({ runId: z.string() })
                .openapi("AutomationWebhookRunResponse"),
            },
          },
          description: "Run started",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        401: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        413: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        415: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        503: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary:
        "Start an automation from a signed webhook (X-Hub-Signature-256)",
      tags: ["Automations"],
    })
  );

  app.post("/v1/automations/:automationId/webhook-secret", async (c) => {
    requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const auth = getRequestAuth(c);
    const automationId = decodeURIComponent(c.req.param("automationId"));
    const automation = await automationService.get(automationId, orgId);

    if (!automation) {
      return errorResponse("Automation not found", 404);
    }

    await automationService.assertCanAutomateMailbox(automation.profileId, {
      isPlatformAdmin: auth.isPlatformAdmin,
      orgRole: auth.orgRole,
    });

    const secret = await automationService.createWebhookSecret(
      automationId,
      orgId
    );

    return json<CreateAutomationWebhookSecretResponse>({ secret });
  });

  // Public: the HMAC signature is the credential. Every reject before the
  // signature check answers the same 401, so ids and triggers do not leak.
  app.post("/v1/automations/:automationId/webhook", async (c) => {
    const unauthorized = () => errorResponse("Invalid webhook signature.", 401);
    const automationId = decodeURIComponent(c.req.param("automationId"));

    // Size checks come first so 413 does not reveal which ids are webhooks.
    if (Number(c.req.header("content-length") ?? 0) > WEBHOOK_MAX_BODY_BYTES) {
      return errorResponse("Request body is too large.", 413);
    }

    const body = new Uint8Array(await c.req.raw.arrayBuffer());

    if (body.byteLength > WEBHOOK_MAX_BODY_BYTES) {
      return errorResponse("Request body is too large.", 413);
    }

    const automation = await automationService.get(automationId);

    if (!automation?.orgId || automation.trigger.type !== "webhook") {
      return unauthorized();
    }

    const organization = await options.databaseAdapter?.getOrganizationById(
      automation.orgId
    );

    if (!organization || organization.archivedAt) {
      return unauthorized();
    }

    let verified: boolean;

    try {
      verified = await automationService.verifyWebhookSignature(
        automation,
        body,
        c.req.header("x-hub-signature-256")
      );
    } catch (error) {
      console.error("Automation webhook secret could not be read:", error);

      return errorResponse("Webhook secrets are unavailable.", 503);
    }

    if (!verified) {
      return unauthorized();
    }

    if (c.req.header("x-github-event") === "ping") {
      return json({ ok: true });
    }

    const deliveryId = c.req.header("x-github-delivery")?.trim();

    if (!deliveryId || deliveryId.length > WEBHOOK_MAX_DELIVERY_ID_LENGTH) {
      return errorResponse("X-GitHub-Delivery header is required.", 400);
    }

    if (!c.req.header("content-type")?.includes("application/json")) {
      return errorResponse("Send the webhook as application/json.", 415);
    }

    const payload = new TextDecoder().decode(body);

    try {
      JSON.parse(payload);
    } catch {
      return errorResponse("Request body must be JSON.", 400);
    }

    const result = await agent.startAutomationFromWebhook(automationId, {
      deliveryId,
      payload,
    });

    if ("skipped" in result) {
      return errorResponse(result.error, 409);
    }

    return json({ runId: result.runId }, 202);
  });
}
