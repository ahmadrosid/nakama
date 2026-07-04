export interface ChannelSendResult {
  ok: boolean;
  error?: string;
}

export interface EmailOutboundAdapter {
  send(input: {
    to: string;
    subject: string;
    text: string;
    profileId?: string;
    orgId?: string | null;
  }): Promise<ChannelSendResult>;
}

export interface TelegramOutboundAdapter {
  send(input: {
    text: string;
    chatIds?: number[];
    topicId?: number;
    parseMode?: "HTML";
  }): Promise<ChannelSendResult>;
}

export interface WhatsAppOutboundAdapter {
  send(input: { text: string }): Promise<ChannelSendResult>;
}
