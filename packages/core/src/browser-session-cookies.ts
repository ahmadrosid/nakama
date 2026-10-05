/**
 * Names of the browser session cookies shared by the server, the web client
 * and the CLI.
 *
 * HTTPS deployments use the `__Host-` prefixed pair. A browser only accepts
 * those cookies when they are Secure, Path=/ and carry no Domain attribute, so
 * they stay bound to the exact host: a sibling host under the same parent
 * domain can neither set nor overwrite them, which is what made an unprefixed
 * `nakama_session` a session-fixation vector (#1345).
 *
 * Plain HTTP keeps the unprefixed pair because browsers discard Secure cookies
 * on http:// origins. Both server and client derive the pair from the scheme of
 * the request they are on, so a deployment on either scheme stays consistent.
 */
export interface BrowserSessionCookieNames {
  csrf: string;
  session: string;
}

export const PLAIN_BROWSER_SESSION_COOKIE_NAMES: BrowserSessionCookieNames = {
  csrf: "nakama_csrf",
  session: "nakama_session",
};

export const HOST_BOUND_BROWSER_SESSION_COOKIE_NAMES: BrowserSessionCookieNames =
  {
    csrf: "__Host-nakama_csrf",
    session: "__Host-nakama_session",
  };

export function browserSessionCookieNames(
  secure: boolean
): BrowserSessionCookieNames {
  return secure
    ? HOST_BOUND_BROWSER_SESSION_COOKIE_NAMES
    : PLAIN_BROWSER_SESSION_COOKIE_NAMES;
}
