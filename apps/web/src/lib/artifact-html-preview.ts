import {
  assertHtmlArtifactSize,
  MAX_HTML_ARTIFACT_BYTES,
} from "@nakama/core/artifact-mime";

const HIDDEN_SCROLLBAR_STYLE =
  "<style data-nakama-html-preview>html,body{scrollbar-width:none;-ms-overflow-style:none}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}</style>";

/** Scripts run inside the iframe, but without same-origin access to the host app. */
export const ARTIFACT_HTML_IFRAME_SANDBOX = "allow-scripts";

/** Served by the API with its own CSP; see `ARTIFACT_FRAME_HTML` on the server. */
export const ARTIFACT_FRAME_URL = "/artifact-frame";

export const ARTIFACT_FRAME_READY = "nakama-artifact-frame-ready";

const ARTIFACT_PRINT_DONE = "nakama-artifact-print-done";

/** Runs inside the frame: wait for fonts, open the print dialog, then report back. */
const PRINT_SCRIPT = `<script>(() => {
  const go = () => document.fonts.ready.then(() => setTimeout(() => {
    addEventListener("afterprint", () => parent.postMessage("${ARTIFACT_PRINT_DONE}", "*"));
    print();
  }, 100));
  document.readyState === "complete" ? go() : addEventListener("load", go);
})();</script>`;

/**
 * Prints an HTML artifact with the browser's own print dialog, where the user
 * picks "Save as PDF". The browser renders it the same way as the preview.
 */
export function printArtifactHtml(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", `${ARTIFACT_HTML_IFRAME_SANDBOX} allow-modals`);
  frame.src = ARTIFACT_FRAME_URL;
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;width:0;height:0;border:0";

  const cleanup = () => {
    window.removeEventListener("message", onMessage);
    frame.remove();
  };

  function onMessage(event: MessageEvent) {
    if (event.source !== frame.contentWindow) {
      return;
    }

    if (event.data === ARTIFACT_FRAME_READY) {
      frame.contentWindow?.postMessage(
        {
          nakamaArtifactHtml: `${htmlForArtifactPreview(html)}${PRINT_SCRIPT}`,
        },
        "*"
      );
    } else if (event.data === ARTIFACT_PRINT_DONE) {
      cleanup();
    }
  }

  window.addEventListener("message", onMessage);
  document.body.append(frame);
  // Some browsers never send afterprint; do not keep the frame forever.
  window.setTimeout(cleanup, 10 * 60_000);
}

export function htmlForArtifactPreview(html: string): string {
  if (new TextEncoder().encode(html).byteLength > MAX_HTML_ARTIFACT_BYTES) {
    return `<p role="alert">HTML artifacts cannot exceed ${MAX_HTML_ARTIFACT_BYTES} bytes.</p>`;
  }

  if (/<head[\s>]/i.test(html)) {
    return html.replace(
      /<head(\s[^>]*)?>/i,
      (match) => `${match}${HIDDEN_SCROLLBAR_STYLE}`
    );
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(
      /<html(\s[^>]*)?>/i,
      (match) => `${match}<head>${HIDDEN_SCROLLBAR_STYLE}</head>`
    );
  }

  return `${HIDDEN_SCROLLBAR_STYLE}${html}`;
}

const ABSOLUTE_ASSET_URL = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i;

const CSS_ASSET_URL =
  /\/\*[\s\S]*?\*\/|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)|@import\s+(?:"([^"]*)"|'([^']*)')|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi;

