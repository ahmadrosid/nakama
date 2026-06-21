import type { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestAuthContext } from "./shared";

export type AppEnv = {
  Variables: {
    auth: RequestAuthContext;
  };
};

export type HonoApp = OpenAPIHono<AppEnv>;
