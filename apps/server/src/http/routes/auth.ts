import { createRoute, z } from "@hono/zod-openapi";
import {
  type AcceptOrgInviteResponse,
  type AuthUserResponse,
  type ChangePasswordRequest,
  type CreateOrganizationRequest,
  type CreateOrganizationResponse,
  type ListUserOrgsResponse,
  LocalAuthTokenManagedExternallyError,
  type RotateLocalAuthTokenResponse,
  rotateLocalAuthToken,
  type SetActiveOrgRequest,
  type SetupAuthRequest,
  type UpdateAuthProfileRequest,
} from "@nakama/core";
import {
  persistWebPublicUrl,
  resolveRequestClientOrigin,
} from "../../services/composio-callback-url";
import type { ServerOptions } from "../context";
import {
  requirePlatformAdmin,
  requirePlatformAdminFromContext,
} from "../org-guards";
import {
  assertBrowserCsrf,
  assertJsonRequest,
  authenticateRequest,
  clearBrowserSessionCookies,
  createBrowserSessionResponse,
  errorResponse,
  getRequestAuth,
  json,
  readJson,
} from "../shared";
import type { HonoApp } from "../types";

export function registerAuthRoutes(app: HonoApp, options: ServerOptions): void {
  const { authService, databaseAdapter, orgService } = options;
  const authCredentialsSchema = z
    .object({
      email: z.string(),
      password: z.string(),
    })
    .openapi("AuthCredentialsRequest");
  const authUserSchema = z
    .object({
      activeOrgId: z.string().nullable().optional(),
      email: z.string(),
      isPlatformAdmin: z.boolean().optional(),
      name: z.string().nullable().optional(),
      orgId: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
    })
    .openapi("AuthUserResponse");
  const updateAuthProfileSchema = z
    .object({
      email: z.string().optional(),
      name: z.string().nullable().optional(),
      phone: z.string().nullable().optional(),
    })
    .openapi("UpdateAuthProfileRequest");
  const loggedOutSchema = z.object({
    ok: z.boolean(),
  });
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");

  const setupRoute = createRoute({
    method: "post",
    operationId: "setupAuth",
    path: "/v1/auth/setup",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z
              .object({
                admin: z.object({
                  email: z.string(),
                  name: z.string(),
                  password: z.string(),
                  phone: z.string().optional(),
                }),
                organization: z.object({
                  name: z.string(),
                  slug: z.string(),
                }),
                webPublicUrl: z.string().optional(),
              })
              .openapi("SetupAuthRequest"),
          },
        },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: authUserSchema } },
        description: "Created admin user",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      409: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary:
      "Create the first organization, admin account, and browser session",
    tags: ["Auth"],
  });

  const loginRoute = createRoute({
    method: "post",
    operationId: "loginAuth",
    path: "/v1/auth/login",
    request: {
      body: {
        content: { "application/json": { schema: authCredentialsSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: authUserSchema } },
        description: "Logged in user",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Log in with email and password",
    tags: ["Auth"],
  });

  const meRoute = createRoute({
    method: "get",
    operationId: "getAuthMe",
    path: "/v1/auth/me",
    responses: {
      200: {
        content: { "application/json": { schema: authUserSchema } },
        description: "Authenticated user",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Get the current authenticated user",
    tags: ["Auth"],
  });

  const updateMeRoute = createRoute({
    method: "patch",
    operationId: "updateAuthMe",
    path: "/v1/auth/me",
    request: {
      body: {
        content: { "application/json": { schema: updateAuthProfileSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: authUserSchema } },
        description: "Updated user",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      409: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Update the current user's profile",
    tags: ["Auth"],
  });

  const logoutRoute = createRoute({
    method: "post",
    operationId: "logoutAuth",
    path: "/v1/auth/logout",
    responses: {
      200: {
        content: { "application/json": { schema: loggedOutSchema } },
        description: "Logged out",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Log out and revoke the browser session",
    tags: ["Auth"],
  });

  const acceptInviteSchema = z
    .object({
      password: z.string().optional(),
      token: z.string(),
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
    operationId: "changePassword",
    path: "/v1/auth/change-password",
    request: {
      body: {
        content: { "application/json": { schema: changePasswordSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": { schema: z.object({ ok: z.boolean() }) },
        },
        description: "Password changed",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Change the current user's password",
    tags: ["Auth"],
  });

  const acceptInviteRoute = createRoute({
    method: "post",
    operationId: "acceptOrgInvite",
    path: "/v1/auth/accept-invite",
    request: {
      body: {
        content: { "application/json": { schema: acceptInviteSchema } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: acceptInviteResponseSchema } },
        description: "Invite accepted",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      401: {
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
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Accept an organization invite and create a browser session",
    tags: ["Auth"],
  });

  const rotateLocalAuthTokenSchema = z
    .object({ token: z.string() })
    .openapi("RotateLocalAuthTokenResponse");

  const rotateLocalAuthTokenRoute = createRoute({
    method: "post",
    operationId: "rotateLocalAuthToken",
    path: "/v1/auth/local-token/rotate",
    responses: {
      200: {
        content: { "application/json": { schema: rotateLocalAuthTokenSchema } },
        description: "Rotated local auth token",
      },
      400: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      401: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      403: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
      500: {
        content: { "application/json": { schema: errorSchema } },
        description: "Error",
      },
    },
    summary: "Rotate the local API token used by CLI and channel workers",
    tags: ["Auth"],
  });

  app.openAPIRegistry.registerPath(setupRoute);
  app.post("/v1/auth/setup", async (c) => {
    if (!(authService && databaseAdapter && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const humanUserCount = await databaseAdapter.countHumanUsers();
    if (humanUserCount > 0) {
      return errorResponse("Admin user already exists", 409);
    }

    const body = await readJson<SetupAuthRequest>(c.req.raw);
    const password = body.admin?.password?.trim() ?? "";
    if (
      !(
        body.organization?.name?.trim() &&
        body.organization?.slug?.trim() &&
        body.admin?.name?.trim() &&
        body.admin?.email?.trim() &&
        password
      )
    ) {
      return errorResponse("Organization and admin details are required.", 400);
    }

    if (password.length < 8) {
      return errorResponse("Password must be at least 8 characters.", 400);
    }

    const webPublicUrl = resolveRequestClientOrigin(
      c.req.raw,
      body.webPublicUrl
    );
    if (webPublicUrl) {
      try {
        await persistWebPublicUrl(webPublicUrl);
      } catch (error) {
        return errorResponse(
          error instanceof Error ? error.message : String(error),
          400
        );
      }
    }

    const { user, organization } = await orgService.bootstrapInitialSetup({
      admin: {
        email: body.admin.email,
        name: body.admin.name,
        passwordHash: await authService.hashPassword(password),
        phone: body.admin.phone ?? "",
      },
      organization: {
        name: body.organization.name,
        slug: body.organization.slug,
      },
    });

    const response = await createBrowserSessionResponse(
      authService,
      databaseAdapter,
      user,
      {
        activeOrgId: organization.id,
        request: c.req.raw,
      }
    );
    const authBody = await orgService.buildAuthUserResponse(
      user,
      response.session.id,
      organization.id
    );

    return json<AuthUserResponse>(authBody, 201, response.headers);
  });

  app.openAPIRegistry.registerPath(loginRoute);
  app.post("/v1/auth/login", async (c) => {
    if (!(authService && databaseAdapter && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    assertJsonRequest(c.req.raw);

    const body = await readJson<{ email: string; password: string }>(c.req.raw);
    const user = await databaseAdapter.getUserByEmail(body.email);
    if (!user) {
      return errorResponse("Invalid credentials", 401);
    }

    // Every path that sets a password trims it first, so login has to as well
    // or a padded password can never be typed back in.
    const valid = await authService.verifyPassword(
      body.password?.trim() ?? "",
      user.passwordHash
    );
    if (!valid) {
      return errorResponse("Invalid credentials", 401);
    }

    const response = await createBrowserSessionResponse(
      authService,
      databaseAdapter,
      user,
      {
        request: c.req.raw,
      }
    );
    const authBody = await orgService.buildAuthUserResponse(
      user,
      response.session.id,
      response.session.activeOrgId
    );
    return json<AuthUserResponse>(authBody, 200, response.headers);
  });

  app.openapi(meRoute, async (c) => {
    if (!(authService && databaseAdapter && orgService)) {
      return c.json({ error: "Authentication not configured" }, 500);
    }

    const auth = await authenticateRequest(
      c.req.raw,
      authService,
      databaseAdapter
    );
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
      auth.session?.activeOrgId
    );
    return c.json(authBody, 200);
  });

  app.openAPIRegistry.registerPath(updateMeRoute);
  app.patch("/v1/auth/me", async (c) => {
    if (!(authService && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<UpdateAuthProfileRequest>(c.req.raw);
    const updated = await orgService.updateOwnProfile(auth.user.id, body);
    return json<AuthUserResponse>(updated);
  });

  app.openapi(logoutRoute, async (c) => {
    if (!(authService && databaseAdapter)) {
      return c.json({ error: "Authentication not configured" }, 500);
    }

    const auth = await authenticateRequest(
      c.req.raw,
      authService,
      databaseAdapter
    );
    if (!auth) {
      return c.json({ error: "Authentication required" }, 401);
    }

    assertBrowserCsrf(c.req.raw, auth, authService);

    if (auth.mode === "browser-session" && auth.session) {
      const revokedAt = new Date().toISOString();
      await databaseAdapter.revokeBrowserSessionBySessionTokenHash(
        auth.session.sessionTokenHash,
        revokedAt
      );
    }

    const response = c.json({ ok: true }, 200);
    clearBrowserSessionCookies(response.headers);
    return response;
  });

  app.openAPIRegistry.registerPath(changePasswordRoute);
  app.post("/v1/auth/change-password", async (c) => {
    if (!(authService && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<ChangePasswordRequest>(c.req.raw);
    await orgService.changePassword({
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
      userId: auth.user.id,
    });

    const response = c.json({ ok: true }, 200);
    clearBrowserSessionCookies(response.headers);
    return response;
  });

  app.openAPIRegistry.registerPath(acceptInviteRoute);
  app.post("/v1/auth/accept-invite", async (c) => {
    if (!(authService && databaseAdapter && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const body = await readJson<{ token: string; password?: string }>(
      c.req.raw
    );
    const accepted = await orgService.acceptInvite(body);
    const response = await createBrowserSessionResponse(
      authService,
      databaseAdapter,
      accepted.user,
      { activeOrgId: accepted.orgId, request: c.req.raw }
    );

    return json<AcceptOrgInviteResponse>(
      {
        email: accepted.user.email,
        orgId: accepted.orgId,
        role: accepted.role,
      },
      200,
      response.headers
    );
  });

  app.openAPIRegistry.registerPath(rotateLocalAuthTokenRoute);
  app.post("/v1/auth/local-token/rotate", async (c) => {
    if (!(authService && databaseAdapter)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = await authenticateRequest(
      c.req.raw,
      authService,
      databaseAdapter
    );
    if (!auth) {
      return errorResponse("Authentication required", 401);
    }

    if (auth.mode !== "browser-session") {
      return errorResponse(
        "Sign in through the dashboard to rotate the local auth token.",
        403
      );
    }

    requirePlatformAdmin(auth);
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
    if (!(authService && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = requirePlatformAdminFromContext(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<CreateOrganizationRequest>(c.req.raw);
    const result = await orgService.createOrganization(body, auth.user.id);
    return json<CreateOrganizationResponse>(result, 201);
  });

  app.post("/v1/auth/active-org", async (c) => {
    if (!(authService && databaseAdapter && orgService)) {
      return errorResponse("Authentication not configured", 500);
    }

    const auth = getRequestAuth(c);
    assertBrowserCsrf(c.req.raw, auth, authService);

    const body = await readJson<SetActiveOrgRequest>(c.req.raw);
    await orgService.setActiveOrg({
      orgId: body.orgId,
      sessionId: auth.session?.id,
      userId: auth.user.id,
    });

    const user = await databaseAdapter.getUserById(auth.user.id);
    if (!user) {
      return errorResponse("Authentication required", 401);
    }

    const authBody = await orgService.buildAuthUserResponse(
      user,
      auth.session?.id,
      body.orgId
    );
    return json<AuthUserResponse>(authBody);
  });
}
