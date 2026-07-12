import type { ServerOptions } from "../context";
import type { HonoApp } from "../types";
import { errorResponse } from "../shared";
import { handleAnthropicMessagesRequest } from "../../services/inference-gateway-service";

export function registerInferenceGatewayRoutes(app: HonoApp, options: ServerOptions): void {
  app.post("/v1/messages", async (c) => {
    const auth = c.get("auth");

    if (!auth) {
      return errorResponse("Authentication required", 401);
    }

    const orgId = auth.activeOrgId?.trim();

    if (!orgId) {
      return errorResponse("Organization context required", 400);
    }

    if (!options.databaseAdapter) {
      return errorResponse("Database not configured", 500);
    }

    const profileId = c.req.query("profileId")?.trim() || null;
    let body: unknown;

    try {
      body = await c.req.json();
    } catch {
      return errorResponse("Invalid JSON in request body.", 400);
    }

    return handleAnthropicMessagesRequest({
      db: options.databaseAdapter!,
      userConfig: options.agent.getUserConfig(),
      context: { orgId, profileId },
      body,
    });
  });
}
