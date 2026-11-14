/** Nakama Desktop listens only on this computer, on a one-time port. */
const RETURN_ADDRESS = /^http:\/\/127\.0\.0\.1:\d{1,5}\/[A-Za-z0-9/_-]*$/;

export interface ConnectRequest {
  installId: string;
  name: string;
  publicKey: string;
  returnTo: string;
  state: string;
}

/** Null for a link that did not come from Nakama Desktop on this computer. */
export function parseConnectRequest(
  params: URLSearchParams
): ConnectRequest | null {
  const request = {
    installId: params.get("install")?.trim() ?? "",
    name: params.get("name")?.trim() ?? "",
    publicKey: params.get("key")?.trim() ?? "",
    returnTo: params.get("return")?.trim() ?? "",
    state: params.get("state")?.trim() ?? "",
  };

  const complete = Object.values(request).every((value) => value.length > 0);

  return complete && RETURN_ADDRESS.test(request.returnTo) ? request : null;
}

/** Where the browser goes after Connect: back to the app on this computer. */
export function connectReturnUrl(
  request: ConnectRequest,
  result: {
    account: string;
    /** This server's origin: the app may have opened withnakama.com, which sent it here. */
    cloud: string;
    computerId: string;
    confirmCode: string;
    orgId: string;
    orgName: string;
  }
): string {
  // RETURN_ADDRESS allows no query, so the result is the whole query.
  const query = new URLSearchParams({
    account: result.account,
    cloud: result.cloud,
    computerId: result.computerId,
    confirmCode: result.confirmCode,
    orgId: result.orgId,
    orgName: result.orgName,
    state: request.state,
  });

  return `${request.returnTo}?${query.toString()}`;
}
