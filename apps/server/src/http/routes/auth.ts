import { createRoute, z } from "@hono/zod-openapi";
import {
  LocalAuthTokenManagedExternallyError,
  rotateLocalAuthToken,
  type AcceptOrgInviteResponse,
  type AuthUserResponse,
  type ChangePasswordRequest,
  type CreateOrganizationRequest,
  type CreateOrganizationResponse,
  type ListUserOrgsResponse,
  type RotateLocalAuthTokenResponse,
  type SetActiveOrgRequest,
  type SetupAuthRequest,
  type UpdateAuthProfileRequest,
} from "@nakama/core";
import {
  persistWebPublicUrl,
  resolveRequestClientOrigin,
} from "../../services/composio-callback-url";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";
import { requirePlatformAdminFromContext } from "../org-guards";
import {
  assertBrowserCsrf,
  authenticateRequest,
  clearBrowserSessionCookies,
  createBrowserSessionResponse,
  errorResponse,
  getRequestAuth,
  json,
  readJson,
} from "../shared";

export function registerAuthRoutes(app: HonoApp, options: ServerOptions): void {
  const { authService, databaseAdapter, orgService } = options;
  const authCredentialsSchema = z.object({
    email: z.string(),
    password: z.string(),
  }).openapi("AuthCredentialsRequest");
  const authUserSchema = z.object({
    email: z.string(),
    name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    isPlatformAdmin: z.boolean().optional(),
    activeOrgId: z.string().nullable().optional(),
    orgId: z.string().nullable().optional(),
  }).openapi("AuthUserResponse");
  const updateAuthProfileSchema = z
    .object({
      name: z.string().nullable().optional(),
      email: z.string().optional(),
      phone: z.string().nullable().optional(),
    })
    .openapi("UpdateAuthProfileRequest");
  const loggedOutSchema = z.object({
    ok: z.boolean(),
  });
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");

  const setupRoute = createRoute({
    method: "post",
    path: "/v1/auth/setup",
    tags: ["Auth"],
    summary: "Create the first organization, admin account, and browser session",
    operationId: "setupAuth",
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: z
              .object({
                organization: z.object({
                  name: z.string(),
                  slug: z.string(),
                }),
                admin: z.object({
                  name: z.string(),
                  email: z.string(),
                  phone: z.string().optional(),
                  password: z.string(),
                }),
                webPublicUrl: z.string().optional(),
              })
              .openapi("SetupAuthRequest"),
          },
        },
      },
    },
    responses: {
      201: { description: "Created admin user", content: { "application/json": { schema: authUserSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  });

  const loginRoute = createRoute({
    method: "post",
    path: "/v1/auth/login",
    tags: ["Auth"],
    summary: "Log in with email and password",
    operationId: "loginAuth",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: authCredentialsSchema } },
      },
    },
    responses: {
      200: { description: "Logged in user", content: { "application/json": { schema: authUserSchema } } },
      401: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  });

  const meRoute = createRoute({
    method: "get",
    path: "/v1/auth/me",
    tags: ["Auth"],
    summary: "Get the current authenticated user",
    operationId: "getAuthMe",
    responses: {
      200: { description: "Authenticated user", content: { "application/json": { schema: authUserSchema } } },
      401: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  });

  const updateMeRoute = createRoute({
    method: "patch",
    path: "/v1/auth/me",
    tags: ["Auth"],
    summary: "Update the current user's profile",
    operationId: "updateAuthMe",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: updateAuthProfileSchema } },
      },
    },
    responses: {
      200: { description: "Updated user", content: { "application/json": { schema: authUserSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      401: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  });

  const logoutRoute = createRoute({
    method: "post",
    path: "/v1/auth/logout",
    tags: ["Auth"],
    summary: "Log out and revoke the browser session",
    operationId: "logoutAuth",
    responses: {
      200: { description: "Logged out", content: { "application/json": { schema: loggedOutSchema } } },
      401: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  });

  const acceptInviteSchema = z
    .object({
      token: z.string(),
      password: z.string().optional(),
    })
    .openapi("AcceptOrgInviteRequest");
  const acceptInviteResponseSchema = z
    .object({
      email: z.string(),
      orgId: z.string(),
      role: z.enum(["admin", "member", "viewer"]),
    })
    .openapi("AcceptOrgInviteResponse");
  const changePasswordSchema = z
    .object({
      currentPassword: z.string(),
      newPassword: z.string(),
    })
    .openapi("ChangePasswordRequest");
  const changePasswordRoute = createRoute({
    method: "post",
    path: "/v1/auth/change-password",
    tags: ["Auth"],
    summary: "Change the current user's password",
    operationId: "changePassword",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: changePasswordSchema } },
      },
    },
    responses: {
      200: { description: "Password changed", content: { "application/json": { schema: z.object({ ok: z.boolean() }) } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      401: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  });

  const acceptInviteRoute = createRoute({
    method: "post",
    path: "/v1/auth/accept-invite",
    tags: ["Auth"],
    summary: "Accept an organization invite and create a browser session",
    operationId: "acceptOrgInvite",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: acceptInviteSchema } },
      },
    },
    responses: {
      200: {
        description: "Invite accepted",
        content: { "application/json": { schema: acceptInviteResponseSchema } },
      },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      401: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  });

  const rotateLocalAuthTokenSchema = z
    .object({ token: z.string() })
    .openapi("RotateLocalAuthTokenResponse");

  const rotateLocalAuthTokenRoute = createRoute({
    method: "post",
    path: "/v1/auth/local-token/rotate",
    tags: ["Auth"],
    summary: "Rotate the local API token used by CLI and channel workers",
    operationId: "rotateLocalAuthToken",
    responses: {
      200: {
        description: "Rotated local auth token",
        content: { "application/json": { schema: rotateLocalAuthTokenSchema } },
      },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      401: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      403: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  });

  app.openAPIRegistry.registerPath(setupRoute);
  app.post("/v1/auth/setup", async (c) => {
    if (!authService || !databaseAdapter || !orgService) {
      return errorResponse("Authentication not configured", 500);
    }

    const humanUserCount = await databaseAdapter.countHumanUsers();
    if (humanUserCount > 0) {
      return errorResponse("Admin user already exists", 409);
    }

    const body = await readJson<SetupAuthRequest>(c.req.raw);
    const password = body.admin?.password?.trim() ?? "";
    if (
      !body.organization?.name?.trim() ||
      !body.organization?.slug?.trim() ||
      !body.admin?.name?.trim() ||
      !body.admin?.email?.trim() ||
      !password
    ) {
      return errorResponse("Organization and admin details are required.", 400);
    }

    if (password.length < 8) {
      return errorResponse("Password must be at least 8 characters.", 400);
    }

    const webPublicUrl = resolveRequestClientOrigin(c.req.raw, body.webPublicUrl);
    if (webPublicUrl) {
      try {
        await persistWebPublicUrl(webPublicUrl);
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error), 400);
      }
    }

    const { user, organization } = await orgService.bootstrapInitialSetup({
      organization: {
        name: body.organization.name,
        slug: body.organization.slug,
      },
      admin: {
        name: body.admin.name,
        email: body.admin.email,
        phone: body.admin.phone ?? "",
        passwordHash: await authService.hashPassword(password),
      },
    });

    const response = await createBrowserSessionResponse(authService, databaseAdapter, user, {
      activeOrgId: organization.id,
      request: c.req.raw,
    });
    const authBody = await orgService.buildAuthUserResponse(
      user,
      response.session.id,
      organization.id,
    );

    return json<AuthUserResponse>(authBody, 201, response.headers);
  });

  app.openAPIRegistry.registerPath(loginRoute);
  app.post("/v1/auth/login", async (c) => {
    if (!authService || !databaseAdapter || !orgService) {
      return errorResponse("Authentication not configured", 500);
    }

    const body = await readJson<{ email: string; password: string }>(c.req.raw);
    const user = await databaseAdapter.getUserByEmail(body.email);
    if (!user) {
      return errorResponse("Invalid credentials", 401);
    }

    const valid = await authService.verifyPassword(body.password, user.passwordHash);
    if (!valid) {
      return errorResponse("Invalid credentials", 401);
    }

    const response = await createBrowserSessionResponse(authService, databaseAdapter, user, {
      request: c.req.raw,
    });
    const authBody = await orgService.buildAuthUserResponse(
      user,
      response.session.id,
      response.session.activeOrgId,
    );
    return json<AuthUserResponse>(authBody, 200, response.headers);
  });

  app.openapi(meRoute, async (c) => {
    if (!authService || !databaseAdapter || !orgService) {
      return c.json({ error: "Authentication not configured" }, 500);
    }

    const auth = await authenticateRequest(c.req.raw, authService, databaseAdapter);
    if (!auth) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const user = await databaseAdapter.getUserById(auth.user.id);
    if (!user) {
      return c.json({ error: "Authentication required" }, 401);
    }

    const authBody = await orgService.buildAuthUserResponse(
      user,
      auth.session?.id,
      auth.session?.activeOrgId,
    );
    return c.json(authBody, 200);
  });

  app.openAPIRegistry.registerPath(updateMeRoute);
  app.patch("/v1/auth/me", async (c) => {
    if (!authService || !orgService) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<UpdateAuthProfileRequest>(c.req.raw);
    const updated = await orgService.updateOwnProfile(auth.user.id, body);
    return json<AuthUserResponse>(updated);
  });

  app.openapi(logoutRoute, async (c) => {
    if (!authService || !databaseAdapter) {
      return c.json({ error: "Authentication not configured" }, 500);
    }

    const auth = await authenticateRequest(c.req.raw, authService, databaseAdapter);
    if (!auth) {
      return c.json({ error: "Authentication required" }, 401);
    }

    assertBrowserCsrf(c.req.raw, auth, authService);

    if (auth.mode === "browser-session" && auth.session) {
      const revokedAt = new Date().toISOString();
      await databaseAdapter.revokeBrowserSessionBySessionTokenHash(
        auth.session.sessionTokenHash,
        revokedAt,
      );
    }

    const response = c.json({ ok: true }, 200);
    clearBrowserSessionCookies(response.headers);
    return response;
  });

  app.openAPIRegistry.registerPath(changePasswordRoute);
  app.post("/v1/auth/change-password", async (c) => {
    if (!authService || !orgService) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<ChangePasswordRequest>(c.req.raw);
    await orgService.changePassword({
      userId: auth.user.id,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });

    return json({ ok: true });
  });

  app.openAPIRegistry.registerPath(acceptInviteRoute);
  app.post("/v1/auth/accept-invite", async (c) => {
    if (!authService || !databaseAdapter || !orgService) {
      return errorResponse("Authentication not configured", 500);
    }

    const body = await readJson<{ token: string; password?: string }>(c.req.raw);
    const accepted = await orgService.acceptInvite(body);
    const response = await createBrowserSessionResponse(
      authService,
      databaseAdapter,
      accepted.user,
      { activeOrgId: accepted.orgId, request: c.req.raw },
    );

    return json<AcceptOrgInviteResponse>(
      {
        email: accepted.user.email,
        orgId: accepted.orgId,
        role: accepted.role,
      },
      200,
      response.headers,
    );
  });

  app.openAPIRegistry.registerPath(rotateLocalAuthTokenRoute);
  app.post("/v1/auth/local-token/rotate", async (c) => {
    if (!authService || !databaseAdapter) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = await authenticateRequest(c.req.raw, authService, databaseAdapter);
    if (!auth) {
      return errorResponse("Authentication required", 401);
    }

    if (auth.mode !== "browser-session") {
      return errorResponse(
        "Sign in through the dashboard to rotate the local auth token.",
        403,
      );
    }

    assertBrowserCsrf(c.req.raw, auth, authService);

    try {
      const token = await rotateLocalAuthToken();
      return json<RotateLocalAuthTokenResponse>({ token }, 200);
    } catch (error) {
      if (error instanceof LocalAuthTokenManagedExternallyError) {
        return errorResponse(error.message, 400);
      }

      throw error;
    }
  });

  app.get("/v1/auth/orgs", async (c) => {
    if (!orgService) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    const orgs = await orgService.listUserOrgs(auth.user.id);
    return json<ListUserOrgsResponse>(orgs);
  });

  app.post("/v1/auth/orgs", async (c) => {
    if (!authService || !orgService) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = requirePlatformAdminFromContext(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<CreateOrganizationRequest>(c.req.raw);
    const result = await orgService.createOrganization(body, auth.user.id);
    return json<CreateOrganizationResponse>(result, 201);
  });

  app.post("/v1/auth/active-org", async (c) => {
    if (!authService || !databaseAdapter || !orgService) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<SetActiveOrgRequest>(c.req.raw);
    await orgService.setActiveOrg({
      userId: auth.user.id,
      orgId: body.orgId,
      sessionId: auth.session?.id,
    });

    const user = await databaseAdapter.getUserById(auth.user.id);
    if (!user) {
      return errorResponse("Authentication required", 401);
    }

    const authBody = await orgService.buildAuthUserResponse(user, auth.session?.id, body.orgId);
    return json<AuthUserResponse>(authBody);
  });
}
