import type {
  CreateNotificationDestinationRequest,
  ListNotificationDestinationsResponse,
  NotificationDestinationSummary,
  NotificationDestinationWithSecret,
  RegenerateNotificationDestinationKeyResponse,
  UpdateNotificationDestinationRequest,
} from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import { NotificationDestinationService } from "../../services/notification-destination-service";
import type { ServerOptions } from "../context";
import { requireOrgAdminFromContext } from "../org-guards";
import { errorResponse, json, readJson } from "../shared";
import type { HonoApp } from "../types";

export function registerNotificationDestinationRoutes(
  app: HonoApp,
  options: ServerOptions,
): void {
  const service = new NotificationDestinationService(
    options.databaseAdapter,
    options.authService,
  );

  app.get("/v1/notification-destinations", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    return json<ListNotificationDestinationsResponse>(await service.list(auth.activeOrgId!));
  });

  app.post("/v1/notification-destinations", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    try {
      const body = await readJson<CreateNotificationDestinationRequest>(c.req.raw);
      return json<NotificationDestinationWithSecret>(
        await service.create(auth.activeOrgId!, body),
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.put("/v1/notification-destinations/:destinationId", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    try {
      const body = await readJson<UpdateNotificationDestinationRequest>(c.req.raw);
      return json<NotificationDestinationSummary>(
        await service.update(auth.activeOrgId!, c.req.param("destinationId"), body),
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.post("/v1/notification-destinations/:destinationId/rotate-key", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    try {
      return json<RegenerateNotificationDestinationKeyResponse>(
        await service.regenerateKey(auth.activeOrgId!, c.req.param("destinationId")),
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.delete("/v1/notification-destinations/:destinationId", async (c) => {
    const auth = requireOrgAdminFromContext(c);

    try {
      await service.delete(auth.activeOrgId!, c.req.param("destinationId"));
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      return errorResponse(error instanceof Error ? error.message : String(error), 400);
    }
  });
}
