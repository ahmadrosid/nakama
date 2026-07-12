import { afterEach, describe, expect, mock, test } from "bun:test";

// Node's dns/promises must be stubbed BEFORE web-fetch is imported, so register
// the mock at module-eval time and load web-fetch dynamically afterwards.
mock.module("node:dns/promises", () => ({
  lookup: (hostname: string) => {
    if (hostname === "localhost") {
      return Promise.resolve([{ address: "127.0.0.1" }]);
    }
    if (hostname === "github-pages.test") {
      return Promise.resolve([
        { address: "185.199.111.153" },
        { address: "fd00:aa:bb:2250::b9c7:6f99" },
      ]);
    }
    if (hostname === "private-alias.test") {
      return Promise.resolve([{ address: "fd00:aa:bb:2250::0a00:0001" }]);
    }
    // Any other hostname "resolves" to a public example.com address.
    return Promise.resolve([{ address: "93.184.216.34" }]);
  },
}));

const webFetchModule = await import("./web-fetch");
const {
  convertHtmlToMarkdown,
  webFetchInputSchema,
  webFetchTool,
} = webFetchModule;

import type { ToolContext } from "../contract";

const CTX: ToolContext = {};

type FetchImpl = typeof fetch;
const originalFetch = globalThis.fetch;

function stubFetch(
  impl: (req: Request | string | URL, init?: RequestInit) => Promise<Response>,
): void {
  globalThis.fetch = mock(impl) as unknown as FetchImpl;
}

