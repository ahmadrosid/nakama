import type { McpRegistrySearchResponse } from "@nakama/core/contract";
import { searchMcpRegistry } from "../../services/mcp-registry";
import { requirePlatformAdminFromContext } from "../org-guards";
import { json } from "../shared";
import type { HonoApp } from "../types";

export function registerMcpRegistryRoutes(app: HonoApp): void {
  app.get("/v1/mcp/registry", async (c) => {
    requirePlatformAdminFromContext(c);

    return json<McpRegistrySearchResponse>(
      await searchMcpRegistry(c.req.query("search") ?? c.req.query("q") ?? "")
    );
  });
}
