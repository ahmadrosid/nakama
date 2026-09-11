import type { Context } from "./ui-context";
import { createPage } from "./ui-page";
export const inject = ["slots", "host", "styles", "ui"];
export function apply(ctx: Context) {
  ctx.styles(
    ".sm-page{max-width:960px;margin:0 auto;padding:24px;width:100%;box-sizing:border-box}.sm-stack{display:flex;flex-direction:column;gap:16px}.sm-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.sm-title{flex:1;min-width:0;overflow-wrap:anywhere}.sm-page h1{font-size:24px;font-weight:600}.sm-search{display:flex;gap:8px;flex:1;min-width:180px}.sm-card{border:1px solid var(--border);border-radius:10px;padding:16px}.sm-list{list-style:none;margin:0;padding:0;display:grid;gap:12px}.sm-excerpt{white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0}.sm-source{font-size:13px;overflow-wrap:anywhere;opacity:.7}.sm-stack label{display:grid;gap:6px}@media(max-width:600px){.sm-page{padding:16px}.sm-search{flex-basis:100%}}"
  );
  ctx.slots.register("page", createPage(ctx));
}
