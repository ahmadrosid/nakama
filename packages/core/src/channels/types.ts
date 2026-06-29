export interface ChannelSendResult {
  ok: boolean;
  error?: string;
}

export interface EmailOutboundAdapter {
  send(input: { to: string; subject: string; text: string }): Promise<ChannelSendResult>;
}

export interface TelegramOutboundAdapter {
  send(input: { text: string; chatIds?: number[] }): Promise<ChannelSendResult>;
}

export interface WhatsAppOutboundAdapter {
  send(input: { text: string }): Promise<ChannelSendResult>;
}
