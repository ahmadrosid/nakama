import {
  resolveMessagesForNonVisionProvider,
  type ProviderClient,
} from "@nakama/core";

export function wrapProviderForNonVision(provider: ProviderClient): ProviderClient {
  return {
    ...provider,
    async generateChat(input) {
      return provider.generateChat({
        ...input,
        messages: resolveMessagesForNonVisionProvider(input.messages),
      });
    },
    async streamChat(input, handlers) {
      return provider.streamChat(
        {
          ...input,
          messages: resolveMessagesForNonVisionProvider(input.messages),
        },
        handlers,
      );
    },
  };
}
