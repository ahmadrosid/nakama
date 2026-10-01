import { createRoute, z } from "@hono/zod-openapi";
import { NakamaApiError } from "@nakama/core";
import type {
  ArtifactShareStatusResponse,
  PublishArtifactShareRequest,
  PublishArtifactShareResponse,
  RevokeArtifactShareResponse,
} from "@nakama/core/contract";
import { ArtifactShareService } from "../../services/artifact-share-service";
import { resolveRequestClientOrigin } from "../../services/composio-callback-url";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireNotViewerFromContext,
} from "../org-guards";
import { getRequestAuth, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerArtifactShareRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  if (!(options.databaseAdapter && options.authService)) {
    return;
  }

  const service = new ArtifactShareService(
    options.databaseAdapter,
    options.authService
  );

  const workspaceParams = z.object({ workspaceId: z.string() });
  const publishRequest = z
    .object({ path: z.string().min(1), clientOrigin: z.string().optional() })
    .strict();
  const sharedResponseFields = {
    id: z.string(),
    sharePath: z.string(),
    shareUrl: z.string().nullable(),
    webPublicUrlConfigured: z.boolean(),
  };
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      path: "/v1/workspaces/{workspaceId}/files/shares",
      tags: ["Workspaces"],
      summary: "Publish a snapshot of a folder file",
      request: {
        params: workspaceParams,
        body: {
          required: true,
          content: { "application/json": { schema: publishRequest } },
        },
      },
      responses: {
        201: {
          description: "Published",
          content: {
            "application/json": {
              schema: z.object({
                ...sharedResponseFields,
                refreshed: z.boolean(),
                token: z.string(),
              }),
            },
          },
        },
      },
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      path: "/v1/workspaces/{workspaceId}/files/shares/status",
      tags: ["Workspaces"],
      summary: "Get a folder file's share status",
      request: {
        params: workspaceParams,
        query: z.object({ path: z.string() }),
      },
      responses: {
        200: {
          description: "Share status",
          content: {
            "application/json": {
              schema: z
                .object({
                  ...sharedResponseFields,
                  active: z.boolean(),
                  createdAt: z.string(),
                })
                .nullable(),
            },
          },
        },
      },
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      path: "/v1/workspaces/{workspaceId}/files/shares/{shareId}",
      tags: ["Workspaces"],
      summary: "Revoke a folder file's public share",
      request: { params: workspaceParams.extend({ shareId: z.string() }) },
      responses: {
        200: {
          description: "Revoked",
          content: {
            "application/json": {
              schema: z.object({ id: z.string(), revoked: z.boolean() }),
            },
          },
        },
      },
    })
  );
  const workspaceScope = async (c: Parameters<typeof getRequestAuth>[0]) => {
    const auth = getRequestAuth(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const workspace = await options.agent.chatWorkspaces.require(
      orgId,
      c.req.param("workspaceId") ?? "",
      { ...auth, userId: auth.user.id }
    );
    return { orgId, workspaceId: workspace.id, profileId: "", workspace };
  };
  app.post("/v1/workspaces/:workspaceId/files/shares", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const scope = await workspaceScope(c);
    const body = await readJson<PublishArtifactShareRequest>(
      c.req.raw,
      publishRequest
    );
    const file = (
      await options.agent.chatWorkspaces.files(scope.workspace)
    ).find((entry) => entry.path === body.path);
    if (!file) {
      throw new NakamaApiError("File not found.", 404);
    }
    return json(
      await service.publishArtifactShare({
        ...scope,
        fileId: file.id,
        sourcePath: file.path,
        userId: auth.user.id,
        request: c.req.raw,
        clientOrigin: resolveRequestClientOrigin(c.req.raw, body.clientOrigin),
      }),
      201
    );
  });
  app.get("/v1/workspaces/:workspaceId/files/shares/status", async (c) => {
    const scope = await workspaceScope(c);
    const file = (
      await options.agent.chatWorkspaces.files(scope.workspace)
    ).find((entry) => entry.path === c.req.query("path"));
    return json(
      file
        ? await service.getArtifactShareStatus({
            ...scope,
            fileId: file.id,
            sourcePath: file.path,
            request: c.req.raw,
          })
        : null
    );
  });
  app.delete("/v1/workspaces/:workspaceId/files/shares/:shareId", async (c) => {
    requireNotViewerFromContext(c);
    const scope = await workspaceScope(c);
    return json(
      await service.revokeArtifactShare({
        ...scope,
        shareId: c.req.param("shareId"),
      })
    );
  });

  app.post("/v1/profiles/:profileId/artifacts/shares", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const body = await readJson<PublishArtifactShareRequest>(c.req.raw);

    if (!body.path?.trim()) {
      return json({ error: "path is required" }, 400);
    }

    const clientOrigin = resolveRequestClientOrigin(
      c.req.raw,
      body.clientOrigin
    );

    return json<PublishArtifactShareResponse>(
      await service.publishArtifactShare({
        orgId,
        profileId,
        request: c.req.raw,
        sourcePath: body.path.trim(),
        userId: auth.user.id,
        ...(clientOrigin ? { clientOrigin } : {}),
      }),
      201
    );
  });

  app.get("/v1/profiles/:profileId/artifacts/shares/status", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const sourcePath = c.req.query("path");

    if (!sourcePath?.trim()) {
      return json({ error: "path is required" }, 400);
    }

    const status = await service.getArtifactShareStatus({
      orgId,
      profileId,
      request: c.req.raw,
      sourcePath: sourcePath.trim(),
    });

    if (!status) {
      return json<ArtifactShareStatusResponse | null>(null);
    }

    return json(status);
  });

  app.delete("/v1/profiles/:profileId/artifacts/shares/:shareId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const shareId = decodeURIComponent(c.req.param("shareId"));

    return json<RevokeArtifactShareResponse>(
      await service.revokeArtifactShare({ orgId, profileId, shareId })
    );
  });

  app.get("/v1/public/artifact-shares/:token", async (c) => {
    const token = decodeURIComponent(c.req.param("token"));
    const metaOnly = c.req.query("meta") === "1";

    try {
      const { bytes, metadata } = await service.readPublicArtifactShare(token);

      if (metaOnly) {
        return json(metadata);
      }

      const downloadName = metadata.filename.replace(/["\\]/g, "_");
      const disposition = metadata.inlineAllowed ? "inline" : "attachment";
      const contentType = metadata.inlineAllowed
        ? metadata.mimeType
        : metadata.mimeType.startsWith("text/")
          ? "text/plain; charset=utf-8"
          : "application/octet-stream";

      return new Response(bytes, {
        headers: {
          "Content-Disposition": `${disposition}; filename="${downloadName}"`,
          "Content-Type": contentType,
          "Referrer-Policy": "no-referrer",
          "X-Artifact-Filename": metadata.filename,
          "X-Inline-Allowed": metadata.inlineAllowed ? "1" : "0",
        },
      });
    } catch (error) {
      if (error instanceof NakamaApiError && error.status === 404) {
        return json({ error: "Not found" }, 404);
      }

      throw error;
    }
  });
}
