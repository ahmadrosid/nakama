import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NakamaApiError } from "@nakama/core";
import { z } from "zod";

const PDF_TIMEOUT_MS = 60_000;

/** The page is served from this origin, so relative assets resolve to it. */
const ARTIFACT_ORIGIN = "https://artifact.nakama.invalid";

/** The same remote hosts the web preview CSP allows (`ARTIFACT_FRAME_CSP`). */
const SCRIPT_HOSTS = [
  "https://cdnjs.cloudflare.com",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
  "https://cdn.tailwindcss.com",
  "https://code.jquery.com",
];

const STYLE_HOST = "https://fonts.googleapis.com";

const FONT_HOST = "https://fonts.gstatic.com";

const REMOTE_HOSTS = [...SCRIPT_HOSTS, STYLE_HOST, FONT_HOST];

/** No fetch, XHR or WebSocket, so a page cannot read internal hosts into the PDF. */
const PDF_CSP = [
  "default-src 'none'",
  `script-src 'self' 'unsafe-inline' ${SCRIPT_HOSTS.join(" ")}`,
  `style-src 'self' 'unsafe-inline' data: ${STYLE_HOST}`,
  `font-src 'self' data: ${FONT_HOST}`,
  "img-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// Ubuntu's chromium-browser is a snap launcher, so it comes last.
const CHROME_NAMES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chrome",
  "chromium-browser",
];

const MAC_CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const CHROME_MISSING_MESSAGE =
  "PDF export needs headless Chrome on the Nakama server. Ask the server admin to install Chrome or Chromium, or to set NAKAMA_CHROME_PATH to the Chrome binary.";

export function resolveChromeBin(): string | null {
  const configured = process.env.NAKAMA_CHROME_PATH?.trim();

  if (configured) {
    return configured;
  }

  for (const name of CHROME_NAMES) {
    const found = Bun.which(name);

    if (found) {
      return found;
    }
  }

  return process.platform === "darwin" && existsSync(MAC_CHROME)
    ? MAC_CHROME
    : null;
}

type JsonValue = z.infer<ReturnType<typeof z.json>>;

type CdpParams = Record<string, JsonValue>;

const CdpMessageSchema = z.object({
  error: z.object({ message: z.string() }).optional(),
  id: z.number().optional(),
  method: z.string().optional(),
  params: z.json().optional(),
  result: z.json().optional(),
});

const PausedRequestSchema = z.object({
  request: z.object({ url: z.string() }),
  requestId: z.string(),
});

const TargetSchema = z.object({ targetId: z.string() });

const SessionSchema = z.object({ sessionId: z.string() });

const PrintSchema = z.object({ data: z.string() });

const AnySchema = z.json();

type PausedRequest = z.infer<typeof PausedRequestSchema>;

type PageCommand = (method: string, params?: CdpParams) => Promise<JsonValue>;

/**
 * Renders HTML to PDF in headless Chrome, the same engine as the web preview.
 * Chrome asks this process for every request: the HTML and files under
 * `artifactsDir` come from here, the preview's CDN and font hosts load, and
 * everything else fails.
 */
