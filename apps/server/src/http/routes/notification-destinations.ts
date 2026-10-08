import { z } from "@hono/zod-openapi";
import type {
  ListNotificationDestinationsResponse,
  NotificationDestinationSummary,
  NotificationDestinationWithSecret,
  RegenerateNotificationDestinationKeyResponse,
} from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import { NotificationDestinationService } from "../../services/notification-destination-service";
import type { ServerOptions } from "../context";
import { requireOrgAdminFromContext } from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerNotificationDestinationRoutes(
  app: HonoApp,
  options: ServerOptions
): void {
  const service = new NotificationDestinationService(
    options.databaseAdapter,
    options.authService
  );

  const telegramConfigSchema = z.object({
    chatId: z.number(),
    profileId: z.string().optional(),
    topicId: z.number().nullable().optional(),
  });

  const discordConfigSchema = z.object({
    channelId: z.string(),
    profileId: z.string(),
  });

  const whatsappConfigSchema = z.object({ profileId: z.string() });

  const createRequestSchema = z.discriminatedUnion("channel", [
    z.object({
      channel: z.literal("telegram"),
      name: z.string(),
      telegram: telegramConfigSchema,
    }),
    z.object({
      channel: z.literal("discord"),
      discord: discordConfigSchema,
      name: z.string(),
    }),
    z.object({
      channel: z.literal("whatsapp"),
      name: z.string(),
      whatsapp: whatsappConfigSchema,
    }),
  ]);

  const updateRequestSchema = z.union([
    z.object({
      channel: z.literal("telegram").optional(),
      name: z.string(),
      telegram: telegramConfigSchema,
    }),
    z.object({
      channel: z.literal("discord"),
      discord: discordConfigSchema,
      name: z.string(),
    }),
    z.object({
      channel: z.literal("whatsapp"),
      name: z.string(),
      whatsapp: whatsappConfigSchema,
    }),
  ]);

  app.get("/v1/notification-destinations", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    return json<ListNotificationDestinationsResponse>(
      await service.list(auth.activeOrgId!)
    );
  });

  app.post("/v1/notification-destinations", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    try {
      const body = await readJson(c.req.raw, createRequestSchema);

      return json<NotificationDestinationWithSecret>(
        await service.create(auth.activeOrgId!, body)
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(
        error instanceof Error ? error.message : String(error),
        400
      );
    }
  });

  app.put("/v1/notification-destinations/:destinationId", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    try {
      const body = await readJson(c.req.raw, updateRequestSchema);

      return json<NotificationDestinationSummary>(
        await service.update(
          auth.activeOrgId!,
          c.req.param("destinationId"),
          body
        )
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(
        error instanceof Error ? error.message : String(error),
        400
      );
    }
  });

  app.post(
    "/v1/notification-destinations/:destinationId/rotate-key",
    async (c) => {
      const auth = requireOrgAdminFromContext(c);

      try {
        return json<RegenerateNotificationDestinationKeyResponse>(
          await service.regenerateKey(
            auth.activeOrgId!,
            c.req.param("destinationId")
          )
        );
      } catch (error) {
        if (error instanceof NakamaApiError) {
          return errorResponse(error.message, error.status);
        }

        return errorResponse(
          error instanceof Error ? error.message : String(error),
          400
        );
      }
    }
  );

  app.delete("/v1/notification-destinations/:destinationId", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    try {
      await service.delete(auth.activeOrgId!, c.req.param("destinationId"));

      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      return errorResponse(
        error instanceof Error ? error.message : String(error),
        400
      );
    }
  });
}
