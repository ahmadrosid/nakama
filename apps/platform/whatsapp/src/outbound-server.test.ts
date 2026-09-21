import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WHATSAPP_OUTBOUND_TOKEN_HEADER } from "@nakama/core";
import { createWhatsAppOutboundAdapter } from "@nakama/core/channels/whatsapp-outbound";
import {
  loadWhatsAppConfigFile,
  saveWhatsAppConfig,
  syncWhatsAppOwnerPairing,
} from "@nakama/core/whatsapp-config";
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
  test("routes two organizations through separate ports, tokens, and recipients", async () => {
    configDir = await mkdtemp(join(tmpdir(), "nakama-wa-org-outbound-"));
    process.env.NAKAMA_CONFIG_DIR = configDir;
    const sent: string[] = [];
    const servers: Array<{ port: number; stop: () => void }> = [];
    try {
      for (const [orgId, phone] of [
        ["org_a", "628111111111"],
        ["org_b", "628222222222"],
      ]) {
        await saveWhatsAppConfig({}, { orgId, profileId: "agent" });
        await syncWhatsAppOwnerPairing(
          { ownerJid: phone + "@s.whatsapp.net" },
          { orgId, profileId: "agent" }
        );
        servers.push(
          await startWhatsAppOutboundServer({
            getSendHandle: () => ({
              sendMessage: async (jid, content) => {
                sent.push(orgId + ":" + jid + ":" + content.text);
              },
            }),
            orgId: { orgId, profileId: "agent" },
          })
        );
      }
      expect(servers[0].port).not.toBe(servers[1].port);
      const a = await loadWhatsAppConfigFile({
        orgId: "org_a",
        profileId: "agent",
      });
      const b = await loadWhatsAppConfigFile({
        orgId: "org_b",
        profileId: "agent",
      });
      expect(a?.outboundToken).not.toBe(b?.outboundToken);
      const crossed = await post(servers[1].port, {
        [WHATSAPP_OUTBOUND_TOKEN_HEADER]: a!.outboundToken!,
      });
      expect(crossed.status).toBe(401);
      const adapter = createWhatsAppOutboundAdapter();
      expect(
        await adapter.send({
          orgId: "org_a",
          profileId: "agent",
          text: "well-test",
        })
      ).toEqual({ ok: true });
      expect(
        await adapter.send({
          orgId: "org_b",
          profileId: "agent",
          text: "finance",
        })
      ).toEqual({
        ok: true,
      });
      expect(
        (
          await adapter.send({
            orgId: "org_c",
            profileId: "agent",
            text: "unknown",
          })
        ).ok
      ).toBe(false);
      expect(sent).toEqual([
        "org_a:628111111111@s.whatsapp.net:well-test",
        "org_b:628222222222@s.whatsapp.net:finance",
      ]);
    } finally {
      for (const server of servers) {
        server.stop();
      }
    }
  });

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
