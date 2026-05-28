import type { ChatMessage, TaskMessagesResponse } from "@tinyclaw/core/contract";
import { TinyClawApiError } from "@tinyclaw/core/api-error";
import { client } from "@/lib/client";

export async function loadTaskMessages(taskId: string): Promise<TaskMessagesResponse> {
  try {
    return await client.getTaskMessages(taskId);
  } catch (error) {
    if (error instanceof TinyClawApiError && error.status === 404 && error.message === "Not found") {
      return loadTaskMessagesFallback(taskId);
    }

    throw error;
  }
}

async function loadTaskMessagesFallback(taskId: string): Promise<TaskMessagesResponse> {
  const task = await client.getTask(taskId);

  if (task.sessionId) {
    const { messages } = await client.getSessionMessages(task.sessionId);
    return { sessionId: task.sessionId, messages };
  }

  const runs = await client.listTaskRuns(taskId);
  const latestRun = runs.find((run) => run.status !== "running");

  if (!latestRun) {
    return { sessionId: "", messages: [] };
  }

  const messages: ChatMessage[] = [{ role: "user", content: task.prompt }];

  if (latestRun.status === "failed") {
    messages.push({
      role: "assistant",
      content: latestRun.error ?? "Task run failed.",
    });
  } else if (latestRun.output) {
    messages.push({
      role: "assistant",
      content: latestRun.output,
    });
  }

  return { sessionId: "", messages };
}
