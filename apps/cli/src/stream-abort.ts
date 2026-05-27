import type {
  RemoteChatSession,
  SendMessageArg,
  StreamHandlers,
} from "@tinyclaw/client";

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

interface StreamAbortWatcher {
  dispose(): void;
}

function createStreamAbortWatcher(onAbort: () => void): StreamAbortWatcher {
  if (!process.stdin.isTTY) {
    return { dispose() {} };
  }

  const stdin = process.stdin;
  let disposed = false;

  function onData(chunk: Buffer | string) {
    if (String(chunk) === "\u001b") {
      onAbort();
    }
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.on("data", onData);

  return {
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    },
  };
}

export async function sendStreamCancellable(
  session: RemoteChatSession,
  input: SendMessageArg,
  handlers: StreamHandlers,
): Promise<{ aborted: boolean }> {
  const abortController = new AbortController();
  const watcher = createStreamAbortWatcher(() => {
    abortController.abort();
  });

  try {
    await session.sendStream(input, handlers, { signal: abortController.signal });
    return { aborted: false };
  } catch (error) {
    if (isAbortError(error)) {
      return { aborted: true };
    }

    throw error;
  } finally {
    watcher.dispose();
  }
}
