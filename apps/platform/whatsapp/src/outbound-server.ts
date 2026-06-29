import { loadWhatsAppConfigFile, resolveWhatsAppOutboundPort } from "@tinyclaw/core";

export interface WhatsAppOutboundSendHandle {
  sendMessage: (jid: string, content: { text: string }) => Promise<unknown>;
}

export interface WhatsAppOutboundServerOptions {
  getSendHandle: () => WhatsAppOutboundSendHandle | null;
}

export async function startWhatsAppOutboundServer(
  options: WhatsAppOutboundServerOptions,
): Promise<{ port: number; stop: () => void }> {
  const config = await loadWhatsAppConfigFile();
  const port = resolveWhatsAppOutboundPort(config);
  let stopped = false;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      if (stopped) {
        return new Response("Server stopped", { status: 503 });
      }

      const url = new URL(request.url);

      if (request.method === "POST" && url.pathname === "/send") {
        const latestConfig = await loadWhatsAppConfigFile();
        const pairedJid = latestConfig?.pairedJid?.trim();

        if (!pairedJid) {
          return Response.json({ error: "WhatsApp is not paired." }, { status: 400 });
        }

        let body: { text?: string };

        try {
          body = (await request.json()) as { text?: string };
        } catch {
          return Response.json({ error: "Invalid JSON body." }, { status: 400 });
        }

        const text = body.text?.trim();

        if (!text) {
          return Response.json({ error: "text is required." }, { status: 400 });
        }

        const handle = options.getSendHandle();

        if (!handle) {
          return Response.json({ error: "WhatsApp socket is not ready." }, { status: 503 });
        }

        try {
          await handle.sendMessage(pairedJid, { text });
          return Response.json({ ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 500 });
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return {
    port: server.port ?? port,
    stop: () => {
      stopped = true;
      server.stop();
    },
  };
}
