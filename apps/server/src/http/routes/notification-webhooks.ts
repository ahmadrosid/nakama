import type { NotificationWebhookRequest } from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import { NotificationWebhookService } from "../../services/notification-webhook-service";
import type { ServerOptions } from "../context";
import { errorResponse, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerNotificationWebhookRoutes(
  app: HonoApp,
  options: ServerOptions,
): void {
  const service = new NotificationWebhookService(
    options.databaseAdapter,
    options.authService,
  );

  app.post("/v1/notify/:destinationId", async (c) => {
    try {
      const body = await readJson<NotificationWebhookRequest>(c.req.raw);
      const apiKey = c.req.header("x-api-key")?.trim() ?? null;
      await service.deliver(c.req.param("destinationId"), apiKey, body);
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });
}
