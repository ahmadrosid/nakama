import { createRoute, z } from "@hono/zod-openapi";
import {
  type DeleteRetainedPluginDataRequest,
  type InstallOrgPluginRequest,
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
  PluginHostError,
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
  app.get("/v1/plugins/official", async (c) => {
    requireNotViewerFromContext(c);
    return json({
      plugins: await requirePluginService(options).listOfficialPlugins(),
    });
  });
  app.post("/v1/plugins/official/:pluginId/install", async (c) => {
    const auth = requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    try {
      const install = await requirePluginService(options).installOfficialPlugin(
        orgId,
        c.req.param("pluginId"),
        { id: auth.user.id, role: "admin" }
      );
      return json({ install });
    } catch (error) {
      throwPluginHttpError(error);
    }
  });
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
  const packageRequestSchema = z
    .object({
      packageName: z.string().min(1).max(214),
      version: z.string().min(1).max(128),
    })
    .strict()
    .openapi("PluginPackageRequest");
  const installRequestSchema = packageRequestSchema
    .extend({
      expectedDigest: z.string().regex(/^[a-f0-9]{64}$/),
      expectedIntegrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/),
    })
    .openapi("InstallPluginPackageRequest");
  const openapiBag = (name: string) => z.object({}).passthrough().openapi(name);
  const previewResponseSchema = openapiBag("PluginPackagePreviewResponse");
  const installResponseSchema = openapiBag("InstallPluginPackageResponse");
  const listReleasesSchema = openapiBag("ListPluginReleasesResponse");
  const listOrgPluginsSchema = openapiBag("ListOrgPluginsResponse");
  const orgPluginSchema = openapiBag("OrgPluginDetail");
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
  const contributionPreviewSchema = openapiBag(
    "PluginContributionChangePreview"
  );
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
  const invokeResponseSchema = openapiBag("InvokePluginActionResponse");
  const errorResponse = {
    content: { "application/json": { schema: errorSchema } },
    description: "Error",
  };

  function pluginPath(spec: {
    extra?: Record<string, typeof errorResponse | { description: string }>;
    method: "delete" | "get" | "post";
    ok?: {
      content?: Record<string, { schema: z.ZodTypeAny }>;
      description: string;
      status?: 200 | 204;
    };
    operationId: string;
    path: string;
    request?: {
      body?: z.ZodTypeAny;
      params?: z.ZodTypeAny;
      query?: z.ZodTypeAny;
    };
    summary: string;
    tags: string[];
  }) {
    const okStatus = spec.ok?.status ?? 200;
    app.openAPIRegistry.registerPath(
      createRoute({
        method: spec.method,
        operationId: spec.operationId,
        path: spec.path,
        request: spec.request
          ? {
              ...(spec.request.body
                ? {
                    body: {
                      content: {
                        "application/json": { schema: spec.request.body },
                      },
                      required: true,
                    },
                  }
                : {}),
              ...(spec.request.params ? { params: spec.request.params } : {}),
              ...(spec.request.query ? { query: spec.request.query } : {}),
            }
          : undefined,
        responses: {
          ...(spec.ok
            ? {
                [okStatus]: spec.ok.content
                  ? {
                      content: spec.ok.content,
                      description: spec.ok.description,
                    }
                  : { description: spec.ok.description },
              }
            : {}),
          ...spec.extra,
        },
        summary: spec.summary,
        tags: spec.tags,
      })
    );
  }

  const jsonOk = (schema: z.ZodTypeAny, description: string) => ({
    content: { "application/json": { schema } },
    description,
    status: 200 as const,
  });
  const platform = ["Platform", "Plugins"] as string[];
  const plugins = ["Plugins"];

  pluginPath({
    extra: { 400: errorResponse, 403: errorResponse },
    method: "post",
    ok: jsonOk(previewResponseSchema, "Plugin package preview"),
    operationId: "previewPluginPackage",
    path: "/v1/platform/plugins/releases/preview",
    request: { body: packageRequestSchema },
    summary: "Inspect an npm plugin package without executing it",
    tags: platform,
  });
  pluginPath({
    extra: { 403: errorResponse },
    method: "post",
    ok: jsonOk(installResponseSchema, "Installed plugin release"),
    operationId: "installPluginPackage",
    path: "/v1/platform/plugins/releases",
    request: { body: installRequestSchema },
    summary: "Install an npm plugin package without executing it",
    tags: platform,
  });
  pluginPath({
    extra: { 403: errorResponse },
    method: "get",
    ok: jsonOk(listReleasesSchema, "Approved plugin releases"),
    operationId: "listPluginReleases",
    path: "/v1/platform/plugins/releases",
    summary: "List approved plugin releases",
    tags: platform,
  });
  pluginPath({
    extra: { 403: errorResponse, 409: errorResponse },
    method: "delete",
    ok: { description: "Release removed", status: 204 },
    operationId: "removePluginRelease",
    path: "/v1/platform/plugins/releases/{pluginId}/{version}",
    request: { params: pluginVersionParams },
    summary: "Remove a plugin release that no installation depends on",
    tags: platform,
  });
  pluginPath({
    method: "get",
    ok: jsonOk(listOrgPluginsSchema, "Organization plugin catalog"),
    operationId: "listOrgPlugins",
    path: "/v1/plugins",
    summary: "List plugins available to the active organization",
    tags: plugins,
  });
  pluginPath({
    extra: { 404: errorResponse },
    method: "get",
    ok: jsonOk(orgPluginSchema, "Organization plugin detail"),
    operationId: "getOrgPlugin",
    path: "/v1/plugins/{pluginId}",
    request: { params: pluginIdParam },
    summary: "Get one organization plugin",
    tags: plugins,
  });
  pluginPath({
    extra: { 403: errorResponse },
    method: "post",
    ok: jsonOk(orgPluginSchema, "Organization plugin added"),
    operationId: "installOrgPlugin",
    path: "/v1/plugins/{pluginId}/install",
    request: { body: installOrgRequestSchema, params: pluginIdParam },
    summary: "Add an approved release to the active organization",
    tags: plugins,
  });
  pluginPath({
    extra: { 403: errorResponse },
    method: "post",
    ok: jsonOk(orgPluginSchema, "Plugin enabled"),
    operationId: "enableOrgPlugin",
    path: "/v1/plugins/{pluginId}/enable",
    request: { body: revisionRequestSchema, params: pluginIdParam },
    summary: "Enable an organization plugin",
    tags: plugins,
  });
  pluginPath({
    extra: { 403: errorResponse },
    method: "post",
    ok: jsonOk(orgPluginSchema, "Plugin disabled"),
    operationId: "disableOrgPlugin",
    path: "/v1/plugins/{pluginId}/disable",
    request: { body: revisionRequestSchema, params: pluginIdParam },
    summary: "Disable an organization plugin",
    tags: plugins,
  });
  pluginPath({
    extra: { 403: errorResponse },
    method: "get",
    ok: jsonOk(contributionPreviewSchema, "Update contribution preview"),
    operationId: "previewOrgPluginUpdate",
    path: "/v1/plugins/{pluginId}/update/preview",
    request: {
      params: pluginIdParam,
      query: z.object({ targetVersion: z.string() }),
    },
    summary: "Preview contribution removals for an update",
    tags: plugins,
  });
  pluginPath({
    extra: { 403: errorResponse },
    method: "post",
    ok: jsonOk(orgPluginSchema, "Plugin updated"),
    operationId: "updateOrgPlugin",
    path: "/v1/plugins/{pluginId}/update",
    request: { body: updateRequestSchema, params: pluginIdParam },
    summary: "Update a disabled organization plugin to another release",
    tags: plugins,
  });
  pluginPath({
    extra: { 403: errorResponse },
    method: "post",
    ok: jsonOk(orgPluginSchema, "Plugin uninstalled"),
    operationId: "uninstallOrgPlugin",
    path: "/v1/plugins/{pluginId}/uninstall",
    request: { body: revisionRequestSchema, params: pluginIdParam },
    summary: "Uninstall an organization plugin and retain its data",
    tags: plugins,
  });
  pluginPath({
    extra: { 403: errorResponse },
    method: "post",
    ok: { description: "Retained data deleted", status: 204 },
    operationId: "deleteRetainedPluginData",
    path: "/v1/plugins/{pluginId}/retained-data/delete",
    request: { body: deleteRetainedSchema, params: pluginIdParam },
    summary: "Delete retained plugin data after confirmation",
    tags: plugins,
  });
  pluginPath({
    extra: { 403: errorResponse, 404: errorResponse },
    method: "post",
    ok: jsonOk(invokeResponseSchema, "Action result"),
    operationId: "invokePluginAction",
    path: "/v1/plugins/{pluginId}/actions/{actionKey}",
    request: { body: invokeRequestSchema, params: pluginActionParams },
    summary: "Invoke a declared plugin UI action",
    tags: plugins,
  });
  pluginPath({
    extra: { 404: errorResponse },
    method: "get",
    ok: { description: "Plugin UI document or asset" },
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
    summary: "Serve a file from the enabled plugin UI directory",
    tags: plugins,
  });

  app.post("/v1/platform/plugins/releases/preview", async (c) => {
    requirePlatformAdminFromContext(c);
    const plugins = requirePluginService(options);
    const parsed = packageRequestSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw new NakamaApiError(
        "Package name and exact version are required.",
        400
      );
    }
    try {
      const preview = await plugins.previewPluginPackage(parsed.data);
      return json<PluginPackagePreviewResponse>(preview);
    } catch (error) {
      throwPluginHttpError(error);
    }
  });

  app.post("/v1/platform/plugins/releases", async (c) => {
    requirePlatformAdminFromContext(c);
    const plugins = requirePluginService(options);
    const parsed = installRequestSchema.safeParse(await readJson(c.req.raw));
    if (!parsed.success) {
      throw new NakamaApiError("Preview approval is required.", 400);
    }
    try {
      const installed = await plugins.installPluginPackage(
        parsed.data,
        parsed.data
      );
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
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const body = await readJson<PluginRevisionRequest>(c.req.raw);
    try {
      const install = await plugins.enableOrgPlugin(
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

  app.post("/v1/plugins/:pluginId/disable", async (c) => {
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const body = await readJson<PluginRevisionRequest>(c.req.raw);
    try {
      const install = await plugins.disableOrgPlugin(
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
    requireOrgAdminOrPlatformAdminFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const plugins = requirePluginService(options);
    const body = await readJson<UpdateOrgPluginRequest>(c.req.raw);
    try {
      const install = await plugins.updateOrgPlugin(
        orgId,
        decodeURIComponent(c.req.param("pluginId")),
        body.targetVersion,
        body.expectedRevision
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

  if (assetPath === "" && !c.req.path.endsWith("/")) {
    const url = new URL(c.req.url);
    return c.redirect(`${url.pathname}/${url.search}`, 302);
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

const PLUGIN_ERROR_STATUS: Record<string, number> = {
  archive_too_large: 413,
  busy: 429,
  digest_mismatch: 400,
  duplicate_entry: 400,
  expansion_limit: 413,
  forbidden: 403,
  interrupted: 503,
  invalid_archive: 400,
  invalid_package: 400,
  invalid_entry: 400,
  invalid_input: 400,
  invalid_manifest: 400,
  missing_manifest: 400,
  missing_referenced_file: 400,
  not_found: 404,
  package_unavailable: 404,
  unknown_action: 404,
  unknown_hook: 404,
  unsafe_path: 400,
  unsupported_entry: 400,
};

function throwPluginHttpError(error: unknown): never {
  if (error instanceof PluginHostError) {
    throw new NakamaApiError(
      error.code,
      PLUGIN_ERROR_STATUS[error.code] ?? 409
    );
  }
  throw error;
}
