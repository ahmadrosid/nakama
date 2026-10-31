import { z } from "@hono/zod-openapi";
import { NakamaApiError } from "@nakama/core";
import { isPushServiceEndpoint } from "../../services/web-push";
import { webPushService } from "../../services/web-push-service";
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
