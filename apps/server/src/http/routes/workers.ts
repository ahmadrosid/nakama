import { createRoute, z } from "@hono/zod-openapi";
import type { WorkerLogsResponse } from "@nakama/core";
import type { Context } from "hono";
import type { ServerOptions } from "../context";
import {
  requireNotViewerFromContext,
  requirePlatformAdminFromContext,
} from "../org-guards";
import { errorResponse, json } from "../shared";
import type { AppEnv, HonoApp } from "../types";

const PLATFORM_ADMIN_WORKERS = new Set(["telegram", "whatsapp", "discord"]);

function requireWorkerAuthorization(c: Context<AppEnv>, name: string): void {
  if (PLATFORM_ADMIN_WORKERS.has(name)) {
    requirePlatformAdminFromContext(c);
  } else {
    requireNotViewerFromContext(c);
  }
}

export function registerWorkerRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const { workerManager } = options;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const workerLogsSchema = z
    .object({
      lines: z.array(z.string()),
      worker: z.string(),
    })
    .passthrough()
    .openapi("WorkerLogsResponse");
  const okSchema = z.object({ ok: z.boolean() });
  const workerParam = z.object({
    name: z.string().openapi({ param: { in: "path", name: "name" } }),
  });
  const workerActionParam = z.object({
    action: z
      .enum(["start", "stop", "restart"])
      .openapi({ param: { in: "path", name: "action" } }),
    name: z.string().openapi({ param: { in: "path", name: "name" } }),
  });
  const workerLogsQuery = z.object({
    lines: z.string().optional(),
  });

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "workerAction",
      path: "/v1/workers/{name}/{action}",
      request: { params: workerActionParam },
      responses: {
        200: {
          content: { "application/json": { schema: okSchema } },
          description: "Worker action succeeded",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Control a worker",
      tags: ["Workers"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getWorkerLogs",
      path: "/v1/workers/{name}/logs",
      request: { params: workerParam, query: workerLogsQuery },
      responses: {
        200: {
          content: { "application/json": { schema: workerLogsSchema } },
          description: "Worker logs",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get worker logs",
      tags: ["Workers"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "clearWorkerLogs",
      path: "/v1/workers/{name}/clear-logs",
      request: { params: workerParam },
      responses: {
        200: {
          content: { "application/json": { schema: okSchema } },
          description: "Worker logs cleared",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Clear worker logs",
      tags: ["Workers"],
    })
  );

  app.post("/v1/workers/:name/:action{start|stop|restart}", async (c) => {
    const name = decodeURIComponent(c.req.param("name"));
    const action = c.req.param("action");
    requireWorkerAuthorization(c, name);

    if (!workerManager.isValidWorker(name)) {
      return errorResponse(`Unknown worker: ${name}`, 400);
    }

    try {
      if (action === "start") {
        await workerManager.startWorker(name);
      } else if (action === "stop") {
        await workerManager.stopWorker(name);
      } else {
        await workerManager.restartWorker(name);
      }

      return json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(message, 500);
    }
  });

  app.get("/v1/workers/:name/logs", async (c) => {
    const name = decodeURIComponent(c.req.param("name"));
    requireWorkerAuthorization(c, name);

    if (!workerManager.isValidWorker(name)) {
      return errorResponse(`Unknown worker: ${name}`, 400);
    }

    const linesParam = c.req.query("lines");
    const lines = Math.min(
      Math.max(1, linesParam ? Number.parseInt(linesParam, 10) : 200),
      2000
    );

    try {
      const logs = await workerManager.getWorkerLogs(name, lines);
      return json<WorkerLogsResponse>(logs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(message, 500);
    }
  });

  app.post("/v1/workers/:name/clear-logs", async (c) => {
    const name = decodeURIComponent(c.req.param("name"));
    requireWorkerAuthorization(c, name);

    if (!workerManager.isValidWorker(name)) {
      return errorResponse(`Unknown worker: ${name}`, 400);
    }

    try {
      await workerManager.clearWorkerLogs(name);
      return json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(message, 500);
    }
  });
}
