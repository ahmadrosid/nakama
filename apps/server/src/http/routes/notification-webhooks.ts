import type { NotificationWebhookRequest } from "@nakama/core";
import { NotificationWebhookService } from "../../services/notification-webhook-service";
import type { ServerOptions } from "../context";
import { readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerNotificationWebhookRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const service = new NotificationWebhookService(
    options.databaseAdapter,
    options.authService
  );

  // Public webhook: clients must send a unique Idempotency-Key per event.
  // Replays with the same key are rejected (409) after the first successful claim.
  app.post("/v1/notify/:destinationId", async (c) => {
    const body = await readJson<NotificationWebhookRequest>(c.req.raw);
    const apiKey = c.req.header("x-api-key")?.trim() ?? null;
    const idempotencyKey = c.req.header("idempotency-key")?.trim() ?? null;
    await service.deliver(
      c.req.param("destinationId"),
      apiKey,
      body,
      idempotencyKey
    );
    return new Response(null, { status: 204 });
  });
}
