import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAgentChatSession } from "@nakama/agent";
import {
  type ChatMessage,
  getProfileArtifactsDir,
  getProfileSoulDir,
  listArtifactsTool,
  loadUserConfig,
  readFileTool,
  writeFileTool,
} from "@nakama/core";
import { createProviderForInstance } from "../providers/create";
import { withMswCassette } from "../testing/llm-msw-cassette";
import { sendWhatsAppArtifactTool } from "./send-discord-artifact-tool";

const cases = [
  {
    history: [
      { content: "Which file did you just create?", role: "user" },
      { content: "I created artifacts/report.csv.", role: "assistant" },
    ] as ChatMessage[],
    message: "Send that again",
    name: "resend",
    send: true,
  },
  { message: "Send report.csv", name: "discovery", send: true },
  { message: "Send the report", name: "ambiguous", send: false },
  {
    message:
      "Create draft.csv with header amount and one row 10. Save only, do not send it.",
    name: "save-only",
    send: false,
  },
  {
    message:
      "Create our real September 2026 sales report in one CSV. No source sales data has been supplied. Do not use the example files as source sales data.",
    name: "missing-data",
    send: false,
  },
  {
    message:
      "Create a sales report for September 1 to 27, 2026 in one CSV. Source rows: date,amount\n2026-09-01,10\n2026-09-27,20\n2026-09-28,30",
    name: "consolidate",
    send: true,
  },
];

for (const scenario of cases) {
  test(`WhatsApp agent artifact decision: ${scenario.name}`, async () => {
    const config = await loadUserConfig();
    const instance = config?.providers.find(
      (item) => item.type === "openai" && item.apiKey.trim()
    ) ?? {
      apiKey: process.env.OPENAI_API_KEY ?? "sk-replay-placeholder",
      createdAt: "2026-10-01T00:00:00.000Z",
      id: "replay-openai",
      label: "OpenAI",
      type: "openai" as const,
    };
    const provider = createProviderForInstance(instance, "gpt-4o-mini");
    if (!provider) {
      throw new Error("OpenAI provider unavailable");
    }
    const previous = process.env.NAKAMA_CONFIG_DIR;
    const home = await mkdtemp(
      path.join(tmpdir(), "nakama-whatsapp-cassette-")
    );
    process.env.NAKAMA_CONFIG_DIR = home;
    try {
      const orgId = "org_test";
      const profileId = "profile_test";
      const artifactsDir = getProfileArtifactsDir(orgId, profileId);
      await mkdir(artifactsDir, { recursive: true });
      await writeFile(
        path.join(artifactsDir, "report.csv"),
        "example,value\nexample,10"
      );
      await writeFile(
        path.join(artifactsDir, "other-report.csv"),
        "example,value\nexample,20"
      );
      const session = createAgentChatSession(
        { provider },
        {
          channel: "whatsapp",
          initialHistory: scenario.history,
          toolContext: {
            channel: "whatsapp",
            orgId,
            profileId,
            tokenOptimizerEnabled: false,
            workspaceRoot: getProfileSoulDir(orgId, profileId),
          },
          tools: [
            listArtifactsTool,
            readFileTool,
            writeFileTool,
            sendWhatsAppArtifactTool,
          ],
        }
      );
      await withMswCassette(
        `whatsapp-artifact-${scenario.name}`,
        () => session.send(scenario.message),
        {
          url: /https:\/\/api\.openai\.com\/v1\/(?:responses|chat\/completions)$/,
        }
      );
      const history = session.getHistory();
      const results = history.filter(
        (item) => item.role === "tool" && item.name === "send_whatsapp_artifact"
      );
      expect(results.length).toBe(scenario.send ? 1 : 0);
      if (scenario.name === "discovery") {
        expect(
          history.some(
            (item) => item.role === "tool" && item.name === "list_artifacts"
          )
        ).toBe(true);
      }
      if (scenario.send) {
        const message = results[0];
        if (message?.role !== "tool") {
          throw new Error("Missing send result");
        }
        const prepared = JSON.parse(message.content);
        expect(prepared.status).toBe("prepared");
        expect(prepared.ok).toBe(true);
        if (scenario.name === "resend" || scenario.name === "discovery") {
          expect(prepared.path).toBe("report.csv");
        }
        if (scenario.name === "consolidate") {
          const csv = await readFile(
            path.join(artifactsDir, prepared.path),
            "utf8"
          );
          expect(csv).toContain("2026-09-01");
          expect(csv).toContain("2026-09-27");
          expect(csv).not.toContain("2026-09-28");
        }
      }
      if (scenario.name === "save-only") {
        expect(
          await readFile(path.join(artifactsDir, "draft.csv"), "utf8")
        ).toContain("10");
      }
    } finally {
      if (previous === undefined) {
        delete process.env.NAKAMA_CONFIG_DIR;
      } else {
        process.env.NAKAMA_CONFIG_DIR = previous;
      }
      await rm(home, { force: true, recursive: true });
    }
  }, 120_000);
}
