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

    // oxlint-disable-next-line anti-slop/no-known-value-widening -- This public result intentionally keeps its documented broad return contract.
    return { host, prefix, suffix };
  } catch {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- This public result intentionally keeps its documented broad return contract.
    return { host: url, prefix: "", suffix: "" };
  }
}
