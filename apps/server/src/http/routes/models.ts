import { createRoute, z } from "@hono/zod-openapi";
import {
  resetWhatsAppSessionForReconnect,
  type ConfigureProviderRequest,
  type ConfigureProviderResponse,
  type CreateProviderRequest,
  type CreateProviderResponse,
  type DeleteProviderResponse,
  type DiscoverModelsRequest,
  type ListProvidersResponse,
  type ListTimezonesResponse,
  type ModelsResponse,
  type TelegramSettingsResponse,
  type ComposioSettingsResponse,
  type CodingHarnessSettingsResponse,
  type CodingHarnessInstallRequest,
  type EmailSettingsResponse,
  type SendEmailTestRequest,
  type SendEmailTestResponse,
  type VerifyCodingHarnessRequest,
  type VerifyCodingHarnessResponse,
  type ThinkingSettingsResponse,
  type TimezoneSettingsResponse,
  type UpdateProviderRequest,
  type UpdateProviderResponse,
  type UpdateTelegramSettingsRequest,
  type UpdateComposioSettingsRequest,
  type UpdateEmailSettingsRequest,
  type UpdateCodingHarnessSettingsRequest,
  type UpdateThinkingRequest,
  type UpdateTimezoneRequest,
  type UpdateVisionRequest,
  type UpdateTranscriptionRequest,
  type TranscribeAudioRequest,
  type TranscribeAudioResponse,
  type TranscriptionSettingsResponse,
  type UpdateWhatsAppSettingsRequest,
  type VisionSettingsResponse,
  type WhatsAppSettingsResponse,
} from "@nakama/core";
import { NakamaApiError } from "@nakama/core";
import { getTimezoneCatalog } from "../../services/timezone-catalog-service";
import type { HonoApp } from "../types";
import type { ServerOptions } from "../context";
import { errorResponse, json, readJson } from "../shared";
import { requireOrgAdminFromContext } from "../org-guards";
import { installCodingAgentHarness } from "../../services/coding-agent-harness-service";
import { streamCodingHarnessInstall } from "../coding-harness-install-stream";

