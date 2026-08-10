import { NakamaApiError } from "@nakama/core/api-error";
import type { ChatMessage, TaskMessagesResponse } from "@nakama/core/contract";
import { client } from "@/lib/client";

export async function loadTaskMessages(
  taskId: string
): Promise<TaskMessagesResponse> {
  try {
    const result = await client.getTaskMessages(taskId);

    if (result.messages.length > 0) {
      return result;
    }

    const fallback = await buildTaskMessagesFromRuns(taskId);

    return {
      messages:
        fallback.messages.length > 0 ? fallback.messages : result.messages,
      sessionId: result.sessionId || fallback.sessionId,
    };
  } catch (error) {
    if (error instanceof NakamaApiError && error.status === 404) {
      return buildTaskMessagesFromRuns(taskId);
    }

    throw error;
  }
}

async function buildTaskMessagesFromRuns(
  taskId: string
): Promise<TaskMessagesResponse> {
  const task = await client.getTask(taskId);

  if (task.sessionId) {
    try {
      const { messages } = await client.getSessionMessages(task.sessionId);

      if (messages.length > 0) {
        return { messages, sessionId: task.sessionId };
      }
    } catch {
      // Fall through to run output synthesis.
    }
  }

  const runs = await client.listTaskRuns(taskId);
  const latestRun = runs.find((run) => run.status !== "running");

  if (!latestRun) {
    return { messages: [], sessionId: task.sessionId ?? "" };
  }

  const messages: ChatMessage[] = [{ content: task.prompt, role: "user" }];

  if (latestRun.status === "failed") {
    messages.push({
      content: latestRun.error ?? "Task run failed.",
      role: "assistant",
    });
  } else if (latestRun.output) {
    messages.push({
      content: latestRun.output,
      role: "assistant",
    });
  }

  return { messages, sessionId: task.sessionId ?? "" };
}
