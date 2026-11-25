import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ToolContext, UserConfig } from "@nakama/core";
import { GENERATE_VIDEO_TOOL_ID } from "@nakama/core/tools/protected";
import {
  createInMemoryDatabaseAdapter,
  mergeWorkspaceSettings,
  seedDatabase,
} from "@nakama/db";
import { z } from "zod";
import { createMinimalHonoApp } from "../http/test-app-helpers";
import { setupFreshInstallSession } from "../http/test-session-helpers";
import { AgentService } from "../services/agent-service";
import { resolveToolsFromStorage } from "../services/tool-resolver";
import { setupTestConfigDir } from "../test-config-dir";
import {
  createGenerateVideoTool,
  resolveVideoGenerationSelection,
} from "./generate-video-tool";

setupTestConfigDir("nakama-generate-video-test-");

const VIDEO_BYTES = Uint8Array.from([0, 0, 0, 24, 102, 116, 121, 112]);

const minimaxConfig: UserConfig = {
  defaultProviderId: null,
  providers: [
    {
      apiKey: "mm-key",
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "p-minimax",
      label: "MiniMax",
      type: "minimax",
    },
  ],
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

async function setup(videoModel: string | null) {
  const db = createInMemoryDatabaseAdapter();
  await db.upsertWorkspaceSettings(
    mergeWorkspaceSettings(null, {
      updatedAt: new Date().toISOString(),
      videoModel,
    })
  );

  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "nakama-video-"));
  tempDirs.push(workspaceRoot);

  const context: ToolContext = {
    orgId: "org_a",
    profileId: "profile_a",
    sessionId: "session_a",
    workspaceRoot,
  };

  return { context, db, workspaceRoot };
}

/** Fake MiniMax: create → one Processing poll → Success → file → download. */
function fakeMinimax(
  overrides: {
    createBody?: object;
    download?: () => Response;
    onQuery?: () => void;
    status?: string;
  } = {}
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let polls = 0;

  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ init, url });

    if (url.endsWith("/video_generation")) {
      return Response.json(
        overrides.createBody ?? {
          base_resp: { status_code: 0 },
          task_id: "task-1",
        }
      );
    }

    if (url.includes("/query/video_generation")) {
      polls += 1;
      overrides.onQuery?.();

      return Response.json({
        base_resp: { status_code: 0 },
        file_id: "file-1",
        status: polls === 1 ? "Processing" : (overrides.status ?? "Success"),
      });
    }

    if (url.includes("/files/retrieve")) {
      return Response.json({
        base_resp: { status_code: 0 },
        file: { download_url: "https://cdn.example/video.mp4" },
      });
    }

    if (url === "https://cdn.example/video.mp4") {
      return overrides.download?.() ?? new Response(VIDEO_BYTES);
    }

    return new Response("not found", { status: 404 });
  };

  return { calls, fetchFn };
}

