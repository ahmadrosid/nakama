import type {
  RemoteChatSession,
  SendMessageArg,
  StreamHandlers,
} from "@nakama/client";

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export async function sendStreamCancellable(
  session: RemoteChatSession,
  input: SendMessageArg,
  handlers: StreamHandlers,
  options?: { signal?: AbortSignal },
): Promise<{ aborted: boolean }> {
  try {
    await session.sendStream(input, handlers, options);
    return { aborted: false };
  } catch (error) {
    if (isAbortError(error)) {
      return { aborted: true };
    }

    throw error;
  }
}
