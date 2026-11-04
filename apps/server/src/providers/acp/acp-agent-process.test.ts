import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import * as acp from "@agentclientprotocol/sdk";
import { startAcpAgentProcess } from "./acp-agent-process";

const STDERR_MARKER = "stderr-marker-7f3a";

describe("ACP agent start", () => {
  test("a command that exits before initialize carries its stderr, without ANSI codes", async () => {
    const start = startAcpAgentProcess(
      {
        args: [
          "-e",
          `console.error('\\u001b[91m${STDERR_MARKER}\\u001b[0m'); process.exit(1)`,
        ],
        command: process.execPath,
        cwd: tmpdir(),
      },
      acp.client()
    );

    await expect(start).rejects.toMatchObject({
      cause: expect.any(Error),
      message: expect.stringContaining(STDERR_MARKER),
    });
    await expect(start).rejects.toMatchObject({
      message: expect.not.stringContaining("\u001b"),
    });
  });
});
