import type { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import type { RequestAuthContext } from "./shared";

/**
 * What the rate limiter needs from Bun's `Server`, kept structural so the HTTP
 * layer does not depend on the runtime type.
 */
type RequestAddressSource = {
  requestIP?: (request: Request) => { address: string } | null;
};

export type AppEnv = {
  Bindings: {
    server?: RequestAddressSource;
  };
  Variables: RequestIdVariables & {
    auth: RequestAuthContext;
  };
};

export type HonoApp = OpenAPIHono<AppEnv>;