describe("generate_video tool", () => {
  test("seedDatabase adds the tool and the resolver exposes it when assigned", async () => {
    const db = createInMemoryDatabaseAdapter();
    await seedDatabase(db);

    expect(await db.getTool(GENERATE_VIDEO_TOOL_ID)).not.toBeNull();

    const now = new Date().toISOString();
    await db.upsertProfile({
      createdAt: now,
      id: "profile_v",
      isDefault: false,
      isSuper: false,
      model: null,
      name: "Video",
      orgId: "org_a",
      systemPrompt: "",
      updatedAt: now,
    });
    await db.assignToolToProfile("profile_v", GENERATE_VIDEO_TOOL_ID);

    const tool = createGenerateVideoTool({ db, getUserConfig: () => null });

    const tools = await resolveToolsFromStorage(
      await db.listToolsForProfile("profile_v"),
      db,
      [],
      { serverTools: { generateVideo: tool } }
    );

    expect(tools.map((entry) => entry.name)).toContain("generate_video");
  });

  test("creates the task, polls, and saves the MP4 under artifacts/", async () => {
    const { context, db, workspaceRoot } = await setup(
      "p-minimax::MiniMax-Hailuo-2.3"
    );

    const { calls, fetchFn } = fakeMinimax();

    const tool = createGenerateVideoTool({
      db,
      fetch: fetchFn,
      getUserConfig: () => minimaxConfig,
      pollIntervalMs: 1,
    });

    const result = await tool.run(
      { duration: 10, prompt: "A cat surfs a wave" },
      context
    );

    expect(result).toEqual({
      mimeType: "video/mp4",
      model: "MiniMax-Hailuo-2.3",
      path: "artifacts/generated-video.mp4",
      sizeBytes: VIDEO_BYTES.byteLength,
    });

    const saved = await readFile(
      path.join(workspaceRoot, "artifacts", "generated-video.mp4")
    );

    expect(new Uint8Array(saved)).toEqual(VIDEO_BYTES);

    const create = calls[0];
    expect(create?.url).toBe("https://api.minimax.io/v1/video_generation");
    expect(JSON.parse(String(create?.init?.body))).toEqual({
      duration: 10,
      model: "MiniMax-Hailuo-2.3",
      prompt: "A cat surfs a wave",
      resolution: "768P",
    });
    expect(calls.filter((call) => call.url.includes("/query/")).length).toBe(2);
  });

  test("returns an error and writes no file when the task fails", async () => {
    const { context, db, workspaceRoot } = await setup(
      "p-minimax::MiniMax-Hailuo-02"
    );

    const { fetchFn } = fakeMinimax({ status: "Fail" });

    const tool = createGenerateVideoTool({
      db,
      fetch: fetchFn,
      getUserConfig: () => minimaxConfig,
      pollIntervalMs: 1,
    });

    const result = await tool.run({ prompt: "A storm" }, context);

    expect(result).toHaveProperty("error");
    expect(
      await readdir(path.join(workspaceRoot, "artifacts")).catch(() => [])
    ).toEqual([]);
  });

  test("returns an error when MiniMax rejects the create call", async () => {
    const { context, db } = await setup("p-minimax::MiniMax-Hailuo-2.3");

    const { calls, fetchFn } = fakeMinimax({
      createBody: { base_resp: { status_code: 1008, status_msg: "balance" } },
    });

    const tool = createGenerateVideoTool({
      db,
      fetch: fetchFn,
      getUserConfig: () => minimaxConfig,
      pollIntervalMs: 1,
    });

    expect(await tool.run({ prompt: "A storm" }, context)).toHaveProperty(
      "error"
    );
    expect(calls).toHaveLength(1);
  });

  test("makes no provider call when no video model is set", async () => {
    const { context, db } = await setup(null);
    const { calls, fetchFn } = fakeMinimax();

    const tool = createGenerateVideoTool({
      db,
      fetch: fetchFn,
      getUserConfig: () => minimaxConfig,
    });

    expect(await tool.run({ prompt: "A storm" }, context)).toHaveProperty(
      "error"
    );
    expect(calls).toHaveLength(0);
  });

  test("rejects 1080P with a 10 second clip before any provider call", async () => {
    const { context, db } = await setup("p-minimax::MiniMax-Hailuo-2.3");
    const { calls, fetchFn } = fakeMinimax();

    const tool = createGenerateVideoTool({
      db,
      fetch: fetchFn,
      getUserConfig: () => minimaxConfig,
    });

    expect(
      await tool.run(
        { duration: 10, prompt: "A storm", resolution: "1080P" },
        context
      )
    ).toHaveProperty("error");
    expect(calls).toHaveLength(0);
  });
});

describe("resolveVideoGenerationSelection", () => {
  test("rejects a model that is not on a MiniMax provider", () => {
    const config: UserConfig = {
      defaultProviderId: null,
      providers: [
        {
          apiKey: "k",
          createdAt: "2026-01-01T00:00:00.000Z",
          id: "p-openai",
          label: "OpenAI",
          type: "openai",
        },
      ],
    };

    expect(() =>
      resolveVideoGenerationSelection(config, "p-openai::MiniMax-Hailuo-2.3")
    ).toThrow();
    expect(() =>
      resolveVideoGenerationSelection(minimaxConfig, "p-minimax::bad model/id")
    ).toThrow();
  });

  test("accepts a model ID that is not a suggestion", () => {
    expect(
      resolveVideoGenerationSelection(
        minimaxConfig,
        "p-minimax::MiniMax-Hailuo-3"
      )?.model
    ).toBe("MiniMax-Hailuo-3");
  });

  test("uses the China base URL for a minimax_cn provider", () => {
    const selection = resolveVideoGenerationSelection(
      {
        defaultProviderId: null,
        providers: [
          {
            apiKey: "k",
            createdAt: "2026-01-01T00:00:00.000Z",
            id: "p-cn",
            label: "MiniMax CN",
            type: "minimax_cn",
          },
        ],
      },
      "p-cn::MiniMax-Hailuo-02"
    );

    expect(selection?.baseUrl).toBe("https://api.minimaxi.com/v1");
  });
});

