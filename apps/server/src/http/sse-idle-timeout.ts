/**
 * Bun.serve closes idle connections after `idleTimeout` seconds (max 255).
 *
 * Chat SSE can sit quiet for minutes during a tool run; `: ping` comments do
 * not reliably reset that timer. Disable idle timeout after the handler
 * returns when Content-Type is text/event-stream.
 *
 * Automation run POSTs write no bytes until the agent finishes, so disable
 * idle timeout at request start by matching those paths.
 *
 * @see https://bun.com/docs/guides/http/sse
 */
export function isSseResponse(response: Response): boolean {
  const contentType = response.headers.get("Content-Type") ?? "";
  return contentType.startsWith("text/event-stream");
}

export function disableBunIdleTimeoutForSse(
  request: Request,
  response: Response,
  server: { timeout(request: Request, seconds: number): void }
): void {
  if (isSseResponse(response)) {
    server.timeout(request, 0);
  }
}

/**
 * Automation run POSTs hold the socket until the agent finishes and write no
 * bytes until then. Disable idle timeout at request start, not after the
 * handler returns.
 */
export function isLongHeldAutomationRunRequest(request: Request): boolean {
  if (request.method !== "POST") {
    return false;
  }

  const pathname = new URL(request.url).pathname;
  return /\/v1\/(?:internal\/)?automations\/[^/]+\/run\/?$/.test(pathname);
}

export function disableBunIdleTimeoutForLongHeldRequest(
  request: Request,
  server: { timeout(request: Request, seconds: number): void }
): void {
  if (isLongHeldAutomationRunRequest(request)) {
    server.timeout(request, 0);
  }
}
