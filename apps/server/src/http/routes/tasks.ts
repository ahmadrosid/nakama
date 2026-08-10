import { createRoute, z } from "@hono/zod-openapi";
import type {
  CreateTaskRequest,
  DraftTaskPromptRequest,
  DraftTaskPromptResponse,
  ListTaskRunsResponse,
  ListTasksResponse,
  RunTaskResponse,
  TaskMessagesResponse,
  TaskResponse,
  UpdateTaskRequest,
} from "@nakama/core";
import type { ServerOptions } from "../context";
import {
  requireActiveOrgIdFromContext,
  requireNotViewerFromContext,
} from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerTaskRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent, taskService } = options;
  const errorSchema = z
    .object({ error: z.string() })
    .openapi("ApiErrorResponse");
  const taskIdParam = z.object({
    taskId: z.string().openapi({ param: { in: "path", name: "taskId" } }),
  });
  const listTasksSchema = z
    .object({})
    .passthrough()
    .openapi("ListTasksResponse");
  const draftTaskPromptSchema = z
    .object({})
    .passthrough()
    .openapi("DraftTaskPromptRequest");
  const draftTaskPromptResponseSchema = z
    .object({})
    .passthrough()
    .openapi("DraftTaskPromptResponse");
  const createTaskSchema = z
    .object({})
    .passthrough()
    .openapi("CreateTaskRequest");
  const updateTaskSchema = z
    .object({})
    .passthrough()
    .openapi("UpdateTaskRequest");
  const taskSchema = z.object({}).passthrough().openapi("TaskResponse");
  const runTaskSchema = z.object({}).passthrough().openapi("RunTaskResponse");
  const listTaskRunsSchema = z
    .object({})
    .passthrough()
    .openapi("ListTaskRunsResponse");
  const taskMessagesSchema = z
    .object({})
    .passthrough()
    .openapi("TaskMessagesResponse");

  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "draftTaskPrompt",
      path: "/v1/tasks/draft-prompt",
      request: {
        body: {
          content: { "application/json": { schema: draftTaskPromptSchema } },
          required: true,
        },
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: draftTaskPromptResponseSchema },
          },
          description: "Generated prompt",
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
      summary: "Draft an agent prompt from task title and description",
      tags: ["Tasks"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listTasks",
      path: "/v1/tasks",
      responses: {
        200: {
          content: { "application/json": { schema: listTasksSchema } },
          description: "Tasks",
        },
      },
      summary: "List all tasks",
      tags: ["Tasks"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "createTask",
      path: "/v1/tasks",
      request: {
        body: {
          content: { "application/json": { schema: createTaskSchema } },
          required: true,
        },
      },
      responses: {
        201: {
          content: { "application/json": { schema: taskSchema } },
          description: "Task created",
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
      summary: "Create a task",
      tags: ["Tasks"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getTask",
      path: "/v1/tasks/{taskId}",
      request: { params: taskIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: taskSchema } },
          description: "Task",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get a task",
      tags: ["Tasks"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "put",
      operationId: "updateTask",
      path: "/v1/tasks/{taskId}",
      request: {
        body: {
          content: { "application/json": { schema: updateTaskSchema } },
          required: true,
        },
        params: taskIdParam,
      },
      responses: {
        200: {
          content: { "application/json": { schema: taskSchema } },
          description: "Task updated",
        },
        400: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Update a task",
      tags: ["Tasks"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "delete",
      operationId: "deleteTask",
      path: "/v1/tasks/{taskId}",
      request: { params: taskIdParam },
      responses: {
        204: { description: "Task deleted" },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Delete a task",
      tags: ["Tasks"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "post",
      operationId: "runTask",
      path: "/v1/tasks/{taskId}/run",
      request: { params: taskIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: runTaskSchema } },
          description: "Task run",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        409: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
        500: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Run a task now",
      tags: ["Tasks"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "listTaskRuns",
      path: "/v1/tasks/{taskId}/runs",
      request: { params: taskIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: listTaskRunsSchema } },
          description: "Task runs",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "List task run history",
      tags: ["Tasks"],
    })
  );
  app.openAPIRegistry.registerPath(
    createRoute({
      method: "get",
      operationId: "getTaskMessages",
      path: "/v1/tasks/{taskId}/messages",
      request: { params: taskIdParam },
      responses: {
        200: {
          content: { "application/json": { schema: taskMessagesSchema } },
          description: "Task chat messages",
        },
        404: {
          content: { "application/json": { schema: errorSchema } },
          description: "Error",
        },
      },
      summary: "Get task chat messages",
      tags: ["Tasks"],
    })
  );

  app.get("/v1/tasks", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const tasks = await taskService.listForOrg(orgId);
    return json<ListTasksResponse>({ tasks });
  });

  app.post("/v1/tasks/draft-prompt", async (c) => {
    requireNotViewerFromContext(c);
    const body = await readJson<DraftTaskPromptRequest>(c.req.raw);

    try {
      const prompt = await agent.draftTaskPrompt(body.title, body.description);
      return json<DraftTaskPromptResponse>({ prompt });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Task title is required."
      ) {
        return errorResponse(error.message, 400);
      }
      throw error;
    }
  });

  app.post("/v1/tasks", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<CreateTaskRequest>(c.req.raw);

    try {
      const task = await taskService.create(orgId, body, body.profileId, {
        isPlatformAdmin: auth.isPlatformAdmin,
        orgRole: auth.orgRole,
      });
      return json<TaskResponse>({ task }, 201);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "Profile not found.") {
          return errorResponse(error.message, 400);
        }

        if (
          error.message === "Task title is required." ||
          error.message === "Task prompt is required." ||
          error.message.startsWith("Invalid task status:")
        ) {
          return errorResponse(error.message, 400);
        }
      }
      throw error;
    }
  });

  app.get("/v1/tasks/:taskId", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const task = await taskService.get(
      decodeURIComponent(c.req.param("taskId")),
      orgId
    );
    if (!task) {
      return errorResponse("Task not found.", 404);
    }
    return json<TaskResponse>({ task });
  });

  app.put("/v1/tasks/:taskId", async (c) => {
    const auth = requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const taskId = decodeURIComponent(c.req.param("taskId"));
    const body = await readJson<UpdateTaskRequest>(c.req.raw);

    try {
      const task = await taskService.update(taskId, orgId, body, {
        access: {
          isPlatformAdmin: auth.isPlatformAdmin,
          orgRole: auth.orgRole,
        },
      });
      return json<TaskResponse>({ task });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "Task not found.") {
          return errorResponse(error.message, 404);
        }

        if (
          error.message === "Profile not found." ||
          error.message === "Task title is required." ||
          error.message === "Task prompt is required." ||
          error.message.startsWith("Invalid task status:")
        ) {
          return errorResponse(error.message, 400);
        }
      }
      throw error;
    }
  });

  app.delete("/v1/tasks/:taskId", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const deleted = await taskService.delete(
      decodeURIComponent(c.req.param("taskId")),
      orgId
    );
    if (!deleted) {
      return errorResponse("Task not found.", 404);
    }
    return new Response(null, { status: 204 });
  });

  app.post("/v1/tasks/:taskId/run", async (c) => {
    requireNotViewerFromContext(c);
    const orgId = requireActiveOrgIdFromContext(c);
    const taskId = decodeURIComponent(c.req.param("taskId"));
    const task = await taskService.get(taskId, orgId);

    if (!task) {
      return errorResponse("Task not found.", 404);
    }

    if (task.status !== "in_progress") {
      await taskService.update(
        taskId,
        orgId,
        { status: "in_progress" },
        { triggerRun: false }
      );
    }

    const result = await agent.runTask(taskId);
    if (result.skipped) {
      return errorResponse(result.error ?? "Task run skipped.", 409);
    }

    const runs = await taskService.listRuns(taskId, orgId, 1);
    const run = runs[0];
    if (!run) {
      return errorResponse("Task run record not found.", 500);
    }

    return json<RunTaskResponse>({ run });
  });

  app.get("/v1/tasks/:taskId/runs", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const taskId = decodeURIComponent(c.req.param("taskId"));

    try {
      const runs = await taskService.listRuns(taskId, orgId);
      return json<ListTaskRunsResponse>({ runs });
    } catch (error) {
      if (error instanceof Error && error.message === "Task not found.") {
        return errorResponse(error.message, 404);
      }
      throw error;
    }
  });

  app.get("/v1/tasks/:taskId/messages", async (c) => {
    const taskId = decodeURIComponent(c.req.param("taskId"));
    if (taskId === "__capability_probe__") {
      return errorResponse("Task not found.", 404);
    }

    const orgId = requireActiveOrgIdFromContext(c);
    const result = await agent.getTaskChatMessages(taskId, orgId);
    if (!result) {
      return errorResponse("Task not found.", 404);
    }

    return json<TaskMessagesResponse>({
      messages: result.messages,
      sessionId: result.sessionId,
    });
  });
}
