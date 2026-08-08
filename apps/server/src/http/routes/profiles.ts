import { createRoute, z } from "@hono/zod-openapi";
import type {
  CreateProfileRequest,
  DeleteArtifactResponse,
  DeleteKnowledgeBaseResponse,
  ImageAttachment,
  InitSoulResponse,
  ListArtifactsResponse,
  ListKnowledgeBaseResponse,
  ListProfilesResponse,
  ProfileResponse,
  SoulStackResponse,
  SoulStatusResponse,
  UpdateProfileRequest,
  UpdateSoulFileRequest,
  UploadKnowledgeBaseRequest,
  UploadKnowledgeBaseResponse,
} from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import { filterProfilesForChatAccess } from "@nakama/core/profiles";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireOrgAdmin,
  requirePlatformAdminFromContext,
} from "../org-guards";
import { getRequestAuth, json, readJson } from "../shared";
import type { HonoApp } from "../types";

const ORG_ADMIN_PROFILE_SETTING_KEYS = new Set([
  "skillsWriteApproval",
  "skillsPostTurnReview",
]);

function isOrgAdminAllowedProfileSettingsUpdate(
  body: UpdateProfileRequest
): boolean {
  const keys = Object.keys(body).filter(
    (key) => body[key as keyof UpdateProfileRequest] !== undefined
  );
  return (
    keys.length > 0 &&
    keys.every((key) => ORG_ADMIN_PROFILE_SETTING_KEYS.has(key))
  );
}

