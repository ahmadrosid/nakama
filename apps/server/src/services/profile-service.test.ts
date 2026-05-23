import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createInMemoryDatabaseAdapter } from "@tinyclaw/db";
import { ProfileService } from "./profile-service";

const originalToolsDir = process.env.TINYCLAW_TOOLS_DIR;

describe("profile service createTool", () => {
  let tempToolsDir = "";

  afterEach(async () => {
    process.env.TINYCLAW_TOOLS_DIR = originalToolsDir;

    if (tempToolsDir) {
      await rm(tempToolsDir, { recursive: true, force: true });
      tempToolsDir = "";
    }
  });

  test("defaults to an executable javascript tool", async () => {
    tempToolsDir = await mkdtemp(path.join(os.tmpdir(), "tinyclaw-profile-tool-"));
    process.env.TINYCLAW_TOOLS_DIR = tempToolsDir;
    await mkdir(tempToolsDir, { recursive: true });

    await writeFile(
      path.join(tempToolsDir, "echo.js"),
      `export async function run(input) {
  return input;
}
`,
      "utf8",
    );

    const service = new ProfileService(createInMemoryDatabaseAdapter());
    const tool = await service.createTool({
      name: "echo",
      description: "Echo input",
      handlerConfig: { modulePath: "echo.js" },
    });

    expect(tool.handlerType).toBe("javascript");
  });

  test('rejects non-javascript handler types', async () => {
    const service = new ProfileService(createInMemoryDatabaseAdapter());

    await expect(
      service.createTool({
        name: "bad-tool",
        description: "Bad tool",
        handlerType: "custom",
        handlerConfig: { modulePath: "bad-tool.js" },
      }),
    ).rejects.toThrow(/only javascript tools can be created/i);
  });
});
