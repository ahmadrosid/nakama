/**
 * Bun.serve closes idle connections after `idleTimeout` seconds (max 255).
 * Chat SSE can sit quiet for minutes during a tool run; `: ping` comments do
 * not reliably reset that timer. Disable it per-request for SSE responses.
 *
 * Detect via the response Content-Type after the handler returns — do not
 * duplicate route knowledge on the request.
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
