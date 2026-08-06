import type { ServerOptions } from "../context";
import type { HonoApp } from "../types";
import { json, readJson } from "../shared";
import {
  requireActiveOrgIdFromContext,
  requireNotViewerFromContext,
} from "../org-guards";
import { ArtifactShareService } from "../../services/artifact-share-service";
import { NakamaApiError } from "@nakama/core";
import type {
  ArtifactShareStatusResponse,
  PublishArtifactShareRequest,
  PublishArtifactShareResponse,
  RevokeArtifactShareResponse,
} from "@nakama/core/contract";

export function registerArtifactShareRoutes(app: HonoApp, options: ServerOptions): void {
  if (!options.databaseAdapter || !options.authService) {
    return;
  }

  const service = new ArtifactShareService(options.databaseAdapter, options.authService);

  app.post("/v1/profiles/:profileId/artifacts/shares", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const body = await readJson<PublishArtifactShareRequest>(c.req.raw);

    if (!body.path?.trim()) {
      return json({ error: "path is required" }, 400);
    }

    return json<PublishArtifactShareResponse>(
      await service.publishArtifactShare({
        orgId,
        profileId,
        sourcePath: body.path.trim(),
        userId: auth.user.id,
        request: c.req.raw,
      }),
      201,
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
      sourcePath: sourcePath.trim(),
      request: c.req.raw,
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
      await service.revokeArtifactShare({ orgId, profileId, shareId }),
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
          "Content-Type": contentType,
          "Content-Disposition": `${disposition}; filename="${downloadName}"`,
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