export function registerModelRoutes(app: HonoApp, options: ServerOptions): void {
  const { agent, workerManager, databaseAdapter } = options;
  const errorSchema = z.object({ error: z.string() }).openapi("ApiErrorResponse");
  const providerIdParam = z.object({
    providerId: z.string().openapi({ param: { name: "providerId", in: "path" } }),
  });
  const modelsResponseSchema = z.object({ models: z.array(z.object({}).passthrough()) }).passthrough().openapi("ModelsResponse");
  const providersResponseSchema = z.object({ providers: z.array(z.object({}).passthrough()) }).passthrough().openapi("ListProvidersResponse");
  const createProviderResponseSchema = z.object({}).passthrough().openapi("CreateProviderResponse");
  const updateProviderResponseSchema = z.object({}).passthrough().openapi("UpdateProviderResponse");
  const deleteProviderResponseSchema = z.object({}).passthrough().openapi("DeleteProviderResponse");
  const configureProviderResponseSchema = z.object({}).passthrough().openapi("ConfigureProviderResponse");
  const timezonesResponseSchema = z.object({ timezones: z.array(z.object({}).passthrough()) }).passthrough().openapi("ListTimezonesResponse");
  const timezoneSettingsSchema = z.object({ timezone: z.string() }).openapi("TimezoneSettingsResponse");
  const thinkingSettingsSchema = z.object({}).passthrough().openapi("ThinkingSettingsResponse");
  const visionSettingsSchema = z.object({}).passthrough().openapi("VisionSettingsResponse");
  const transcriptionSettingsSchema = z
    .object({})
    .passthrough()
    .openapi("TranscriptionSettingsResponse");
  const transcribeAudioRequestSchema = z
    .object({})
    .passthrough()
    .openapi("TranscribeAudioRequest");
  const transcribeAudioResponseSchema = z
    .object({})
    .passthrough()
    .openapi("TranscribeAudioResponse");
  const telegramSettingsSchema = z.object({}).passthrough().openapi("TelegramSettingsResponse");
  const composioSettingsSchema = z.object({}).passthrough().openapi("ComposioSettingsResponse");
  const emailSettingsSchema = z.object({}).passthrough().openapi("EmailSettingsResponse");
  const codingHarnessSettingsSchema = z
    .object({})
    .passthrough()
    .openapi("CodingHarnessSettingsResponse");
  const codingHarnessInstallRequestSchema = z
    .object({ harnessId: z.string() })
    .openapi("CodingHarnessInstallRequest");
  const codingHarnessInstallEventSchema = z
    .object({})
    .passthrough()
    .openapi("CodingHarnessInstallEvent");
  const sendEmailTestRequestSchema = z.object({ to: z.string().optional() }).openapi("SendEmailTestRequest");
  const sendEmailTestResponseSchema = z.object({ ok: z.literal(true), to: z.string(), messageId: z.string() }).openapi("SendEmailTestResponse");
  const updateEmailRequestSchema = z.object({}).passthrough().openapi("UpdateEmailSettingsRequest");
  const updateCodingHarnessRequestSchema = z
    .object({})
    .passthrough()
    .openapi("UpdateCodingHarnessSettingsRequest");
  const verifyCodingHarnessRequestSchema = z
    .object({})
    .passthrough()
    .openapi("VerifyCodingHarnessRequest");
  const verifyCodingHarnessResponseSchema = z
    .object({})
    .passthrough()
    .openapi("VerifyCodingHarnessResponse");
  const whatsappSettingsSchema = z.object({}).passthrough().openapi("WhatsAppSettingsResponse");
  const discoverModelsRequestSchema = z
    .object({
      baseUrl: z.string().optional(),
      apiKey: z.string().optional(),
      providerId: z.string().optional(),
    })
    .openapi("DiscoverModelsRequest");
  const createProviderRequestSchema = z.object({}).passthrough().openapi("CreateProviderRequest");
  const updateProviderRequestSchema = z.object({}).passthrough().openapi("UpdateProviderRequest");
  const configureProviderRequestSchema = z.object({}).passthrough().openapi("ConfigureProviderRequest");
  const updateTimezoneRequestSchema = z.object({ timezone: z.string() }).openapi("UpdateTimezoneRequest");
  const updateThinkingRequestSchema = z.object({}).passthrough().openapi("UpdateThinkingRequest");
  const updateVisionRequestSchema = z.object({ model: z.string().nullable() }).openapi("UpdateVisionRequest");
  const updateTelegramRequestSchema = z.object({}).passthrough().openapi("UpdateTelegramSettingsRequest");
  const updateComposioRequestSchema = z.object({}).passthrough().openapi("UpdateComposioSettingsRequest");
  const updateWhatsappRequestSchema = z.object({}).passthrough().openapi("UpdateWhatsAppSettingsRequest");
  const modelQuerySchema = z.object({ source: z.enum(["catalog", "remote"]).optional() });

  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/models",
    tags: ["Models"],
    summary: "List available models",
    operationId: "listModels",
    request: { query: modelQuerySchema },
    responses: { 200: { description: "Model catalog", content: { "application/json": { schema: modelsResponseSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/models/discover",
    tags: ["Models"],
    summary: "Discover models from a provider base URL",
    operationId: "discoverModels",
    request: { body: { required: true, content: { "application/json": { schema: discoverModelsRequestSchema } } } },
    responses: { 200: { description: "Model catalog", content: { "application/json": { schema: modelsResponseSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/providers",
    tags: ["Models"],
    summary: "List configured provider instances",
    operationId: "listProviders",
    responses: { 200: { description: "Provider instances", content: { "application/json": { schema: providersResponseSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/providers",
    tags: ["Models"],
    summary: "Add a provider instance",
    operationId: "createProvider",
    request: { body: { required: true, content: { "application/json": { schema: createProviderRequestSchema } } } },
    responses: { 200: { description: "Provider created", content: { "application/json": { schema: createProviderResponseSchema } } }, 500: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "patch",
    path: "/v1/providers/{providerId}",
    tags: ["Models"],
    summary: "Update a provider instance",
    operationId: "updateProvider",
    request: { params: providerIdParam, body: { required: true, content: { "application/json": { schema: updateProviderRequestSchema } } } },
    responses: { 200: { description: "Provider updated", content: { "application/json": { schema: updateProviderResponseSchema } } }, 500: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "delete",
    path: "/v1/providers/{providerId}",
    tags: ["Models"],
    summary: "Remove a provider instance",
    operationId: "deleteProvider",
    request: { params: providerIdParam },
    responses: { 200: { description: "Provider removed", content: { "application/json": { schema: deleteProviderResponseSchema } } }, 500: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/settings/provider",
    tags: ["Models"],
    summary: "Configure the LLM provider and API key",
    operationId: "configureProvider",
    request: { body: { required: true, content: { "application/json": { schema: configureProviderRequestSchema } } } },
    responses: { 200: { description: "Provider configured", content: { "application/json": { schema: configureProviderResponseSchema } } }, 500: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/timezones",
    tags: ["Models"],
    summary: "List available timezones",
    operationId: "listTimezones",
    responses: { 200: { description: "Timezone catalog", content: { "application/json": { schema: timezonesResponseSchema } } }, 500: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/settings/timezone",
    tags: ["Models"],
    summary: "Get the user timezone",
    operationId: "getTimezone",
    responses: { 200: { description: "Timezone settings", content: { "application/json": { schema: timezoneSettingsSchema } } }, 500: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/settings/timezone",
    tags: ["Models"],
    summary: "Update the user timezone",
    operationId: "setTimezone",
    request: { body: { required: true, content: { "application/json": { schema: updateTimezoneRequestSchema } } } },
    responses: { 200: { description: "Timezone settings", content: { "application/json": { schema: timezoneSettingsSchema } } }, 500: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/settings/thinking",
    tags: ["Models"],
    summary: "Get thinking settings",
    operationId: "getThinkingSettings",
    responses: { 200: { description: "Thinking settings", content: { "application/json": { schema: thinkingSettingsSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/settings/thinking",
    tags: ["Models"],
    summary: "Update thinking settings",
    operationId: "setThinkingSettings",
    request: { body: { required: true, content: { "application/json": { schema: updateThinkingRequestSchema } } } },
    responses: { 200: { description: "Thinking settings", content: { "application/json": { schema: thinkingSettingsSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/settings/vision",
    tags: ["Models"],
    summary: "Get vision settings",
    operationId: "getVisionSettings",
    responses: { 200: { description: "Vision settings", content: { "application/json": { schema: visionSettingsSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/settings/vision",
    tags: ["Models"],
    summary: "Update vision settings",
    operationId: "setVisionSettings",
    request: { body: { required: true, content: { "application/json": { schema: updateVisionRequestSchema } } } },
    responses: {
      200: { description: "Vision settings", content: { "application/json": { schema: visionSettingsSchema } } },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  const updateTranscriptionRequestSchema = z
    .object({ model: z.string().nullable() })
    .openapi("UpdateTranscriptionRequest");
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/settings/transcription",
    tags: ["Models"],
    summary: "Get transcription settings",
    operationId: "getTranscriptionSettings",
    responses: {
      200: {
        description: "Transcription settings",
        content: { "application/json": { schema: transcriptionSettingsSchema } },
      },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/settings/transcription",
    tags: ["Models"],
    summary: "Update transcription settings",
    operationId: "setTranscriptionSettings",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: updateTranscriptionRequestSchema } },
      },
    },
    responses: {
      200: {
        description: "Transcription settings",
        content: { "application/json": { schema: transcriptionSettingsSchema } },
      },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/audio/transcribe",
    tags: ["Models"],
    summary: "Transcribe audio with configured Whisper model",
    operationId: "transcribeAudio",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: transcribeAudioRequestSchema } },
      },
    },
    responses: {
      200: {
        description: "Transcription result",
        content: { "application/json": { schema: transcribeAudioResponseSchema } },
      },
      400: { description: "Error", content: { "application/json": { schema: errorSchema } } },
      502: { description: "Upstream error", content: { "application/json": { schema: errorSchema } } },
    },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/settings/telegram",
    tags: ["Models"],
    summary: "Get Telegram settings",
    operationId: "getTelegramSettings",
    responses: { 200: { description: "Telegram settings", content: { "application/json": { schema: telegramSettingsSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/settings/telegram",
    tags: ["Models"],
    summary: "Update Telegram settings",
    operationId: "setTelegramSettings",
    request: { body: { required: true, content: { "application/json": { schema: updateTelegramRequestSchema } } } },
    responses: { 200: { description: "Telegram settings", content: { "application/json": { schema: telegramSettingsSchema } } }, 400: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/settings/telegram/handshake",
    tags: ["Models"],
    summary: "Regenerate Telegram handshake",
    operationId: "regenerateTelegramHandshake",
    responses: { 200: { description: "Telegram settings", content: { "application/json": { schema: telegramSettingsSchema } } }, 400: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/settings/composio",
    tags: ["Models"],
    summary: "Get Composio settings",
    operationId: "getComposioSettings",
    responses: { 200: { description: "Composio settings", content: { "application/json": { schema: composioSettingsSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/settings/composio",
    tags: ["Models"],
    summary: "Update Composio settings",
    operationId: "setComposioSettings",
    request: { body: { required: true, content: { "application/json": { schema: updateComposioRequestSchema } } } },
    responses: { 200: { description: "Composio settings", content: { "application/json": { schema: composioSettingsSchema } } }, 400: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/settings/email",
    tags: ["Models"],
    summary: "Get email settings",
    operationId: "getEmailSettings",
    responses: { 200: { description: "Email settings", content: { "application/json": { schema: emailSettingsSchema } } }, 403: { description: "Forbidden", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/settings/email",
    tags: ["Models"],
    summary: "Update email settings",
    operationId: "setEmailSettings",
    request: { body: { required: true, content: { "application/json": { schema: updateEmailRequestSchema } } } },
    responses: { 200: { description: "Email settings", content: { "application/json": { schema: emailSettingsSchema } } }, 400: { description: "Error", content: { "application/json": { schema: errorSchema } } }, 403: { description: "Forbidden", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/settings/email/test",
    tags: ["Models"],
    summary: "Send test email",
    operationId: "sendEmailTest",
    request: { body: { required: false, content: { "application/json": { schema: sendEmailTestRequestSchema } } } },
    responses: { 200: { description: "Test email sent", content: { "application/json": { schema: sendEmailTestResponseSchema } } }, 400: { description: "Error", content: { "application/json": { schema: errorSchema } } }, 403: { description: "Forbidden", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/settings/coding-harnesses",
    tags: ["Models"],
    summary: "Get coding harness settings",
    operationId: "getCodingHarnessSettings",
    responses: { 200: { description: "Coding harness settings", content: { "application/json": { schema: codingHarnessSettingsSchema } } }, 403: { description: "Forbidden", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/settings/coding-harnesses",
    tags: ["Models"],
    summary: "Update coding harness settings",
    operationId: "setCodingHarnessSettings",
    request: { body: { required: true, content: { "application/json": { schema: updateCodingHarnessRequestSchema } } } },
    responses: { 200: { description: "Coding harness settings", content: { "application/json": { schema: codingHarnessSettingsSchema } } }, 400: { description: "Error", content: { "application/json": { schema: errorSchema } } }, 403: { description: "Forbidden", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/settings/coding-harnesses/verify",
    tags: ["Models"],
    summary: "Verify a coding harness",
    operationId: "verifyCodingHarness",
    request: { body: { required: false, content: { "application/json": { schema: verifyCodingHarnessRequestSchema } } } },
    responses: { 200: { description: "Coding harness verification", content: { "application/json": { schema: verifyCodingHarnessResponseSchema } } }, 400: { description: "Error", content: { "application/json": { schema: errorSchema } } }, 403: { description: "Forbidden", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/settings/coding-harnesses/install",
    tags: ["Models"],
    summary: "Install a coding harness",
    operationId: "installCodingHarness",
    request: { body: { required: true, content: { "application/json": { schema: codingHarnessInstallRequestSchema } } } },
    responses: { 200: { description: "Coding harness install stream", content: { "application/json": { schema: codingHarnessInstallEventSchema } } }, 400: { description: "Error", content: { "application/json": { schema: errorSchema } } }, 403: { description: "Forbidden", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "get",
    path: "/v1/settings/whatsapp",
    tags: ["Models"],
    summary: "Get WhatsApp settings",
    operationId: "getWhatsAppSettings",
    responses: { 200: { description: "WhatsApp settings", content: { "application/json": { schema: whatsappSettingsSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "put",
    path: "/v1/settings/whatsapp",
    tags: ["Models"],
    summary: "Update WhatsApp settings",
    operationId: "setWhatsAppSettings",
    request: { body: { required: true, content: { "application/json": { schema: updateWhatsappRequestSchema } } } },
    responses: { 200: { description: "WhatsApp settings", content: { "application/json": { schema: whatsappSettingsSchema } } }, 400: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/settings/whatsapp/pairing-code",
    tags: ["Models"],
    summary: "Regenerate WhatsApp pairing code",
    operationId: "regenerateWhatsAppPairingCode",
    responses: { 200: { description: "WhatsApp settings", content: { "application/json": { schema: whatsappSettingsSchema } } }, 400: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));
  app.openAPIRegistry.registerPath(createRoute({
    method: "post",
    path: "/v1/settings/whatsapp/reconnect",
    tags: ["Models"],
    summary: "Reconnect WhatsApp session",
    operationId: "reconnectWhatsApp",
    responses: { 200: { description: "WhatsApp settings", content: { "application/json": { schema: whatsappSettingsSchema } } }, 400: { description: "Error", content: { "application/json": { schema: errorSchema } } } },
  }));

  app.get("/v1/models", async (c) => {
    const source = c.req.query("source");
    const modelsSource = source === "remote" ? ("remote" as const) : ("catalog" as const);
    return json<ModelsResponse>(await agent.getModels({ source: modelsSource }));
  });

  app.post("/v1/models/discover", async (c) => {
    const body = await readJson<DiscoverModelsRequest>(c.req.raw);

    try {
      const result = await agent.discoverModels(body);
      return json<ModelsResponse>(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.get("/v1/providers", async () => {
    return json<ListProvidersResponse>(await agent.listProviders());
  });

  app.post("/v1/providers", async (c) => {
    const body = await readJson<CreateProviderRequest>(c.req.raw);
    return json<CreateProviderResponse>(await agent.createProvider(body));
  });

  app.patch("/v1/providers/:providerId", async (c) => {
    const body = await readJson<UpdateProviderRequest>(c.req.raw);
    return json<UpdateProviderResponse>(
      await agent.updateProvider(decodeURIComponent(c.req.param("providerId")), body),
    );
  });

  app.delete("/v1/providers/:providerId", async (c) => {
    return json<DeleteProviderResponse>(
      await agent.deleteProvider(decodeURIComponent(c.req.param("providerId"))),
    );
  });

  app.put("/v1/settings/provider", async (c) => {
    const body = await readJson<ConfigureProviderRequest>(c.req.raw);
    const result = await agent.configureProvider(body);
    return json<ConfigureProviderResponse>(result);
  });

  app.get("/v1/timezones", async () => {
    return json<ListTimezonesResponse>(await getTimezoneCatalog());
  });

  app.get("/v1/settings/timezone", async () => {
    return json<TimezoneSettingsResponse>({ timezone: await agent.getUserTimezone() });
  });

  app.put("/v1/settings/timezone", async (c) => {
    const body = await readJson<UpdateTimezoneRequest>(c.req.raw);
    const timezone = await agent.setUserTimezone(body.timezone);
    return json<TimezoneSettingsResponse>({ timezone });
  });

  app.get("/v1/settings/thinking", async () => {
    return json<ThinkingSettingsResponse>(await agent.getThinkingSettings());
  });

  app.put("/v1/settings/thinking", async (c) => {
    const body = await readJson<UpdateThinkingRequest>(c.req.raw);
    return json<ThinkingSettingsResponse>(await agent.setThinkingSettings(body));
  });

  app.get("/v1/settings/vision", async () => {
    return json<VisionSettingsResponse>(await agent.getVisionSettings());
  });

  app.put("/v1/settings/vision", async (c) => {
    const body = await readJson<UpdateVisionRequest>(c.req.raw);

    try {
      return json<VisionSettingsResponse>(await agent.setVisionSettings(body));
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.get("/v1/settings/transcription", async () => {
    return json<TranscriptionSettingsResponse>(await agent.getTranscriptionSettings());
  });

  app.put("/v1/settings/transcription", async (c) => {
    const body = await readJson<UpdateTranscriptionRequest>(c.req.raw);

    try {
      return json<TranscriptionSettingsResponse>(await agent.setTranscriptionSettings(body));
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.post("/v1/audio/transcribe", async (c) => {
    const body = await readJson<TranscribeAudioRequest>(c.req.raw);

    try {
      return json<TranscribeAudioResponse>(await agent.transcribeAudio(body));
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }

      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.get("/v1/settings/email", async (c) => {
    requireOrgAdminFromContext(c);
    return json<EmailSettingsResponse>(await agent.getEmailSettings());
  });

  app.put("/v1/settings/email", async (c) => {
    requireOrgAdminFromContext(c);
    const body = await readJson<UpdateEmailSettingsRequest>(c.req.raw);

    try {
      return json<EmailSettingsResponse>(await agent.setEmailSettings(body));
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.post("/v1/settings/email/test", async (c) => {
    const auth = requireOrgAdminFromContext(c);
    const body = await readJson<SendEmailTestRequest>(c.req.raw).catch(() => ({} as SendEmailTestRequest));

    try {
      return json<SendEmailTestResponse>(
        await agent.sendEmailTest(body.to?.trim() || auth.user.email),
      );
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.get("/v1/settings/coding-harnesses", async (c) => {
    requireOrgAdminFromContext(c);
    return json<CodingHarnessSettingsResponse>(await agent.getCodingHarnessSettings());
  });

  app.put("/v1/settings/coding-harnesses", async (c) => {
    requireOrgAdminFromContext(c);
    const body = await readJson<UpdateCodingHarnessSettingsRequest>(c.req.raw);

    try {
      return json<CodingHarnessSettingsResponse>(await agent.setCodingHarnessSettings(body));
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.post("/v1/settings/coding-harnesses/verify", async (c) => {
    requireOrgAdminFromContext(c);
    const body = await readJson<VerifyCodingHarnessRequest>(c.req.raw).catch(
      () => ({} as VerifyCodingHarnessRequest),
    );

    try {
      return json<VerifyCodingHarnessResponse>(await agent.verifyCodingHarness(body.harnessId));
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.post("/v1/settings/coding-harnesses/install", async (c) => {
    requireOrgAdminFromContext(c);
    const body = await readJson<CodingHarnessInstallRequest>(c.req.raw);

    if (!databaseAdapter) {
      return errorResponse("Database adapter is not configured.", 500);
    }

    return streamCodingHarnessInstall(async (send) => {
      const status = await installCodingAgentHarness(databaseAdapter, body.harnessId, (progress) => {
        send({
          type: "progress",
          harnessId: progress.harnessId,
          name: progress.name,
          message: progress.message,
        });
      });

      send({
        type: "done",
        status,
      });
    }, {
      timeoutMessage: "Install timed out while waiting for the coding harness installer.",
    });
  });

  app.get("/v1/settings/telegram", async () => {
    return json<TelegramSettingsResponse>(await agent.getTelegramSettings());
  });

  app.put("/v1/settings/telegram", async (c) => {
    const body = await readJson<UpdateTelegramSettingsRequest>(c.req.raw);

    try {
      return json<TelegramSettingsResponse>(await agent.setTelegramSettings(body));
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.post("/v1/settings/telegram/handshake", async () => {
    try {
      return json<TelegramSettingsResponse>(await agent.regenerateTelegramHandshake());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.get("/v1/settings/composio", async () => {
    return json<ComposioSettingsResponse>(await agent.getComposioSettings());
  });

  app.put("/v1/settings/composio", async (c) => {
    const body = await readJson<UpdateComposioSettingsRequest>(c.req.raw);

    try {
      return json<ComposioSettingsResponse>(await agent.setComposioSettings(body));
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.get("/v1/settings/whatsapp", async () => {
    return json<WhatsAppSettingsResponse>(await agent.getWhatsAppSettings());
  });

  app.put("/v1/settings/whatsapp", async (c) => {
    const body = await readJson<UpdateWhatsAppSettingsRequest>(c.req.raw);

    try {
      return json<WhatsAppSettingsResponse>(await agent.setWhatsAppSettings(body));
    } catch (error) {
      if (error instanceof NakamaApiError) {
        return errorResponse(error.message, error.status);
      }
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.post("/v1/settings/whatsapp/pairing-code", async () => {
    try {
      return json<WhatsAppSettingsResponse>(await agent.regenerateWhatsAppPairingCode());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });

  app.post("/v1/settings/whatsapp/reconnect", async () => {
    try {
      await workerManager.stopWorker("whatsapp").catch(() => {});
      const settings = await resetWhatsAppSessionForReconnect();

      try {
        await workerManager.startWorker("whatsapp");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResponse(
          `Session reset, but the WhatsApp worker could not start: ${message}. Start it manually from Settings.`,
          400,
        );
      }

      return json<WhatsAppSettingsResponse>(settings);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return errorResponse(message, 400);
    }
  });
}
