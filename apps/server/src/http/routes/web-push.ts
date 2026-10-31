import { z } from "@hono/zod-openapi";
import type { StreamEvent } from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import { TURN_CANCELLED_ERROR } from "../../services/turn-runner";
import { isPushServiceEndpoint } from "../../services/web-push";
import { webPushService } from "../../services/web-push-service";
import type { ServerOptions } from "../context";
import { getRequestAuth, json, readJson } from "../shared";
import type { HonoApp } from "../types";

const subscriptionSchema = z.object({
  endpoint: z.string().max(2048),
  keys: z.object({
    auth: z.string().min(1).max(64),
    p256dh: z.string().min(1).max(256),
  }),
});

const endpointSchema = z.object({ endpoint: z.string().max(2048) });

const presenceSchema = z.object({
  clientId: z.string().min(1).max(64),
  visible: z.boolean(),
});

const noContent = () => new Response(null, { status: 204 });

/** Browser push for "your reply is ready", per signed-in user. */
export function registerWebPushRoutes(app: HonoApp): void {
  app.get("/v1/push/public-key", async () =>
    json({ publicKey: await webPushService.publicKey() })
  );

  app.put("/v1/push/subscription", async (c) => {
    const { user } = getRequestAuth(c);
    const subscription = await readJson(c.req.raw, subscriptionSchema);

    if (!isPushServiceEndpoint(subscription.endpoint)) {
      throw new NakamaApiError("Unsupported push service.", 400);
    }

    await webPushService.subscribe(user.id, subscription);

    return noContent();
  });

  app.delete("/v1/push/subscription", async (c) => {
    const { user } = getRequestAuth(c);
    const { endpoint } = await readJson(c.req.raw, endpointSchema);
    await webPushService.unsubscribe(user.id, endpoint);

    return noContent();
  });

  app.put("/v1/push/presence", async (c) => {
    const { user } = getRequestAuth(c);
    const { clientId, visible } = await readJson(c.req.raw, presenceSchema);
    webPushService.setPresence(user.id, clientId, visible);

    return noContent();
  });
}

type TurnPushAgent = Pick<
  ServerOptions["agent"],
  "getProfile" | "getSessionSummary"
>;

/** Pushes "the reply is ready" to whoever asked, if they have left the page. */
export async function pushTurnEnded(
  agent: TurnPushAgent,
  target: { orgId: string; sessionId: string; userId: string },
  terminal: StreamEvent
): Promise<void> {
  try {
    await sendTurnEndedPush(agent, target, terminal);
  } catch (error) {
    console.warn(`Session ${target.sessionId}: web push failed:`, error);
  }
}

async function sendTurnEndedPush(
  agent: TurnPushAgent,
  target: { orgId: string; sessionId: string; userId: string },
  terminal: StreamEvent
): Promise<void> {
  if (
    !(
      terminal.type === "done" ||
      (terminal.type === "error" && terminal.error !== TURN_CANCELLED_ERROR)
    )
  ) {
    return;
  }

  const summary = await agent.getSessionSummary(target.sessionId, target.orgId);

  // A cognito chat has no row, and promises no trace: no lock-screen preview.
  if (!summary) {
    return;
  }

  const { profile } = await agent.getProfile(target.orgId, summary.profileId);

  const text =
    terminal.type === "done"
      ? terminal.reply
      : `The reply failed: ${terminal.error}`;

  await webPushService.notify(target.userId, {
    body: text.replace(/\s+/g, " ").trim().slice(0, 180) || "Reply ready",
    tag: `session-${target.sessionId}`,
    title: summary.title ? `${profile.name} · ${summary.title}` : profile.name,
    url: `/chat/${encodeURIComponent(summary.profileId)}/${encodeURIComponent(target.sessionId)}`,
  });
}
