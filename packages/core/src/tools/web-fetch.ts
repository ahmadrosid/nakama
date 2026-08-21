import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import { unified } from "unified";
import { z } from "zod";
import type { JsonSchema, ToolDefinition } from "../contract";
import { withDisabledFetchIdle } from "../fetch-idle";

export const WEB_FETCH_TOOL_NAME = "web_fetch";

export interface WebFetchInput {
  raw?: boolean;
  url: string;
}

const HTTP_S_URL_REGEX = /^https?:\/\/.+$/i;

export const webFetchInputSchema = z
  .object({
    raw: z
      .boolean()
      .optional()
      .describe(
        "When true, return the raw response body without Markdown conversion. Defaults to false."
      ),
    url: z
      .string()
      .min(1)
      .url()
      .regex(HTTP_S_URL_REGEX, "url must use http: or https:")
      .describe("Absolute http: or https: URL to fetch."),
  })
  .strict();

export function webFetchParameters(): JsonSchema {
  const { $schema, ...schema } = webFetchInputSchema.toJSONSchema();
  return schema as JsonSchema;
}

export interface WebFetchOutput {
  bytes: number;
  content: string;
  contentType: string;
  finalUrl: string;
  status: number;
  truncated: boolean;
  url: string;
}

const MAX_BODY_BYTES = 1024 * 1024;
/**
 * MAX_BODY_BYTES bounds the transfer; this bounds what reaches the model. Without
 * it a single fetch can spend a megabyte of context: one call in a local session
 * pulled a 913 KB OpenAPI spec, which then rides along in history on every later
 * turn. Number, marker and the subtraction below all follow
 * `truncateComposioToolResult` in apps/server/src/services/composio-tool-bridge.ts,
 * which answered the same question for Composio results.
 */
const MAX_CONTENT_CHARS = 16_000;
const TRUNCATION_MARKER = "\n...[truncated]";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

/**
 * Private / reserved IPv4 ranges blocked for SSRF (loopback, RFC1918, CGNAT,
 * link-local, docs/test nets, 6to4 anycast, benchmarking, multicast, reserved).
 */
function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split(".").map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    return true;
  }

  const [a, b, c] = octets;

  // 0.0.0.0/8 — "this" network
  if (a === 0) {
    return true;
  }
  // 10.0.0.0/8 — RFC1918
  if (a === 10) {
    return true;
  }
  // 100.64.0.0/10 — CGNAT
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  // 127.0.0.0/8 — loopback
  if (a === 127) {
    return true;
  }
  // 169.254.0.0/16 — link-local
  if (a === 169 && b === 254) {
    return true;
  }
  // 172.16.0.0/12 — RFC1918
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  // 192.0.0.0/24 — IETF protocol assignments
  if (a === 192 && b === 0 && c === 0) {
    return true;
  }
  // 192.0.2.0/24 — TEST-NET-1
  if (a === 192 && b === 0 && c === 2) {
    return true;
  }
  // 192.88.99.0/24 — 6to4 relay anycast
  if (a === 192 && b === 88 && c === 99) {
    return true;
  }
  // 192.168.0.0/16 — RFC1918
  if (a === 192 && b === 168) {
    return true;
  }
  // 198.18.0.0/15 — benchmarking
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  // 203.0.113.0/24 — TEST-NET-3
  if (a === 203 && b === 0 && c === 113) {
    return true;
  }
  // 224.0.0.0/4 — multicast; 240.0.0.0/4 — reserved
  if (a >= 224) {
    return true;
  }

  return false;
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
  if (family === 4) {
    return isPrivateIpv4(ip);
  }
  if (family === 6) {
    return isPrivateIpv6(ip);
  }
  return true;
}

