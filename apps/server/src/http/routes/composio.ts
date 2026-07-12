import type {
  ComposioConnectResponse,
  ComposioToolkitSummary,
  ComposioConnectRequest,
  EnableComposioToolkitRequest,
  ListComposioToolkitsResponse,
  ListProfileComposioToolkitsResponse,
  UpdateProfileComposioToolkitsRequest,
} from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import { ComposioService } from "../../services/composio-service";
import { resolveComposioCallbackBaseUrl } from "../../services/composio-callback-url";
import type { ServerOptions } from "../context";
import { requireNotViewerFromContext, requireOrgAdminFromContext } from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerComposioOAuthRoutes(app: HonoApp, options: ServerOptions): void {
  const service = options.composioService;
  if (!service) {
    return;
  }

  app.get("/v1/composio/oauth/callback", async (c) => {
    const state = c.req.query("state");
    if (!state) {
      return errorResponse("Missing OAuth state.", 400);
    }

    try {
      const connectedAccountId = c.req.query("connected_account_id");
      const result = await service.completeOAuth(state, { connectedAccountId });
      const accept = c.req.header("accept") ?? "";
      const wantsHtml = accept.includes("text/html") || !accept.includes("application/json");

      if (wantsHtml) {
        const toolkit = escapeHtml(result.toolkitSlug);
        return c.html(
          `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connected — Nakama</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1.25rem; line-height: 1.5; color: #111; }
    h1 { font-size: 1.35rem; margin-bottom: 0.5rem; }
    p { color: #444; }
    a { color: #0b57d0; }
  </style>
</head>
<body>
  <h1>${toolkit} connected</h1>
  <p>You can close this tab and return to Discord, Telegram, or chat.</p>
  <p><a href="/integrations?section=composio&amp;connected=${encodeURIComponent(result.toolkitSlug)}">Open Integrations</a></p>
</body>
</html>`,
        );
      }

      return c.redirect(
        `/integrations?section=composio&connected=${encodeURIComponent(result.toolkitSlug)}`,
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function registerComposioRoutes(app: HonoApp, options: ServerOptions): void {
  const service = options.composioService;
  if (!service) {
    return;
  }

  app.get("/v1/composio/toolkits", async (c) => {
    const auth = requireNotViewerFromContext(c);
    return json<ListComposioToolkitsResponse>(
      await service.listToolkits(auth.activeOrgId!, auth.user.id),
    );
  });

  app.post("/v1/composio/toolkits/:toolkitSlug/enable", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    try {
      return json<ComposioToolkitSummary>(
        await service.enableToolkit(auth.activeOrgId!, {
          toolkitSlug: c.req.param("toolkitSlug"),
        } satisfies EnableComposioToolkitRequest),
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.post("/v1/composio/toolkits/:toolkitSlug/disable", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    try {
      return json<ComposioToolkitSummary>(
        await service.disableToolkit(auth.activeOrgId!, c.req.param("toolkitSlug")),
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.post("/v1/composio/toolkits/:toolkitSlug/connect", async (c) => {
    const auth = requireNotViewerFromContext(c);

    try {
      const body = await readJson<ComposioConnectRequest>(c.req.raw).catch(() => ({}));
      return json<ComposioConnectResponse>(
        await service.connectToolkit(
          auth.activeOrgId!,
          auth.user.id,
          c.req.param("toolkitSlug"),
          resolveComposioCallbackBaseUrl({
            clientOrigin: body.callbackOrigin,
            request: c.req.raw,
          }),
        ),
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.post("/v1/composio/toolkits/:toolkitSlug/disconnect", async (c) => {
    const auth = requireNotViewerFromContext(c);

    try {
      return json<ComposioToolkitSummary>(
        await service.disconnectToolkit(
          auth.activeOrgId!,
          auth.user.id,
          c.req.param("toolkitSlug"),
        ),
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.post("/v1/composio/toolkits/:toolkitSlug/sync", async (c) => {
    const auth = requireNotViewerFromContext(c);

    try {
      return json<ComposioToolkitSummary>(
        await service.syncUserToolkit(
          auth.activeOrgId!,
          auth.user.id,
          c.req.param("toolkitSlug"),
        ),
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.get("/v1/profiles/:profileId/composio-toolkits", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const profile = await options.databaseAdapter?.getProfile(c.req.param("profileId"));

    if (!profile || profile.orgId !== auth.activeOrgId) {
      return errorResponse("Profile not found.", 404);
    }

    return json<ListProfileComposioToolkitsResponse>(
      await service.listProfileAssignments(auth.activeOrgId!, profile),
    );
  });

  app.put("/v1/profiles/:profileId/composio-toolkits", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const profile = await options.databaseAdapter?.getProfile(c.req.param("profileId"));

    if (!profile || profile.orgId !== auth.activeOrgId) {
      return errorResponse("Profile not found.", 404);
    }

    try {
      const body = await readJson<UpdateProfileComposioToolkitsRequest>(c.req.raw);
      return json<ListProfileComposioToolkitsResponse>(
        await service.updateProfileAssignments(auth.activeOrgId!, profile, body),
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });
}
