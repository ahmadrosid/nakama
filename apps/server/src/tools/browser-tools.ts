import type {
  ImageAttachment,
  ToolContext,
  ToolDefinition,
} from "@nakama/core";
import { z } from "zod";
import { resolveAgentBrowserConfig } from "../services/agent-browser-service";
import {
  captureKernelScreenshot,
  chatExecutorName,
  ensureKernelBrowser,
  executeKernelPlaywright,
  type KernelComputerAction,
  runKernelComputerActions,
  userBrowserName,
} from "../services/kernel-browser";

/** One LinkedIn feed read runs past 20k characters; more crowds out the chat. */
const MAX_OUTPUT_CHARS = 20_000;

const MAX_LINKS = 100;

const DEFAULT_SCRIPT_TIMEOUT_SEC = 45;

const MAX_PLAYWRIGHT_TIMEOUT_SEC = 120;

const MAX_COMPUTER_ACTIONS = 20;

const MAX_WAIT_MS = 5000;

const MAX_COORDINATE = 4000;

interface ResolvedBrowser {
  apiKey: string;
  browserName: string;
  executor?: string;
}

/**
 * The browser always belongs to the caller: org and user come from the tool
 * context, never from the model, so no input can reach another user's
 * signed-in browser. A run with no user, such as an automation, gets none.
 */
async function resolveBrowser(context: ToolContext): Promise<ResolvedBrowser> {
  const orgId = context.orgId?.trim();
  const userId = context.userId?.trim();

  if (!(orgId && userId)) {
    throw new Error(
      "Browser tools need a signed-in user. They do not run in automations."
    );
  }

  const config = await resolveAgentBrowserConfig();

  if (!config?.apiKey) {
    throw new Error(
      "The Kernel browser runtime is not set up. A platform admin can set it under AI Providers → Browser runtime."
    );
  }

  await ensureKernelBrowser(config.apiKey, orgId, userId);

  const sessionId = context.sessionId?.trim();

  return {
    apiKey: config.apiKey,
    browserName: userBrowserName(orgId, userId),
    executor: sessionId ? chatExecutorName(sessionId) : undefined,
  };
}

async function runScript(
  context: ToolContext,
  code: string,
  timeoutSec = DEFAULT_SCRIPT_TIMEOUT_SEC
) {
  const browser = await resolveBrowser(context);

  const outcome = await executeKernelPlaywright(
    browser.apiKey,
    browser.browserName,
    { code, executor: browser.executor, timeoutSec }
  );

  if (!outcome.success) {
    throw new Error(outcome.error?.trim() || "The browser step failed.");
  }

  return outcome;
}

/** Inputs reach the page script as a JSON literal, never spliced as code. */
function withInput(input: Record<string, JsonValue>, body: string): string {
  return `const input = ${JSON.stringify(input)};\n${body}`;
}

function capText(text: string): { text: string; truncated: boolean } {
  return text.length > MAX_OUTPUT_CHARS
    ? { text: text.slice(0, MAX_OUTPUT_CHARS), truncated: true }
    : { text, truncated: false };
}

async function bringChatTabToFront(browser: ResolvedBrowser): Promise<void> {
  await executeKernelPlaywright(browser.apiKey, browser.browserName, {
    code: BRING_TO_FRONT_SCRIPT,
    executor: browser.executor,
    timeoutSec: 10,
  });
}

async function screenshotResult(
  context: ToolContext,
  browser?: ResolvedBrowser
): Promise<{ content: string; images: ImageAttachment[] }> {
  const target = browser ?? (await resolveBrowser(context));

  if (!browser) {
    await bringChatTabToFront(target);
  }

  const image = await captureKernelScreenshot(
    target.apiKey,
    target.browserName
  );

  return {
    content:
      "Screenshot of the browser screen. Use its pixel positions for browser_computer.",
    images: [image],
  };
}

const NavigateInputSchema = z.object({ url: z.string() });