function htmlResponse(
  html: string,
  status = 200,
  contentType = "text/html; charset=utf-8",
): Response {
  return new Response(html, {
    status,
    headers: { "content-type": contentType },
  });
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe("web_fetch input schema", () => {
  test("accepts a valid http(s) url with optional raw", () => {
    expect(webFetchInputSchema.parse({ url: "https://example.com" })).toEqual({
      url: "https://example.com",
    });
    expect(webFetchInputSchema.parse({ url: "http://x.io/a", raw: true })).toEqual({
      url: "http://x.io/a",
      raw: true,
    });
  });

  test("rejects empty / non-string url", () => {
    expect(() => webFetchInputSchema.parse({})).toThrow();
    expect(() => webFetchInputSchema.parse({ url: "" })).toThrow();
    expect(() => webFetchInputSchema.parse({ url: 5 })).toThrow();
  });

  test("rejects non-http(s) schemes", () => {
    expect(() => webFetchInputSchema.parse({ url: "file:///etc/passwd" })).toThrow();
    expect(() => webFetchInputSchema.parse({ url: "ftp://example.com" })).toThrow();
  });

  test("rejects unknown keys (strict)", () => {
    expect(() =>
      webFetchInputSchema.parse({ url: "https://example.com", extra: 1 }),
    ).toThrow();
  });

  test("rejects non-boolean raw", () => {
    expect(() => webFetchInputSchema.parse({ url: "https://x", raw: "true" })).toThrow();
  });
});

describe("web_fetch tool metadata", () => {
  test("exports the parameters schema", () => {
    expect(webFetchTool.parameters?.type).toBe("object");
    expect(webFetchTool.parameters?.required).toEqual(["url"]);
    expect(webFetchTool.parameters?.additionalProperties).toBe(false);
  });
});

describe("web_fetch tool validation errors", () => {
  test("throws on missing url", async () => {
    await expect(webFetchTool.run({} as never, CTX)).rejects.toThrow(/invalid parameter at url/);
  });

  test("throws on non-http(s) url", async () => {
    await expect(webFetchTool.run({ url: "file:///etc/passwd" }, CTX)).rejects.toThrow(
      /http: or https:/,
    );
  });

  test("throws on unknown keys", async () => {
    await expect(
      webFetchTool.run({ url: "https://example.com", extra: 1 } as never, CTX),
    ).rejects.toThrow(/Unrecognized key/);
  });
});

describe("web_fetch SSRF guard", () => {
  test("rejects private IPv4 literal", async () => {
    await expect(webFetchTool.run({ url: "http://127.0.0.1/" }, CTX)).rejects.toThrow(
      /private or reserved/,
    );
    await expect(webFetchTool.run({ url: "http://10.0.0.1/" }, CTX)).rejects.toThrow(
      /private or reserved/,
    );
    await expect(webFetchTool.run({ url: "http://192.168.1.1/" }, CTX)).rejects.toThrow(
      /private or reserved/,
    );
  });

  test("rejects IPv6 loopback literal", async () => {
    await expect(webFetchTool.run({ url: "http://[::1]/" }, CTX)).rejects.toThrow(
      /private or reserved/,
    );
  });

  test("rejects link-local 169.254.x.x", async () => {
    await expect(webFetchTool.run({ url: "http://169.254.169.254/" }, CTX)).rejects.toThrow(
      /private or reserved/,
    );
  });

  test("rejects localhost hostname (resolves to loopback)", async () => {
    await expect(webFetchTool.run({ url: "http://localhost/" }, CTX)).rejects.toThrow(
      /resolves to private address/,
    );
  });

  test("allows hostnames with at least one public address", async () => {
    stubFetch(async () => htmlResponse("<p>ok</p>"));

    const out = await webFetchTool.run({ url: "https://github-pages.test/" }, CTX);

    expect(out.status).toBe(200);
    expect(out.content).toContain("ok");
  });

  test("rejects hostnames with only private addresses", async () => {
    await expect(webFetchTool.run({ url: "https://private-alias.test/" }, CTX)).rejects.toThrow(
      /resolves to private address/,
    );
  });
});

describe("web_fetch happy path", () => {
  test("converts HTML to Markdown and returns metadata", async () => {
    stubFetch(async () => htmlResponse("<h1>Title</h1><p>Hello <b>world</b></p>"));

    const out = await webFetchTool.run({ url: "https://example.com" }, CTX);

    expect(out.status).toBe(200);
    expect(out.contentType).toContain("text/html");
    expect(out.url).toBe("https://example.com/");
    expect(out.finalUrl).toBe("https://example.com/");
    expect(out.bytes).toBeGreaterThan(0);
    expect(out.content).toContain("# Title");
    expect(out.content).toContain("**world**");
  });

  test("respects raw=true (no markdown conversion)", async () => {
    const html = "<h1>Title</h1>";
    stubFetch(async () => htmlResponse(html));

    const out = await webFetchTool.run({ url: "https://example.com", raw: true }, CTX);

    expect(out.content).toBe(html);
    expect(out.content).not.toContain("# Title");
  });

  test("returns raw body for non-HTML content type", async () => {
    const json = '{"ok":true}';
    stubFetch(async () => jsonResponse(json));

    const out = await webFetchTool.run({ url: "https://api.example.com/v1" }, CTX);

    expect(out.contentType).toContain("application/json");
    expect(out.content).toBe(json);
  });

  test("throws on non-2xx response", async () => {
    stubFetch(async () => htmlResponse("<h1>Not Found</h1>", 404));

    await expect(webFetchTool.run({ url: "https://example.com/missing" }, CTX)).rejects.toThrow(
      /HTTP 404/,
    );
  });

  test("follows redirects and reports the final URL", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://target.example.com/fin" },
        });
      }
      return htmlResponse("<p>final</p>");
    });

    const out = await webFetchTool.run({ url: "https://start.example.com/" }, CTX);

    expect(out.status).toBe(200);
    expect(out.finalUrl).toBe("https://target.example.com/fin");
    expect(out.content).toContain("final");
    expect(calls).toBe(2);
  });

  test("rejects redirect to a private address", async () => {
    stubFetch(async () =>
      new Response(null, {
        status: 301,
        headers: { location: "http://127.0.0.1/" },
      }),
    );

    await expect(webFetchTool.run({ url: "https://example.com/" }, CTX)).rejects.toThrow(
      /private or reserved/,
    );
  });
});

describe("convertHtmlToMarkdown", () => {
  test("converts headings and bold", async () => {
    const md = await convertHtmlToMarkdown("<h2>Sub</h2><p>a <strong>b</strong></p>");
    expect(md).toContain("## Sub");
    expect(md).toContain("**b**");
  });

  test("removes framework comment noise", async () => {
    const md = await convertHtmlToMarkdown(`
      <!--[-->
      <nav><!--]--><a href="#content">Skip to content</a><!--[--></nav>
      <!---->
      <!--[--><main id="content"><h1>Nakama</h1><p>Self-hosted AI agents</p></main><!--]-->
    `);

    expect(md).not.toContain("<!--[-->");
    expect(md).not.toContain("<!--]-->");
    expect(md).not.toContain("<!---->");
    expect(md).toContain("[Skip to content](#content)");
    expect(md).toContain("# Nakama");
    expect(md).toContain("Self-hosted AI agents");
  });
});
