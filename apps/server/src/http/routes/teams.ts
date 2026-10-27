import { z } from "@hono/zod-openapi";
import {
  getTeamsWorkerStatus,
  loadTeamsConfigFile,
  loadTeamsSettingsPublic,
  NakamaApiError,
  saveTeamsConfig,
  type TeamsSettingsResponse,
  type UpdateTeamsSettingsRequest,
} from "@nakama/core";
import type { MiddlewareHandler } from "hono";
import { resolveChannelOwner } from "../channel-owner";
import type { ServerOptions } from "../context";
import { requireOrgAdminOrPlatformAdminFromContext } from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { AppEnv, HonoApp } from "../types";

/**
 * The worker's SDK parses with express.json(), whose default limit is 100 KiB;
 * a larger body is refused here instead of by an error page from the worker.
 */
const MAX_FORWARDED_BODY_BYTES = 102_400;

const FORWARD_TIMEOUT_MS = 20_000;

/** The path the SDK adapter listens on inside the worker. */
const WORKER_MESSAGES_PATH = "/api/messages";

const updateTeamsSettingsSchema = z.object({
  allowedUserIds: z.string().optional(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  profileId: z.string().optional(),
  tenantId: z.string().optional(),
});

export function registerTeamsRoutes(app: HonoApp, options: ServerOptions) {
  const { agent, databaseAdapter, workerManager } = options;

  // Access is decided before a handler reads a body or turns an error into 400.
  const requireChannelAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
    await resolveChannelOwner(c, agent);
    await next();
  };

  app.use("/v1/settings/teams", requireChannelAccess);

  app.get("/v1/settings/teams", async (c) =>
    json<TeamsSettingsResponse>(
      await loadTeamsSettingsPublic(await resolveChannelOwner(c, agent))
    )
  );

  app.put("/v1/settings/teams", async (c) => {
    const owner = await resolveChannelOwner(c, agent);

    // Members may manage their own agent's other channels, but a Teams bot
    // admits users from outside the organization, so only admins connect one.
    requireOrgAdminOrPlatformAdminFromContext(c);

    const body = await readJson<UpdateTeamsSettingsRequest>(
      c.req.raw,
      updateTeamsSettingsSchema
    );

    try {
      // Stops the worker, saves, then starts it again if it should run, so a
      // running worker never keeps the credentials it started with.
      return json<TeamsSettingsResponse>(
        await workerManager.saveChannelConfig("teams", owner, () =>
          saveTeamsConfig(body, owner)
        )
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      // Credential and upstream failures are reported without their detail,
      // which can carry the secret or Microsoft's raw response.
      return errorResponse(
        error instanceof Error
          ? error.message
          : "Could not save Teams settings.",
        400
      );
    }
  });

  // Public: Microsoft posts here with its own service token, which only the
  // worker's SDK can verify. The owner comes from the agent in the path, never
  // from a header, query or body the caller controls.
  app.post("/v1/channels/teams/:profileId/messages", async (c) => {
    if (!databaseAdapter) {
      return errorResponse("Teams is not available", 503);
    }

    const profileId = decodeURIComponent(c.req.param("profileId"));
    const profile = await databaseAdapter.getProfile(profileId);

    if (!profile?.orgId) {
      return errorResponse("Not found", 404);
    }

    const owner = { orgId: profile.orgId, profileId: profile.id };
    const config = await loadTeamsConfigFile(owner);
    const status = await getTeamsWorkerStatus(owner);

    // A port saved by a worker that has since died must never be forwarded to.
    if (!(config?.inboundPort && status.running)) {
      return errorResponse("Teams connection is not running", 503);
    }

    const body = await c.req.raw.arrayBuffer();

    if (body.byteLength > MAX_FORWARDED_BODY_BYTES) {
      return errorResponse("Request too large", 413);
    }

    const headers = new Headers();
    const authorization = c.req.header("authorization");
    const contentType = c.req.header("content-type");

    // Only what the SDK needs to authenticate and parse the activity. No
    // cookies, no hop-by-hop headers, no forwarded host.
    if (authorization) {
      headers.set("authorization", authorization);
    }

    headers.set("content-type", contentType ?? "application/json");

    try {
      const response = await fetch(
        `http://127.0.0.1:${config.inboundPort}${WORKER_MESSAGES_PATH}`,
        {
          body,
          headers,
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
        }
      );

      // Outside production express answers a bad request with a page that
      // carries a stack trace and file paths, so a refusal keeps only its status.
      if (!response.ok) {
        return errorResponse(
          "Teams connection refused the request",
          response.status
        );
      }

      return new Response(response.body, {
        headers: {
          "content-type":
            response.headers.get("content-type") ?? "application/json",
        },
        status: response.status,
      });
    } catch {
      // A redirect, a refused connection or a timeout: the caller learns only
      // that the connection did not answer.
      return errorResponse("Teams connection did not answer", 502);
    }
  });
}
