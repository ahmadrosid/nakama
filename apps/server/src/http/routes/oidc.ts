import { NakamaApiError, resolveWebPublicUrl } from "@nakama/core";
import {
  resolveRequestClientOrigin,
  resolveRequestSelfOrigin,
} from "../../services/composio-callback-url";
import { OIDC_CALLBACK_PATH } from "../../services/oidc-service";
import type { ServerOptions } from "../context";
import { createBrowserSessionResponse, oauthResultPage } from "../shared";
import type { HonoApp } from "../types";

/**
 * The origin the SSO flow hands back to the browser. The caller's Origin or
 * Referer is taken when it vouches for itself (configured public URL, loopback
 * or a trusted-proxy host); a configured public URL or the origin the request
 * landed on covers CLI/operator calls that carry neither header. An origin we
 * cannot vouch for is refused, since it ends up in the provider redirect_uri.
 */
function resolveOidcWebOrigin(request: Request): string {
  const origin =
    resolveRequestClientOrigin(request) ??
    resolveWebPublicUrl() ??
    resolveRequestSelfOrigin(request);

  if (!origin) {
    throw new NakamaApiError(
      "Cannot determine the web origin for the OIDC redirect.",
      400
    );
  }

  return origin;
}

function oidcErrorPage(detail: string, status = 400): Response {
  return oauthResultPage(
    "Sign-in failed",
    detail,
    { href: "/login", label: "Back to sign in" },
    status
  );
}

export function registerOidcAuthRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { authService, databaseAdapter, oidcService, orgService } = options;

  if (!(oidcService && authService && databaseAdapter && orgService)) {
    return;
  }

  app.get("/v1/auth/oidc/start", async (c) => {
    try {
      const webOrigin = resolveOidcWebOrigin(c.req.raw);
      const url = await oidcService.beginLogin(webOrigin);

      return c.redirect(url);
    } catch (error) {
      return oidcErrorPage(
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  app.get(OIDC_CALLBACK_PATH, async (c) => {
    const providerError = c.req.query("error");

    if (providerError) {
      const description = c.req.query("error_description") ?? providerError;

      return oidcErrorPage(description, 401);
    }

    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!(code && state)) {
      return oidcErrorPage("The provider response is missing code or state.");
    }

    try {
      const { user, webOrigin } = await oidcService.completeLogin({
        code,
        state,
      });

      const activeOrgId = await orgService.resolveActiveOrgId(user.id);

      const response = await createBrowserSessionResponse(
        authService,
        databaseAdapter,
        user,
        { activeOrgId, request: c.req.raw }
      );

      const headers = new Headers(response.headers);
      headers.set("Location", `${webOrigin}/`);

      return new Response(null, { headers, status: 302 });
    } catch (error) {
      const status = error instanceof NakamaApiError ? error.status : 400;

      return oidcErrorPage(
        error instanceof Error ? error.message : String(error),
        status
      );
    }
  });
}
