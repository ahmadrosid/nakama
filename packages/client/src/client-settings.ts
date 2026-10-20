import type {
  AgentBrowserStatusResponse,
  ComposioSettingsResponse,
  EmailSettingsResponse,
  ErrorTrackingSettingsResponse,
  GenerateImageRequest,
  GenerateImageResponse,
  ImageGenerationSettings,
  ImageGenerationSettingsResponse,
  ListTimezonesResponse,
  SendEmailTestRequest,
  SendEmailTestResponse,
  SendErrorTrackingTestResponse,
  ThinkingSettings,
  ThinkingSettingsResponse,
  TimezoneSettingsResponse,
  TranscribeAudioRequest,
  TranscribeAudioResponse,
  TranscriptionSettings,
  TranscriptionSettingsResponse,
  UpdateAgentBrowserSettingsRequest,
  UpdateEmailSettingsRequest,
  UpdateErrorTrackingSettingsRequest,
  UpdateImageGenerationRequest,
  UpdateThinkingRequest,
  UpdateTimezoneRequest,
  UpdateTranscriptionRequest,
  UpdateVisionRequest,
  UpdateWebSearchSettingsRequest,
  VisionSettings,
  VisionSettingsResponse,
  WebSearchProvider,
  WebSearchSettingsResponse,
} from "@nakama/core/contract";
import { withDisabledFetchIdle } from "@nakama/core/fetch-idle";
import { createApiError } from "./client-helpers";
import { SystemClient } from "./client-system";
import { readAgentBrowserInstallStream } from "./stream";

/** Workspace settings: timezone, thinking, vision, speech, images, search, email, error tracking, browser. */
export class SettingsClient extends SystemClient {
  async getTimezone(): Promise<string> {
    const response = await this.request<TimezoneSettingsResponse>(
      "/v1/settings/timezone"
    );

    return response.timezone;
  }

  async setTimezone(timezone: string): Promise<string> {
    const response = await this.request<TimezoneSettingsResponse>(
      "/v1/settings/timezone",
      {
        body: JSON.stringify({ timezone } satisfies UpdateTimezoneRequest),
        method: "PUT",
      }
    );

    return response.timezone;
  }

  async getThinkingSettings(): Promise<ThinkingSettings> {
    const response = await this.request<ThinkingSettingsResponse>(
      "/v1/settings/thinking"
    );

    return response.thinking;
  }

  async setThinkingSettings(
    settings: UpdateThinkingRequest
  ): Promise<ThinkingSettings> {
    const response = await this.request<ThinkingSettingsResponse>(
      "/v1/settings/thinking",
      {
        body: JSON.stringify(settings satisfies UpdateThinkingRequest),
        method: "PUT",
      }
    );

    return response.thinking;
  }

  async getVisionSettings(): Promise<VisionSettings> {
    const response = await this.request<VisionSettingsResponse>(
      "/v1/settings/vision"
    );

    return response.vision;
  }

  async setVisionSettings(model: string | null): Promise<VisionSettings> {
    const response = await this.request<VisionSettingsResponse>(
      "/v1/settings/vision",
      {
        body: JSON.stringify({ model } satisfies UpdateVisionRequest),
        method: "PUT",
      }
    );

    return response.vision;
  }

  async getTranscriptionSettings(): Promise<TranscriptionSettings> {
    const response = await this.request<TranscriptionSettingsResponse>(
      "/v1/settings/transcription"
    );

    return response.transcription;
  }

  async setTranscriptionSettings(
    model: string | null
  ): Promise<TranscriptionSettings> {
    const response = await this.request<TranscriptionSettingsResponse>(
      "/v1/settings/transcription",
      {
        body: JSON.stringify({ model } satisfies UpdateTranscriptionRequest),
        method: "PUT",
      }
    );

    return response.transcription;
  }

  async transcribeAudio(
    input: TranscribeAudioRequest
  ): Promise<TranscribeAudioResponse> {
    return this.request<TranscribeAudioResponse>("/v1/audio/transcribe", {
      body: JSON.stringify(input satisfies TranscribeAudioRequest),
      method: "POST",
    });
  }

  async getImageGenerationSettings(): Promise<ImageGenerationSettings> {
    const response = await this.request<ImageGenerationSettingsResponse>(
      "/v1/settings/image-generation"
    );

    return response.imageGeneration;
  }

  async setImageGenerationSettings(
    model: string | null
  ): Promise<ImageGenerationSettings> {
    const response = await this.request<ImageGenerationSettingsResponse>(
      "/v1/settings/image-generation",
      {
        body: JSON.stringify({ model } satisfies UpdateImageGenerationRequest),
        method: "PUT",
      }
    );

    return response.imageGeneration;
  }

