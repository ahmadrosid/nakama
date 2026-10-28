import type {
  AcpAgentPresetsResponse,
  AcpSessionSettingsResponse,
  AgentChannel,
  BranchSessionRequest,
  BranchSessionResponse,
  CompactionResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  DraftAutomationResponse,
  InitUserContextResponse,
  ListSessionsResponse,
  SendMessageRequest,
  SendMessageResponse,
  SessionBrowserResponse,
  SessionMessagesResponse,
  SessionStatusResponse,
  SessionSummary,
  SetupChecklistRequest,
  SetupChecklistResponse,
  UpdateSessionRequest,
  UpdateUserContextRequest,
  UserContextStatusResponse,
} from "@nakama/core/contract";
import { withDisabledFetchIdle } from "@nakama/core/fetch-idle";
import { createApiError } from "./client-helpers";
import { ProfileFilesClient } from "./client-profile-files";
import {
  normalizeStreamHandlers,
  readStreamEvents,
  resolveSendMessageBody,
  retryWhileTurnIsStopping,
} from "./stream";
import type {
  RemoteChatSession,
  SendMessageArg,
  SendStreamOptions,
  StreamHandler,
  StreamHandlers,
} from "./types";

/** Chat sessions, their stream, and the user context. */
export class ChatClient extends ProfileFilesClient {
  async createSession(
    channel: AgentChannel,
    options: Omit<CreateSessionRequest, "channel"> = {}
  ): Promise<RemoteChatSession> {
    const response = await this.request<CreateSessionResponse>("/v1/sessions", {
      body: JSON.stringify({
        channel,
        codingWorkspaceRoot: options.codingWorkspaceRoot,
        cognito: options.cognito,
        model: options.model,
        profileId: options.profileId,
        thinkingEffort: options.thinkingEffort,
      }),
      method: "POST",
    });

    return this.createChatSession(response.sessionId, channel);
  }

  async readAttachmentContent(attachmentId: string): Promise<Blob> {
    const response = await this.fetchRaw(
      `/v1/attachments/${encodeURIComponent(attachmentId)}/content`
    );

    return response.blob();
  }