const ReadInputSchema = z.object({
  maxChars: z.number().optional().catch(undefined),
  offset: z.number().optional().catch(undefined),
  selector: z.string().optional().catch(undefined),
});

const ScrollInputSchema = z.object({
  pixels: z.number().optional().catch(undefined),
  selector: z.string().optional().catch(undefined),
});

const PlaywrightInputSchema = z.object({
  code: z.string(),
  timeoutSec: z.number().optional().catch(undefined),
});

const CoordinateSchema = z.number().int().min(0).max(MAX_COORDINATE);

const ComputerActionSchema = z.discriminatedUnion("type", [
  z.object({
    button: z.enum(["left", "middle", "right"]).optional(),
    double: z.boolean().optional(),
    type: z.literal("click"),
    x: CoordinateSchema,
    y: CoordinateSchema,
  }),
  z.object({ text: z.string().max(2000), type: z.literal("type") }),
  z.object({
    keys: z.array(z.string().min(1)).min(1).max(5),
    type: z.literal("key"),
  }),
  z.object({
    deltaX: z.number().int().optional(),
    deltaY: z.number().int(),
    type: z.literal("scroll"),
    x: CoordinateSchema,
    y: CoordinateSchema,
  }),
  z.object({
    path: z
      .array(z.tuple([CoordinateSchema, CoordinateSchema]))
      .min(2)
      .max(50),
    type: z.literal("drag"),
  }),
  z.object({
    ms: z.number().int().min(0).max(MAX_WAIT_MS),
    type: z.literal("wait"),
  }),
]);

const ComputerInputSchema = z.object({
  actions: z.array(ComputerActionSchema).min(1).max(MAX_COMPUTER_ACTIONS),
});

type ComputerAction = z.infer<typeof ComputerActionSchema>;

function toKernelAction(action: ComputerAction): KernelComputerAction {
  switch (action.type) {
    case "click":
      return {
        click_mouse: {
          button: action.button ?? "left",
          num_clicks: action.double ? 2 : 1,
          x: action.x,
          y: action.y,
        },
        type: "click_mouse",
      };
    case "type":
      return { type: "type_text", type_text: { text: action.text } };
    case "key":
      return { press_key: { keys: action.keys }, type: "press_key" };
    case "scroll":
      return {
        scroll: {
          delta_x: action.deltaX ?? 0,
          delta_y: action.deltaY,
          x: action.x,
          y: action.y,
        },
        type: "scroll",
      };
    case "drag":
      return { drag_mouse: { path: action.path }, type: "drag_mouse" };
    case "wait":
      return { sleep: { duration_ms: action.ms }, type: "sleep" };
    default:
      throw new Error("Unknown browser_computer action.");
  }
}

function readHttpUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("url must be a full http or https address.");
  }

  if (!(url.protocol === "http:" || url.protocol === "https:")) {
    throw new Error("url must be a full http or https address.");
  }

  return url.toString();
}

// Screenshots, mouse actions, and the live view all show the front tab, so
// the chat's tab comes to the front before any of them.
const BRING_TO_FRONT_SCRIPT = "await page.bringToFront(); return true;";

const NAVIGATE_SCRIPT = `
await page.bringToFront();
await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 30000 });
const loginForm = (await page.locator('input[type="password"]').count()) > 0;
return { loginForm, title: await page.title(), url: page.url() };`;

const READ_SCRIPT = `
const candidates = input.selector ? [input.selector] : ["main", "body"];
let selector = null;
for (const candidate of candidates) {
  if ((await page.locator(candidate).count()) > 0) { selector = candidate; break; }
}
if (!selector) throw new Error("No element matches " + input.selector + ".");
const root = page.locator(selector).first();
const text = await root.innerText();
const links = await root.evaluate((el, max) => {
  const seen = new Set();
  const out = [];
  for (const a of el.querySelectorAll("a[href]")) {
    const href = a.href;
    if (!href || href.startsWith("javascript:") || seen.has(href)) continue;
    const label = (a.innerText || a.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 80);
    if (!label) continue;
    seen.add(href);
    out.push({ href, text: label });
    if (out.length >= max) break;
  }
  return out;
}, input.maxLinks);
return { links, selector, text, title: await page.title(), url: page.url() };`;

