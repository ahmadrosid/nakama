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
  ListToolsResponse,
  ProfileResponse,
  SoulStackResponse,
  SoulStatusResponse,
  UpdateProfileRequest,
  UpdateSoulFileRequest,
  UploadKnowledgeBaseRequest,
  UploadKnowledgeBaseResponse,
} from "@nakama/core";
import { filterProfilesForChatAccess } from "@nakama/core/profiles";
import { json, readJson, getRequestAuth } from "../shared";
import { requirePlatformAdminFromContext, requireActiveOrgIdFromContext } from "../org-guards";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";

export function registerProfileRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const profileIdParam = z.object({
    profileId: z.string().openapi({ param: { name: "profileId", in: "path" } }),
  });
  const documentIdParam = z.object({
    profileId: z.string().openapi({ param: { name: "profileId", in: "path" } }),
    documentId: z.string().openapi({ param: { name: "documentId", in: "path" } }),
  });
  const soulFileParam = z.object({
    profileId: z.string().openapi({ param: { name: "profileId", in: "path" } }),
    fileKey: z.enum(["soul", "style", "instructions", "memory"]).openapi({ param: { name: "fileKey", in: "path" } }),
  });
  const contentsQuery = z.object({
    contents: z.enum(["true", "false"]).optional(),
  });
  const artifactPathQuery = z.object({
    path: z.string().min(1),
  });
  const listProfilesSchema = z.object({}).passthrough().openapi("ListProfilesResponse");
  const profileSchema = z.object({}).passthrough().openapi("ProfileResponse");
  const createProfileSchema = z.object({}).passthrough().openapi("CreateProfileRequest");
  const updateProfileSchema = z.object({}).passthrough().openapi("UpdateProfileRequest");
  const soulStatusSchema = z.object({}).passthrough().openapi("SoulStatusResponse");
  const soulStackSchema = z.object({}).passthrough().openapi("SoulStackResponse");
  const initSoulSchema = z.object({}).passthrough().openapi("InitSoulResponse");
  const updateSoulFileSchema = z.object({}).passthrough().openapi("UpdateSoulFileRequest");
  const listArtifactsSchema = z.object({}).passthrough().openapi("ListArtifactsResponse");
  const deleteArtifactSchema = z.object({}).passthrough().openapi("DeleteArtifactResponse");
  const listKnowledgeBaseSchema = z.object({}).passthrough().openapi("ListKnowledgeBaseResponse");
  const uploadKnowledgeBaseSchema = z.object({}).passthrough().openapi("UploadKnowledgeBaseRequest");
  const uploadKnowledgeBaseResponseSchema = z.object({}).passthrough().openapi("UploadKnowledgeBaseResponse");
  const deleteKnowledgeBaseSchema = z.object({}).passthrough().openapi("DeleteKnowledgeBaseResponse");
  const imageAttachmentSchema = z.object({}).passthrough().openapi("ImageAttachment");

  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/profiles",
    tags: ["Profiles"],
    summary: "List bot profiles",
    operationId: "listProfiles",
    responses: { 200: { description: "Profile list", content: { "application/json": { schema: listProfilesSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/profiles",
    tags: ["Profiles"],
    summary: "Create a bot profile",
    operationId: "createProfile",
    request: { body: { required: true, content: { "application/json": { schema: createProfileSchema } } } },
    responses: {
      201: { description: "Profile created", content: { "application/json": { schema: profileSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/profiles/{profileId}",
    tags: ["Profiles"],
    summary: "Get a bot profile",
    operationId: "getProfile",
    request: { params: profileIdParam },
    responses: {
      200: { description: "Profile detail", content: { "application/json": { schema: profileSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/profiles/{profileId}",
    tags: ["Profiles"],
    summary: "Update a bot profile",
    operationId: "updateProfile",
    request: { params: profileIdParam, body: { required: true, content: { "application/json": { schema: updateProfileSchema } } } },
    responses: {
      200: { description: "Profile updated", content: { "application/json": { schema: profileSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/profiles/{profileId}",
    tags: ["Profiles"],
    summary: "Delete a bot profile",
    operationId: "deleteProfile",
    request: { params: profileIdParam },
    responses: {
      204: { description: "Profile deleted" },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/profiles/{profileId}/soul",
    tags: ["Soul", "Profiles"],
    summary: "Get soul status for a profile",
    operationId: "getProfileSoulStatus",
    request: { params: profileIdParam, query: contentsQuery },
    responses: {
      200: { description: "Soul status", content: { "application/json": { schema: soulStatusSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/profiles/{profileId}/soul/stack",
    tags: ["Soul", "Profiles"],
    summary: "Get soul stack contents for a profile",
    operationId: "getProfileSoulStack",
    request: { params: profileIdParam },
    responses: {
      200: { description: "Soul stack", content: { "application/json": { schema: soulStackSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/profiles/{profileId}/soul/init",
    tags: ["Soul", "Profiles"],
    summary: "Initialize soul templates for a profile",
    operationId: "initProfileSoul",
    request: { params: profileIdParam },
    responses: {
      201: { description: "Soul initialized", content: { "application/json": { schema: initSoulSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/profiles/{profileId}/soul/files/{fileKey}",
    tags: ["Soul", "Profiles"],
    summary: "Write a profile soul file",
    operationId: "writeProfileSoulFile",
    request: { params: soulFileParam, body: { required: true, content: { "application/json": { schema: updateSoulFileSchema } } } },
    responses: {
      204: { description: "File saved" },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/profiles/{profileId}/artifacts",
    tags: ["Profiles"],
    summary: "List artifacts for a profile",
    operationId: "listProfileArtifacts",
    request: { params: profileIdParam },
    responses: {
      200: { description: "Artifact list", content: { "application/json": { schema: listArtifactsSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/profiles/{profileId}/artifacts/content",
    tags: ["Profiles"],
    summary: "Download an artifact for a profile",
    operationId: "getProfileArtifactContent",
    request: { params: profileIdParam, query: artifactPathQuery },
    responses: {
      200: { description: "Artifact bytes", content: { "*/*": { schema: z.string() } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/profiles/{profileId}/artifacts",
    tags: ["Profiles"],
    summary: "Delete an artifact for a profile",
    operationId: "deleteProfileArtifact",
    request: { params: profileIdParam, query: artifactPathQuery },
    responses: {
      200: { description: "Deleted artifact", content: { "application/json": { schema: deleteArtifactSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/profiles/{profileId}/knowledge-base",
    tags: ["Profiles"],
    summary: "List knowledge base documents for a profile",
    operationId: "listKnowledgeBase",
    request: { params: profileIdParam },
    responses: {
      200: { description: "Knowledge base documents", content: { "application/json": { schema: listKnowledgeBaseSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/profiles/{profileId}/knowledge-base",
    tags: ["Profiles"],
    summary: "Upload a knowledge base document",
    operationId: "uploadKnowledgeBaseDocument",
    request: { params: profileIdParam, body: { required: true, content: { "application/json": { schema: uploadKnowledgeBaseSchema } } } },
    responses: {
      201: { description: "Uploaded knowledge base document", content: { "application/json": { schema: uploadKnowledgeBaseResponseSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/profiles/{profileId}/knowledge-base/{documentId}",
    tags: ["Profiles"],
    summary: "Delete a knowledge base document",
    operationId: "deleteKnowledgeBaseDocument",
    request: { params: documentIdParam },
    responses: {
      200: { description: "Deleted knowledge base document", content: { "application/json": { schema: deleteKnowledgeBaseSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/profiles/{profileId}/avatar",
    tags: ["Profiles"],
    summary: "Get a profile avatar image",
    operationId: "getProfileAvatar",
    request: { params: profileIdParam },
    responses: {
      200: { description: "Profile avatar image", content: { "image/*": { schema: z.string() } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/profiles/{profileId}/avatar",
    tags: ["Profiles"],
    summary: "Upload a profile avatar",
    operationId: "uploadProfileAvatar",
    request: { params: profileIdParam, body: { required: true, content: { "application/json": { schema: imageAttachmentSchema } } } },
    responses: {
      200: { description: "Profile with updated avatar", content: { "application/json": { schema: profileSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/profiles/{profileId}/avatar",
    tags: ["Profiles"],
    summary: "Delete a profile avatar",
    operationId: "deleteProfileAvatar",
    request: { params: profileIdParam },
    responses: {
      204: { description: "Avatar deleted" },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));

  app.get("/v1/profiles", async (c) => {
    const auth = getRequestAuth(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const response = await agent.listProfiles(orgId);

    return json<ListProfilesResponse>({
      profiles: filterProfilesForChatAccess(response.profiles, {
        orgRole: auth.orgRole,
        isPlatformAdmin: auth.isPlatformAdmin,
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
      await agent.getProfileSoulStatus(orgId, profileId, includeContents),
    );
  });

  app.get("/v1/profiles/:profileId/soul/stack", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    return json<SoulStackResponse>(await agent.getProfileSoulStack(orgId, profileId));
  });

  app.post("/v1/profiles/:profileId/soul/init", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    return json<InitSoulResponse>(await agent.initProfileSoul(orgId, profileId), 201);
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
      body,
    );
    return new Response(null, { status: 204 });
  });

  app.get("/v1/profiles/:profileId/artifacts", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    return json<ListArtifactsResponse>(await agent.listProfileArtifacts(orgId, profileId));
  });

  app.get("/v1/profiles/:profileId/artifacts/content", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const artifactPath = c.req.query("path");

    if (!artifactPath) {
      return json({ error: "path is required" }, 400);
    }

    const artifact = await agent.readProfileArtifact(orgId, profileId, artifactPath);
    const downloadName = (artifactPath.split("/").pop() ?? "artifact").replace(/["\\]/g, "_");
    return new Response(artifact.bytes, {
      headers: {
        "Content-Type": artifact.contentType,
        "Content-Disposition": `attachment; filename="${downloadName}"`,
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
      await agent.deleteProfileArtifact(orgId, profileId, artifactPath),
    );
  });

  app.get("/v1/profiles/:profileId/knowledge-base", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    return json<ListKnowledgeBaseResponse>(await agent.listKnowledgeBase(orgId, profileId));
  });

  app.post("/v1/profiles/:profileId/knowledge-base", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const body = await readJson<UploadKnowledgeBaseRequest>(c.req.raw);
    return json<UploadKnowledgeBaseResponse>(
      await agent.uploadKnowledgeBaseDocument(orgId, profileId, body.document),
      201,
    );
  });

  app.delete("/v1/profiles/:profileId/knowledge-base/:documentId", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    return json<DeleteKnowledgeBaseResponse>(
      await agent.deleteKnowledgeBaseDocument(
        orgId,
        profileId,
        decodeURIComponent(c.req.param("documentId")),
      ),
    );
  });

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
    return json<ProfileResponse>(await agent.uploadProfileAvatar(orgId, profileId, body));
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
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const body = await readJson<UpdateProfileRequest>(c.req.raw);
    return json<ProfileResponse>(await agent.updateProfile(orgId, profileId, body));
  });

  app.delete("/v1/profiles/:profileId", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    await agent.deleteProfile(orgId, profileId);
    return new Response(null, { status: 204 });
  });
}