function relativeAssetPath(
  reference: string,
  parentPath: string
): string | null {
  const parts = reference.startsWith("/")
    ? []
    : parentPath.split("/").slice(0, -1).filter(Boolean);

  const pathname = reference.split(/[?#]/, 1)[0];

  for (const encoded of pathname.split("/")) {
    let part: string;

    try {
      part = decodeURIComponent(encoded);
    } catch {
      return null;
    }

    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      if (!parts.pop()) {
        return null;
      }
    } else if (/[\\/\u0000]/.test(part)) {
      return null;
    } else {
      parts.push(part);
    }
  }

  return parts.join("/");
}

/** Fetch through the parent client: sandboxed frames cannot send session cookies. */
export async function resolveArtifactHtmlAssets(
  html: string,
  artifactPath: string,
  readAsset: (
    path: string
  ) => Promise<{ data: ArrayBuffer; contentType: string }>,
  signal: AbortSignal
): Promise<string> {
  assertHtmlArtifactSize(
    artifactPath,
    new TextEncoder().encode(html).byteLength,
    "text/html"
  );
  const document = new DOMParser().parseFromString(html, "text/html");
  const cache = new Map<string, string>();
  signal.throwIfAborted();

  async function rewriteCss(
    css: string,
    path: string,
    ancestors: string[]
  ): Promise<string> {
    let output = "";
    let offset = 0;

    for (const match of css.matchAll(CSS_ASSET_URL)) {
      const reference =
        match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];

      let replacement = match[0];

      if (
        reference !== undefined &&
        !ABSOLUTE_ASSET_URL.test(reference.trim())
      ) {
        const url = await resolve(reference, path, ancestors);
        replacement =
          match[4] !== undefined || match[5] !== undefined
            ? `@import "${url}"`
            : `url("${url}")`;
      }

      output += css.slice(offset, match.index) + replacement;
      offset = match.index + match[0].length;
    }

    return output + css.slice(offset);
  }

  async function resolve(
    reference: string,
    parentPath: string,
    ancestors: string[] = []
  ): Promise<string> {
    const value = reference.trim();

    if (!value || ABSOLUTE_ASSET_URL.test(value)) {
      return value;
    }

    try {
      signal.throwIfAborted();
      const path = parentPath ? relativeAssetPath(value, parentPath) : null;

      if (!path || ancestors.includes(path) || ancestors.length >= 16) {
        return "about:blank";
      }

      const fragment = value.includes("#")
        ? value.slice(value.indexOf("#"))
        : "";

      const cached = cache.get(path);

      if (cached) {
        return cached + fragment;
      }

      const asset = await readAsset(path);
      signal.throwIfAborted();
      const isCss = asset.contentType.split(";", 1)[0] === "text/css";

      const data = isCss
        ? await rewriteCss(new TextDecoder().decode(asset.data), path, [
            ...ancestors,
            path,
          ])
        : asset.data;

      signal.throwIfAborted();
      const bytes = new Uint8Array(await new Blob([data]).arrayBuffer());
      signal.throwIfAborted();
      let binary = "";

      for (let offset = 0; offset < bytes.length; offset += 0x80_00) {
        binary += String.fromCharCode(
          ...bytes.subarray(offset, offset + 0x80_00)
        );
      }

      // Parent-created blob URLs are also inaccessible to an opaque-origin iframe.
      const url = `data:${asset.contentType.split(";", 1)[0]};base64,${btoa(binary)}`;
      cache.set(path, url);

      return url + fragment;
    } catch {
      // A missing attachment must not prevent the HTML and other assets rendering.
      signal.throwIfAborted();

      return "about:blank";
    }
  }

  // Preserve explicit external base URLs; they already resolve without profile access.
  const baseHref = document
    .querySelector("base[href]")
    ?.getAttribute("href")
    ?.trim();

  if (baseHref && /^(?:https?:)?\/\//i.test(baseHref)) {
    return html;
  }

  const basePath = baseHref
    ? relativeAssetPath(baseHref, artifactPath)
    : artifactPath;

  const parentPath =
    basePath === null
      ? ""
      : baseHref?.endsWith("/")
        ? `${basePath}/index.html`
        : basePath;

  document.querySelectorAll("base").forEach((node) => {
    node.remove();
  });

  for (const node of document.querySelectorAll(
    "[src], video[poster], link[rel~='stylesheet'][href]"
  )) {
    for (const attr of ["src", "poster", "href"]) {
      const value = node.getAttribute(attr);

      if (value !== null) {
        node.setAttribute(attr, await resolve(value, parentPath));
      }
    }
  }

  for (const node of document.querySelectorAll("[srcset]")) {
    const candidates: string[] = [];

    for (const match of (node.getAttribute("srcset") ?? "").matchAll(
      /(\S+)(?:\s+([^,]*))?(?:,|$)/g
    )) {
      const url = await resolve(match[1].replace(/,+$/, ""), parentPath);
      candidates.push(`${url}${match[2] ? ` ${match[2].trim()}` : ""}`);
    }

    node.setAttribute("srcset", candidates.join(", "));
  }

  for (const node of document.querySelectorAll("style, [style]")) {
    if (node.tagName === "STYLE") {
      node.textContent = await rewriteCss(
        node.textContent ?? "",
        parentPath,
        []
      );
    }

    if (node.hasAttribute("style")) {
      node.setAttribute(
        "style",
        await rewriteCss(node.getAttribute("style") ?? "", parentPath, [])
      );
    }
  }

  const output = `${document.doctype ? "<!DOCTYPE html>" : ""}${document.documentElement.outerHTML}`;
  assertHtmlArtifactSize(
    artifactPath,
    new TextEncoder().encode(output).byteLength,
    "text/html"
  );

  return output;
}
