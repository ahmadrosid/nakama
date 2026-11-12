import { createRoute, z } from "@hono/zod-openapi";
import { NakamaApiError } from "@nakama/core";
import type { MeetAction, MeetActionResults } from "@nakama/core/google-meet";
import type { Context } from "hono";
import { resolveRequestSelfOrigin } from "../../services/composio-callback-url";
import {
  type MeetActionInput,
  meetingActionSchemas,
} from "../../services/google-meet/actions";
import type { GoogleMeetService } from "../../services/google-meet/service";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgMemberFromContext,
} from "../org-guards";
import { isSecureRequest, json, readJson } from "../shared";
import type { AppEnv, HonoApp } from "../types";

const resultSchema = z.object({}).passthrough();

const extensionRoutes = [
  {
    method: "post",
    path: "/v1/meet/extension/pair",
    operationId: "meet-extension-pair",
    responses: {
      200: {
        description: "Pairing code",
        content: {
          "application/json": {
            schema: z.object({
              code: z.string(),
              expiresIn: z.number(),
              pairId: z.string(),
            }),
          },
        },
      },
      429: { description: "Too many pending pairings" },
    },
  },
  {
    method: "get",
    path: "/v1/meet/extension/pair/{pairId}",
    operationId: "meet-extension-pair-status",
    request: { params: z.object({ pairId: z.string() }) },
    responses: {
      200: {
        description: "Pending, or the key once after approval",
        content: {
          "application/json": {
            schema: z.object({
              key: z.string().optional(),
              status: z.enum(["pending", "approved"]),
            }),
          },
        },
      },
      404: { description: "Pairing not found or expired" },
    },
  },
  {
    method: "get",
    path: "/v1/meet/extension/status",
    operationId: "meet-extension-status",
    responses: {},
  },
  {
    method: "post",
    path: "/v1/meet/extension/start",
    operationId: "meet-extension-start",
    request: {
      body: {
        content: {
          "application/json": { schema: meetingActionSchemas["start-capture"] },
        },
        required: true,
      },
    },
    responses: {
      200: {
        description:
          "Capture ticket. Open captureUrl, then send the ticket as the first message.",
        content: {
          "application/json": {
            schema: z.object({
              captureUrl: z.string(),
              meetingId: z.string(),
              ticket: z.string(),
            }),
          },
        },
      },
    },
  },
  {
    method: "post",
    path: "/v1/meet/extension/leave",
    operationId: "meet-extension-leave",
    request: {
      body: {
        content: {
          "application/json": { schema: meetingActionSchemas.leave },
        },
        required: true,
      },
    },
    responses: {},
  },
  {
    method: "get",
    path: "/v1/meet/extension/transcript",
    operationId: "meet-extension-transcript",
    request: {
      query: z.object({
        after: z.string().optional(),
        meetingId: z.string(),
      }),
    },
    responses: {},
  },
  {
    method: "post",
    path: "/v1/meet/extension/disconnect",
    operationId: "meet-extension-disconnect",
    responses: {
      200: {
        description: "Revokes the key that made the call",
        content: {
          "application/json": { schema: z.object({ revoked: z.boolean() }) },
        },
      },
    },
  },
] as const;

function requireMeet(options: ServerOptions): GoogleMeetService {
  if (!options.googleMeetService) {
    throw new NakamaApiError("Google Meet is unavailable", 503);
  }

  return options.googleMeetService;
}

