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

  app.post("/v1/notify/:destinationId", async (c) => {
    const body = await readJson<NotificationWebhookRequest>(c.req.raw);
    const apiKey = c.req.header("x-api-key")?.trim() ?? null;
    await service.deliver(c.req.param("destinationId"), apiKey, body);
    return new Response(null, { status: 204 });
  });
}
