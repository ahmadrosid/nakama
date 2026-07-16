const HIDDEN_SCROLLBAR_STYLE = `<style data-nakama-html-preview>html,body{scrollbar-width:none;-ms-overflow-style:none}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}</style>`;

/** Scripts run inside the iframe, but without same-origin access to the host app. */
export const ARTIFACT_HTML_IFRAME_SANDBOX = "allow-scripts allow-forms allow-popups";

export function htmlForArtifactPreview(html: string): string {
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${HIDDEN_SCROLLBAR_STYLE}`);
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}<head>${HIDDEN_SCROLLBAR_STYLE}</head>`);
  }

  return `${HIDDEN_SCROLLBAR_STYLE}${html}`;
}
