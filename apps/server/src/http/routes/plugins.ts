import { createRoute, z } from "@hono/zod-openapi";
import {
  type DeleteRetainedPluginDataRequest,
  type InstallOrgPluginRequest,
  type InstallPluginPackageRequest,
  type InstallPluginPackageResponse,
  type InvokePluginActionRequest,
  type InvokePluginActionResponse,
  type ListOrgPluginsResponse,
  type ListPluginReleasesResponse,
  NakamaApiError,
  type OrgPluginDetail,
  type PluginContributionChangePreview,
  type PluginExecutionActor,
  type PluginPackagePreviewResponse,
  type PluginRevisionRequest,
  type PluginUiBootstrap,
  type UpdateOrgPluginRequest,
} from "@nakama/core";
import type { Context } from "hono";
import {
  PluginInvocationError,
  PluginLifecycleError,
  PluginPackageError,
  type PluginService,
} from "../../services/plugin-service";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireNotViewerFromContext,
  requireOrgAdminOrPlatformAdminFromContext,
  requirePlatformAdminFromContext,
} from "../org-guards";
import { type getRequestAuth, json, readJson } from "../shared";
import type { AppEnv, HonoApp } from "../types";

const PLUGIN_UI_BOOTSTRAP_PATH = "__nakama/bootstrap.json";

const UI_MIME_TYPES: Record<string, string> = {
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  woff2: "font/woff2",
};