export function registerProfileRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { agent } = options;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const profileIdParam = z.object({
    profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
  });
  const documentIdParam = z.object({
    documentId: z
      .string()
      .openapi({ param: { in: "path", name: "documentId" } }),
    profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
  });
  const soulFileParam = z.object({
    fileKey: z
      .enum(["soul", "style", "instructions", "memory"])
      .openapi({ param: { in: "path", name: "fileKey" } }),
    profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
  });
  const contentsQuery = z.object({
    contents: z.enum(["true", "false"]).optional(),
  });
  const artifactPathQuery = z.object({
    inline: z.enum(["0", "1"]).optional(),
    path: z.string().min(1),
  });
  const listProfilesSchema = z
    .object({})
    .passthrough()
    .openapi("ListProfilesResponse");
  const profileSchema = z.object({}).passthrough().openapi("ProfileResponse");
  const createProfileSchema = z
    .object({})
    .passthrough()
    .openapi("CreateProfileRequest");
  const updateProfileSchema = z
    .object({})
    .passthrough()
    .openapi("UpdateProfileRequest");
  const soulStatusSchema = z
    .object({})
    .passthrough()
    .openapi("SoulStatusResponse");
  const soulStackSchema = z
    .object({})
    .passthrough()
    .openapi("SoulStackResponse");
  const initSoulSchema = z.object({}).passthrough().openapi("InitSoulResponse");
  const updateSoulFileSchema = z
    .object({})
    .passthrough()
    .openapi("UpdateSoulFileRequest");
  const listArtifactsSchema = z
    .object({})
    .passthrough()
    .openapi("ListArtifactsResponse");
  const deleteArtifactSchema = z
    .object({})
    .passthrough()
    .openapi("DeleteArtifactResponse");
  const listKnowledgeBaseSchema = z
    .object({})
    .passthrough()
    .openapi("ListKnowledgeBaseResponse");
  const uploadKnowledgeBaseSchema = z
    .object({})
    .passthrough()
    .openapi("UploadKnowledgeBaseRequest");
  const uploadKnowledgeBaseResponseSchema = z
    .object({})
    .passthrough()
    .openapi("UploadKnowledgeBaseResponse");
  const deleteKnowledgeBaseSchema = z
    .object({})
    .passthrough()
    .openapi("DeleteKnowledgeBaseResponse");
  const imageAttachmentSchema = z
    .object({})
    .passthrough()
    .openapi("ImageAttachment");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listProfiles",
      path: "/v1/profiles",
      responses: {
        200: {
          content: { "application/json": { schema: listProfilesSchema } },
          description: "Profile list",
        },
      },
      summary: "List bot profiles",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createProfile",
      path: "/v1/profiles",
      request: {
        body: {
          content: { "application/json": { schema: createProfileSchema } },
          required: true,
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: profileSchema } },
          description: "Profile created",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Create a bot profile",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getProfile",
      path: "/v1/profiles/{profileId}",
      request: { params: profileIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: profileSchema } },
          description: "Profile detail",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get a bot profile",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "put",
      operationId: "updateProfile",
      path: "/v1/profiles/{profileId}",
      request: {
        body: {
          content: { "application/json": { schema: updateProfileSchema } },
          required: true,
        },
        params: profileIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: profileSchema } },
          description: "Profile updated",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Update a bot profile",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteProfile",
      path: "/v1/profiles/{profileId}",
      request: { params: profileIdParam },
      responses: {
        204: { description: "Profile deleted" },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Delete a bot profile",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getProfileSoulStatus",
      path: "/v1/profiles/{profileId}/soul",
      request: { params: profileIdParam, query: contentsQuery },
      responses: {
        200: {
          content: { "application/json": { schema: soulStatusSchema } },
          description: "Soul status",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get soul status for a profile",
      tags: ["Soul", "Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getProfileSoulStack",
      path: "/v1/profiles/{profileId}/soul/stack",
      request: { params: profileIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: soulStackSchema } },
          description: "Soul stack",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get soul stack contents for a profile",
      tags: ["Soul", "Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "initProfileSoul",
      path: "/v1/profiles/{profileId}/soul/init",
      request: { params: profileIdParam },
      responses: {
        201: {
          content: { "application/json": { schema: initSoulSchema } },
          description: "Soul initialized",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Initialize soul templates for a profile",
      tags: ["Soul", "Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "put",
      operationId: "writeProfileSoulFile",
      path: "/v1/profiles/{profileId}/soul/files/{fileKey}",
      request: {
        body: {
          content: { "application/json": { schema: updateSoulFileSchema } },
          required: true,
        },
        params: soulFileParam,
      },
      responses: {
        204: { description: "File saved" },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Write a profile soul file",
      tags: ["Soul", "Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listProfileArtifacts",
      path: "/v1/profiles/{profileId}/artifacts",
      request: { params: profileIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: listArtifactsSchema } },
          description: "Artifact list",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "List artifacts for a profile",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getProfileArtifactContent",
      path: "/v1/profiles/{profileId}/artifacts/content",
      request: { params: profileIdParam, query: artifactPathQuery },
      responses: {
        200: {
          content: { "*/*": { schema: z.string() } },
          description: "Artifact bytes",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary:
        "Read artifact bytes for a profile (org members; list/delete remain platform-admin)",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteProfileArtifact",
      path: "/v1/profiles/{profileId}/artifacts",
      request: { params: profileIdParam, query: artifactPathQuery },
      responses: {
        200: {
          content: { "application/json": { schema: deleteArtifactSchema } },
          description: "Deleted artifact",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Delete an artifact for a profile",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listKnowledgeBase",
      path: "/v1/profiles/{profileId}/knowledge-base",
      request: { params: profileIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: listKnowledgeBaseSchema } },
          description: "Knowledge base documents",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "List knowledge base documents for a profile",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "uploadKnowledgeBaseDocument",
      path: "/v1/profiles/{profileId}/knowledge-base",
      request: {
        body: {
          content: {
            "application/json": { schema: uploadKnowledgeBaseSchema },
          },
          required: true,
        },
        params: profileIdParam,
      },
      responses: {
        201: {
          content: {
            "application/json": { schema: uploadKnowledgeBaseResponseSchema },
          },
          description: "Uploaded knowledge base document",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Upload a knowledge base document",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteKnowledgeBaseDocument",
      path: "/v1/profiles/{profileId}/knowledge-base/{documentId}",
      request: { params: documentIdParam },
      responses: {
        200: {
          content: {
            "application/json": { schema: deleteKnowledgeBaseSchema },
          },
          description: "Deleted knowledge base document",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Delete a knowledge base document",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getProfileAvatar",
      path: "/v1/profiles/{profileId}/avatar",
      request: { params: profileIdParam },
      responses: {
        200: {
          content: { "image/*": { schema: z.string() } },
          description: "Profile avatar image",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get a profile avatar image",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "put",
      operationId: "uploadProfileAvatar",
      path: "/v1/profiles/{profileId}/avatar",
      request: {
        body: {
          content: { "application/json": { schema: imageAttachmentSchema } },
          required: true,
        },
        params: profileIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: profileSchema } },
          description: "Profile with updated avatar",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Upload a profile avatar",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteProfileAvatar",
      path: "/v1/profiles/{profileId}/avatar",
      request: { params: profileIdParam },
      responses: {
        204: { description: "Avatar deleted" },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Delete a profile avatar",
      tags: ["Profiles"],
    })
  );

  app.get("/v1/profiles", async (c) => {
    const auth = getRequestAuth(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const response = await agent.listProfiles(orgId);

    return json<ListProfilesResponse>({
      profiles: filterProfilesForChatAccess(response.profiles, {
        isPlatformAdmin: auth.isPlatformAdmin,
        orgRole: auth.orgRole,
      }),
    });
  });

  app.post("/v1/profiles", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<CreateProfileRequest>(c.req.raw);
    return json<ProfileResponse>(await agent.createProfile(orgId, body), 201);
  });

  app.get("/v1/profiles/:profileId/soul", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const includeContents = c.req.query("contents") === "true";
    return json<SoulStatusResponse>(
      await agent.getProfileSoulStatus(orgId, profileId, includeContents)
    );
  });

  app.get("/v1/profiles/:profileId/soul/stack", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    return json<SoulStackResponse>(
      await agent.getProfileSoulStack(orgId, profileId)
    );
  });

  app.post("/v1/profiles/:profileId/soul/init", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    return json<InitSoulResponse>(
      await agent.initProfileSoul(orgId, profileId),
      201
    );
  });

  app.put("/v1/profiles/:profileId/soul/files/:fileKey", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const body = await readJson<UpdateSoulFileRequest>(c.req.raw);
    await agent.writeProfileSoulFile(
      orgId,
      profileId,
      decodeURIComponent(c.req.param("fileKey")),
      body
    );
    return new Response(null, { status: 204 });
  });

  app.get("/v1/profiles/:profileId/artifacts", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    return json<ListArtifactsResponse>(
      await agent.listProfileArtifacts(orgId, profileId)
    );
  });

  app.get("/v1/profiles/:profileId/artifacts/content", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const artifactPath = c.req.query("path");

    if (!artifactPath) {
      return json({ error: "path is required" }, 400);
    }

    const render =
      c.req.query("render") === "markdown" ? ("markdown" as const) : undefined;
    const artifact = await agent.readProfileArtifact(
      orgId,
      profileId,
      artifactPath,
      { render }
    );
    const downloadName = (artifactPath.split("/").pop() ?? "artifact").replace(
      /["\\]/g,
      "_"
    );
    const disposition = c.req.query("inline") === "1" ? "inline" : "attachment";
    return new Response(artifact.bytes, {
      headers: {
        "Content-Disposition": `${disposition}; filename="${downloadName}"`,
        "Content-Type": artifact.contentType,
      },
    });
  });

  app.delete("/v1/profiles/:profileId/artifacts", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const artifactPath = c.req.query("path");

    if (!artifactPath) {
      return json({ error: "path is required" }, 400);
    }

    return json<DeleteArtifactResponse>(
      await agent.deleteProfileArtifact(orgId, profileId, artifactPath)
    );
  });

  app.get("/v1/profiles/:profileId/knowledge-base", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    return json<ListKnowledgeBaseResponse>(
      await agent.listKnowledgeBase(orgId, profileId)
    );
  });

  app.post("/v1/profiles/:profileId/knowledge-base", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const body = await readJson<UploadKnowledgeBaseRequest>(c.req.raw);
    return json<UploadKnowledgeBaseResponse>(
      await agent.uploadKnowledgeBaseDocument(orgId, profileId, body.document),
      201
    );
  });

  app.delete(
    "/v1/profiles/:profileId/knowledge-base/:documentId",
    async (c) => {
      requirePlatformAdminFromContext(c);
      const orgId = requireActiveOrgIdFromContext(c);
      const profileId = decodeURIComponent(c.req.param("profileId"));
      return json<DeleteKnowledgeBaseResponse>(
        await agent.deleteKnowledgeBaseDocument(
          orgId,
          profileId,
          decodeURIComponent(c.req.param("documentId"))
        )
      );
    }
  );

  app.get("/v1/profiles/:profileId/avatar", async (c) => {
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const avatar = await agent.getProfileAvatarByProfileId(profileId);
    return new Response(avatar.bytes, {
      headers: { "Content-Type": avatar.mediaType },
    });
  });

  app.put("/v1/profiles/:profileId/avatar", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const body = await readJson<ImageAttachment>(c.req.raw);
    return json<ProfileResponse>(
      await agent.uploadProfileAvatar(orgId, profileId, body)
    );
  });

  app.delete("/v1/profiles/:profileId/avatar", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    await agent.deleteProfileAvatar(orgId, profileId);
    return new Response(null, { status: 204 });
  });

  app.get("/v1/profiles/:profileId", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    return json<ProfileResponse>(await agent.getProfile(orgId, profileId));
  });

  app.put("/v1/profiles/:profileId", async (c) => {
    const auth = getRequestAuth(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const body = await readJson<UpdateProfileRequest>(c.req.raw);

    if (!auth.isPlatformAdmin) {
      requireOrgAdmin(auth);
      if (!isOrgAdminAllowedProfileSettingsUpdate(body)) {
        throw new NakamaApiError("Forbidden", 403);
      }
    }

    return json<ProfileResponse>(
      await agent.updateProfile(orgId, profileId, body)
    );
  });

  app.delete("/v1/profiles/:profileId", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    await agent.deleteProfile(orgId, profileId);
    return new Response(null, { status: 204 });
  });
}