  async generateImage(
    input: GenerateImageRequest
  ): Promise<GenerateImageResponse> {
    return this.request<GenerateImageResponse>("/v1/images/generate", {
      body: JSON.stringify(input satisfies GenerateImageRequest),
      method: "POST",
    });
  }

  async getErrorTrackingSettings(): Promise<ErrorTrackingSettingsResponse> {
    return this.request<ErrorTrackingSettingsResponse>(
      "/v1/settings/error-tracking"
    );
  }

  async setErrorTrackingSettings(
    request: UpdateErrorTrackingSettingsRequest
  ): Promise<ErrorTrackingSettingsResponse> {
    return this.request<ErrorTrackingSettingsResponse>(
      "/v1/settings/error-tracking",
      { body: JSON.stringify(request), method: "PUT" }
    );
  }

  async sendErrorTrackingTest(): Promise<SendErrorTrackingTestResponse> {
    return this.request<SendErrorTrackingTestResponse>(
      "/v1/settings/error-tracking/test",
      { method: "POST" }
    );
  }

  async getWebSearchSettings(): Promise<WebSearchSettingsResponse> {
    return this.request<WebSearchSettingsResponse>("/v1/settings/web-search");
  }

  async setWebSearchSettings(
    request: UpdateWebSearchSettingsRequest
  ): Promise<WebSearchSettingsResponse> {
    return this.request<WebSearchSettingsResponse>("/v1/settings/web-search", {
      body: JSON.stringify(request),
      method: "PUT",
    });
  }

  async setWebSearchSecret(
    provider: WebSearchProvider,
    apiKey: string
  ): Promise<WebSearchSettingsResponse> {
    return this.request<WebSearchSettingsResponse>(
      "/v1/settings/web-search/secret",
      {
        body: JSON.stringify({ apiKey, provider }),
        method: "PUT",
      }
    );
  }

  async manageSettingSecret<T extends "email" | "web-search" | "composio">(
    kind: T,
    action: "clear" | "use-stored"
  ): Promise<
    T extends "email"
      ? EmailSettingsResponse
      : T extends "web-search"
        ? WebSearchSettingsResponse
        : ComposioSettingsResponse
  > {
    return this.request(
      `/v1/settings/${kind}/secret${action === "use-stored" ? "/use-stored" : ""}`,
      { method: action === "clear" ? "DELETE" : "POST" }
    );
  }

  async getEmailSettings(): Promise<EmailSettingsResponse> {
    return this.request<EmailSettingsResponse>("/v1/settings/email");
  }

  async setEmailSettings(
    request: UpdateEmailSettingsRequest
  ): Promise<EmailSettingsResponse> {
    return this.request<EmailSettingsResponse>("/v1/settings/email", {
      body: JSON.stringify(request),
      method: "PUT",
    });
  }

  async setEmailSecret(password: string): Promise<EmailSettingsResponse> {
    return this.request<EmailSettingsResponse>("/v1/settings/email/secret", {
      body: JSON.stringify({ password }),
      method: "PUT",
    });
  }

  async sendEmailTest(
    request: SendEmailTestRequest = {}
  ): Promise<SendEmailTestResponse> {
    return this.request<SendEmailTestResponse>("/v1/settings/email/test", {
      body: JSON.stringify(request),
      method: "POST",
    });
  }

  async getAgentBrowserStatus(): Promise<AgentBrowserStatusResponse> {
    return this.request<AgentBrowserStatusResponse>(
      "/v1/settings/agent-browser"
    );
  }

  async setAgentBrowserSettings(
    request: UpdateAgentBrowserSettingsRequest
  ): Promise<AgentBrowserStatusResponse> {
    return this.request<AgentBrowserStatusResponse>(
      "/v1/settings/agent-browser",
      {
        body: JSON.stringify(request),
        method: "PUT",
      }
    );
  }

  async installAgentBrowser(
    handlers: {
      onProgress?: (message: string) => void;
      onDone?: (status: AgentBrowserStatusResponse) => void;
    } = {},
    options?: { signal?: AbortSignal }
  ): Promise<AgentBrowserStatusResponse> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/settings/agent-browser/install`,
      withDisabledFetchIdle({
        credentials: this.credentials,
        headers: this.buildHeaders("POST", {
          Accept: "text/event-stream",
        }),
        method: "POST",
        signal: options?.signal,
      })
    );

    if (!response.ok) {
      throw await createApiError(
        response,
        "/v1/settings/agent-browser/install"
      );
    }

    if (!response.body) {
      throw new Error("Server returned an empty stream.");
    }

    return readAgentBrowserInstallStream(
      response.body,
      handlers,
      options?.signal
    );
  }

  async listTimezones(): Promise<ListTimezonesResponse> {
    return this.request<ListTimezonesResponse>("/v1/timezones");
  }
}
