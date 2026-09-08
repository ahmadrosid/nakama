import type { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import type { RequestAuthContext } from "./shared";

export type AppEnv = {
  Variables: RequestIdVariables & {
    auth: RequestAuthContext;
  };
};

export type HonoApp = OpenAPIHono<AppEnv>;