const SCROLL_SCRIPT = `
const start = await page.evaluate(({ pixels, selector }) => {
  let el;
  if (selector) {
    el = document.querySelector(selector);
    if (!el) return null;
  } else {
    const scrollers = [...document.querySelectorAll("*")].filter((e) => {
      const style = getComputedStyle(e);
      return /(auto|scroll)/.test(style.overflowY) && e.scrollHeight > e.clientHeight + 50;
    });
    el = scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? document.scrollingElement;
  }
  window.__nakamaScrollTarget = el;
  const before = { height: el.scrollHeight, top: Math.round(el.scrollTop) };
  el.scrollBy(0, pixels);
  const target = el === document.scrollingElement ? "page" : el.tagName.toLowerCase() + (el.id ? "#" + el.id : "");
  return { before, target };
}, input);
if (!start) throw new Error("No element matches " + input.selector + ".");
await page.waitForTimeout(1500);
// Feeds such as LinkedIn load the next posts only after the bottom is reached,
// so give them a few seconds before calling it the end.
const bottom = await page.evaluate(() => {
  const el = window.__nakamaScrollTarget;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 4 ? el.scrollHeight : null;
});
if (bottom !== null) {
  await page
    .waitForFunction((height) => window.__nakamaScrollTarget.scrollHeight > height, bottom, { timeout: 8000 })
    .catch(() => null);
}
const after = await page.evaluate(() => {
  const el = window.__nakamaScrollTarget;
  return {
    atEnd: el.scrollTop + el.clientHeight >= el.scrollHeight - 4,
    height: el.scrollHeight,
    top: Math.round(el.scrollTop),
  };
});
return { ...start, after };`;

