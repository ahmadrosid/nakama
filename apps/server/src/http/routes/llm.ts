import { z } from "@hono/zod-openapi";
import {
  type ComputerAuthService,
  computerTokenRequestSchema,
} from "../../services/computer-auth";
import { readJson } from "../shared";
import type { HonoApp } from "../types";

export const LLM_TOKEN_PATH = "/v1/llm/token";

/**
 * Model access for Nakama Desktop. There is no user session here: a computer
 * signs a request with its device key to get a pass, then sends the pass.
 */
export function registerLlmRoutes(
  app: HonoApp,
  computerAuth: ComputerAuthService
): void {
  app.post(LLM_TOKEN_PATH, async (c) => {
    const request = computerTokenRequestSchema.safeParse(
      await readJson(c.req.raw, z.unknown())
    );

    const issued = request.success
      ? await computerAuth.issuePass(request.data, {
          method: "POST",
          path: LLM_TOKEN_PATH,
        })
      : null;

    return issued
      ? c.json(issued, 200)
      : c.json({ error: "Sign in again." }, 401);
  });
}
