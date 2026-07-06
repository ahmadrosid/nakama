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
import { errorResponse, json, readJson } from "../shared";
import { requireActiveOrgIdFromContext } from "../org-guards";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";

export function registerTaskRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent, taskService } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const taskIdParam = z.object({
    taskId: z.string().openapi({ param: { name: "taskId", in: "path" } }),
  });
  const listTasksSchema = z.object({}).passthrough().openapi("ListTasksResponse");
  const draftTaskPromptSchema = z.object({}).passthrough().openapi("DraftTaskPromptRequest");
  const draftTaskPromptResponseSchema = z.object({}).passthrough().openapi("DraftTaskPromptResponse");
  const createTaskSchema = z.object({}).passthrough().openapi("CreateTaskRequest");
  const updateTaskSchema = z.object({}).passthrough().openapi("UpdateTaskRequest");
  const taskSchema = z.object({}).passthrough().openapi("TaskResponse");
  const runTaskSchema = z.object({}).passthrough().openapi("RunTaskResponse");
  const listTaskRunsSchema = z.object({}).passthrough().openapi("ListTaskRunsResponse");
  const taskMessagesSchema = z.object({}).passthrough().openapi("TaskMessagesResponse");

  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/tasks/draft-prompt",
    tags: ["Tasks"],
    summary: "Draft an agent prompt from task title and description",
    operationId: "draftTaskPrompt",
    request: { body: { required: true, content: { "application/json": { schema: draftTaskPromptSchema } } } },
    responses: {
      200: { description: "Generated prompt", content: { "application/json": { schema: draftTaskPromptResponseSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/tasks",
    tags: ["Tasks"],
    summary: "List all tasks",
    operationId: "listTasks",
    responses: { 200: { description: "Tasks", content: { "application/json": { schema: listTasksSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/tasks",
    tags: ["Tasks"],
    summary: "Create a task",
    operationId: "createTask",
    request: { body: { required: true, content: { "application/json": { schema: createTaskSchema } } } },
    responses: {
      201: { description: "Task created", content: { "application/json": { schema: taskSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/tasks/{taskId}",
    tags: ["Tasks"],
    summary: "Get a task",
    operationId: "getTask",
    request: { params: taskIdParam },
    responses: {
      200: { description: "Task", content: { "application/json": { schema: taskSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/tasks/{taskId}",
    tags: ["Tasks"],
    summary: "Update a task",
    operationId: "updateTask",
    request: { params: taskIdParam, body: { required: true, content: { "application/json": { schema: updateTaskSchema } } } },
    responses: {
      200: { description: "Task updated", content: { "application/json": { schema: taskSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/tasks/{taskId}",
    tags: ["Tasks"],
    summary: "Delete a task",
    operationId: "deleteTask",
    request: { params: taskIdParam },
    responses: {
      204: { description: "Task deleted" },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/tasks/{taskId}/run",
    tags: ["Tasks"],
    summary: "Run a task now",
    operationId: "runTask",
    request: { params: taskIdParam },
    responses: {
      200: { description: "Task run", content: { "application/json": { schema: runTaskSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      409: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/tasks/{taskId}/runs",
    tags: ["Tasks"],
    summary: "List task run history",
    operationId: "listTaskRuns",
    request: { params: taskIdParam },
    responses: {
      200: { description: "Task runs", content: { "application/json": { schema: listTaskRunsSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/tasks/{taskId}/messages",
    tags: ["Tasks"],
    summary: "Get task chat messages",
    operationId: "getTaskMessages",
    request: { params: taskIdParam },
    responses: {
      200: { description: "Task chat messages", content: { "application/json": { schema: taskMessagesSchema } } },
      404: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));

  app.get("/v1/tasks", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const tasks = await taskService.listForOrg(orgId);
    return json<ListTasksResponse>({ tasks });
  });

  app.post("/v1/tasks/draft-prompt", async (c) => {
    const body = await readJson<DraftTaskPromptRequest>(c.req.raw);

    try {
      const prompt = await agent.draftTaskPrompt(body.title, body.description);
      return json<DraftTaskPromptResponse>({ prompt });
    } catch (error) {
      if (error instanceof Error && error.message === "Task title is required.") {
        return errorResponse(error.message, 400);
      }
      throw error;
    }
  });

  app.post("/v1/tasks", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const body = await readJson<CreateTaskRequest>(c.req.raw);

    try {
      const task = await taskService.create(orgId, body, body.profileId);
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
    const task = await taskService.get(decodeURIComponent(c.req.param("taskId")), orgId);
    if (!task) {
      return errorResponse("Task not found.", 404);
    }
    return json<TaskResponse>({ task });
  });

  app.put("/v1/tasks/:taskId", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const taskId = decodeURIComponent(c.req.param("taskId"));
    const body = await readJson<UpdateTaskRequest>(c.req.raw);

    try {
      const task = await taskService.update(taskId, orgId, body);
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
    const orgId = requireActiveOrgIdFromContext(c);
    const deleted = await taskService.delete(
      decodeURIComponent(c.req.param("taskId")),
      orgId,
    );
    if (!deleted) {
      return errorResponse("Task not found.", 404);
    }
    return new Response(null, { status: 204 });
  });

  app.post("/v1/tasks/:taskId/run", async (c) => {
    const orgId = requireActiveOrgIdFromContext(c);
    const taskId = decodeURIComponent(c.req.param("taskId"));
    const task = await taskService.get(taskId, orgId);

    if (!task) {
      return errorResponse("Task not found.", 404);
    }

    if (task.status !== "in_progress") {
      await taskService.update(taskId, orgId, { status: "in_progress" }, { triggerRun: false });
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
      sessionId: result.sessionId,
      messages: result.messages,
    });
  });
}
