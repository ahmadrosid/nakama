import type {
  ChatgptOAuthCredentials,
  ChatgptOAuthDeviceStartResponse,
  CustomModelEntry,
  XaiOAuthCredentials,
} from "@nakama/core/contract";
import { client } from "@/lib/client";

export interface DeviceSignIn<T> {
  completeDevice: (
    sessionId: string,
    signal: AbortSignal
  ) => Promise<{ oauth: T; models?: CustomModelEntry[] }>;
  label: string;
  loginUrl?: string;
  startDevice: () => Promise<ChatgptOAuthDeviceStartResponse>;
}

export const CHATGPT_SIGN_IN: DeviceSignIn<ChatgptOAuthCredentials> = {
  completeDevice: async (sessionId) => {
    const result = await client.completeChatgptOAuthDevice({ sessionId });

    return { models: result.models, oauth: result.chatgptOAuth };
  },
  label: "ChatGPT",
  loginUrl: "https://auth.openai.com/codex/device",
  startDevice: () => client.startChatgptOAuthDevice(),
};

export const XAI_SIGN_IN: DeviceSignIn<XaiOAuthCredentials> = {
  completeDevice: async (sessionId, signal) => {
    const result = await client.completeXaiOAuthDevice({ sessionId }, signal);

    return { models: result.models, oauth: result.xaiOAuth };
  },
  label: "Grok",
  startDevice: () => client.startXaiOAuthDevice(),
};
