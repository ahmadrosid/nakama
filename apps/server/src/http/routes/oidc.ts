import { NakamaApiError, resolveWebPublicUrl } from "@nakama/core";
import {
  resolveRequestClientOrigin,
  resolveRequestSelfOrigin,
} from "../../services/composio-callback-url";
import { OIDC_CALLBACK_PATH } from "../../services/oidc-service";
import type { ServerOptions } from "../context";
import {
  buildCookie,
  createBrowserSessionResponse,
  getRequestTokenFromCookies,
  isSecureRequest,
  oauthResultPage,
} from "../shared";
import type { HonoApp } from "../types";

/**
 * Binds the provider round trip to the browser that started it. Without it, a
 * callback URL carrying the attacker's own code and state signs a victim into
 * the attacker's account (login CSRF). Lax still rides the provider's top-level
 * GET redirect back to us.
 */
const STATE_COOKIE = "nakama_oidc_state";

const STATE_COOKIE_MAX_AGE_SECONDS = 10 * 60;

function stateCookie(request: Request, value: string, maxAge: number): string {
  return buildCookie(STATE_COOKIE, value, {
    httpOnly: true,
    maxAge,
    path: "/v1/auth/oidc",
    sameSite: "Lax",
    secure: isSecureRequest(request),
  });
}

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

/**
 * Our own errors are written for the person signing in. Anything else can
 * carry provider response bodies or internal URLs, so it goes to the log.
 */
async function orFailurePage(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NakamaApiError) {
      return oidcErrorPage(error.message, error.status);
    }

    console.error("[oidc] sign-in failed:", error);

    return oidcErrorPage(
      "Sign-in could not be completed. Try again or contact an admin.",
      502
    );
  }
}

export function registerOidcAuthRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { authService, databaseAdapter, oidcService, orgService } = options;

  if (!(oidcService && authService && databaseAdapter && orgService)) {
    return;
  }

  // Both legs carry one-time values in the URL; no cache may keep them.
  app.use("/v1/auth/oidc/*", async (c, next) => {
    await next();
    c.res.headers.set("Cache-Control", "no-store");
  });

  app.get("/v1/auth/oidc/start", (c) =>
    orFailurePage(async () => {
      const webOrigin = resolveOidcWebOrigin(c.req.raw);
      const url = await oidcService.beginLogin(webOrigin);
      const state = new URL(url).searchParams.get("state") ?? "";

      const response = c.redirect(url);
      response.headers.append(
        "Set-Cookie",
        stateCookie(c.req.raw, state, STATE_COOKIE_MAX_AGE_SECONDS)
      );

      return response;
    })
  );

  const handleCallback = async (request: Request): Promise<Response> => {
    const query = new URL(request.url).searchParams;
    const providerError = query.get("error");

    if (providerError) {
      console.warn(
        `[oidc] provider refused sign-in: ${providerError.slice(0, 100)}`
      );

      return oidcErrorPage("The provider did not complete the sign-in.", 401);
    }

    const code = query.get("code");
    const state = query.get("state");

    if (!(code && state)) {
      return oidcErrorPage("The provider response is missing code or state.");
    }

    if (getRequestTokenFromCookies(request, STATE_COOKIE) !== state) {
      return oidcErrorPage(
        "This sign-in was not started in this browser. Start again."
      );
    }

    return orFailurePage(async () => {
      const { user, webOrigin } = await oidcService.completeLogin({
        code,
        state,
      });

      const activeOrgId = await orgService.resolveActiveOrgId(user.id);

      const session = await createBrowserSessionResponse(
        authService,
        databaseAdapter,
        user,
        { activeOrgId, request }
      );

      const headers = new Headers(session.headers);
      headers.set("Location", `${webOrigin}/`);

      return new Response(null, { headers, status: 302 });
    });
  };

  app.get(OIDC_CALLBACK_PATH, async (c) => {
    const response = await handleCallback(c.req.raw);
    response.headers.append("Set-Cookie", stateCookie(c.req.raw, "", 0));

    return response;
  });
}
