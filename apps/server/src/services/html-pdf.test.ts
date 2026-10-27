import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { convertHtmlArtifactToPdf } from "./html-pdf";

// The fake interpreter is a shell script, and CI has WeasyPrint only on POSIX.
const isWindows = process.platform === "win32";

const hasWeasyPrint =
  !isWindows &&
  Bun.spawnSync(["python3", "-c", "import weasyprint"]).exitCode === 0;

let dir: string;

/** WeasyPrint packs page objects into compressed object streams. */
function pdfPageCount(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  let objects = text;

  for (const match of text.matchAll(/stream\r?\n/g)) {
    const start = match.index + match[0].length;
    const end = text.indexOf("endstream", start);

    try {
      objects += inflateSync(pdf.subarray(start, end)).toString("latin1");
    } catch {
      // Not a deflate stream (for example an image); skip it.
    }
  }

  return objects.match(/\/Type\s*\/Page\b/g)?.length ?? 0;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "nakama-html-pdf-"));
});

afterEach(async () => {
  await rm(dir, { force: true, recursive: true });
});

test.skipIf(isWindows)(
  "reports 501 when the server's Python has no WeasyPrint",
  async () => {
    const python = path.join(dir, "python3");
    await writeFile(python, "#!/bin/sh\nexit 3\n");
    await chmod(python, 0o755);
    const html = path.join(dir, "deck.html");
    await writeFile(html, "<p>Deck</p>");

    await expect(
      convertHtmlArtifactToPdf(html, dir, python)
    ).rejects.toMatchObject({ status: 501 });
  }
);

test.skipIf(!hasWeasyPrint)(
  "renders every hidden slide of a deck as its own page",
  async () => {
    const html = path.join(dir, "deck.html");
    await writeFile(
      html,
      `<style>.slide[hidden]{display:block}@media print{.slide{break-after:page}}</style>
      <section class="slide">One</section>
      <section class="slide" hidden>Two</section>
      <section class="slide" hidden>Three</section>`
    );

    const pdf = await convertHtmlArtifactToPdf(html, dir, "python3");

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfPageCount(pdf)).toBe(3);
  }
);

test.skipIf(!hasWeasyPrint)(
  "renders a page that loads a sibling stylesheet and a blocked local file",
  async () => {
    const html = path.join(dir, "page.html");
    await writeFile(path.join(dir, "page.css"), "p{color:red}");
    await writeFile(
      html,
      '<link rel="stylesheet" href="page.css"><img src="file:///etc/hosts"><p>Page</p>'
    );

    const pdf = await convertHtmlArtifactToPdf(html, dir, "python3");

    expect(pdfPageCount(pdf)).toBe(1);
  }
);

test.skipIf(!hasWeasyPrint)(
  "renders a deck that sizes text with clamp() and container units",
  async () => {
    const html = path.join(dir, "deck.html");
    await writeFile(
      html,
      "<style>:root{--title:clamp(23px,5cqw,70px)}h1{font-size:var(--title)}</style><h1>Deck</h1>"
    );

    const pdf = await convertHtmlArtifactToPdf(html, dir, "python3");

    expect(pdfPageCount(pdf)).toBe(1);
  }
);
