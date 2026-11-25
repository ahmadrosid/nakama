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
import { resolveToolsFromStorage } from "../services/tool-resolver";
import {
  createGenerateVideoTool,
  resolveVideoGenerationSelection,
} from "./generate-video-tool";

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
function fakeMinimax(overrides: { status?: string; createBody?: object } = {}) {
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
      return new Response(VIDEO_BYTES);
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
      resolveVideoGenerationSelection(minimaxConfig, "p-minimax::gpt-4o")
    ).toThrow();
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
