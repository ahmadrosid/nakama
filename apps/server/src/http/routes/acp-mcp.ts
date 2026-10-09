import { z } from "@hono/zod-openapi";
import {
  acpMcpRequestSchema,
  handleAcpMcpRequest,
} from "../../providers/acp/acp-mcp-tools";
import { readJson } from "../shared";
import type { HonoApp } from "../types";

/**
 * Called by the stdio bridge an ACP agent starts. There is no user session:
 * the token in the path is the credential, and it only reaches one chat's tools.
 */
export function registerAcpMcpRoutes(app: HonoApp): void {
  app.post("/v1/acp-mcp/:token", async (c) => {
    const token = decodeURIComponent(c.req.param("token"));
    const body = await readJson(c.req.raw, z.unknown());
    const request = acpMcpRequestSchema.safeParse(body);

    if (!request.success) {
      return c.json({ error: "Invalid JSON-RPC request." }, 400);
    }

    const reply = await handleAcpMcpRequest(token, request.data);

    if (reply.kind === "unknown") {
      return c.json({ error: "Unknown ACP session." }, 404);
    }

    if (reply.kind === "accepted") {
      return c.body(null, 202);
    }

    return c.json(reply.body, 200);
  });
}
