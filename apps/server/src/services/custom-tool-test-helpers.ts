import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { StoredToolRecord } from "@nakama/db";

export async function setupCustomToolsDir(): Promise<{
  configDir: string;
  toolsDir: string;
}> {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "nakama-config-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  const toolsDir = path.join(configDir, "tools");
  await mkdir(toolsDir, { recursive: true });
  return { configDir, toolsDir };
}

export function makeCustomToolRecord(
  overrides: Partial<StoredToolRecord> = {}
): StoredToolRecord {
  return {
    createdAt: new Date().toISOString(),
    description: "Echo a message",
    handlerConfig: { modulePath: "echo.js" },
    handlerType: "javascript",
    id: "tool_echo",
    name: "echo",
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
