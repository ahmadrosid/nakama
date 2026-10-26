import { z } from "@hono/zod-openapi";
import type {
  SkillInstallPreviewResponse,
  SkillsMarketplaceResponse,
} from "@nakama/core/contract";
import {
  previewSkillInstall,
  searchSkillsMarketplace,
} from "../../services/skills-marketplace";
import { requirePlatformAdminFromContext } from "../org-guards";
import { json, readJson } from "../shared";
import type { HonoApp } from "../types";

// Registered before the skill routes so /v1/skills/:skillId does not take "marketplace".
export function registerSkillsMarketplaceRoutes(app: HonoApp): void {
  app.get("/v1/skills/marketplace", async (c) => {
    requirePlatformAdminFromContext(c);

    return json<SkillsMarketplaceResponse>(
      await searchSkillsMarketplace(c.req.query("q") ?? "")
    );
  });

  app.post("/v1/skills/install/preview", async (c) => {
    requirePlatformAdminFromContext(c);
    const body = await readJson(c.req.raw, z.object({ command: z.string() }));

    return json<SkillInstallPreviewResponse>(
      await previewSkillInstall(body.command)
    );
  });
}
