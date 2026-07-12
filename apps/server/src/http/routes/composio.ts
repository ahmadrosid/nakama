import type {
  ComposioConnectResponse,
  ComposioToolkitSummary,
  EnableComposioToolkitRequest,
  ListComposioToolkitsResponse,
  ListProfileComposioToolkitsResponse,
  UpdateProfileComposioToolkitsRequest,
} from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import { ComposioService } from "../../services/composio-service";
import type { ServerOptions } from "../context";
import { requireOrgAdminFromContext } from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

function resolveCallbackBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

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
      const result = await service.completeOAuth(state);
      return c.redirect(`/integrations?section=composio&connected=${encodeURIComponent(result.toolkitSlug)}`);
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });
}

export function registerComposioRoutes(app: HonoApp, options: ServerOptions): void {
  const service = options.composioService;
  if (!service) {
    return;
  }

  app.get("/v1/composio/toolkits", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    return json<ListComposioToolkitsResponse>(await service.listToolkits(auth.activeOrgId!));
  });

  app.post("/v1/composio/toolkits/:toolkitSlug/enable", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    try {
      return json<ComposioToolkitSummary>(
        await service.enableToolkit(auth.activeOrgId!, {
          toolkitSlug: c.req.param("toolkitSlug"),
        }),
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
    const auth = requireOrgAdminFromContext(c);

    try {
      return json<ComposioConnectResponse>(
        await service.connectToolkit(
          auth.activeOrgId!,
          c.req.param("toolkitSlug"),
          resolveCallbackBaseUrl(c.req.raw),
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
    const auth = requireOrgAdminFromContext(c);

    try {
      return json<ComposioToolkitSummary>(
        await service.disconnectToolkit(auth.activeOrgId!, c.req.param("toolkitSlug")),
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.post("/v1/composio/toolkits/:toolkitSlug/sync", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    try {
      return json<ComposioToolkitSummary>(
        await service.syncToolkit(auth.activeOrgId!, c.req.param("toolkitSlug")),
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
