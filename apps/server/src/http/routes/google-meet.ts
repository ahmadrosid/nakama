import { createRoute, z } from "@hono/zod-openapi";
import { NakamaApiError } from "@nakama/core";
import type { MeetAction } from "@nakama/core/google-meet";
import { meetingActionSchemas } from "../../services/google-meet/actions";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireNotViewerFromContext,
} from "../org-guards";
import { json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerGoogleMeetRoutes(app: HonoApp, options: ServerOptions) {
  for (const [action, schema] of Object.entries(meetingActionSchemas)) {
    app.openAPIRegistry.registerPath(
      createRoute({
        method: "post",
        path: `/v1/meet/actions/${action}`,
        operationId: `meet-${action}`,
        tags: ["Google Meet"],
        request: {
          body: { content: { "application/json": { schema } }, required: true },
        },
        responses: {
          200: {
            description: "Meeting action result",
            content: {
              "application/json": { schema: z.object({}).passthrough() },
            },
          },
          400: { description: "Invalid request" },
          403: { description: "Forbidden" },
        },
      })
    );
  }
  app.post("/v1/meet/actions/:actionKey", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    if (!options.googleMeetService) {
      throw new NakamaApiError("Google Meet is unavailable", 503);
    }
    const action = c.req.param("actionKey") as MeetAction;
    const schema = meetingActionSchemas[action];
    if (!Object.hasOwn(meetingActionSchemas, action)) {
      throw new NakamaApiError("Unknown meeting action", 404);
    }
    const parsed = schema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw new NakamaApiError("Invalid meeting input", 400);
    }
    if (action === "configure" && auth.orgRole !== "admin") {
      throw new NakamaApiError("Forbidden", 403);
    }
    try {
      return json(
        await options.googleMeetService.invoke(
          orgId,
          action,
          parsed.data,
          {
            id: auth.user.id,
            role: auth.orgRole === "admin" ? "admin" : "member",
          },
          c.req.raw.signal
        )
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        throw error;
      }
      throw new NakamaApiError(
        error instanceof Error ? error.message : "Meeting action failed",
        400
      );
    }
  });
}
