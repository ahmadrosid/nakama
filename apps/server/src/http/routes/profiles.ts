import { createRoute, z } from "@hono/zod-openapi";
import type {
  CreateProfileRequest,
  DeleteKnowledgeBaseResponse,
  ImageAttachment,
  InitSoulResponse,
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
} from "@tinyclaw/core";
import { json, readJson } from "../shared";
import { requirePlatformAdminFromContext } from "../org-guards";
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
    fileKey: z.enum(["soul", "style", "skill", "memory"]).openapi({ param: { name: "fileKey", in: "path" } }),
  });
  const contentsQuery = z.object({
    contents: z.enum(["true", "false"]).optional(),
  });
  const listProfilesSchema = z.object({}).passthrough().openapi("ListProfilesResponse");
  const profileSchema = z.object({}).passthrough().openapi("ProfileResponse");
  const createProfileSchema = z.object({}).passthrough().openapi("CreateProfileRequest");
  const updateProfileSchema = z.object({}).passthrough().openapi("UpdateProfileRequest");
  const soulStatusSchema = z.object({}).passthrough().openapi("SoulStatusResponse");
  const soulStackSchema = z.object({}).passthrough().openapi("SoulStackResponse");
  const initSoulSchema = z.object({}).passthrough().openapi("InitSoulResponse");
  const updateSoulFileSchema = z.object({}).passthrough().openapi("UpdateSoulFileRequest");
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

  app.get("/v1/profiles", async () => {
    return json<ListProfilesResponse>(await agent.listProfiles());
  });

  app.post("/v1/profiles", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<CreateProfileRequest>(c.req.raw);
    return json<ProfileResponse>(await agent.createProfile(body), 201);
  });

  app.get("/v1/profiles/:profileId/soul", async (c) => {
    requirePlatformAdminFromContext(c);
    const includeContents = c.req.query("contents") === "true";
    return json<SoulStatusResponse>(
      await agent.getProfileSoulStatus(
        decodeURIComponent(c.req.param("profileId")),
        includeContents,
      ),
    );
  });

  app.get("/v1/profiles/:profileId/soul/stack", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<SoulStackResponse>(
      await agent.getProfileSoulStack(decodeURIComponent(c.req.param("profileId"))),
    );
  });

  app.post("/v1/profiles/:profileId/soul/init", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<InitSoulResponse>(
      await agent.initProfileSoul(decodeURIComponent(c.req.param("profileId"))),
      201,
    );
  });

  app.put("/v1/profiles/:profileId/soul/files/:fileKey", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<UpdateSoulFileRequest>(c.req.raw);
    await agent.writeProfileSoulFile(
      decodeURIComponent(c.req.param("profileId")),
      decodeURIComponent(c.req.param("fileKey")),
      body,
    );
    return new Response(null, { status: 204 });
  });

  app.get("/v1/profiles/:profileId/knowledge-base", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<ListKnowledgeBaseResponse>(
      await agent.listKnowledgeBase(decodeURIComponent(c.req.param("profileId"))),
    );
  });

  app.post("/v1/profiles/:profileId/knowledge-base", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<UploadKnowledgeBaseRequest>(c.req.raw);
    return json<UploadKnowledgeBaseResponse>(
      await agent.uploadKnowledgeBaseDocument(
        decodeURIComponent(c.req.param("profileId")),
        body.document,
      ),
      201,
    );
  });

  app.delete("/v1/profiles/:profileId/knowledge-base/:documentId", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<DeleteKnowledgeBaseResponse>(
      await agent.deleteKnowledgeBaseDocument(
        decodeURIComponent(c.req.param("profileId")),
        decodeURIComponent(c.req.param("documentId")),
      ),
    );
  });

  app.get("/v1/profiles/:profileId/avatar", async (c) => {
    const avatar = await agent.getProfileAvatar(decodeURIComponent(c.req.param("profileId")));
    return new Response(avatar.bytes, {
      headers: { "Content-Type": avatar.mediaType },
    });
  });

  app.put("/v1/profiles/:profileId/avatar", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<ImageAttachment>(c.req.raw);
    return json<ProfileResponse>(
      await agent.uploadProfileAvatar(decodeURIComponent(c.req.param("profileId")), body),
    );
  });

  app.delete("/v1/profiles/:profileId/avatar", async (c) => {
    requirePlatformAdminFromContext(c);
    await agent.deleteProfileAvatar(decodeURIComponent(c.req.param("profileId")));
    return new Response(null, { status: 204 });
  });

  app.get("/v1/profiles/:profileId", async (c) => {
    requirePlatformAdminFromContext(c);
    return json<ProfileResponse>(await agent.getProfile(decodeURIComponent(c.req.param("profileId"))));
  });

  app.put("/v1/profiles/:profileId", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson<UpdateProfileRequest>(c.req.raw);
    return json<ProfileResponse>(
      await agent.updateProfile(decodeURIComponent(c.req.param("profileId")), body),
    );
  });

  app.delete("/v1/profiles/:profileId", async (c) => {
    requirePlatformAdminFromContext(c);
    await agent.deleteProfile(decodeURIComponent(c.req.param("profileId")));
    return new Response(null, { status: 204 });
  });
}
