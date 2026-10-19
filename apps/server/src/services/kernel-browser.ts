import { NakamaApiError } from "@nakama/core";
import { z } from "zod";

const KERNEL_API_URL = "https://api.onkernel.com";

const KERNEL_REQUEST_TIMEOUT_MS = 30_000;

/** Idle time, counting live view use, before Kernel stops and saves the browser. */
const KERNEL_BROWSER_IDLE_SECONDS = 600;

/**
 * Kernel's screen size is the screenshot size. A 1920×1080 PNG ran to 650 KB
 * per step in the LinkedIn spike; this keeps screenshots small while computer
 * clicks still use the same coordinates the screenshot shows.
 */
const KERNEL_BROWSER_VIEWPORT = { height: 800, width: 1280 };

const kernelBrowserSchema = z.object({
  browser_live_view_url: z.string().optional(),
  cdp_ws_url: z.string(),
  session_id: z.string(),
});

type KernelBrowser = z.infer<typeof kernelBrowserSchema>;

const playwrightResultSchema = z.object({
  error: z.string().optional(),
  result: z.json().optional(),
  stderr: z.string().optional(),
  stdout: z.string().optional(),
  success: z.boolean(),
});

export type KernelPlaywrightResult = z.infer<typeof playwrightResultSchema>;

interface KernelProfileRequest {
  name: string;
}

interface KernelBrowserRequest {
  headless: boolean;
  name: string;
  profile: { name: string; save_changes: boolean };
  timeout_seconds: number;
  viewport: { height: number; width: number };
}

interface KernelPlaywrightRequest {
  code: string;
  executor?: string;
  timeout_sec: number;
}

export type KernelComputerAction =
  | {
      click_mouse: {
        button?: "left" | "middle" | "right";
        num_clicks?: number;
        x: number;
        y: number;
      };
      type: "click_mouse";
    }
  | { press_key: { keys: string[] }; type: "press_key" }
  | {
      scroll: { delta_x: number; delta_y: number; x: number; y: number };
      type: "scroll";
    }
  | { drag_mouse: { path: [number, number][] }; type: "drag_mouse" }
  | { sleep: { duration_ms: number }; type: "sleep" }
  | { type: "type_text"; type_text: { text: string } };

type KernelRequestBody =
  | KernelBrowserRequest
  | KernelPlaywrightRequest
  | KernelProfileRequest
  | { actions: KernelComputerAction[] }
  | Record<string, never>;

function kernelName(...parts: string[]): string {
  return ["nakama", ...parts.map((part) => part.replace(/[^A-Za-z0-9_-]/g, ""))]
    .join("-")
    .slice(0, 255);
}

function kernelRequest(
  apiKey: string,
  method: "DELETE" | "GET" | "POST",
  path: string,
  body?: KernelRequestBody,
  timeoutMs = KERNEL_REQUEST_TIMEOUT_MS
): Promise<Response> {
  return fetch(`${KERNEL_API_URL}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function kernelFailure(
  response: Response,
  action: string
): Promise<NakamaApiError> {
  const detail = (await response.text().catch(() => "")).slice(0, 300);

  return new NakamaApiError(
    `Kernel could not ${action} (HTTP ${response.status})${detail ? `: ${detail}` : "."}`,
    502
  );
}

function browserPath(name: string, suffix = ""): string {
  return `/browsers/${encodeURIComponent(name)}${suffix}`;
}

export async function getKernelBrowser(
  apiKey: string,
  name: string
): Promise<KernelBrowser | null> {
  const response = await kernelRequest(apiKey, "GET", browserPath(name));

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw await kernelFailure(response, "read the browser");
  }

  return kernelBrowserSchema.parse(await response.json());
}

export function userBrowserName(orgId: string, userId: string): string {
  return kernelName(orgId, "user", userId);
}

/**
 * One Kernel browser per user in each org, found again by its name, so every
 * chat and agent of that user and the live view in the web UI share it. A
 * login the user makes once is there in the next chat. Kernel saves the
 * browser into the user's profile when it stops, so a later browser starts
 * signed in too. Other users never get it: their logins are their own.
 */
export async function ensureKernelBrowser(
  apiKey: string,
  orgId: string,
  userId: string
): Promise<KernelBrowser> {
  const name = userBrowserName(orgId, userId);
  const existing = await getKernelBrowser(apiKey, name);

  if (existing) {
    return existing;
  }

  const profile = await kernelRequest(apiKey, "POST", "/profiles", { name });

  if (!(profile.ok || profile.status === 409)) {
    throw await kernelFailure(profile, "create the browser profile");
  }

  const created = await kernelRequest(apiKey, "POST", "/browsers", {
    headless: false,
    name,
    profile: { name, save_changes: true },
    timeout_seconds: KERNEL_BROWSER_IDLE_SECONDS,
    viewport: KERNEL_BROWSER_VIEWPORT,
  });

  if (created.status === 409) {
    const raced = await getKernelBrowser(apiKey, name);

    if (raced) {
      return raced;
    }
  }

  if (!created.ok) {
    throw await kernelFailure(created, "start a browser");
  }

  return kernelBrowserSchema.parse(await created.json());
}

/** Deleting the Kernel browser is what saves its cookies to the profile. */
export async function deleteKernelBrowser(
  apiKey: string,
  name: string
): Promise<void> {
  const response = await kernelRequest(apiKey, "DELETE", browserPath(name));

  if (!(response.ok || response.status === 404)) {
    throw await kernelFailure(response, "stop the browser");
  }
}

/** Kernel executor names: letters, digits, `_` and `-`, at most 64. */
export function chatExecutorName(sessionId: string): string | undefined {
  const name = sessionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

  return name || undefined;
}

/**
 * Runs Playwright code inside the browser's VM. A named executor owns its own
 * tab, so each chat drives its own tab of the user's one browser. Kernel allows
 * eight named executors; past that the call falls back to the default executor
 * and the active tab rather than failing the chat.
 */
export async function executeKernelPlaywright(
  apiKey: string,
  browserName: string,
  input: { code: string; executor?: string; timeoutSec: number }
): Promise<KernelPlaywrightResult> {
  const send = (executor: string | undefined) => {
    const body: KernelPlaywrightRequest = {
      code: input.code,
      timeout_sec: input.timeoutSec,
    };

    if (executor) {
      body.executor = executor;
    }

    return kernelRequest(
      apiKey,
      "POST",
      browserPath(browserName, "/playwright/execute"),
      body,
      (input.timeoutSec + 15) * 1000
    );
  };

  let response = await send(input.executor);

  if (response.status === 409 && input.executor) {
    response = await send(undefined);
  }

  if (!response.ok) {
    throw await kernelFailure(response, "run the browser step");
  }

  return playwrightResultSchema.parse(await response.json());
}

export async function captureKernelScreenshot(
  apiKey: string,
  browserName: string
): Promise<{ data: string; mediaType: string }> {
  const response = await kernelRequest(
    apiKey,
    "POST",
    browserPath(browserName, "/computer/screenshot"),
    {}
  );

  if (!response.ok) {
    throw await kernelFailure(response, "take a screenshot");
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  return {
    data: bytes.toString("base64"),
    mediaType: response.headers.get("content-type") ?? "image/png",
  };
}

export async function runKernelComputerActions(
  apiKey: string,
  browserName: string,
  actions: KernelComputerAction[]
): Promise<void> {
  const response = await kernelRequest(
    apiKey,
    "POST",
    browserPath(browserName, "/computer/batch"),
    { actions },
    60_000
  );

  if (!response.ok) {
    throw await kernelFailure(response, "run the mouse and keyboard actions");
  }
}
