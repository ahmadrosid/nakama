export interface ChannelSendResult {
  error?: string;
  ok: boolean;
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
    orgId?: string | null;
    profileId?: string;
    chatIds?: number[];
    topicId?: number;
    parseMode?: "HTML";
  }): Promise<ChannelSendResult>;
}

export interface WhatsAppOutboundAdapter {
  send(input: {
    profileId?: string;
    text: string;
    orgId?: string | null;
  }): Promise<ChannelSendResult>;
}

export interface DiscordOutboundAdapter {
  send(input: {
    orgId?: string | null;
    profileId?: string;
    text: string;
    channelId?: string;
  }): Promise<ChannelSendResult>;
}
