/** Window features for markdown external links — must include noopener. */
export const MARKDOWN_EXTERNAL_LINK_FEATURES = "noopener,noreferrer";

/** Open an untrusted markdown href in a new tab without retaining window.opener. */
export function openMarkdownExternalLink(href: string): Window | null {
  return window.open(href, "_blank", MARKDOWN_EXTERNAL_LINK_FEATURES);
}
