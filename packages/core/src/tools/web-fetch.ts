import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { z } from "zod";
import type { JsonSchema, ToolDefinition } from "../contract";

export const WEB_FETCH_TOOL_NAME = "web_fetch";

export interface WebFetchInput {
  url: string;
  raw?: boolean;
}

const HTTP_S_URL_REGEX = /^https?:\/\/.+$/i;

export const webFetchInputSchema = z
  .object({
    url: z
      .string()
      .min(1)
      .url()
      .regex(HTTP_S_URL_REGEX, "url must use http: or https:")
      .describe("Absolute http: or https: URL to fetch."),
    raw: z
      .boolean()
      .optional()
      .describe(
        "When true, return the raw response body without Markdown conversion. Defaults to false.",
      ),
  })
  .strict();

export function webFetchParameters(): JsonSchema {
  const { $schema, ...schema } = webFetchInputSchema.toJSONSchema();
  return schema as JsonSchema;
}

export interface WebFetchOutput {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  bytes: number;
  content: string;
}

const MAX_BODY_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

/**
 * Private / reserved address ranges that indicate a local or internal target.
 * Fetching these is blocked to prevent server-side request forgery (SSRF).
 */
const PRIVATE_IPV4_PREFIXES = [
  "0.",
  "10.",
  "100.64.",
  "100.65.",
  "100.66.",
  "100.67.",
  "100.68.",
  "100.69.",
  "100.70.",
  "100.71.",
  "100.72.",
  "100.73.",
  "100.74.",
  "100.75.",
  "100.76.",
  "100.77.",
  "100.78.",
  "100.79.",
  "100.80.",
  "100.81.",
  "100.82.",
  "100.83.",
  "100.84.",
  "100.85.",
  "100.86.",
  "100.87.",
  "100.88.",
  "100.89.",
  "100.90.",
  "100.91.",
  "100.92.",
  "100.93.",
  "100.94.",
  "100.95.",
  "100.96.",
  "100.97.",
  "100.98.",
  "100.99.",
  "100.100.",
  "100.101.",
  "100.102.",
  "100.103.",
  "100.104.",
  "100.105.",
  "100.106.",
  "100.107.",
  "100.108.",
  "100.109.",
  "100.110.",
  "100.111.",
  "100.112.",
  "100.113.",
  "100.114.",
  "100.115.",
  "100.116.",
  "100.117.",
  "100.118.",
  "100.119.",
  "100.120.",
  "100.121.",
  "100.122.",
  "100.123.",
  "100.124.",
  "100.125.",
  "100.126.",
  "100.127.",
  "169.254.",
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.",
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "192.0.0.",
  "192.0.2.",
  "192.168.",
  "192.88.99.",
  "198.18.",
  "198.19.",
  "203.0.113.",
  "224.",
  "225.",
  "226.",
  "227.",
  "228.",
  "229.",
  "230.",
  "231.",
  "232.",
  "233.",
  "234.",
  "235.",
  "236.",
  "237.",
  "238.",
  "239.",
  "240.",
  "241.",
  "242.",
  "243.",
  "244.",
  "245.",
  "246.",
  "247.",
  "248.",
  "249.",
  "250.",
  "251.",
  "252.",
  "253.",
  "254.",
  "255.",
];

function isPrivateIpv4(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "0.0.0.0" || ip.startsWith("127.")) {
    return true;
  }
  return PRIVATE_IPV4_PREFIXES.some((prefix) => ip.startsWith(prefix));
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fe90:") ||
    normalized.startsWith("fea0:") ||
    normalized.startsWith("feb0:") ||
    normalized.startsWith("fec0:") ||
    normalized.startsWith("::ffff:") ||
    normalized.startsWith("::ffff:0:") ||
    normalized.startsWith("64:ff9b:")
  );
}

function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

async function assertPublicHostname(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, "");

  if (isIP(bare)) {
    if (isPrivateIp(bare)) {
      throw new Error(`web_fetch blocked: address ${bare} is private or reserved.`);
    }
    return;
  }

  let records: { address: string }[];
  try {
    records = await dnsLookup(bare, { all: true });
  } catch (err) {
    throw new Error(`web_fetch failed to resolve hostname ${bare}: ${(err as Error).message}`);
  }

  if (records.length === 0) {
    throw new Error(`web_fetch failed to resolve hostname ${bare}: no records.`);
  }

  let privateAddress: string | null = null;

  for (const record of records) {
    if (!isPrivateIp(record.address)) {
      return;
    }
    privateAddress ??= record.address;
  }

  throw new Error(
    `web_fetch blocked: hostname ${bare} resolves to private address ${privateAddress}.`,
  );
}

function parseUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("web_fetch: url must be a valid absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`web_fetch: unsupported protocol ${url.protocol} (use http or https).`);
  }

  if (!url.hostname) {
    throw new Error("web_fetch: url is missing a hostname.");
  }

  return url;
}

function contentTypeIsHtml(contentType: string): boolean {
  return /text\/html|application\/xhtml\+xml/i.test(contentType ?? "");
}

async function fetchWithRedirects(
  url: URL,
  signal: AbortSignal,
): Promise<{ response: Response; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      signal,
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "user-agent": "tinyclaw-web_fetch/1.0 (+https://github.com/ahmadrosid/tinyclaw)",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`web_fetch: redirect ${response.status} without Location header.`);
      }
      const nextUrl = new URL(location, current);
      if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
        throw new Error(`web_fetch: redirect to unsupported protocol ${nextUrl.protocol}.`);
      }
      await assertPublicHostname(nextUrl.hostname);
      current = nextUrl;
      continue;
    }

    return { response, finalUrl: current.toString() };
  }

  throw new Error(`web_fetch: exceeded ${MAX_REDIRECTS} redirects.`);
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<{ body: string; truncated: boolean }> {
  // If length is known and oversized, reject up-front.
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(
        `web_fetch: response body exceeds ${maxBytes} bytes (Content-Length: ${declared}).`,
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(`web_fetch: response body exceeds ${maxBytes} bytes.`);
    }
    return { body: text, truncated: false };
  }

  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let text = "";
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    received += value.byteLength;
    if (received > maxBytes) {
      truncated = true;
      text += decoder.decode(value.subarray(0, value.byteLength - (received - maxBytes)));
      break;
    }

    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  if (truncated) {
    throw new Error(`web_fetch: response body exceeds ${maxBytes} bytes.`);
  }

  return { body: text, truncated: false };
}

export async function convertHtmlToMarkdown(html: string): Promise<string> {
  const removeCommentNoise = (value: string) =>
    value.replace(/<!--(?:\[--|\]--|\[|\])?-->/g, "");
  const cleanedHtml = removeCommentNoise(html);
  const markdown = String(
    await unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeRemark)
      .use(remarkStringify, { bullet: "-", fences: true })
      .process(cleanedHtml),
  );
  return removeCommentNoise(markdown).replace(/\n{3,}/g, "\n\n").trim();
}

export const webFetchTool: ToolDefinition<WebFetchInput, WebFetchOutput> = {
  name: WEB_FETCH_TOOL_NAME,
  description:
    "Fetch a single public HTTP(S) URL and return its content. HTML pages are converted to Markdown. " +
    "Use for retrieving a known URL; use web_search when you need to discover sources.",
  parameters: webFetchParameters(),
  async run(input) {
    let parsed: { url: string; raw?: boolean };
    try {
      parsed = webFetchInputSchema.parse(input);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issue = err.issues[0];
        const at = issue.path && issue.path.length > 0 ? ` at ${issue.path.join(".")}` : "";
        throw new Error(`web_fetch: invalid parameter${at}: ${issue.message}`);
      }
      throw err instanceof Error ? err : new Error(String(err));
    }

    const raw = Boolean(parsed.raw);
    const url = parseUrl(parsed.url);
    await assertPublicHostname(url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const { response, finalUrl } = await fetchWithRedirects(url, controller.signal);

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`web_fetch failed: HTTP ${response.status} ${response.statusText}.`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const { body } = await readBoundedBody(response, MAX_BODY_BYTES);
      const bytes = Buffer.byteLength(body, "utf8");

      let content = body;
      const shouldConvert =
        !raw && contentTypeIsHtml(contentType) && body.trimStart().startsWith("<");

      if (shouldConvert) {
        content = await convertHtmlToMarkdown(body);
      }

      return {
        url: url.toString(),
        finalUrl,
        status: response.status,
        contentType,
        bytes,
        content,
      };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new Error(`web_fetch timed out after ${REQUEST_TIMEOUT_MS}ms.`);
      }
      throw err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }
  },
};
