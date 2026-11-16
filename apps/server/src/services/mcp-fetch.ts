import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const DNS_TIMEOUT_MS = 5000;

/**
 * 169.254.0.0/16 and fe80::/10 hold the cloud metadata endpoints, which no MCP
 * server lives on. Loopback and private ranges stay reachable: local MCP
 * servers and mesh addresses are normal setups.
 */
function isLinkLocal(address: string): boolean {
  const v4 = address.replace(/^::ffff:/i, "");

  if (isIP(v4) === 4) {
    return v4.startsWith("169.254.");
  }

  return /^fe[89ab][0-9a-f]:/i.test(address);
}

export async function assertNotLinkLocal(
  hostname: string,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  const bare = hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];

  if (isIP(bare)) {
    addresses = [bare];
  } else {
    const deadline = AbortSignal.timeout(DNS_TIMEOUT_MS);
    const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;
    stop.throwIfAborted();
    const result = Promise.withResolvers<LookupAddress[]>();
    const onAbort = () => result.reject(stop.reason);
    stop.addEventListener("abort", onAbort, { once: true });

    try {
      // The OS lookup can finish later; only this wait is cancellable.
      lookup(bare, { all: true }).then(result.resolve, result.reject);
      addresses = (await result.promise).map((record) => record.address);
    } finally {
      stop.removeEventListener("abort", onAbort);
    }
  }

  if (addresses.some(isLinkLocal)) {
    throw new Error(
      `MCP server ${hostname} resolves to a link-local address, which is not allowed.`
    );
  }
}

/** `fetch` for MCP HTTP transports and OAuth discovery. */
export async function fetchMcpRemote(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input);

  const signal =
    init?.signal === undefined && input instanceof Request
      ? input.signal
      : (init?.signal ?? undefined);

  await assertNotLinkLocal(url.hostname, signal);
  signal?.throwIfAborted();

  return fetch(input, init);
}