async function assertPublicHostname(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, "");

  if (isIP(bare)) {
    if (isPrivateIp(bare)) {
      throw new Error(
        `web_fetch blocked: address ${bare} is private or reserved.`
      );
    }
    return;
  }

  let records: { address: string }[];
  try {
    records = await dnsLookup(bare, { all: true });
  } catch (err) {
    throw new Error(
      `web_fetch failed to resolve hostname ${bare}: ${(err as Error).message}`
    );
  }

  if (records.length === 0) {
    throw new Error(
      `web_fetch failed to resolve hostname ${bare}: no records.`
    );
  }

  let privateAddress: string | null = null;

  for (const record of records) {
    if (!isPrivateIp(record.address)) {
      return;
    }
    privateAddress ??= record.address;
  }

  throw new Error(
    `web_fetch blocked: hostname ${bare} resolves to private address ${privateAddress}.`
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
    throw new Error(
      `web_fetch: unsupported protocol ${url.protocol} (use http or https).`
    );
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
  signal: AbortSignal
): Promise<{ response: Response; finalUrl: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(
      current,
      withDisabledFetchIdle({
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
          "user-agent":
            "nakama-web_fetch/1.0 (+https://github.com/ahmadrosid/nakama)",
        },
        redirect: "manual",
        signal,
      })
    );

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(
          `web_fetch: redirect ${response.status} without Location header.`
        );
      }
      const nextUrl = new URL(location, current);
      if (nextUrl.protocol !== "http:" && nextUrl.protocol !== "https:") {
        throw new Error(
          `web_fetch: redirect to unsupported protocol ${nextUrl.protocol}.`
        );
      }
      await assertPublicHostname(nextUrl.hostname);
      current = nextUrl;
      continue;
    }

    return { finalUrl: current.toString(), response };
  }

  throw new Error(`web_fetch: exceeded ${MAX_REDIRECTS} redirects.`);
}

async function readBoundedBody(
  response: Response,
  maxBytes: number
): Promise<{ body: string; truncated: boolean }> {
  // If length is known and oversized, reject up-front.
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(
        `web_fetch: response body exceeds ${maxBytes} bytes (Content-Length: ${declared}).`
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
    if (done) {
      break;
    }

    received += value.byteLength;
    if (received > maxBytes) {
      truncated = true;
      text += decoder.decode(
        value.subarray(0, value.byteLength - (received - maxBytes))
      );
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
  // Strip whole comments before parsing: Word's conditional comments
  // (`<!--[if gte mso 9]>…<![endif]-->`) otherwise survive as visible text.
  const cleanedHtml = html.replace(/<!--[\s\S]*?-->/g, "");
  const markdown = String(
    await unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeRemark)
      // Without GFM, remark-stringify throws on `table` nodes ("Cannot handle unknown
      // node `table`"), so any page or document containing a table fails to convert.
      .use(remarkGfm)
      .use(remarkStringify, { bullet: "-", fences: true })
      .process(cleanedHtml)
  );
  return removeCommentNoise(markdown)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const webFetchTool: ToolDefinition<WebFetchInput, WebFetchOutput> = {
  description:
    "Fetch a single public HTTP(S) URL and return its content. HTML pages are converted to Markdown. " +
    `Content is capped at ${MAX_CONTENT_CHARS} characters; when truncated is true the tail was dropped, ` +
    "so fetch a more specific URL rather than assuming you have the whole document. " +
    "Use for retrieving a known URL; use web_search when you need to discover sources.",
  name: WEB_FETCH_TOOL_NAME,
  parallelSafe: true,
  parameters: webFetchParameters(),
  async run(input) {
    let parsed: { url: string; raw?: boolean };
    try {
      parsed = webFetchInputSchema.parse(input);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const issue = err.issues[0];
        const at =
          issue.path && issue.path.length > 0
            ? ` at ${issue.path.join(".")}`
            : "";
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
      const { response, finalUrl } = await fetchWithRedirects(
        url,
        controller.signal
      );

      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `web_fetch failed: HTTP ${response.status} ${response.statusText}.`
        );
      }

      const contentType = response.headers.get("content-type") ?? "";
      const { body } = await readBoundedBody(response, MAX_BODY_BYTES);
      const bytes = Buffer.byteLength(body, "utf8");

      let content = body;
      const shouldConvert =
        !raw &&
        contentTypeIsHtml(contentType) &&
        body.trimStart().startsWith("<");

      if (shouldConvert) {
        content = await convertHtmlToMarkdown(body);
      }

      // After conversion, so the cap applies to what the model actually reads
      // rather than to the markup it never sees.
      const truncated = content.length > MAX_CONTENT_CHARS;
      if (truncated) {
        const keep = Math.max(0, MAX_CONTENT_CHARS - TRUNCATION_MARKER.length);
        content = `${content.slice(0, keep)}${TRUNCATION_MARKER}`;
      }

      return {
        bytes,
        content,
        contentType,
        finalUrl,
        status: response.status,
        truncated,
        url: url.toString(),
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
