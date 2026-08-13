import { ImageGeneration } from "@/components/chat/ImageGeneration";
import { useAuthenticatedImagePreview } from "@/components/chat/use-artifact-preview-content";
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
  const state = buildGenerateImageToolState(message);
  const shouldFetch =
    shouldRenderGenerateImageToolRow(message) && state.status === "done";
  const preview = useAuthenticatedImagePreview(
    shouldFetch ? profileId : null,
    shouldFetch ? state.artifactPath : null
  );

  if (!shouldRenderGenerateImageToolRow(message)) {
    return null;
  }

  const missingProfile =
    shouldFetch && !(typeof profileId === "string" && profileId.trim());
  const error =
    state.error ??
    preview.error ??
    (missingProfile ? "Image ready, but preview is unavailable." : null);

  return (
    <div className="w-full max-w-full">
      <ImageGeneration
        aspect={state.aspect}
        error={error}
        imageUrl={preview.url}
        prompt={state.prompt}
        resolution={state.resolution}
      />
    </div>
  );
}