export function createBrowserTools(): ToolDefinition[] {
  return [
    {
      description:
        "Open a URL in the user's cloud browser. The user sees it live in the chat's Browser panel. Returns the final URL, the page title, and loginForm: true when the page asks for a password.",
      name: "browser_navigate",
      parameters: {
        additionalProperties: false,
        properties: {
          url: {
            description: "Full http or https address.",
            type: "string",
          },
        },
        required: ["url"],
        type: "object",
      },
      async run(input, context) {
        const { url } = NavigateInputSchema.parse(input);

        const outcome = await runScript(
          context,
          withInput({ url: readHttpUrl(url) }, NAVIGATE_SCRIPT)
        );

        return outcome.result;
      },
    },
    {
      description:
        "Read the visible text of the current page, plus the links in it (text and URL). Reads <main>, else <body>, unless you give a CSS selector. Use the link URLs with browser_navigate when a click does nothing. Text is capped at 20,000 characters.",
      name: "browser_read",
      parameters: {
        additionalProperties: false,
        properties: {
          maxChars: {
            description: "Return at most this many characters of text.",
            type: "number",
          },
          offset: {
            description:
              "Start at this character. After browser_scroll, pass the totalChars from your last read to get only the new text.",
            type: "number",
          },
          selector: {
            description: "CSS selector of the part of the page to read.",
            type: "string",
          },
        },
        type: "object",
      },
      async run(input, context) {
        const parsed = ReadInputSchema.parse(input);

        const outcome = await runScript(
          context,
          withInput(
            { maxLinks: MAX_LINKS, selector: parsed.selector?.trim() || null },
            READ_SCRIPT
          )
        );

        const page = z
          .object({ text: z.string() })
          .passthrough()
          .parse(outcome.result);

        const limit = Math.min(
          Math.max(Math.trunc(parsed.maxChars ?? MAX_OUTPUT_CHARS), 1),
          MAX_OUTPUT_CHARS
        );

        const offset = Math.min(
          Math.max(Math.trunc(parsed.offset ?? 0), 0),
          page.text.length
        );

        const capped = capText(page.text.slice(offset, offset + limit));

        return {
          ...page,
          offset,
          text: capped.text,
          totalChars: page.text.length,
          truncated: capped.truncated || page.text.length > offset + limit,
        };
      },
    },
    {
      description:
        "Scroll the page, then wait for new content to load. Without a selector it scrolls the largest scrollable area, which is the feed on apps like LinkedIn that never scroll the window. Returns the position before and after, and atEnd when nothing more loads.",
      name: "browser_scroll",
      parameters: {
        additionalProperties: false,
        properties: {
          pixels: {
            description:
              "How far to scroll. Negative scrolls up. Defaults to 2000.",
            type: "number",
          },
          selector: {
            description: "CSS selector of the element to scroll.",
            type: "string",
          },
        },
        type: "object",
      },
      async run(input, context) {
        const parsed = ScrollInputSchema.parse(input);

        const outcome = await runScript(
          context,
          withInput(
            {
              pixels: Math.trunc(parsed.pixels ?? 2000),
              selector: parsed.selector?.trim() || null,
            },
            SCROLL_SCRIPT
          )
        );

        return outcome.result;
      },
    },
    {
      description:
        "Run Playwright code in the user's cloud browser for steps the other browser tools cannot do, such as clicking a button or filling a form. `page`, `context`, and `browser` are in scope; `return` a small value. Return only what you need, never whole pages.",
      name: "browser_playwright",
      parameters: {
        additionalProperties: false,
        properties: {
          code: {
            description:
              'Playwright code body, for example: await page.getByRole("button", { name: "Next" }).click(); return page.url();',
            type: "string",
          },
          timeoutSec: {
            description: "Time limit in seconds, at most 120. Defaults to 45.",
            type: "number",
          },
        },
        required: ["code"],
        type: "object",
      },
      async run(input, context) {
        const parsed = PlaywrightInputSchema.parse(input);

        const timeoutSec = Math.min(
          Math.max(
            Math.trunc(parsed.timeoutSec ?? DEFAULT_SCRIPT_TIMEOUT_SEC),
            1
          ),
          MAX_PLAYWRIGHT_TIMEOUT_SEC
        );

        const outcome = await runScript(context, parsed.code, timeoutSec);
        const serialized = JSON.stringify(outcome.result ?? null);
        const capped = capText(serialized);

        return {
          result: capped.truncated ? capped.text : (outcome.result ?? null),
          stdout: outcome.stdout ? capText(outcome.stdout).text : undefined,
          truncated: capped.truncated,
        };
      },
    },
    {
      description:
        "Take a screenshot of the user's cloud browser screen. Use it when text is not enough, or to find pixel positions for browser_computer.",
      name: "browser_screenshot",
      parameters: {
        additionalProperties: false,
        properties: {},
        type: "object",
      },
      async run(_input, context) {
        return await screenshotResult(context);
      },
    },
    {
      description:
        "Use the mouse and keyboard on the user's cloud browser at pixel positions from browser_screenshot. Use it only when browser_playwright cannot do the step. Returns a screenshot after the actions.",
      name: "browser_computer",
      parameters: {
        additionalProperties: false,
        properties: {
          actions: {
            description:
              'Steps in order, at most 20. Types: click {x, y, button?, double?}, type {text}, key {keys: ["Return"]}, scroll {x, y, deltaY, deltaX?}, drag {path: [[x, y], ...]}, wait {ms}.',
            items: { type: "object" },
            type: "array",
          },
        },
        required: ["actions"],
        type: "object",
      },
      async run(input, context) {
        const { actions } = ComputerInputSchema.parse(input);
        const browser = await resolveBrowser(context);

        await bringChatTabToFront(browser);

        await runKernelComputerActions(browser.apiKey, browser.browserName, [
          ...actions.map(toKernelAction),
          { sleep: { duration_ms: 500 }, type: "sleep" },
        ]);

        return await screenshotResult(context, browser);
      },
    },
  ];
}
