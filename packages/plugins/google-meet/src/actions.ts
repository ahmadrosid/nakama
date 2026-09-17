import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PluginExecutionContext } from "@nakama/core";
import type { CookieData } from "puppeteer-core";
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

function googleCookies(value: unknown): CookieData[] {
  if (!(Array.isArray(value) && value.length) || value.length > 200) {
    throw new Error("Import the Google login JSON created by the auth command");
  }
  return value.map((cookie) => {
    if (
      !cookie ||
      typeof cookie !== "object" ||
      typeof cookie.name !== "string" ||
      typeof cookie.value !== "string" ||
      typeof cookie.domain !== "string" ||
      !/^(\.?google\.com|[a-z0-9.-]+\.google\.com)$/.test(cookie.domain)
    ) {
      throw new Error("Only Google login cookies are accepted");
    }
    if (cookie.value.length > 16_384) {
      throw new Error("Cookie exceeds size limit");
    }
    return {
      domain: cookie.domain,
      httpOnly: cookie.httpOnly === true,
      name: cookie.name,
      path: typeof cookie.path === "string" ? cookie.path : "/",
      secure: true,
      value: cookie.value,
      ...(typeof cookie.expires === "number" && Number.isFinite(cookie.expires)
        ? { expires: cookie.expires }
        : {}),
    };
  });
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
    const action = context.actionKey;
    const settingsPath = join(context.dataDir, "settings.json");
    const authPath = join(context.dataDir, "auth.json");
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
      const cookies =
        input.googleCookies === undefined
          ? undefined
          : googleCookies(input.googleCookies);
      privateJson(settingsPath, config);
      if (cookies) {
        privateJson(authPath, cookies);
      }
      return { authenticated: existsSync(authPath), configured: true };
    }
    let worker: { state: string; updatedAt?: number; message?: string } = {
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
        authenticated: existsSync(authPath),
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
      if (!existsSync(authPath)) {
        throw new Error("Configure Google login before joining a meeting");
      }
      return store.create(
        String(input.url ?? "").trim(),
        context.actor.id,
        context.profileId,
        Number(input.durationMinutes ?? 30)
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
