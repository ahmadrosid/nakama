import { createRoute, z } from "@hono/zod-openapi";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";
import { errorResponse, json } from "../shared";
import {
  requireNotViewerFromContext,
  requirePlatformAdminFromContext,
} from "../org-guards";
import type { WorkerLogsResponse } from "@nakama/core";

export function registerWorkerRoutes(app: HonoApp, options: ServerOptions): void {
  const { workerManager } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const workerLogsSchema = z.object({
    worker: z.string(),
    lines: z.array(z.string()),
  }).passthrough().openapi("WorkerLogsResponse");
  const okSchema = z.object({ ok: z.boolean() });
  const workerParam = z.object({
    name: z.string().openapi({ param: { name: "name", in: "path" } }),
  });
  const workerActionParam = z.object({
    name: z.string().openapi({ param: { name: "name", in: "path" } }),
    action: z.enum(["start", "stop", "restart"]).openapi({ param: { name: "action", in: "path" } }),
  });
  const workerLogsQuery = z.object({
    lines: z.string().optional(),
  });

  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/workers/{name}/{action}",
    tags: ["Workers"],
    summary: "Control a worker",
    operationId: "workerAction",
    request: { params: workerActionParam },
    responses: {
      200: { description: "Worker action succeeded", content: { "application/json": { schema: okSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/workers/{name}/logs",
    tags: ["Workers"],
    summary: "Get worker logs",
    operationId: "getWorkerLogs",
    request: { params: workerParam, query: workerLogsQuery },
    responses: {
      200: { description: "Worker logs", content: { "application/json": { schema: workerLogsSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/workers/{name}/clear-logs",
    tags: ["Workers"],
    summary: "Clear worker logs",
    operationId: "clearWorkerLogs",
    request: { params: workerParam },
    responses: {
      200: { description: "Worker logs cleared", content: { "application/json": { schema: okSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));

  app.post("/v1/workers/:name/:action{start|stop|restart}", async (c) => {
    const name = decodeURIComponent(c.req.param("name"));
    const action = c.req.param("action");
    if (name === "telegram" || name === "whatsapp" || name === "discord") {
      requirePlatformAdminFromContext(c);
    } else {
      requireNotViewerFromContext(c);
    }

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

    if (!workerManager.isValidWorker(name)) {
      return errorResponse(`Unknown worker: ${name}`, 400);
    }

    const linesParam = c.req.query("lines");
    const lines = Math.min(
      Math.max(1, linesParam ? parseInt(linesParam, 10) : 200),
      2000,
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
    requireNotViewerFromContext(c);
    const name = decodeURIComponent(c.req.param("name"));

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
