export type Connection = { url: string; token: string };
type Transport = (url: string, init: RequestInit) => Promise<Response>;

export function normalizeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid server URL");
  }
  const host = url.hostname;
  const octets = host.split(".").map(Number);
  const privateHost =
    host === "localhost" ||
    host === "[::1]" ||
    (octets.length === 4 &&
      octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
      (octets[0] === 127 ||
        octets[0] === 10 ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31)));
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(url.protocol === "https:" || (url.protocol === "http:" && privateHost))
  ) {
    throw new Error(
      "Use HTTPS, or HTTP on a private IP or localhost; omit credentials, query and fragment"
    );
  }
  return url.toString().replace(/\/+$/, "");
}

export class SupermemoryError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export class SupermemoryClient {
  constructor(
    private readonly connection: Connection,
    private readonly transport: Transport = fetch
  ) {}

  async request(
    method: string,
    path: string,
    body?: unknown
  ): Promise<Record<string, unknown>> {
    const signal = AbortSignal.timeout(10_000);
    try {
      const response = await this.transport(this.connection.url + path, {
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${this.connection.token}`,
          "Content-Type": "application/json",
        },
        method,
        redirect: "error",
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        const message =
          response.status === 401 || response.status === 403
            ? "Supermemory authentication failed"
            : response.status === 429
              ? "Supermemory rate limit; try later"
              : "Supermemory request failed";
        throw new SupermemoryError(response.status, message);
      }
      if (response.status === 204) {
        return {};
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Missing response");
      }
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          size += value.byteLength;
          if (size > 2_097_152) {
            throw new Error("Oversized response");
          }
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      const result: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      );
      if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new Error("Invalid response");
      }
      return result as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SupermemoryError) {
        throw error;
      }
      throw new SupermemoryError(
        0,
        signal.aborted
          ? "Supermemory request timed out"
          : "Supermemory unavailable or invalid response"
      );
    }
  }
}
