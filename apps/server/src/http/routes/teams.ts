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
import { resolveChannelOwner } from "../channel-owner";
import type { ServerOptions } from "../context";
import { requireOrgAdminOrPlatformAdminFromContext } from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

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

    if (
      Number(c.req.header("content-length") ?? 0) > MAX_FORWARDED_BODY_BYTES
    ) {
      return errorResponse("Request too large", 413);
    }

    // One answer for an unknown agent, an archived organization, an unreadable
    // configuration and a stopped worker, so a caller learns none of them.
    const notRunning = () =>
      errorResponse("Teams connection is not running", 503);

    // Hono has already decoded the path parameter.
    const profile = await databaseAdapter.getProfile(c.req.param("profileId"));

    if (!profile?.orgId) {
      return notRunning();
    }

    const organization = await databaseAdapter.getOrganizationById(
      profile.orgId
    );

    if (!organization || organization.archivedAt) {
      return notRunning();
    }

    const owner = { orgId: profile.orgId, profileId: profile.id };
    const config = await loadTeamsConfigFile(owner).catch(() => null);
    const status = await getTeamsWorkerStatus(owner).catch(() => null);
    const port = config?.inboundPort;

    // A port saved by a worker that has since died is never forwarded to.
    if (!(port && status?.running)) {
      return notRunning();
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
        `http://127.0.0.1:${port}${WORKER_MESSAGES_PATH}`,
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
