import { createRoute, z } from "@hono/zod-openapi";
import type {
  CloneProfileRequest,
  CreateProfileRequest,
  DeleteArtifactResponse,
  DeleteKnowledgeBaseResponse,
  ImageAttachment,
  InitSoulResponse,
  ListArtifactsResponse,
  ListKnowledgeBaseResponse,
  ListProfileChangeHistoryResponse,
  ListProfilesResponse,
  MoveProfileRequest,
  ProfileResponse,
  SoulStackResponse,
  SoulStatusResponse,
  UpdateArtifactRequest,
  UpdateArtifactResponse,
  UpdateProfileRequest,
  UpdateSoulFileRequest,
  UploadKnowledgeBaseRequest,
  UploadKnowledgeBaseResponse,
} from "@nakama/core";
import {
  attachSharedKnowledgeBaseDocument,
  detachSharedKnowledgeBaseDocument,
  getProfileSharedDocumentIds,
  getWorkspaceEntry,
  KnowledgeBaseDocumentInUseError,
  listWorkspaceFiles,
  NakamaApiError,
  readOrganizationKnowledgeBaseDocumentContent,
  readWorkspaceFile,
  renameWorkspaceEntry,
} from "@nakama/core";
import { filterProfilesForChatAccess } from "@nakama/core/profiles";
import { ArtifactShareService } from "../../services/artifact-share-service";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireNotViewerFromContext,
  requireOrgAdmin,
  requireOrgAdminOrPlatformAdminFromContext,
  requirePlatformAdminFromContext,
} from "../org-guards";
import {
  getRequestAppUserScope,
  getRequestAuth,
  json,
  readJson,
  readOptionalJson,
} from "../shared";
import type { HonoApp } from "../types";