async function invokeMeet<Action extends MeetAction>(
  service: GoogleMeetService,
  orgId: string,
  action: Action,
  input: MeetActionInput,
  actor: { id: string; role: "admin" | "member" },
  signal: AbortSignal,
  captureSocketUrl?: string
): Promise<MeetActionResults[Action]> {
  try {
    return await service.invoke(
      orgId,
      action,
      input,
      actor,
      signal,
      undefined,
      captureSocketUrl
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
}

/**
 * The extension routes take only `Authorization: Bearer <Meet key>`. Cookies
 * and other tokens do not work here, and the key works nowhere else.
 */
async function requireExtensionKey(c: Context<AppEnv>, options: ServerOptions) {
  const service = requireMeet(options);
  const header = c.req.header("Authorization") ?? "";

  const auth = header.startsWith("Bearer ")
    ? await service.authenticateExtensionKey(header.slice(7).trim())
    : null;

  if (!auth) {
    throw new NakamaApiError("Authentication required", 401);
  }

  return {
    // A Meet key acts as a plain member: it reaches only its own meetings.
    actor: { id: auth.userId, role: "member" as const },
    keyId: auth.keyId,
    orgId: auth.orgId,
    service,
  };
}

/** The capture socket on the origin the request came to. It holds no secret. */
function captureSocketUrl(request: Request) {
  const url = new URL(
    "/v1/meet/capture",
    resolveRequestSelfOrigin(request) ?? request.url
  );

  url.protocol = isSecureRequest(request) ? "wss:" : "ws:";

  return url.href;
}

async function readMeetInput<Action extends keyof typeof meetingActionSchemas>(
  request: Request,
  action: Action
) {
  const parsed = meetingActionSchemas[action].safeParse(
    await readJson(request, z.unknown())
  );

  if (!parsed.success) {
    throw new NakamaApiError("Invalid meeting input", 400);
  }

  return parsed.data;
}

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
            content: { "application/json": { schema: resultSchema } },
          },
          400: { description: "Invalid request" },
          403: { description: "Forbidden" },
        },
      })
    );
  }

  for (const route of extensionRoutes) {
    app.openAPIRegistry.registerPath(
      createRoute({
        ...route,
        tags: ["Google Meet"],
        responses: {
          200: {
            description: "Meeting action result",
            content: { "application/json": { schema: resultSchema } },
          },
          400: { description: "Invalid request" },
          401: { description: "Unknown, revoked or expired Meet key" },
          ...route.responses,
        },
      })
    );
  }

  app.post("/v1/meet/actions/:actionKey", async (c) => {
    const auth = requireOrgMemberFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const service = requireMeet(options);
    // SAFETY: The validated value satisfies the contract checked by this assertion.
    const action = c.req.param("actionKey") as MeetAction;

    if (!Object.hasOwn(meetingActionSchemas, action)) {
      throw new NakamaApiError("Unknown meeting action", 404);
    }

    const input = await readMeetInput(c.req.raw, action);

    if (action === "configure" && auth.orgRole !== "admin") {
      throw new NakamaApiError("Forbidden", 403);
    }

    return json(
      await invokeMeet(
        service,
        orgId,
        action,
        input,
        {
          id: auth.user.id,
          role: auth.orgRole === "admin" ? "admin" : "member",
        },
        c.req.raw.signal
      )
    );
  });

  // Public: the extension has no credentials yet. Rate-limited per address.
  app.post("/v1/meet/extension/pair", (c) =>
    json(requireMeet(options).startPairing(c.req.header("User-Agent") ?? null))
  );

  app.get("/v1/meet/extension/pair/:pairId", (c) =>
    json(requireMeet(options).collectPairing(c.req.param("pairId")))
  );

  app.get("/v1/meet/extension/status", async (c) => {
    const { actor, orgId, service } = await requireExtensionKey(c, options);

    return json({
      ...(await invokeMeet(
        service,
        orgId,
        "meetings",
        {},
        actor,
        c.req.raw.signal
      )),
      // Key clients use the capture socket on this server.
      captureProtocol: 3,
    });
  });

  app.get("/v1/meet/capture", (c) =>
    requireMeet(options).upgradeCapture(c.req.raw, c.env?.server)
  );

  app.post("/v1/meet/extension/start", async (c) => {
    const { actor, orgId, service } = await requireExtensionKey(c, options);
    const input = await readMeetInput(c.req.raw, "start-capture");

    const started = await invokeMeet(
      service,
      orgId,
      "start-capture",
      input,
      actor,
      c.req.raw.signal,
      captureSocketUrl(c.req.raw)
    );

    return json({
      captureUrl: started.capture.url,
      meetingId: started.id,
      ticket: started.capture.token,
    });
  });

  app.post("/v1/meet/extension/leave", async (c) => {
    const { actor, orgId, service } = await requireExtensionKey(c, options);
    const input = await readMeetInput(c.req.raw, "leave");

    return json(
      await invokeMeet(service, orgId, "leave", input, actor, c.req.raw.signal)
    );
  });

  // Disconnect in the extension revokes its own key, and only that key.
  app.post("/v1/meet/extension/disconnect", async (c) => {
    const { actor, keyId, orgId, service } = await requireExtensionKey(
      c,
      options
    );

    return json(
      await invokeMeet(
        service,
        orgId,
        "revoke-extension",
        { keyId },
        actor,
        c.req.raw.signal
      )
    );
  });

  app.get("/v1/meet/extension/transcript", async (c) => {
    const { actor, orgId, service } = await requireExtensionKey(c, options);
    const query: MeetActionInput = { meetingId: c.req.query("meetingId") };

    const after = c.req.query("after");

    if (after !== undefined) {
      query.after = Number(after);
    }

    const parsed = meetingActionSchemas.transcript.safeParse(query);

    if (!parsed.success) {
      throw new NakamaApiError("Invalid meeting input", 400);
    }

    return json(
      await invokeMeet(
        service,
        orgId,
        "transcript",
        parsed.data,
        actor,
        c.req.raw.signal
      )
    );
  });
}
