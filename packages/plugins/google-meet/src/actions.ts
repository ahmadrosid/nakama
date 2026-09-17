import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginExecutionContext } from "@nakama/core";
import { type Meeting, MeetingStore } from "./store";
import { transcriptionConfig } from "./transcription";

export function privateJson(path: string, data: unknown) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(data), { mode: 0o600 });
  renameSync(temporary, path);
}

export function readSettings(directory: string) {
  return transcriptionConfig(
    JSON.parse(readFileSync(join(directory, "settings.json"), "utf8"))
  );
}

async function connectionCommand(directory: string, action: string) {
  const endpoint = JSON.parse(
    readFileSync(join(directory, "workers", "meet", "control.json"), "utf8")
  ) as { port: number; token: string };
  if (
    !Number.isInteger(endpoint.port) ||
    endpoint.port < 1 ||
    endpoint.port > 65_535
  ) {
    throw new Error("Invalid worker endpoint");
  }
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/${action}`, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
    method: "POST",
    signal: AbortSignal.timeout(5000),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(result.error ?? "Google connection request failed");
  }
  return result;
}

export async function run(
  input: Record<string, unknown>,
  context: PluginExecutionContext
) {
  if (context.actor.role === "viewer") {
    throw new Error("Member access required");
  }
  const store = new MeetingStore(context.dataDir, context.orgId);
  const canAccess = (meeting: Meeting) =>
    (context.actor.role === "admin" || meeting.actorId === context.actor.id) &&
    (!context.profileId || meeting.profileId === context.profileId);
  try {
    const action = context.actionKey ?? "";
    const settingsPath = join(context.dataDir, "settings.json");
    if (
      ["connect", "connection", "finish-login", "disconnect"].includes(action)
    ) {
      if (context.actor.role !== "admin") {
        throw new Error("Admin access required");
      }
      return connectionCommand(context.dataDir, action);
    }
    if (action === "configure") {
      if (context.actor.role !== "admin") {
        throw new Error("Admin access required");
      }
      const previous = existsSync(settingsPath)
        ? readSettings(context.dataDir)
        : {};
      const config = transcriptionConfig({
        ...previous,
        ...input,
        apiKey: input.apiKey || (previous as { apiKey?: string }).apiKey,
      });
      privateJson(settingsPath, config);
      return { configured: true };
    }
    let worker: {
      state: string;
      updatedAt?: number;
      message?: string;
      authenticated?: boolean;
      loginBusy?: boolean;
    } = {
      state: "stopped",
    };
    try {
      worker = JSON.parse(
        readFileSync(
          join(context.dataDir, "workers", "meet", "status.json"),
          "utf8"
        )
      );
    } catch {
      /* Worker has not started. */
    }
    if (!worker.updatedAt || Date.now() - worker.updatedAt > 15_000) {
      worker = { state: "stopped" };
    }
    if (action === "meetings") {
      return {
        authenticated: worker.authenticated === true,
        canConfigure: context.actor.role === "admin",
        configured: existsSync(settingsPath),
        meetings: store.list(
          context.actor.role === "admin" ? null : context.actor.id,
          context.profileId ?? null
        ),
        worker,
      };
    }
    if (action === "join") {
      if (worker.state !== "ready") {
        throw new Error(
          worker.message ?? "Start the Google Meet worker in Workers first"
        );
      }
      readSettings(context.dataDir);
      if (!worker.authenticated || worker.loginBusy) {
        throw new Error("Configure Google login before joining a meeting");
      }
      return store.create(
        String(input.url ?? "").trim(),
        context.actor.id,
        context.profileId,
        Number(input.durationMinutes ?? 120)
      );
    }
    const meeting = store.get(String(input.meetingId ?? ""));
    if (!(meeting && canAccess(meeting))) {
      throw new Error("Meeting not found");
    }
    if (action === "status") {
      return { meeting, worker };
    }
    if (action === "leave") {
      store.stop(meeting.id);
      return { ...meeting, stopRequested: 1 };
    }
    if (action === "transcript") {
      const after = Number(input.after ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) {
        throw new Error("Invalid transcript cursor");
      }
      const segments = store.transcript(meeting.id, after);
      return {
        meeting,
        nextCursor: segments.at(-1)?.sequence ?? after,
        segments,
      };
    }
    throw new Error("Unknown meeting action");
  } finally {
    store.close();
  }
}