export function registerPluginRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const pluginIdParam = z.object({
    pluginId: z.string().openapi({ param: { in: "path", name: "pluginId" } }),
  });
  const pluginVersionParams = z.object({
    pluginId: z.string().openapi({ param: { in: "path", name: "pluginId" } }),
    version: z.string().openapi({ param: { in: "path", name: "version" } }),
  });
  const pluginActionParams = z.object({
    actionKey: z.string().openapi({ param: { in: "path", name: "actionKey" } }),
    pluginId: z.string().openapi({ param: { in: "path", name: "pluginId" } }),
  });
  const pluginUiParams = z.object({
    orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
    pluginId: z.string().openapi({ param: { in: "path", name: "pluginId" } }),
  });
  const archiveRequestSchema = z
    .object({
      data: z.string(),
      expectedDigest: z.string().optional(),
    })
    .openapi("InstallPluginPackageRequest");
  const previewResponseSchema = z
    .object({})
    .passthrough()
    .openapi("PluginPackagePreviewResponse");
  const installResponseSchema = z
    .object({})
    .passthrough()
    .openapi("InstallPluginPackageResponse");
  const listReleasesSchema = z
    .object({})
    .passthrough()
    .openapi("ListPluginReleasesResponse");
  const listOrgPluginsSchema = z
    .object({})
    .passthrough()
    .openapi("ListOrgPluginsResponse");
  const orgPluginSchema = z.object({}).passthrough().openapi("OrgPluginDetail");
  const revisionRequestSchema = z
    .object({ expectedRevision: z.number() })
    .openapi("PluginRevisionRequest");
  const installOrgRequestSchema = z
    .object({ version: z.string().optional() })
    .openapi("InstallOrgPluginRequest");
  const updateRequestSchema = z
    .object({
      expectedRevision: z.number(),
      targetVersion: z.string(),
    })
    .openapi("UpdateOrgPluginRequest");
  const contributionPreviewSchema = z
    .object({})
    .passthrough()
    .openapi("PluginContributionChangePreview");
  const deleteRetainedSchema = z
    .object({
      confirm: z.literal(true),
      expectedRevision: z.number(),
      orgId: z.string(),
      pluginId: z.string(),
    })
    .openapi("DeleteRetainedPluginDataRequest");
  const invokeRequestSchema = z
    .object({ input: z.unknown().optional() })
    .openapi("InvokePluginActionRequest");
  const invokeResponseSchema = z
    .object({})
    .passthrough()
    .openapi("InvokePluginActionResponse");
  const bootstrapSchema = z
    .object({})
    .passthrough()
    .openapi("PluginUiBootstrap");

  const register = (
    route: Parameters<typeof app.openAPIRegistry.registerPath>[0]
  ) => {
    app.openAPIRegistry.registerPath(route);
  };

  register(
    createRoute({
      method: "post",
      operationId: "previewPluginPackage",
      path: "/v1/platform/plugins/releases/preview",
      request: {
        body: {
          content: { "application/json": { schema: archiveRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: previewResponseSchema } },
          description: "Plugin package preview",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Inspect an uploaded plugin archive without executing it",
      tags: ["Platform", "Plugins"],
    })
  );
  register(
    createRoute({
      method: "post",
      operationId: "installPluginPackage",
      path: "/v1/platform/plugins/releases",
      request: {
        body: {
          content: { "application/json": { schema: archiveRequestSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { "application/json": { schema: installResponseSchema } },
          description: "Installed plugin release",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Install an uploaded plugin archive without executing it",
      tags: ["Platform", "Plugins"],
    })
  );
  register(
    createRoute({
      method: "get",
      operationId: "listPluginReleases",
      path: "/v1/platform/plugins/releases",
      responses: {
        200: {
          content: { "application/json": { schema: listReleasesSchema } },
          description: "Approved plugin releases",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "List approved plugin releases",
      tags: ["Platform", "Plugins"],
    })
  );
  register(
    createRoute({
      method: "delete",
      operationId: "removePluginRelease",
      path: "/v1/platform/plugins/releases/{pluginId}/{version}",
      request: { params: pluginVersionParams },
      responses: {
        204: { description: "Release removed" },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Remove a plugin release that no installation depends on",
      tags: ["Platform", "Plugins"],
    })
  );
  register(
    createRoute({
      method: "get",
      operationId: "listOrgPlugins",
      path: "/v1/plugins",
      responses: {
        200: {
          content: { "application/json": { schema: listOrgPluginsSchema } },
          description: "Organization plugin catalog",
        },
      },
      summary: "List plugins available to the active organization",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "get",
      operationId: "getOrgPlugin",
      path: "/v1/plugins/{pluginId}",
      request: { params: pluginIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: orgPluginSchema } },
          description: "Organization plugin detail",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get one organization plugin",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "post",
      operationId: "installOrgPlugin",
      path: "/v1/plugins/{pluginId}/install",
      request: {
        body: {
          content: { "application/json": { schema: installOrgRequestSchema } },
          required: true,
        },
        params: pluginIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: orgPluginSchema } },
          description: "Organization plugin added",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Add an approved release to the active organization",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "post",
      operationId: "enableOrgPlugin",
      path: "/v1/plugins/{pluginId}/enable",
      request: {
        body: {
          content: { "application/json": { schema: revisionRequestSchema } },
          required: true,
        },
        params: pluginIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: orgPluginSchema } },
          description: "Plugin enabled",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Enable an organization plugin",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "post",
      operationId: "disableOrgPlugin",
      path: "/v1/plugins/{pluginId}/disable",
      request: {
        body: {
          content: { "application/json": { schema: revisionRequestSchema } },
          required: true,
        },
        params: pluginIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: orgPluginSchema } },
          description: "Plugin disabled",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Disable an organization plugin",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "get",
      operationId: "previewOrgPluginUpdate",
      path: "/v1/plugins/{pluginId}/update/preview",
      request: {
        params: pluginIdParam,
        query: z.object({ targetVersion: z.string() }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: contributionPreviewSchema },
          },
          description: "Update contribution preview",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Preview contribution removals for an update",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "post",
      operationId: "updateOrgPlugin",
      path: "/v1/plugins/{pluginId}/update",
      request: {
        body: {
          content: { "application/json": { schema: updateRequestSchema } },
          required: true,
        },
        params: pluginIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: orgPluginSchema } },
          description: "Plugin updated",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Update a disabled organization plugin to another release",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "post",
      operationId: "uninstallOrgPlugin",
      path: "/v1/plugins/{pluginId}/uninstall",
      request: {
        body: {
          content: { "application/json": { schema: revisionRequestSchema } },
          required: true,
        },
        params: pluginIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: orgPluginSchema } },
          description: "Plugin uninstalled",
        },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Uninstall an organization plugin and retain its data",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "post",
      operationId: "deleteRetainedPluginData",
      path: "/v1/plugins/{pluginId}/retained-data/delete",
      request: {
        body: {
          content: { "application/json": { schema: deleteRetainedSchema } },
          required: true,
        },
        params: pluginIdParam,
      },
      responses: {
        204: { description: "Retained data deleted" },
        403: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Delete retained plugin data after confirmation",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "post",
      operationId: "invokePluginAction",
      path: "/v1/plugins/{pluginId}/actions/{actionKey}",
      request: {
        body: {
          content: { "application/json": { schema: invokeRequestSchema } },
          required: true,
        },
        params: pluginActionParams,
      },
      responses: {
        200: {
          content: { "application/json": { schema: invokeResponseSchema } },
          description: "Action result",
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
      summary: "Invoke a declared plugin UI action",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "get",
      operationId: "getPluginUiBootstrap",
      path: "/v1/plugins/ui/{orgId}/{pluginId}/__nakama/bootstrap.json",
      request: { params: pluginUiParams },
      responses: {
        200: {
          content: { "application/json": { schema: bootstrapSchema } },
          description: "Plugin page bootstrap",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Non-secret bootstrap for an enabled plugin page",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "get",
      operationId: "getPluginUiDocument",
      path: "/v1/plugins/ui/{orgId}/{pluginId}",
      request: { params: pluginUiParams },
      responses: {
        200: {
          content: { "text/html": { schema: z.string() } },
          description: "Plugin UI document",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Serve the enabled plugin UI entry document",
      tags: ["Plugins"],
    })
  );
  register(
    createRoute({
      method: "get",
      operationId: "getPluginUiAsset",
      path: "/v1/plugins/ui/{orgId}/{pluginId}/{path}",
      request: {
        params: z.object({
          orgId: z.string().openapi({ param: { in: "path", name: "orgId" } }),
          path: z.string().openapi({ param: { in: "path", name: "path" } }),
          pluginId: z
            .string()
            .openapi({ param: { in: "path", name: "pluginId" } }),
        }),
      },
      responses: {
        200: { description: "Plugin UI asset" },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Serve a file from the enabled plugin UI directory",
      tags: ["Plugins"],
    })
  );

  app.post("/v1/platform/plugins/releases/preview", async (c) => {
    requirePlatformAdminFromContext(c);
    const plugins = requirePluginService(options);
    const { archive } = await readPluginArchive(c.req.raw);
    try {
      const preview = await plugins.previewPluginPackage(archive);
      return json<PluginPackagePreviewResponse>(preview);
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.post("/v1/platform/plugins/releases", async (c) => {
    requirePlatformAdminFromContext(c);
    const plugins = requirePluginService(options);
    const { archive, expectedDigest } = await readPluginArchive(c.req.raw);
    try {
      const installed = await plugins.installPluginPackage(archive, {
        expectedDigest,
      });
      return json<InstallPluginPackageResponse>({
        createdAt: installed.createdAt,
        digest: installed.digest,
        manifest: installed.manifest,
        pluginId: installed.pluginId,
        reused: installed.reused,
        version: installed.version,
      });
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.get("/v1/platform/plugins/releases", async (c) => {
    requirePlatformAdminFromContext(c);
    const plugins = requirePluginService(options);
    return json<ListPluginReleasesResponse>({
      releases: await plugins.listApprovedPluginReleases(),
    });
  });

  app.delete("/v1/platform/plugins/releases/:pluginId/:version", async (c) => {
    requirePlatformAdminFromContext(c);
    const plugins = requirePluginService(options);
    try {
      await plugins.removePluginRelease(
        decodeURIComponent(c.req.param("pluginId")),
        decodeURIComponent(c.req.param("version"))
      );
      return new Response(null, { status: 204 });
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.get("/v1/plugins", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    return json<ListOrgPluginsResponse>({
      plugins: await plugins.listOrgPluginDetails(orgId),
    });
  });

  app.get("/v1/plugins/:pluginId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const detail = await plugins.getOrgPluginDetail(
      orgId,
      decodeURIComponent(c.req.param("pluginId"))
    );
    if (!detail) {
      throw new NakamaApiError("Not found", 404);
    }
    return json<OrgPluginDetail>(detail);
  });

  app.post("/v1/plugins/:pluginId/install", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const body = await readJson<InstallOrgPluginRequest>(c.req.raw);
    try {
      const install = await plugins.addOrgPlugin(
        orgId,
        decodeURIComponent(c.req.param("pluginId")),
        body.version
      );
      const detail = await plugins.getOrgPluginDetail(orgId, install.pluginId);
      return json<OrgPluginDetail>(detail!);
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.post("/v1/plugins/:pluginId/enable", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const body = await readJson<PluginRevisionRequest>(c.req.raw);
    try {
      const install = await plugins.enableOrgPlugin(
        orgId,
        decodeURIComponent(c.req.param("pluginId")),
        body.expectedRevision,
        pluginActor(auth)
      );
      const detail = await plugins.getOrgPluginDetail(orgId, install.pluginId);
      return json<OrgPluginDetail>(detail!);
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.post("/v1/plugins/:pluginId/disable", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const body = await readJson<PluginRevisionRequest>(c.req.raw);
    try {
      const install = await plugins.disableOrgPlugin(
        orgId,
        decodeURIComponent(c.req.param("pluginId")),
        body.expectedRevision,
        pluginActor(auth)
      );
      const detail = await plugins.getOrgPluginDetail(orgId, install.pluginId);
      return json<OrgPluginDetail>(detail!);
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.get("/v1/plugins/:pluginId/update/preview", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const pluginId = decodeURIComponent(c.req.param("pluginId"));
    const targetVersion = c.req.query("targetVersion")?.trim();
    if (!targetVersion) {
      throw new NakamaApiError("targetVersion is required", 400);
    }
    try {
      const install = await plugins.getOrgPluginDetail(orgId, pluginId);
      const preview = await plugins.previewPluginContributionChanges(
        orgId,
        pluginId,
        targetVersion
      );
      return json<PluginContributionChangePreview>({
        ...preview,
        lastLifecycleError: install?.lastLifecycleError ?? null,
      });
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.post("/v1/plugins/:pluginId/update", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const body = await readJson<UpdateOrgPluginRequest>(c.req.raw);
    try {
      const install = await plugins.updateOrgPlugin(
        orgId,
        decodeURIComponent(c.req.param("pluginId")),
        body.targetVersion,
        body.expectedRevision,
        pluginActor(auth)
      );
      const detail = await plugins.getOrgPluginDetail(orgId, install.pluginId);
      return json<OrgPluginDetail>(detail!);
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.post("/v1/plugins/:pluginId/uninstall", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const body = await readJson<PluginRevisionRequest>(c.req.raw);
    try {
      const install = await plugins.uninstallOrgPlugin(
        orgId,
        decodeURIComponent(c.req.param("pluginId")),
        body.expectedRevision
      );
      const detail = await plugins.getOrgPluginDetail(orgId, install.pluginId);
      return json<OrgPluginDetail>(detail!);
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.post("/v1/plugins/:pluginId/retained-data/delete", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const pluginId = decodeURIComponent(c.req.param("pluginId"));
    const body = await readJson<DeleteRetainedPluginDataRequest>(c.req.raw);
    if (
      body.confirm !== true ||
      body.orgId !== orgId ||
      body.pluginId !== pluginId
    ) {
      throw new NakamaApiError("Confirmation does not match", 400);
    }
    try {
      await plugins.deleteRetainedPluginData(
        orgId,
        pluginId,
        body.expectedRevision
      );
      return new Response(null, { status: 204 });
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.post("/v1/plugins/:pluginId/actions/:actionKey", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const body = await readJson<InvokePluginActionRequest>(c.req.raw);
    try {
      const invoked = await plugins.invokePluginAction({
        access: "ui",
        actionKey: decodeURIComponent(c.req.param("actionKey")),
        actor: pluginActor(auth),
        input: body.input ?? {},
        orgId,
        pluginId: decodeURIComponent(c.req.param("pluginId")),
      });
      return json<InvokePluginActionResponse>(invoked);
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.get("/v1/plugins/ui/:orgId/:pluginId/*", async (c) =>
    servePluginUi(c, options)
  );

  app.get("/v1/plugins/ui/:orgId/:pluginId", async (c) =>
    servePluginUi(c, options)
  );
}

async function servePluginUi(c: Context<AppEnv>, options: ServerOptions) {
  requireNotViewerFromContext(c);
  const orgId = requireActiveOrgIdFromContext(c);
  const pathOrgId = decodeURIComponent(c.req.param("orgId"));
  if (pathOrgId !== orgId) {
    throw new NakamaApiError("Organization context conflict", 400);
  }

  const plugins = requirePluginService(options);
  const pluginId = decodeURIComponent(c.req.param("pluginId"));
  const assetPath = pluginUiAssetPath(c.req.path, orgId, pluginId);
  if (assetPath === PLUGIN_UI_BOOTSTRAP_PATH) {
    const theme = parseTheme(c.req.query("theme"));
    const bootstrap = await plugins.getEnabledUiBootstrap(
      orgId,
      pluginId,
      theme
    );
    if (!bootstrap) {
      throw new NakamaApiError("Not found", 404);
    }
    return json<PluginUiBootstrap>(bootstrap);
  }

  const asset = await plugins.resolveEnabledUiAsset(orgId, pluginId, assetPath);
  if (!asset) {
    throw new NakamaApiError("Not found", 404);
  }

  const file = Bun.file(asset.path);
  return new Response(file, {
    headers: { "Content-Type": contentTypeFor(asset.path, asset.isDocument) },
  });
}

function requirePluginService(options: ServerOptions): PluginService {
  if (!options.pluginService) {
    throw new NakamaApiError("Plugin service not configured", 500);
  }
  return options.pluginService;
}

function pluginActor(
  auth: ReturnType<typeof getRequestAuth>
): PluginExecutionActor {
  const role = auth.orgRole;
  return {
    id: auth.user.id,
    role:
      role === "admin" || role === "member" || role === "viewer"
        ? role
        : "viewer",
  };
}

async function readPluginArchive(request: Request): Promise<{
  archive: Uint8Array;
  expectedDigest?: string;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") ?? form.get("data");
    const digestValue = form.get("expectedDigest");
    const expectedDigest =
      typeof digestValue === "string" ? digestValue : undefined;
    if (file instanceof File) {
      return {
        archive: new Uint8Array(await file.arrayBuffer()),
        expectedDigest,
      };
    }
    if (typeof file === "string" && file.trim()) {
      return {
        archive: Buffer.from(file.trim(), "base64"),
        expectedDigest,
      };
    }
    throw new NakamaApiError("Plugin archive is required.", 400);
  }

  const body = await readJson<InstallPluginPackageRequest>(request);
  if (!body.data?.trim()) {
    throw new NakamaApiError("Plugin archive is required.", 400);
  }
  return {
    archive: Buffer.from(body.data.trim(), "base64"),
    expectedDigest: body.expectedDigest,
  };
}

function pluginUiAssetPath(
  requestPath: string,
  orgId: string,
  pluginId: string
): string {
  const prefix = `/v1/plugins/ui/${orgId}/${pluginId}`;
  if (requestPath === prefix || requestPath === `${prefix}/`) {
    return "";
  }
  if (!requestPath.startsWith(`${prefix}/`)) {
    return "";
  }
  try {
    return decodeURIComponent(requestPath.slice(prefix.length + 1));
  } catch {
    return requestPath.slice(prefix.length + 1);
  }
}

function parseTheme(value: string | undefined): "dark" | "light" {
  return value === "dark" ? "dark" : "light";
}

function contentTypeFor(filePath: string, isDocument: boolean): string {
  if (isDocument) {
    return "text/html; charset=utf-8";
  }
  const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
  return UI_MIME_TYPES[extension] ?? "application/octet-stream";
}

function throwPluginHttpError(error: unknown): never {
  if (error instanceof PluginPackageError) {
    throw new NakamaApiError(error.code, statusForPackageError(error.code));
  }
  if (error instanceof PluginLifecycleError) {
    throw new NakamaApiError(error.code, statusForLifecycleError(error.code));
  }
  if (error instanceof PluginInvocationError) {
    throw new NakamaApiError(error.code, statusForInvocationError(error.code));
  }
  throw error;
}

function statusForPackageError(code: PluginPackageError["code"]): number {
  if (code === "archive_too_large" || code === "expansion_limit") {
    return 413;
  }
  if (code === "version_conflict") {
    return 409;
  }
  return 400;
}

function statusForLifecycleError(code: PluginLifecycleError["code"]): number {
  if (code === "not_found" || code === "package_unavailable") {
    return 404;
  }
  if (code === "interrupted") {
    return 503;
  }
  return 409;
}

function statusForInvocationError(code: PluginInvocationError["code"]): number {
  if (code === "forbidden") {
    return 403;
  }
  if (code === "unknown_action" || code === "unknown_hook") {
    return 404;
  }
  if (code === "busy") {
    return 429;
  }
  if (code === "invalid_input" || code === "invalid_entry") {
    return 400;
  }
  return 409;
}
