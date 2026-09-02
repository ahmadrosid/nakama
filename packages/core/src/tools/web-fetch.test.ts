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
    if (hostname === "dual.test") {
      // Two public records, IPv6 first — the shape most real names have.
      return Promise.resolve([
        { address: "2606:4700:20::681a:58a" },
        { address: "185.199.111.153" },
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
const { convertHtmlToMarkdown, webFetchInputSchema, webFetchTool } =
  webFetchModule;

import type { ToolContext } from "../contract";

const CTX: ToolContext = {};

type FetchImpl = typeof fetch;
const originalFetch = globalThis.fetch;

function stubFetch(
  impl: (req: Request | string | URL, init?: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = mock(impl) as unknown as FetchImpl;
}

function htmlResponse(
  html: string,
  status = 200,
  contentType = "text/html; charset=utf-8"
): Response {
  return new Response(html, {
    headers: { "content-type": contentType },
    status,
  });
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    headers: { "content-type": "application/json" },
    status,
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
    expect(
      webFetchInputSchema.parse({ raw: true, url: "http://x.io/a" })
    ).toEqual({
      raw: true,
      url: "http://x.io/a",
    });
  });

  test("rejects empty / non-string url", () => {
    expect(() => webFetchInputSchema.parse({})).toThrow();
    expect(() => webFetchInputSchema.parse({ url: "" })).toThrow();
    expect(() => webFetchInputSchema.parse({ url: 5 })).toThrow();
  });

  test("rejects non-http(s) schemes", () => {
    expect(() =>
      webFetchInputSchema.parse({ url: "file:///etc/passwd" })
    ).toThrow();
    expect(() =>
      webFetchInputSchema.parse({ url: "ftp://example.com" })
    ).toThrow();
  });

  test("rejects unknown keys (strict)", () => {
    expect(() =>
      webFetchInputSchema.parse({ extra: 1, url: "https://example.com" })
    ).toThrow();
  });

  test("rejects non-boolean raw", () => {
    expect(() =>
      webFetchInputSchema.parse({ raw: "true", url: "https://x" })
    ).toThrow();
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
    await expect(webFetchTool.run({} as never, CTX)).rejects.toThrow(
      /invalid parameter at url/
    );
  });

  test("throws on non-http(s) url", async () => {
    await expect(
      webFetchTool.run({ url: "file:///etc/passwd" }, CTX)
    ).rejects.toThrow(/http: or https:/);
  });

  test("throws on unknown keys", async () => {
    await expect(
      webFetchTool.run({ extra: 1, url: "https://example.com" } as never, CTX)
    ).rejects.toThrow(/Unrecognized key/);
  });
});

describe("web_fetch SSRF guard", () => {
  test("rejects loopback IPv4 literals", async () => {
    await expect(
      webFetchTool.run({ url: "http://127.0.0.1/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
    await expect(
      webFetchTool.run({ url: "http://127.1.2.3/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
  });

  test("rejects RFC1918 IPv4 literals", async () => {
    await expect(
      webFetchTool.run({ url: "http://10.0.0.1/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
    await expect(
      webFetchTool.run({ url: "http://172.16.0.1/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
    await expect(
      webFetchTool.run({ url: "http://172.31.255.255/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
    await expect(
      webFetchTool.run({ url: "http://192.168.1.1/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
  });

  test("rejects CGNAT 100.64.0.0/10", async () => {
    await expect(
      webFetchTool.run({ url: "http://100.64.0.1/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
    await expect(
      webFetchTool.run({ url: "http://100.127.255.254/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
  });

  test("rejects link-local 169.254.x.x", async () => {
    await expect(
      webFetchTool.run({ url: "http://169.254.169.254/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
  });

  test("rejects multicast and reserved IPv4", async () => {
    await expect(
      webFetchTool.run({ url: "http://224.0.0.1/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
    await expect(
      webFetchTool.run({ url: "http://239.255.255.255/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
    await expect(
      webFetchTool.run({ url: "http://240.0.0.1/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
  });

  test("rejects IPv6 loopback literal", async () => {
    await expect(
      webFetchTool.run({ url: "http://[::1]/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
  });

  test("rejects non-global IPv6 literals", async () => {
    stubFetch(async () => htmlResponse("<p>must not fetch</p>"));

    for (const host of ["2001::1", "2001:db8::1", "::192.0.2.1"]) {
      await expect(
        webFetchTool.run({ url: `http://[${host}]/` }, CTX)
      ).rejects.toThrow(/private or reserved/);
    }
  });

  test("allows IPv6 literals adjacent to blocked ranges", async () => {
    stubFetch(async () => htmlResponse("<p>ok</p>"));

    for (const host of ["2001:200::1", "2001:db7:ffff::1", "2001:db9::1"]) {
      const out = await webFetchTool.run({ url: `http://[${host}]/` }, CTX);
      expect(out.status).toBe(200);
    }
  });

  test("rejects localhost hostname (resolves to loopback)", async () => {
    await expect(
      webFetchTool.run({ url: "http://localhost/" }, CTX)
    ).rejects.toThrow(/resolves to private address/);
  });

  test("allows hostnames with at least one public address", async () => {
    let fetchInit: RequestInit | undefined;
    stubFetch(async (_input, init) => {
      fetchInit = init;
      return htmlResponse("<p>ok</p>");
    });

    const out = await webFetchTool.run(
      { url: "https://github-pages.test/" },
      CTX
    );

    expect(out.status).toBe(200);
    expect(out.content).toContain("ok");
    expect(
      (fetchInit as RequestInit & { idleTimeout?: number }).idleTimeout
    ).toBe(0);
  });

  test("allows public IPv4 adjacent to blocked ranges", async () => {
    stubFetch(async () => htmlResponse("<p>ok</p>"));

    // Just outside CGNAT / RFC1918 / multicast — must still fetch.
    for (const host of [
      "100.63.255.255",
      "100.128.0.1",
      "172.15.0.1",
      "172.32.0.1",
      "223.255.255.255",
    ]) {
      const out = await webFetchTool.run({ url: `http://${host}/` }, CTX);
      expect(out.status).toBe(200);
    }
  });

  test("rejects hostnames with only private addresses", async () => {
    await expect(
      webFetchTool.run({ url: "https://private-alias.test/" }, CTX)
    ).rejects.toThrow(/resolves to private address/);
  });
});

describe("web_fetch pins the address it verified", () => {
  test("connects to the resolved address, not the hostname", async () => {
    const inputs: string[] = [];
    stubFetch(async (input) => {
      inputs.push(String(input));
      return htmlResponse("<p>ok</p>");
    });

    await webFetchTool.run({ url: "https://github-pages.test/page" }, CTX);

    // 185.199.111.153 is what the stubbed resolver returned for that name.
    expect(inputs).toEqual(["https://185.199.111.153/page"]);
  });

  test("sends the hostname as Host and as the TLS server name", async () => {
    let init: (RequestInit & { tls?: { serverName: string } }) | undefined;
    stubFetch(async (_input, requestInit) => {
      init = requestInit as typeof init;
      return htmlResponse("<p>ok</p>");
    });

    await webFetchTool.run({ url: "https://github-pages.test/" }, CTX);

    const headers = init?.headers as Record<string, string>;
    expect(headers.host).toBe("github-pages.test");
    expect(init?.tls?.serverName).toBe("github-pages.test");
  });

  test("leaves the TLS override off for plain http", async () => {
    let init: (RequestInit & { tls?: { serverName: string } }) | undefined;
    stubFetch(async (_input, requestInit) => {
      init = requestInit as typeof init;
      return htmlResponse("<p>ok</p>");
    });

    await webFetchTool.run({ url: "http://github-pages.test/" }, CTX);

    expect(init?.tls).toBeUndefined();
  });

  test("keeps IPv6 literals bracketed when pinning", async () => {
    const inputs: string[] = [];
    stubFetch(async (input) => {
      inputs.push(String(input));
      return htmlResponse("<p>ok</p>");
    });

    await webFetchTool.run({ url: "https://[2606:4700::1111]/p" }, CTX);

    expect(inputs).toEqual(["https://[2606:4700::1111]/p"]);
  });

  test("falls back to the next public address when the first refuses", async () => {
    const inputs: string[] = [];
    stubFetch(async (input) => {
      inputs.push(String(input));
      if (inputs.length === 1) {
        throw new Error("connect ECONNREFUSED");
      }
      return htmlResponse("<p>ok</p>");
    });

    const out = await webFetchTool.run({ url: "https://dual.test/" }, CTX);

    expect(out.status).toBe(200);
    expect(inputs).toEqual([
      "https://[2606:4700:20::681a:58a]/",
      "https://185.199.111.153/",
    ]);
  });

  test("never connects to a private record in a mixed answer", async () => {
    const inputs: string[] = [];
    stubFetch(async (input) => {
      inputs.push(String(input));
      return htmlResponse("<p>ok</p>");
    });

    // github-pages.test answers with a public IPv4 and a unique-local IPv6.
    await webFetchTool.run({ url: "https://github-pages.test/" }, CTX);

    expect(inputs).toEqual(["https://185.199.111.153/"]);
  });

  test("re-pins each redirect hop and still reports the logical url", async () => {
    const inputs: string[] = [];
    const hosts: string[] = [];
    stubFetch(async (input, requestInit) => {
      const headers = (requestInit?.headers ?? {}) as Record<string, string>;
      inputs.push(String(input));
      hosts.push(headers.host);
      if (inputs.length === 1) {
        return new Response(null, {
          headers: { location: "https://github-pages.test/fin" },
          status: 302,
        });
      }
      return htmlResponse("<p>final</p>");
    });

    const out = await webFetchTool.run(
      { url: "https://start.example.com/" },
      CTX
    );

    // Hop 1 uses the fallback address, hop 2 the github-pages one.
    expect(inputs).toEqual([
      "https://93.184.216.34/",
      "https://185.199.111.153/fin",
    ]);
    expect(hosts).toEqual(["start.example.com", "github-pages.test"]);
    expect(out.finalUrl).toBe("https://github-pages.test/fin");
  });
});

describe("web_fetch happy path", () => {
  test("converts HTML to Markdown and returns metadata", async () => {
    stubFetch(async () =>
      htmlResponse("<h1>Title</h1><p>Hello <b>world</b></p>")
    );

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

    const out = await webFetchTool.run(
      { raw: true, url: "https://example.com" },
      CTX
    );

    expect(out.content).toBe(html);
    expect(out.content).not.toContain("# Title");
  });

  test("returns raw body for non-HTML content type", async () => {
    const json = '{"ok":true}';
    stubFetch(async () => jsonResponse(json));

    const out = await webFetchTool.run(
      { url: "https://api.example.com/v1" },
      CTX
    );

    expect(out.contentType).toContain("application/json");
    expect(out.content).toBe(json);
  });

  test("throws on non-2xx response", async () => {
    stubFetch(async () => htmlResponse("<h1>Not Found</h1>", 404));

    await expect(
      webFetchTool.run({ url: "https://example.com/missing" }, CTX)
    ).rejects.toThrow(/HTTP 404/);
  });

  test("follows redirects and reports the final URL", async () => {
    let calls = 0;
    stubFetch(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(null, {
          headers: { location: "https://target.example.com/fin" },
          status: 302,
        });
      }
      return htmlResponse("<p>final</p>");
    });

    const out = await webFetchTool.run(
      { url: "https://start.example.com/" },
      CTX
    );

    expect(out.status).toBe(200);
    expect(out.finalUrl).toBe("https://target.example.com/fin");
    expect(out.content).toContain("final");
    expect(calls).toBe(2);
  });

  test("rejects redirect to a private address", async () => {
    stubFetch(
      async () =>
        new Response(null, {
          headers: { location: "http://127.0.0.1/" },
          status: 301,
        })
    );

    await expect(
      webFetchTool.run({ url: "https://example.com/" }, CTX)
    ).rejects.toThrow(/private or reserved/);
  });
});

describe("convertHtmlToMarkdown", () => {
  test("converts headings and bold", async () => {
    const md = await convertHtmlToMarkdown(
      "<h2>Sub</h2><p>a <strong>b</strong></p>"
    );
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

describe("web_fetch content cap", () => {
  // Same shape as truncateComposioToolResult: the marker is inside the budget,
  // so a capped result is exactly CAP characters and never one more.
  const CAP = 16_000;
  const MARKER = "\n...[truncated]";

  test("leaves a small body whole", async () => {
    stubFetch(async () => htmlResponse("<h1>Short</h1><p>Body.</p>"));

    const out = await webFetchTool.run({ url: "https://example.com" }, CTX);

    expect(out.truncated).toBe(false);
    expect(out.content).toContain("# Short");
    expect(out.content).not.toContain(MARKER);
  });

  test("caps a long body and reports the original size", async () => {
    // Long enough that the markdown is still over the cap after conversion.
    const paragraphs = "<p>lorem ipsum dolor sit amet</p>".repeat(4000);
    stubFetch(async () => htmlResponse(`<h1>Long</h1>${paragraphs}`));

    const out = await webFetchTool.run({ url: "https://example.com" }, CTX);

    expect(out.truncated).toBe(true);
    expect(out.content.length).toBe(CAP);
    expect(out.content.endsWith(MARKER)).toBe(true);
    expect(out.content).toContain("# Long");
    expect(out.bytes).toBeGreaterThan(CAP);
  });

  test("caps a raw body too, since raw skips conversion entirely", async () => {
    const html = `<div>${"x".repeat(50_000)}</div>`;
    stubFetch(async () => htmlResponse(html));

    const out = await webFetchTool.run(
      { raw: true, url: "https://example.com" },
      CTX
    );

    expect(out.truncated).toBe(true);
    expect(out.content.length).toBe(CAP);
    expect(out.content.endsWith(MARKER)).toBe(true);
  });

  test("caps a large JSON body, the case that motivated the limit", async () => {
    // An OpenAPI spec fetched in one call is what put 913 KB into a real session.
    const spec = JSON.stringify({
      paths: Object.fromEntries(
        Array.from({ length: 2000 }, (_, i) => [
          `/v1/resource/${i}`,
          { get: { summary: `read resource ${i}` } },
        ])
      ),
    });
    stubFetch(async () => jsonResponse(spec));

    const out = await webFetchTool.run(
      { url: "https://api.example.com/o.json" },
      CTX
    );

    expect(out.bytes).toBeGreaterThan(CAP);
    expect(out.truncated).toBe(true);
    expect(out.content.length).toBe(CAP);
    expect(out.content.endsWith(MARKER)).toBe(true);
  });
});