  async getSessionMessages(
    sessionId: string,
    options: { signal?: AbortSignal } = {}
  ): Promise<SessionMessagesResponse> {
    return this.request<SessionMessagesResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
      { signal: options.signal }
    );
  }

  async getSession(sessionId: string): Promise<SessionSummary> {
    return this.request<SessionSummary>(
      `/v1/sessions/${encodeURIComponent(sessionId)}`
    );
  }

  async getSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
    return this.request<SessionStatusResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/status`
    );
  }

  async getSessionBrowser(sessionId: string): Promise<SessionBrowserResponse> {
    return this.request<SessionBrowserResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/browser`
    );
  }

  async stopSessionBrowser(sessionId: string): Promise<void> {
    await this.request<void>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/browser`,
      { method: "DELETE" }
    );
  }

  async getSessionAcpSettings(
    sessionId: string
  ): Promise<AcpSessionSettingsResponse> {
    return this.request<AcpSessionSettingsResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/acp-settings`
    );
  }

  async setSessionAcpSetting(
    sessionId: string,
    configId: string,
    value: string
  ): Promise<AcpSessionSettingsResponse> {
    return this.request<AcpSessionSettingsResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/acp-settings/${encodeURIComponent(configId)}`,
      { body: JSON.stringify({ value }), method: "PUT" }
    );
  }

  async getAcpAgentPresets(): Promise<AcpAgentPresetsResponse> {
    return this.request<AcpAgentPresetsResponse>("/v1/acp-agent-presets");
  }

  async getProfileAcpSettings(
    profileId: string
  ): Promise<AcpSessionSettingsResponse> {
    return this.request<AcpSessionSettingsResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/acp-settings`
    );
  }

  async setProfileAcpSetting(
    profileId: string,
    configId: string,
    value: string
  ): Promise<AcpSessionSettingsResponse> {
    return this.request<AcpSessionSettingsResponse>(
      `/v1/profiles/${encodeURIComponent(profileId)}/acp-settings/${encodeURIComponent(configId)}`,
      { body: JSON.stringify({ value }), method: "PUT" }
    );
  }

  async updateSession(
    sessionId: string,
    request: UpdateSessionRequest
  ): Promise<void> {
    await this.request<void>(`/v1/sessions/${encodeURIComponent(sessionId)}`, {
      body: JSON.stringify(request),
      method: "PATCH",
    });
  }
  async setSessionOrder(
    profileId: string,
    sessionIds: string[]
  ): Promise<void> {
    await this.request<void>("/v1/sessions/order", {
      body: JSON.stringify({ profileId, sessionIds }),
      method: "PUT",
    });
  }
  async deleteSession(sessionId: string): Promise<void> {
    await this.request<void>(
      `/v1/sessions/${encodeURIComponent(sessionId)}?purge=true`,
      {
        method: "DELETE",
      }
    );
  }

  async subscribeSessionStream(
    sessionId: string,
    handler: StreamHandler | StreamHandlers,
    options?: SendStreamOptions
  ): Promise<{ reconnected: boolean; reply?: string }> {
    const handlers = normalizeStreamHandlers(handler);

    const headers = this.buildHeaders("GET", {
      Accept: "text/event-stream",
    });

    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/sessions/${encodeURIComponent(sessionId)}/stream`,
      withDisabledFetchIdle({
        credentials: this.credentials,
        headers,
        method: "GET",
        signal: options?.signal,
      })
    );

    if (response.status === 204) {
      return { reconnected: false };
    }

    if (!response.ok) {
      throw await createApiError(response, `/v1/sessions/${sessionId}/stream`);
    }

    if (!response.body) {
      throw new Error("Server returned an empty stream.");
    }

    const reply = await readStreamEvents(
      response.body,
      handlers,
      options?.signal
    );

    return { reconnected: true, reply };
  }

  async branchSession(
    sessionId: string,
    request: BranchSessionRequest
  ): Promise<BranchSessionResponse> {
    return this.request<BranchSessionResponse>(
      `/v1/sessions/${encodeURIComponent(sessionId)}/branch`,
      {
        body: JSON.stringify(request),
        method: "POST",
      }
    );
  }

  /** Several channels come back as one list, newest first. */
  async listSessions(
    profileId: string,
    channel: AgentChannel | readonly AgentChannel[] = "web",
    options: { cursor?: string | null; limit?: number; query?: string } = {}
  ): Promise<ListSessionsResponse> {
    const query = new URLSearchParams();

    if (Array.isArray(channel)) {
      query.set("channels", channel.join(","));
    } else {
      query.set("channel", String(channel));
    }

    query.set("profileId", profileId);

    if (options.limit !== undefined) {
      query.set("limit", String(options.limit));
    }

    if (options.cursor) {
      query.set("cursor", options.cursor);
    }

    if (options.query) {
      query.set("q", options.query);
    }

    return this.request<ListSessionsResponse>(
      `/v1/sessions?${query.toString()}`
    );
  }

  async getUserContext(
    options: { includeContent?: boolean } = {}
  ): Promise<UserContextStatusResponse> {
    const query = options.includeContent ? "?content=true" : "";

    return this.request<UserContextStatusResponse>(`/v1/user/context${query}`);
  }

  async writeUserContext(content: string): Promise<void> {
    await this.request("/v1/user/context", {
      body: JSON.stringify({ content } satisfies UpdateUserContextRequest),
      method: "PUT",
    });
  }

  async getSetupChecklist(profileId: string): Promise<SetupChecklistResponse> {
    return this.request<SetupChecklistResponse>("/v1/user/setup-checklist", {
      body: JSON.stringify({ profileId } satisfies SetupChecklistRequest),
      method: "POST",
    });
  }

  async initUserContext(): Promise<InitUserContextResponse> {
    return this.request<InitUserContextResponse>("/v1/user/context/init", {
      method: "POST",
    });
  }

  createChatSession(
    sessionId: string,
    channel: AgentChannel
  ): RemoteChatSession {
    return {
      clear: async () => {
        await this.request(`/v1/sessions/${sessionId}`, {
          method: "DELETE",
        });
      },
      compact: async (options = {}) =>
        this.request<CompactionResponse>(`/v1/sessions/${sessionId}/compact`, {
          body: JSON.stringify(options),
          method: "POST",
        }),
      createAutomation: async (prompt: string) => {
        const response = await this.request<DraftAutomationResponse>(
          "/v1/automations/draft",
          {
            body: JSON.stringify({ channel, prompt }),
            method: "POST",
          }
        );

        return response.automation;
      },
      getMessages: async (options) => {
        const response = await this.getSessionMessages(sessionId, options);

        return response.messages;
      },
      id: sessionId,
      purge: async () => {
        await this.request(`/v1/sessions/${sessionId}?purge=true`, {
          method: "DELETE",
        });
      },
      send: async (input: SendMessageArg) => {
        const body = resolveSendMessageBody(
          input,
          this.clientOrigin ?? undefined
        );

        const response = await this.request<SendMessageResponse>(
          `/v1/sessions/${sessionId}/messages`,
          {
            body: JSON.stringify(body),
            method: "POST",
          }
        );

        return response.reply;
      },
      sendStream: async (
        input: SendMessageArg,
        handler: StreamHandler | StreamHandlers,
        options?: SendStreamOptions
      ) => {
        const handlers = normalizeStreamHandlers(handler);

        const body: SendMessageRequest = {
          ...resolveSendMessageBody(input, this.clientOrigin ?? undefined),
          stream: true,
        };

        if (options?.whatsappMessage) {
          body.whatsappMessage = options.whatsappMessage;
        }

        const headers = new Headers(
          this.buildHeaders("POST", {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          })
        );

        if (options?.whatsappContextToken) {
          headers.set(
            "X-Nakama-WhatsApp-Context-Token",
            options.whatsappContextToken
          );
        }

        const response = await retryWhileTurnIsStopping(
          async () => {
            const attempt = await this.fetchImpl(
              `${this.baseUrl}/v1/sessions/${sessionId}/messages?stream=true`,
              withDisabledFetchIdle({
                body: JSON.stringify(body),
                credentials: this.credentials,
                headers,
                method: "POST",
                signal: options?.signal,
              })
            );

            if (!attempt.ok) {
              throw await createApiError(
                attempt,
                `/v1/sessions/${sessionId}/messages`
              );
            }

            return attempt;
          },
          { signal: options?.signal }
        );

        if (!response.body) {
          throw new Error("Server returned an empty stream.");
        }

        return readStreamEvents(response.body, handlers, options?.signal);
      },
      subscribeStream: async (
        handler: StreamHandler | StreamHandlers,
        options?: SendStreamOptions
      ) => this.subscribeSessionStream(sessionId, handler, options),
    };
  }
}