export async function convertHtmlToPdf(
  html: string,
  htmlPath: string,
  artifactsDir: string,
  chromeBin: string | null = resolveChromeBin()
): Promise<Buffer> {
  if (!chromeBin) {
    throw new NakamaApiError(CHROME_MISSING_MESSAGE, 501);
  }

  const root = await realpath(artifactsDir);
  const profileDir = await mkdtemp(path.join(os.tmpdir(), "nakama-chrome-"));
  const pageUrl = `${ARTIFACT_ORIGIN}/${htmlPath.split("/").map(encodeURIComponent).join("/")}`;

  let chrome: ReturnType<typeof startChrome>;

  try {
    chrome = startChrome(chromeBin, profileDir);
  } catch {
    await rm(profileDir, { force: true, recursive: true });
    throw new NakamaApiError(CHROME_MISSING_MESSAGE, 501);
  }

  const timeout = setTimeout(() => chrome.kill(), PDF_TIMEOUT_MS);

  try {
    const endpoint = await readDevToolsEndpoint(chrome.stderr);
    let sessionId = "";
    let onLoad: () => void = () => undefined;

    const loaded = new Promise<void>((resolve) => {
      onLoad = () => resolve();
    });

    const cdp = await connectCdp(endpoint, (method, params) => {
      if (method === "Page.loadEventFired") {
        onLoad();
      } else if (method === "Fetch.requestPaused") {
        void answerRequest(
          PausedRequestSchema.parse(params),
          page,
          html,
          pageUrl,
          root
        );
      }
    });

    const page: PageCommand = (method, params = {}) =>
      cdp.send(method, params, AnySchema, sessionId);

    try {
      const { targetId } = await cdp.send(
        "Target.createTarget",
        { url: "about:blank" },
        TargetSchema
      );

      ({ sessionId } = await cdp.send(
        "Target.attachToTarget",
        { flatten: true, targetId },
        SessionSchema
      ));

      await page("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
      await page("Page.enable");
      await page("Page.navigate", { url: pageUrl });
      await loaded;

      await page("Runtime.evaluate", {
        awaitPromise: true,
        expression: "document.fonts.ready.then(() => true)",
      });

      const { data } = await cdp.send(
        "Page.printToPDF",
        { preferCSSPageSize: true, printBackground: true },
        PrintSchema,
        sessionId
      );

      return Buffer.from(data, "base64");
    } finally {
      cdp.close();
    }
  } catch (error) {
    if (error instanceof NakamaApiError) {
      throw error;
    }

    throw new NakamaApiError(
      `Could not convert the artifact to PDF: ${error instanceof Error ? error.message : String(error)}`,
      500
    );
  } finally {
    clearTimeout(timeout);
    chrome.kill();
    await chrome.exited;
    await rm(profileDir, { force: true, recursive: true });
  }
}

function startChrome(chromeBin: string, profileDir: string) {
  return Bun.spawn(
    [
      chromeBin,
      "--headless=new",
      "--disable-gpu",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      // Chrome cannot start its sandbox as root, or on hosts that block user
      // namespaces (Ubuntu 24.04 AppArmor). The CSP and request filter still apply.
      ...(process.getuid?.() === 0 ||
      process.env.NAKAMA_CHROME_NO_SANDBOX === "true"
        ? ["--no-sandbox"]
        : []),
      "about:blank",
    ],
    { stderr: "pipe", stdin: "ignore", stdout: "ignore" }
  );
}

async function answerRequest(
  { request, requestId }: PausedRequest,
  page: PageCommand,
  html: string,
  pageUrl: string,
  root: string
): Promise<void> {
  const fail = () =>
    page("Fetch.failRequest", { errorReason: "BlockedByClient", requestId });

  try {
    const url = request.url.split("#", 1)[0];

    if (url === pageUrl) {
      await page("Fetch.fulfillRequest", {
        body: Buffer.from(html).toString("base64"),
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "text/html; charset=utf-8" },
          { name: "Content-Security-Policy", value: PDF_CSP },
        ],
      });

      return;
    }

    if (url.startsWith(`${ARTIFACT_ORIGIN}/`)) {
      const relative = decodeURIComponent(new URL(url).pathname.slice(1));
      const file = await realpath(path.resolve(root, relative));

      if (!file.startsWith(root + path.sep)) {
        await fail();

        return;
      }

      await page("Fetch.fulfillRequest", {
        body: (await readFile(file)).toString("base64"),
        requestId,
        responseCode: 200,
        responseHeaders: [
          {
            name: "Content-Type",
            value: Bun.file(file).type || "application/octet-stream",
          },
        ],
      });

      return;
    }

    // Redirects come back through Fetch.requestPaused, so each hop is checked too.
    if (REMOTE_HOSTS.some((host) => url.startsWith(`${host}/`))) {
      await page("Fetch.continueRequest", { requestId });

      return;
    }

    await fail();
  } catch {
    // A missing asset must not stop the page; Chrome renders without it.
    await fail().catch(() => null);
  }
}

async function readDevToolsEndpoint(
  stderr: ReadableStream<Uint8Array>
): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";

  for await (const chunk of stderr) {
    output += decoder.decode(chunk, { stream: true });
    const match = output.match(/DevTools listening on (ws:\/\/\S+)/);

    if (match) {
      return match[1];
    }
  }

  throw new NakamaApiError(
    `${CHROME_MISSING_MESSAGE} Chrome did not start: ${chromeStartError(output)}`,
    501
  );
}

async function connectCdp(
  endpoint: string,
  onEvent: (method: string, params: JsonValue) => void
) {
  const socket = new WebSocket(endpoint);

  const pending = new Map<
    number,
    { reject: (error: Error) => void; resolve: (result: JsonValue) => void }
  >();

  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Could not connect to Chrome.")),
      { once: true }
    );
  });

  socket.addEventListener("message", (event) => {
    const message = CdpMessageSchema.parse(JSON.parse(String(event.data)));

    if (message.id === undefined) {
      if (message.method) {
        onEvent(message.method, message.params ?? null);
      }

      return;
    }

    const waiter = pending.get(message.id);
    pending.delete(message.id);

    if (message.error) {
      waiter?.reject(new Error(message.error.message));
    } else {
      waiter?.resolve(message.result ?? null);
    }
  });

  socket.addEventListener("close", () => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error("Chrome closed the connection."));
    }

    pending.clear();
  });

  return {
    close: () => socket.close(),
    send: <T>(
      method: string,
      params: CdpParams,
      schema: z.ZodType<T>,
      sessionId?: string
    ) =>
      new Promise<T>((resolve, reject) => {
        const id = nextId++;

        pending.set(id, {
          reject,
          resolve: (result) => {
            const parsed = schema.safeParse(result);

            if (parsed.success) {
              resolve(parsed.data);
            } else {
              reject(new Error(`Unexpected Chrome reply to ${method}.`));
            }
          },
        });

        socket.send(
          JSON.stringify({
            id,
            method,
            params,
            sessionId: sessionId || undefined,
          })
        );
      }),
  };
}

/** Chrome ends a crash with a stack trace, so the FATAL line holds the cause. */
function chromeStartError(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    lines.find((line) => line.includes(":FATAL:")) ??
    lines.find((line) => line.includes(":ERROR:")) ??
    lines.at(-1) ??
    "no output"
  );
}
