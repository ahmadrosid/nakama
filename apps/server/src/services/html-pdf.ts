import { realpath } from "node:fs/promises";
import { NakamaApiError } from "@nakama/core";
import { resolvePythonBin } from "./python-tool-loader";

const PDF_TIMEOUT_MS = 60_000;

/**
 * WeasyPrint renders without a browser. Its fetcher is the only gate on what
 * the HTML can pull in, so it allows what the preview CSP allows: files in the
 * artifacts folder, data URLs and Google Fonts. Anything else (other local
 * files, internal hosts) would end up inside the PDF.
 */
const WEASYPRINT_SCRIPT = `
import os, re, sys, urllib.parse
try:
    import weasyprint
except ImportError:
    sys.exit(3)

html_path, root = sys.argv[1], sys.argv[2]
remote = ("https://fonts.googleapis.com/", "https://fonts.gstatic.com/")

def check(url):
    if url.startswith("file://"):
        path = os.path.realpath(urllib.parse.unquote(urllib.parse.urlparse(url).path))
        if path.startswith(root + os.sep):
            return
    elif url.startswith("data:") or url.startswith(remote):
        return
    raise ValueError("blocked: " + url[:80])

try:
    from weasyprint.urls import URLFetcher
except ImportError:
    # Older WeasyPrint (for example Debian's package) takes a plain function.
    def fetch(url, timeout=10, ssl_context=None):
        check(url)
        return weasyprint.default_url_fetcher(url, timeout, ssl_context)
else:
    # Redirects come back through fetch(), so each hop is checked too.
    class Fetcher(URLFetcher):
        def fetch(self, url, headers=None):
            check(url)
            return super().fetch(url, headers)
    fetch = Fetcher()

# WeasyPrint has no container units, and clamp() with one crashes it. A deck
# slide fills the 16in page, so 1cqw is 1vw there.
units = {"w": "vw", "i": "vw", "h": "vh", "b": "vh", "min": "vmin", "max": "vmax"}
with open(html_path, encoding="utf-8") as file:
    html = re.sub(r"(?<=[\\d.])cq(min|max|w|h|i|b)\\b", lambda m: units[m[1]], file.read())

weasyprint.HTML(string=html, base_url=html_path, url_fetcher=fetch).write_pdf(sys.stdout.buffer)
`;

export async function convertHtmlArtifactToPdf(
  filePath: string,
  artifactsDir: string,
  pythonBin: string = resolvePythonBin()
): Promise<Buffer> {
  const child = Bun.spawn(
    [
      pythonBin,
      "-c",
      WEASYPRINT_SCRIPT,
      filePath,
      await realpath(artifactsDir),
    ],
    { stderr: "pipe", stdout: "pipe", timeout: PDF_TIMEOUT_MS }
  );

  const [pdf, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (exitCode === 3) {
    throw new NakamaApiError(
      "PDF export needs WeasyPrint for the server's Python (pip install weasyprint).",
      501
    );
  }

  if (exitCode !== 0) {
    throw new NakamaApiError(
      `Could not convert the artifact to PDF: ${stderr.trim().split("\n").at(-1) ?? "unknown error"}`,
      500
    );
  }

  return Buffer.from(pdf);
}