describe("generate_video edge cases", () => {
  const toolFor = (
    db: Awaited<ReturnType<typeof setup>>["db"],
    fetchFn: ReturnType<typeof fakeMinimax>["fetchFn"]
  ) =>
    createGenerateVideoTool({
      db,
      fetch: fetchFn,
      getUserConfig: () => minimaxConfig,
      pollIntervalMs: 1,
    });

  test("two parallel calls that want the same name both keep their clip", async () => {
    const { context, db, workspaceRoot } = await setup(
      "p-minimax::MiniMax-Hailuo-02"
    );

    const tool = toolFor(db, fakeMinimax().fetchFn);

    const results = await Promise.all([
      tool.run({ filename: "clip.mp4", prompt: "A" }, context),
      tool.run({ filename: "clip.mp4", prompt: "B" }, context),
    ]);

    const SavedSchema = z.object({ path: z.string() });
    const paths = results.map((result) => SavedSchema.parse(result).path);

    expect(new Set(paths).size).toBe(2);

    const files = await readdir(path.join(workspaceRoot, "artifacts"));

    expect(files.sort()).toEqual(
      paths.map((entry) => path.basename(entry)).sort()
    );
  });

  test("a stopped chat ends the wait and leaves no file behind", async () => {
    const { context, db, workspaceRoot } = await setup(
      "p-minimax::MiniMax-Hailuo-02"
    );

    const controller = new AbortController();

    const { fetchFn } = fakeMinimax({
      onQuery: () => controller.abort(),
      status: "Processing",
    });

    const result = await toolFor(db, fetchFn).run(
      { prompt: "A storm" },
      { ...context, signal: controller.signal }
    );

    expect(result).toEqual({ error: "Video generation stopped." });
    expect(await readdir(path.join(workspaceRoot, "artifacts"))).toEqual([]);
  });

  test("a download over the size cap fails and leaves no file behind", async () => {
    const { context, db, workspaceRoot } = await setup(
      "p-minimax::MiniMax-Hailuo-02"
    );

    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;

    const { fetchFn } = fakeMinimax({
      download: () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(stream) {
              sent += 1;

              if (sent > 101) {
                stream.close();

                return;
              }

              stream.enqueue(chunk);
            },
          })
        ),
    });

    const result = await toolFor(db, fetchFn).run(
      { prompt: "A storm" },
      context
    );

    expect(result).toHaveProperty("error");
    expect(await readdir(path.join(workspaceRoot, "artifacts"))).toEqual([]);
  });

  test("accepts a duration sent as a string", async () => {
    const { context, db } = await setup("p-minimax::MiniMax-Hailuo-02");
    const { calls, fetchFn } = fakeMinimax();

    const result = await toolFor(db, fetchFn).run(
      { duration: "10", prompt: "A storm" },
      context
    );

    expect(result).toHaveProperty("path");
    expect(JSON.parse(String(calls[0]?.init?.body)).duration).toBe(10);
  });
});

describe("video generation settings route", () => {
  test("a platform admin saves a valid model, a bad one is refused, and other settings keep it", async () => {
    const db = createInMemoryDatabaseAdapter();
    const agent = new AgentService(minimaxConfig, null, db);
    const { app } = createMinimalHonoApp({ agent, databaseAdapter: db });
    const session = await setupFreshInstallSession(app, db);

    const call = (
      method: string,
      route: string,
      body?: { model: string | null }
    ) =>
      app.fetch(
        new Request(`http://localhost:4310${route}`, {
          body: body === undefined ? undefined : JSON.stringify(body),
          headers: session.headers({
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrfToken,
          }),
          method,
        })
      );

    const readModel = async () =>
      (await (await call("GET", "/v1/settings/video-generation")).json())
        .videoGeneration.model;

    const bad = await call("PUT", "/v1/settings/video-generation", {
      model: "p-minimax::bad model/id",
    });

    expect(bad.status).toBe(400);
    expect(await readModel()).toBeNull();

    const good = await call("PUT", "/v1/settings/video-generation", {
      model: "p-minimax::MiniMax-Hailuo-02",
    });

    expect(good.status).toBe(200);
    expect(await readModel()).toBe("p-minimax::MiniMax-Hailuo-02");

    expect(
      (await call("PUT", "/v1/settings/vision", { model: null })).status
    ).toBe(200);
    expect(await readModel()).toBe("p-minimax::MiniMax-Hailuo-02");
  });
});
