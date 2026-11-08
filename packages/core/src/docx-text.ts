import { convertDocumentBytes } from "./anydoc-text";
import {
  LEGACY_DOC_UNSUPPORTED_MESSAGE,
  looksLikeUtf8Text,
} from "./artifact-mime";
import { convertHtmlToMarkdown } from "./tools/web-fetch";

/**
 * A real `.docx` is a ZIP archive, so it always starts with the local file header
 * magic `PK\x03\x04`.
 */
function looksLikeZipArchive(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** A genuine legacy `.doc` is an OLE compound file: `D0 CF 11 E0`. */
export function looksLikeOleDocument(bytes: Uint8Array): boolean {
  return (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  );
}

function looksLikeWordprocessingXml(text: string): boolean {
  return /<w:document[\s>]/i.test(text);
}

function looksLikeHtml(text: string): boolean {
  return /<!doctype html|<html[\s>]|<body[\s>]|<div[\s>]|<p[\s>]|<h[1-6][\s>]/i.test(
    text
  );
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Bare WordprocessingML (`word/document.xml` written straight to disk, never zipped)
 * is not a valid `.docx`, but it is still a document we can read: pull the text out
 * of each `<w:p>` and promote heading styles to Markdown headings.
 */
/**
 * Bodies of each `<w:NAME ...>...</w:NAME>` element, found with `indexOf` so the
 * scan stays linear on hostile input (a lazy regex goes quadratic when close tags
 * are missing). `<w:NAMEx` tags such as `<w:pPr>` or `<w:tab/>` are skipped, and a
 * self-closing `<w:NAME/>` has no body.
 */
function elementBodies(xml: string, name: string): string[] {
  const open = `<w:${name}`;
  const close = `</w:${name}>`;
  const bodies: string[] = [];
  let pos = 0;

  for (;;) {
    const start = xml.indexOf(open, pos);

    if (start === -1) {
      break;
    }

    const next = xml[start + open.length] ?? "";

    if (next !== ">" && next !== "/" && !/\s/.test(next)) {
      pos = start + open.length;
      continue;
    }

    const tagEnd = xml.indexOf(">", start);

    if (tagEnd === -1) {
      break;
    }

    if (xml[tagEnd - 1] === "/") {
      pos = tagEnd + 1;
      continue;
    }

    const end = xml.indexOf(close, tagEnd + 1);

    if (end === -1) {
      break;
    }

    bodies.push(xml.slice(tagEnd + 1, end));
    pos = end + close.length;
  }

  return bodies;
}

function convertWordprocessingXmlToMarkdown(xml: string): string {
  const blocks: string[] = [];

  for (const paragraph of elementBodies(xml, "p")) {
    const text = elementBodies(paragraph, "t")
      .map(decodeXmlEntities)
      .join("")
      .trim();

    if (!text) {
      continue;
    }

    const styleMatch = paragraph.match(/<w:pStyle\s+w:val="Heading(\d)"/i);
    const level = styleMatch ? Number(styleMatch[1]) : 0;
    blocks.push(
      level >= 1 && level <= 6 ? `${"#".repeat(level)} ${text}` : text
    );
  }

  return blocks.join("\n\n").trim();
}

/**
 * Read a Word-ish artifact as Markdown, deciding from the *bytes* rather than the
 * filename. Agents that only have a text-writing tool routinely save HTML (or raw
 * WordprocessingML) under a `.docx` name, and those files must still be readable
 * instead of dumping stylesheet source at the reader.
 */
export async function convertDocxToMarkdown(bytes: Buffer): Promise<string> {
  if (looksLikeZipArchive(bytes)) {
    const { text } = await convertDocumentBytes(bytes, { format: "docx" });

    return text;
  }

  // Only a real OLE payload is a true legacy .doc. A `.doc` file that actually holds
  // HTML is common (agents fake it) and stays perfectly readable, so judge the bytes.
  if (looksLikeOleDocument(bytes)) {
    throw new Error(LEGACY_DOC_UNSUPPORTED_MESSAGE);
  }

  if (!looksLikeUtf8Text(bytes)) {
    throw new Error(
      "This file is neither a valid .docx archive nor readable text, so it cannot be previewed."
    );
  }

  const text = bytes.toString("utf8");

  if (looksLikeWordprocessingXml(text)) {
    return convertWordprocessingXmlToMarkdown(text);
  }

  if (looksLikeHtml(text)) {
    return convertHtmlToMarkdown(text);
  }

  return text.trim();
}
