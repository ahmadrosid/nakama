import { resolveManagedSecret } from "@nakama/core";
import { errorResponse, json } from "../shared";
import type { HonoApp } from "../types";

/**
 * Channel workers never get NAKAMA_SECRETS_KEY (#2021), so they read their
 * encrypted bot token through the server instead.
 */
export function registerInternalChannelTokenRoutes(app: HonoApp): void {
  app.get("/v1/internal/channel-bot-token", async (c) => {
    const auth = c.get("auth");

    if (!auth || auth.mode !== "local-token") {
      return errorResponse("Authentication required", 401);
    }

    const scope = c.req.query("scope") ?? "";
    const name = c.req.query("name") ?? "";

    // Bot tokens only: provider, email and tool keys never leave the server.
    if (!(scope && /^(telegram|discord)-bot(:|$)/.test(name))) {
      return errorResponse("Unknown bot token", 404);
    }

    return json({ token: await resolveManagedSecret(scope, name) });
  });
}
