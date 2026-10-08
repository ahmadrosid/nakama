type TestFetchHandler = (
  ...args: Parameters<typeof fetch>
) => ReturnType<typeof fetch>;

export function asTestFetch<Fetch extends TestFetchHandler>(
  fetchMock: Fetch
): Fetch {
  return fetchMock;
}

export function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });
}
