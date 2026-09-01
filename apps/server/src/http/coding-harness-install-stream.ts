import { type AgentBrowserInstallEvent, formatServerError } from "@nakama/core";

const INSTALL_STREAM_TIMEOUT_MS = 120_000;

type InstallStreamErrorEvent = { type: "error"; error: string };

type InstallStreamOptions = {
  timeoutMessage?: string;
  timeoutMs?: number;
};

export function streamInstallEvents<TEvent extends { type: string }>(
  executor: (send: (event: TEvent) => void) => Promise<void>,
  options: InstallStreamOptions = {}
): Response {
  const encoder = new TextEncoder();
  const keepaliveIntervalMs = 4000;
  const timeoutMs = options.timeoutMs ?? INSTALL_STREAM_TIMEOUT_MS;
  const timeoutMessage =
    options.timeoutMessage ??
    `Install timed out after ${Math.round(timeoutMs / 1000)}s waiting for the installer.`;

  let terminated = false;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = () => {
    clearInterval(keepalive);
    clearTimeout(timeoutId);
  };

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      terminated = true;
      clearTimers();
    },
    async start(controller) {
      const send = (event: TEvent) => {
        if (terminated) {
          return;
        }
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };

      const finish = () => {
        clearTimers();

        if (terminated) {
          return;
        }

        terminated = true;
        controller.close();
      };

      keepalive = setInterval(() => {
        if (terminated) {
          clearTimers();
          return;
        }
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, keepaliveIntervalMs);

      timeoutId = setTimeout(() => {
        send({
          error: timeoutMessage,
          type: "error",
        } as Extract<TEvent, InstallStreamErrorEvent>);
        finish();
      }, timeoutMs);

      try {
        await executor(send);
      } catch (error) {
        send({
          error: formatServerError(error),
          type: "error",
        } as Extract<TEvent, InstallStreamErrorEvent>);
      } finally {
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}

export function streamAgentBrowserInstall(
  executor: (send: (event: AgentBrowserInstallEvent) => void) => Promise<void>,
  options: InstallStreamOptions = {}
): Response {
  return streamInstallEvents<AgentBrowserInstallEvent>(executor, options);
}
