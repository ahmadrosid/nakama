/** Split a URL so the host can be emphasized in the external-link safety dialog. */
export function splitExternalUrl(url: string): {
  prefix: string;
  host: string;
  suffix: string;
} {
  try {
    const parsed = new URL(url);
    const prefix = `${parsed.protocol}//`;
    const host = parsed.host;
    const suffix = url.slice(prefix.length + host.length);
    return { prefix, host, suffix };
  } catch {
    return { prefix: "", host: url, suffix: "" };
  }
}
