import type {
  RemoteChatSession,
  SendMessageArg,
  StreamHandlers,
} from "@nakama/client";
import { isAbortError } from "@nakama/core/channel-active-stream";

export async function sendStreamCancellable(
  session: RemoteChatSession,
  input: SendMessageArg,
  handlers: StreamHandlers,
  options?: { signal?: AbortSignal }
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
