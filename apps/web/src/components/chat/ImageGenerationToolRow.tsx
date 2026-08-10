import { ImageGeneration } from "@/components/chat/ImageGeneration";
import type { ChatListItem } from "@/lib/chat-history";
import {
  buildGenerateImageToolState,
  shouldRenderGenerateImageToolRow,
} from "@/lib/chat-stream-image-generation";

export function ImageGenerationToolRow({
  message,
  profileId,
}: {
  message: ChatListItem;
  profileId?: string | null;
}) {
  if (!shouldRenderGenerateImageToolRow(message)) {
    return null;
  }

  const state = buildGenerateImageToolState(message, profileId);

  return (
    <div className="w-full max-w-full">
      <ImageGeneration
        aspect={state.aspect}
        error={state.error}
        imageUrl={state.imageUrl}
        prompt={state.prompt}
        resolution={state.resolution}
      />
    </div>
  );
}
