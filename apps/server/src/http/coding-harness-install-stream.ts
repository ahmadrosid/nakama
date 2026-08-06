import { formatServerError } from "@nakama/core";
import type { AgentBrowserInstallEvent, CodingHarnessInstallEvent } from "@nakama/core";

const INSTALL_STREAM_TIMEOUT_MS = 120_000;

export function streamInstallEvents<TEvent extends { type: string }>(
  executor: (send: (event: TEvent) => void) => Promise<void>,
  options: {
    timeoutMessage?: string;
  } = {},
): Response {
  const encoder = new TextEncoder();
  const keepaliveIntervalMs = 4_000;
  const timeoutMessage =
    options.timeoutMessage ??
    `Install timed out after ${Math.round(INSTALL_STREAM_TIMEOUT_MS / 1000)}s waiting for the installer.`;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: TEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(keepalive);
        }
      }, keepaliveIntervalMs);

      const timeoutId = setTimeout(() => {
        send({
          type: "error",
          error: timeoutMessage,
        } as TEvent);
        clearInterval(keepalive);
        controller.close();
      }, INSTALL_STREAM_TIMEOUT_MS);

      try {
        await executor(send);
      } catch (error) {
        send({
          type: "error",
          error: formatServerError(error),
        } as TEvent);
      } finally {
        clearTimeout(timeoutId);
        clearInterval(keepalive);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export function streamCodingHarnessInstall(
  executor: (send: (event: CodingHarnessInstallEvent) => void) => Promise<void>,
  options: {
    timeoutMessage?: string;
  } = {},
): Response {
  return streamInstallEvents<CodingHarnessInstallEvent>(executor, options);
}

export function streamAgentBrowserInstall(
  executor: (send: (event: AgentBrowserInstallEvent) => void) => Promise<void>,
  options: {
    timeoutMessage?: string;
  } = {},
): Response {
  return streamInstallEvents<AgentBrowserInstallEvent>(executor, options);
}
