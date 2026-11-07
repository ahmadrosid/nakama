import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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

export async function assertNotLinkLocal(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, "");

  const addresses = isIP(bare)
    ? [bare]
    : (await lookup(bare, { all: true })).map((record) => record.address);

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
  await assertNotLinkLocal(url.hostname);

  return fetch(input, init);
}
