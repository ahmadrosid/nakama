import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WHATSAPP_OUTBOUND_TOKEN_HEADER } from "@nakama/core";
import { startWhatsAppOutboundServer } from "./outbound-server";

const originalConfigDir = process.env.NAKAMA_CONFIG_DIR;
let configDir = "";

afterEach(async () => {
  process.env.NAKAMA_CONFIG_DIR = originalConfigDir;

  if (configDir) {
    await rm(configDir, { force: true, recursive: true });
    configDir = "";
  }
});

// Each server gets its own port: two on the default would leave the second
// request answered by the first, already-stopped, server.
async function startPairedServer(port: number) {
  configDir = await mkdtemp(join(tmpdir(), "nakama-whatsapp-outbound-"));
  process.env.NAKAMA_CONFIG_DIR = configDir;
  await mkdir(join(configDir, "whatsapp"), { recursive: true });
  await writeFile(
    join(configDir, "whatsapp", "config.ini"),
    [
      "profile_id=default",
      "paired_jid=628100000000@s.whatsapp.net",
      `outbound_port=${port}`,
      "",
    ].join("\n"),
    "utf8"
  );

  const sent: string[] = [];
  const server = await startWhatsAppOutboundServer({
    getSendHandle: () => ({
      sendMessage: async (_jid, content) => {
        sent.push(content.text);
      },
    }),
  });

  return { sent, server };
}

async function post(port: number, headers: Record<string, string>) {
  return await fetch(`http://127.0.0.1:${port}/send`, {
    body: JSON.stringify({ text: "hello" }),
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST",
  });
}

describe("whatsapp outbound server", () => {
  test("rejects a local caller that does not know the token", async () => {
    const { sent, server } = await startPairedServer(43_121);

    try {
      const anonymous = await post(server.port, {});
      const wrongToken = await post(server.port, {
        [WHATSAPP_OUTBOUND_TOKEN_HEADER]: "a".repeat(64),
      });

      expect(anonymous.status).toBe(401);
      expect(wrongToken.status).toBe(401);
      expect(sent).toEqual([]);
    } finally {
      server.stop();
    }
  });

  test("sends when the caller presents the minted token", async () => {
    const { sent, server } = await startPairedServer(43_122);

    try {
      const { loadWhatsAppConfigFile } = await import("@nakama/core");
      const token = (await loadWhatsAppConfigFile())?.outboundToken ?? "";

      expect(token).toHaveLength(64);

      const response = await post(server.port, {
        [WHATSAPP_OUTBOUND_TOKEN_HEADER]: token,
      });

      expect(response.status).toBe(200);
      expect(sent).toEqual(["hello"]);
    } finally {
      server.stop();
    }
  });
});