const ORG_ADMIN_PROFILE_SETTING_KEYS = new Set([
  "automationsEnabled",
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
  const artifactShares =
    options.databaseAdapter && options.authService
      ? new ArtifactShareService(options.databaseAdapter, options.authService)
      : null;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const renameWorkspaceSchema = z
    .object({
      path: z.string().min(1).max(4096),
      newName: z.string().min(1).max(255),
    })
    .strict();
  const profileIdParam = z.object({
    profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
  });
  const documentIdParam = z.object({
    documentId: z
      .string()
      .openapi({ param: { in: "path", name: "documentId" } }),
    profileId: z.string().openapi({ param: { in: "path", name: "profileId" } }),
  });
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "patch",
      path: "/v1/profiles/{profileId}/workspace/rename",
      operationId: "renameProfileWorkspaceEntry",
      summary: "Rename a workspace file or folder (platform admin)",
      tags: ["Profiles"],
      request: {
        params: profileIdParam,
        body: {
          required: true,
          content: { "application/json": { schema: renameWorkspaceSchema } },
        },
      },
      responses: {
        200: {
          description: "Renamed entry",
          content: {
            "application/json": {
              schema: z.object({
                filename: z.string(),
                path: z.string(),
                kind: z.enum(["file", "directory"]),
                mimeType: z.string(),
                sizeBytes: z.number(),
                updatedAt: z.string(),
              }),
            },
          },
        },
        400: { description: "Invalid or protected path" },
        403: { description: "Platform administrator required" },
        404: { description: "Profile or entry not found" },
        409: { description: "Name already exists" },
      },
    })
  );
  const orgIdParam = z.object({
    orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
  });
  const orgDocumentIdParam = orgIdParam.extend({
    documentId: z
      .string()
      .openapi({ param: { in: "path", name: "documentId" } }),
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
  const updateArtifactSchema = z
    .object({})
    .passthrough()
    .openapi("UpdateArtifactRequest");
  const updateArtifactResultSchema = z
    .object({})
    .passthrough()
    .openapi("UpdateArtifactResponse");
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
  const sharedKnowledgeBaseDocumentSchema = z
    .object({
      documentId: z.string(),
      profileId: z.string(),
    })
    .passthrough()
    .openapi("SharedKnowledgeBaseDocumentResponse");
  const knowledgeBaseDocumentInUseSchema = z
    .object({
      documentId: z.string(),
      error: z.string(),
      profileIds: z.array(z.string()),
    })
    .openapi("KnowledgeBaseDocumentInUseResponse");
  const imageAttachmentSchema = z
    .object({})
    .passthrough()
    .openapi("ImageAttachment");

  for (const method of ["get", "put"] as const) {
    app.openAPIRegistry.registerPath(
      createRoute({
        method,
        path: "/v1/profiles/{profileId}/workspace/pins",
        operationId:
          method === "get" ? "listProfileFilePins" : "setProfileFilePinned",
        tags: ["Profiles"],
        summary:
          method === "get"
            ? "List your pinned files"
            : "Pin or unpin a file for your account",
        request: {
          params: profileIdParam,
          ...(method === "put"
            ? {
                body: {
                  required: true,
                  content: {
                    "application/json": {
                      schema: z.object({
                        path: z.string(),
                        pinned: z.boolean(),
                      }),
                    },
                  },
                },
              }
            : {}),
        },
        responses:
          method === "get"
            ? {
                200: {
                  description: "Pinned workspace files",
                  content: {
                    "application/json": {
                      schema: z.object({
                        entries: z.array(
                          z.object({
                            filename: z.string(),
                            path: z.string(),
                            kind: z.enum(["file", "directory"]),
                            mimeType: z.string(),
                            sizeBytes: z.number(),
                            updatedAt: z.string(),
                          })
                        ),
                      }),
                    },
                  },
                },
                403: { description: "Forbidden" },
              }
            : {
                204: { description: "Pin updated" },
                400: { description: "Invalid path" },
                403: { description: "Forbidden" },
                404: { description: "File not found" },
              },
      })
    );
  }

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
  const cloneProfileSchema = z
    .object({})
    .passthrough()
    .openapi("CloneProfileRequest");
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
      method: "get",
      operationId: "listProfileChangeHistory",
      path: "/v1/profiles/{profileId}/history",
      request: {
        params: profileIdParam,
        query: z.object({
          limit: z.coerce.number().int().min(1).max(200).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        }),
      },
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                events: z.array(
                  z.object({
                    actorName: z.string().nullable().optional(),
                    assignmentNames: z
                      .record(z.string(), z.string().nullable())
                      .optional(),
                    actorUserId: z.string().nullable(),
                    assignmentChanges: z
                      .object({
                        added: z.array(
                          z.object({
                            id: z.string(),
                            name: z.string().nullable(),
                          })
                        ),
                        removed: z.array(
                          z.object({
                            id: z.string(),
                            name: z.string().nullable(),
                          })
                        ),
                      })
                      .optional(),
                    afterValue: z.string().nullable(),
                    beforeValue: z.string().nullable(),
                    createdAt: z.string(),
                    field: z.string(),
                    id: z.string(),
                    orgId: z.string(),
                    profileId: z.string(),
                    source: z.string(),
                  })
                ),
              }),
            },
          },
          description: "Profile change history",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Forbidden",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Not found",
        },
      },
      summary: "List append-only profile change history",
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
      operationId: "listProfileWorkspaceFiles",
      path: "/v1/profiles/{profileId}/workspace",
      request: {
        params: profileIdParam,
        query: z.object({ folder: z.string().optional() }),
      },
      responses: {
        200: {
          description: "Workspace directory entries",
          content: {
            "application/json": {
              schema: z.object({
                entries: z.array(
                  z.object({
                    filename: z.string(),
                    path: z.string(),
                    kind: z.enum(["file", "directory"]),
                    mimeType: z.string(),
                    sizeBytes: z.number(),
                    updatedAt: z.string(),
                  })
                ),
              }),
            },
          },
        },
        400: { description: "Invalid workspace path" },
        403: { description: "Platform administrator required" },
        404: { description: "Profile or folder not found" },
      },
      summary: "List a profile workspace folder (platform admin)",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "readProfileWorkspaceFile",
      path: "/v1/profiles/{profileId}/workspace/content",
      request: {
        params: profileIdParam,
        query: z.object({ path: z.string().min(1) }),
      },
      responses: {
        200: {
          description: "Workspace file bytes",
          content: { "*/*": { schema: z.string() } },
        },
        400: { description: "Invalid workspace path" },
        403: { description: "Platform administrator required" },
        404: { description: "Profile or file not found" },
      },
      summary: "Download a profile workspace file (platform admin)",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listProfileArtifacts",
      path: "/v1/profiles/{profileId}/artifacts",
      request: {
        params: profileIdParam,
        query: z.object({
          folder: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
          offset: z.coerce.number().int().min(0).optional(),
        }),
      },
      responses: {
        200: {
          content: { "application/json": { schema: listArtifactsSchema } },
          description: "Artifact list",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Invalid pagination",
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
      method: "put",
      operationId: "writeProfileArtifactContent",
      path: "/v1/profiles/{profileId}/artifacts/content",
      request: {
        body: {
          content: { "application/json": { schema: updateArtifactSchema } },
          required: true,
        },
        params: profileIdParam,
        query: artifactPathQuery,
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: updateArtifactResultSchema },
          },
          description: "Saved artifact",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Save markdown artifact content (org members except viewers)",
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
      operationId: "getKnowledgeBaseDocumentContent",
      path: "/v1/profiles/{profileId}/knowledge-base/{documentId}/content",
      request: {
        params: documentIdParam,
        query: z.object({
          inline: z.enum(["0", "1"]).optional(),
          render: z.enum(["text"]).optional(),
        }),
      },
      responses: {
        200: {
          content: { "*/*": { schema: z.string() } },
          description: "Knowledge base document bytes",
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
      summary:
        "Read knowledge base document bytes (render=text returns extracted text for preview)",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listOrganizationKnowledgeBase",
      path: "/v1/orgs/{orgId}/knowledge-base",
      request: { params: orgIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: listKnowledgeBaseSchema } },
          description: "Shared organization knowledge base documents",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary:
        "List shared organization knowledge base documents (platform admins)",
      tags: ["Organizations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "uploadOrganizationKnowledgeBaseDocument",
      path: "/v1/orgs/{orgId}/knowledge-base",
      request: {
        body: {
          content: {
            "application/json": { schema: uploadKnowledgeBaseSchema },
          },
          required: true,
        },
        params: orgIdParam,
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: uploadKnowledgeBaseResponseSchema },
          },
          description: "Shared organization knowledge base document kept",
        },
        201: {
          content: {
            "application/json": { schema: uploadKnowledgeBaseResponseSchema },
          },
          description: "Shared organization knowledge base document created",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary:
        "Upload a shared organization knowledge base document (platform admins)",
      tags: ["Organizations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteOrganizationKnowledgeBaseDocument",
      path: "/v1/orgs/{orgId}/knowledge-base/{documentId}",
      request: { params: orgDocumentIdParam },
      responses: {
        200: {
          content: {
            "application/json": { schema: deleteKnowledgeBaseSchema },
          },
          description: "Deleted shared organization knowledge base document",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: {
            "application/json": { schema: knowledgeBaseDocumentInUseSchema },
          },
          description: "Document is still attached to one or more profiles",
        },
      },
      summary:
        "Delete a shared organization knowledge base document (platform admins)",
      tags: ["Organizations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getOrganizationKnowledgeBaseDocumentContent",
      path: "/v1/orgs/{orgId}/knowledge-base/{documentId}/content",
      request: {
        params: orgDocumentIdParam,
        query: z.object({
          inline: z.enum(["0", "1"]).optional(),
          render: z.enum(["text"]).optional(),
        }),
      },
      responses: {
        200: {
          content: { "*/*": { schema: z.string() } },
          description: "Shared organization document bytes",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary:
        "Read shared organization document bytes (render=text returns extracted text for preview)",
      tags: ["Organizations"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "put",
      operationId: "attachSharedKnowledgeBaseDocument",
      path: "/v1/profiles/{profileId}/knowledge-base/shared/{documentId}",
      request: { params: documentIdParam },
      responses: {
        200: {
          content: {
            "application/json": { schema: sharedKnowledgeBaseDocumentSchema },
          },
          description: "Shared document attached to the profile",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary:
        "Attach a shared organization document to a profile (platform admins)",
      tags: ["Profiles"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "detachSharedKnowledgeBaseDocument",
      path: "/v1/profiles/{profileId}/knowledge-base/shared/{documentId}",
      request: { params: documentIdParam },
      responses: {
        200: {
          content: {
            "application/json": { schema: sharedKnowledgeBaseDocumentSchema },
          },
          description: "Shared document detached from the profile",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary:
        "Detach a shared organization document from a profile (platform admins)",
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
    const auth = requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const body = await readJson<UpdateSoulFileRequest>(c.req.raw);
    await agent.writeProfileSoulFile(
      orgId,
      profileId,
      decodeURIComponent(c.req.param("fileKey")),
      body,
      { actorUserId: auth.user.id, source: "dashboard" }
    );
    return new Response(null, { status: 204 });
  });

  app.get("/v1/profiles/:profileId/workspace/pins", async (c) => {
    const auth = requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    await agent.getProfile(orgId, profileId);
    if (!options.databaseAdapter) {
      throw new NakamaApiError("Database unavailable", 503);
    }
    const paths = await options.databaseAdapter.listFilePins(
      orgId,
      auth.user.id,
      profileId
    );
    const entries = [];
    for (const filename of paths) {
      try {
        entries.push(
          (await getWorkspaceEntry(orgId, profileId, filename)).entry
        );
      } catch (error) {
        // Missing files and paths that no longer pass workspace guards stay hidden.
        if (
          !(
            error instanceof NakamaApiError &&
            (error.status === 404 || error.status === 400)
          )
        ) {
          throw error;
        }
      }
    }
    return json({ entries });
  });

  app.patch("/v1/profiles/:profileId/workspace/rename", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    await agent.getProfile(orgId, profileId);
    const parsed = renameWorkspaceSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw new NakamaApiError("Invalid rename request", 400);
    }
    const database = options.databaseAdapter;
    if (!database) {
      throw new NakamaApiError("Database unavailable", 503);
    }
    return json(
      await renameWorkspaceEntry({
        ...parsed.data,
        orgId,
        profileId,
        updateReferences: (newPath) =>
          database.renameFilePins(orgId, profileId, parsed.data.path, newPath),
      })
    );
  });

  app.put("/v1/profiles/:profileId/workspace/pins", async (c) => {
    const auth = requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    await agent.getProfile(orgId, profileId);
    const parsed = z
      .object({
        path: z
          .string()
          .min(1)
          .max(4096)
          .refine(
            (value) =>
              !(value.includes("\\") || value.includes("\0")) &&
              value
                .split("/")
                .every((part) => part !== "" && part !== "." && part !== "..")
          ),
        pinned: z.boolean(),
      })
      .strict()
      .safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw new NakamaApiError("Invalid file pin", 400);
    }
    if (!options.databaseAdapter) {
      throw new NakamaApiError("Database unavailable", 503);
    }
    if (parsed.data.pinned) {
      await getWorkspaceEntry(orgId, profileId, parsed.data.path);
    }
    await options.databaseAdapter.setFilePinned(
      orgId,
      auth.user.id,
      profileId,
      parsed.data.path,
      parsed.data.pinned
    );
    return new Response(null, { status: 204 });
  });

  app.get("/v1/profiles/:profileId/workspace", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    await agent.getProfile(orgId, profileId);
    return json(
      await listWorkspaceFiles(orgId, profileId, c.req.query("folder") ?? "")
    );
  });

  app.get("/v1/profiles/:profileId/workspace/content", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    await agent.getProfile(orgId, profileId);
    const filename = c.req.query("path");
    if (!filename) {
      return json({ error: "path is required" }, 400);
    }
    const render =
      c.req.query("render") === "markdown" ? ("markdown" as const) : undefined;
    const file = await readWorkspaceFile(orgId, profileId, filename, {
      render,
    });
    // Default stays `attachment`, so every existing download link is untouched.
    const disposition = c.req.query("inline") === "1" ? "inline" : "attachment";
    const body = "markdown" in file ? file.markdown : Bun.file(file.filePath);
    return new Response(body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(filename.split("/").pop() ?? "file")}`,
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });

  app.get("/v1/profiles/:profileId/artifacts", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const { appUserId } = getRequestAppUserScope(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const limitRaw = c.req.query("limit");
    const offsetRaw = c.req.query("offset");

    if (limitRaw === undefined && offsetRaw !== undefined) {
      return json({ error: "limit is required when offset is provided" }, 400);
    }

    const limit =
      limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);
    const offset =
      offsetRaw === undefined ? undefined : Number.parseInt(offsetRaw, 10);

    if (
      limit !== undefined &&
      (!Number.isFinite(limit) || limit < 1 || limit > 100)
    ) {
      return json({ error: "limit must be an integer between 1 and 100" }, 400);
    }

    if (offset !== undefined && (!Number.isFinite(offset) || offset < 0)) {
      return json({ error: "offset must be a non-negative integer" }, 400);
    }

    return json<ListArtifactsResponse>(
      await agent.listProfileArtifacts(orgId, profileId, {
        appUserId,
        folder: c.req.query("folder"),
        limit,
        offset,
      })
    );
  });

  app.get("/v1/profiles/:profileId/artifacts/content", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const { appUserId } = getRequestAppUserScope(c);
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
      {
        appUserId,
        render,
      }
    );
    const downloadName = artifactPath.split("/").pop() ?? "artifact";
    const disposition = c.req.query("inline") === "1" ? "inline" : "attachment";
    return new Response(artifact.bytes, {
      headers: {
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        "Content-Type": artifact.contentType,
      },
    });
  });

  app.put("/v1/profiles/:profileId/artifacts/content", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const artifactPath = c.req.query("path");

    if (!artifactPath) {
      return json({ error: "path is required" }, 400);
    }

    const body = await readJson<UpdateArtifactRequest>(c.req.raw);

    if (typeof body.content !== "string") {
      return json({ error: "content is required" }, 400);
    }

    const saved = await agent.writeProfileArtifact(
      orgId,
      profileId,
      artifactPath,
      body.content
    );

    await artifactShares?.refreshArtifactShareSnapshot({
      orgId,
      profileId,
      sourcePaths: [artifactPath, saved.filename],
    });

    return json<UpdateArtifactResponse>(saved);
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
    const result = await agent.uploadKnowledgeBaseDocument(
      orgId,
      profileId,
      body.document,
      body.onDuplicate
    );
    return json<UploadKnowledgeBaseResponse>(
      result,
      result.outcome === "created" ? 201 : 200
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

  app.get(
    "/v1/profiles/:profileId/knowledge-base/:documentId/content",
    async (c) => {
      requirePlatformAdminFromContext(c);
      const orgId = requireActiveOrgIdFromContext(c);
      const profileId = decodeURIComponent(c.req.param("profileId"));
      const documentId = decodeURIComponent(c.req.param("documentId"));
      await agent.getProfile(orgId, profileId);
      const render =
        c.req.query("render") === "text" ? ("text" as const) : undefined;
      const sharedDocumentIds = await getProfileSharedDocumentIds(
        orgId,
        profileId
      );
      const document = sharedDocumentIds.includes(documentId)
        ? await readOrganizationKnowledgeBaseDocumentContent(
            orgId,
            documentId,
            {
              render,
            }
          )
        : await agent.readKnowledgeBaseDocument(orgId, profileId, documentId, {
            render,
          });
      const downloadName = document.filename.replace(/["\\]/g, "_");
      const disposition =
        c.req.query("inline") === "1" ? "inline" : "attachment";
      return new Response(document.bytes, {
        headers: {
          "Content-Disposition": `${disposition}; filename="${downloadName}"`,
          "Content-Type": document.contentType,
        },
      });
    }
  );

  app.get("/v1/orgs/:orgId/knowledge-base", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    if (orgId !== decodeURIComponent(c.req.param("orgId"))) {
      throw new NakamaApiError("Not found", 404);
    }
    return json(await agent.listOrganizationKnowledgeBase(orgId));
  });

  app.post("/v1/orgs/:orgId/knowledge-base", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    if (orgId !== decodeURIComponent(c.req.param("orgId"))) {
      throw new NakamaApiError("Not found", 404);
    }
    const body = await readJson<UploadKnowledgeBaseRequest>(c.req.raw);
    const result = await agent.uploadOrganizationKnowledgeBaseDocument(
      orgId,
      body.document,
      body.onDuplicate
    );
    return json(result, result.outcome === "created" ? 201 : 200);
  });

  app.delete("/v1/orgs/:orgId/knowledge-base/:documentId", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    if (orgId !== decodeURIComponent(c.req.param("orgId"))) {
      throw new NakamaApiError("Not found", 404);
    }
    const documentId = decodeURIComponent(c.req.param("documentId"));
    try {
      return json(
        await agent.deleteOrganizationKnowledgeBaseDocument(orgId, documentId)
      );
    } catch (error) {
      if (error instanceof KnowledgeBaseDocumentInUseError) {
        return json(
          {
            documentId,
            error: error.message,
            profileIds: error.profileIds,
          },
          409
        );
      }
      throw error;
    }
  });

  app.get("/v1/orgs/:orgId/knowledge-base/:documentId/content", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    if (orgId !== decodeURIComponent(c.req.param("orgId"))) {
      throw new NakamaApiError("Not found", 404);
    }
    const document = await agent.readOrganizationKnowledgeBaseDocument(
      orgId,
      decodeURIComponent(c.req.param("documentId")),
      { render: c.req.query("render") === "text" ? "text" : undefined }
    );
    return new Response(document.bytes, {
      headers: {
        "Content-Disposition": `${c.req.query("inline") === "1" ? "inline" : "attachment"}; filename="${document.filename.replace(/["\\]/g, "_")}"`,
        "Content-Type": document.contentType,
      },
    });
  });

  app.put(
    "/v1/profiles/:profileId/knowledge-base/shared/:documentId",
    async (c) => {
      requirePlatformAdminFromContext(c);
      const orgId = requireActiveOrgIdFromContext(c);
      const profileId = decodeURIComponent(c.req.param("profileId"));
      const documentId = decodeURIComponent(c.req.param("documentId"));
      await agent.getProfile(orgId, profileId);
      try {
        await attachSharedKnowledgeBaseDocument(orgId, profileId, documentId);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Shared knowledge base document not found."
        ) {
          throw new NakamaApiError(error.message, 404);
        }
        throw error;
      }
      return json({ attached: true, documentId, profileId });
    }
  );

  app.delete(
    "/v1/profiles/:profileId/knowledge-base/shared/:documentId",
    async (c) => {
      requirePlatformAdminFromContext(c);
      const orgId = requireActiveOrgIdFromContext(c);
      const profileId = decodeURIComponent(c.req.param("profileId"));
      const documentId = decodeURIComponent(c.req.param("documentId"));
      await agent.getProfile(orgId, profileId);
      const detached = await detachSharedKnowledgeBaseDocument(
        orgId,
        profileId,
        documentId
      );
      if (!detached) {
        throw new NakamaApiError(
          "Shared knowledge base document is not attached to this profile.",
          404
        );
      }
      return json({ detached: true, documentId, profileId });
    }
  );

  app.get("/v1/profiles/:profileId/avatar", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const avatar = await agent.getProfileAvatar(orgId, profileId);
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
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    return json<ProfileResponse>(await agent.getProfile(orgId, profileId));
  });

  app.get("/v1/profiles/:profileId/history", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const limitRaw = c.req.query("limit");
    const offsetRaw = c.req.query("offset");
    const limit =
      limitRaw === undefined ? undefined : Number.parseInt(limitRaw, 10);
    const offset =
      offsetRaw === undefined ? undefined : Number.parseInt(offsetRaw, 10);

    if (
      limit !== undefined &&
      (!Number.isFinite(limit) || limit < 1 || limit > 200)
    ) {
      return json({ error: "limit must be an integer between 1 and 200" }, 400);
    }

    if (offset !== undefined && (!Number.isFinite(offset) || offset < 0)) {
      return json({ error: "offset must be a non-negative integer" }, 400);
    }

    return json<ListProfileChangeHistoryResponse>(
      await agent.listProfileChangeHistory(orgId, profileId, { limit, offset })
    );
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
      await agent.updateProfile(orgId, profileId, body, {
        actorUserId: auth.user.id,
        source: "dashboard",
      })
    );
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "cloneProfile",
      path: "/v1/profiles/{profileId}/clone",
      request: {
        body: {
          content: { "application/json": { schema: cloneProfileSchema } },
          required: false,
        },
        params: profileIdParam,
      },
      responses: {
        201: {
          content: { "application/json": { schema: profileSchema } },
          description: "Profile cloned",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Clone a bot profile",
      tags: ["Profiles"],
    })
  );
  app.post("/v1/profiles/:profileId/clone", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const body = await readOptionalJson<CloneProfileRequest>(c.req.raw, {});
    return json<ProfileResponse>(
      await agent.cloneProfile(orgId, profileId, body),
      201
    );
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "moveProfile",
      path: "/v1/profiles/{profileId}/move",
      request: {
        params: profileIdParam,
        body: {
          required: true,
          content: {
            "application/json": {
              schema: z.object({ organizationId: z.string().min(1) }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Profile moved",
          content: { "application/json": { schema: profileSchema } },
        },
      },
      summary: "Move a profile to another organization",
      tags: ["Profiles"],
    })
  );
  app.post("/v1/profiles/:profileId/move", async (c) => {
    requirePlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const profileId = decodeURIComponent(c.req.param("profileId"));
    const body = await readJson<MoveProfileRequest>(c.req.raw);
    return json<ProfileResponse>(
      await agent.moveProfile(orgId, profileId, body)
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
