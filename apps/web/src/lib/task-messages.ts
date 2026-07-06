import type { ChatMessage, TaskMessagesResponse } from "@nakama/core/contract";
import { NakamaApiError } from "@nakama/core/api-error";
import { client } from "@/lib/client";

export async function loadTaskMessages(taskId: string): Promise<TaskMessagesResponse> {
  try {
    const result = await client.getTaskMessages(taskId);

    if (result.messages.length > 0) {
      return result;
    }

    const fallback = await buildTaskMessagesFromRuns(taskId);

    return {
      sessionId: result.sessionId || fallback.sessionId,
      messages: fallback.messages.length > 0 ? fallback.messages : result.messages,
    };
  } catch (error) {
    if (error instanceof NakamaApiError && error.status === 404) {
      return buildTaskMessagesFromRuns(taskId);
    }

    throw error;
  }
}

async function buildTaskMessagesFromRuns(taskId: string): Promise<TaskMessagesResponse> {
  const task = await client.getTask(taskId);

  if (task.sessionId) {
    try {
      const { messages } = await client.getSessionMessages(task.sessionId);

      if (messages.length > 0) {
        return { sessionId: task.sessionId, messages };
      }
    } catch {
      // Fall through to run output synthesis.
    }
  }

  const runs = await client.listTaskRuns(taskId);
  const latestRun = runs.find((run) => run.status !== "running");

  if (!latestRun) {
    return { sessionId: task.sessionId ?? "", messages: [] };
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

  return { sessionId: task.sessionId ?? "", messages };
}
