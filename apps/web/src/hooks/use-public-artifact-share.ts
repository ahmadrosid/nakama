import { useQuery } from "@tanstack/react-query";
import { htmlForArtifactPreview } from "@/lib/artifact-html-preview";
import {
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isVideoArtifactMimeType,
  looksLikeUtf8Text,
  resolveArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client } from "@/lib/client";

export interface PublicShareMetadata {
  filename: string;
  inlineAllowed: boolean;
  mimeType: string;
  sizeBytes: number;
}

export interface PublicArtifactShareData {
  content: string | null;
  metadata: PublicShareMetadata;
}

async function loadPublicArtifactShare(
  token: string
): Promise<PublicArtifactShareData> {
  const metaResponse = await fetch(
    `${client.baseUrl}/v1/public/artifact-shares/${encodeURIComponent(token)}?meta=1`
  );

  if (!metaResponse.ok) {
    throw new Error("This share link is unavailable.");
  }

  const metadata = (await metaResponse.json()) as PublicShareMetadata;
  const resolvedMime = resolveArtifactMimeType(
    metadata.mimeType,
    metadata.filename
  );
  const previewAsHtml = isHtmlArtifactMimeType(resolvedMime);
  // Binary media uses the public share URL as <img>/<video> src — no need to buffer bytes here.
  const previewAsBinaryMedia =
    isImageArtifactMimeType(resolvedMime) ||
    isVideoArtifactMimeType(resolvedMime);

  if (previewAsBinaryMedia) {
    return { content: null, metadata };
  }

  if (!(metadata.inlineAllowed || previewAsHtml)) {
    return { content: null, metadata };
  }

  const contentResponse = await fetch(
    `${client.baseUrl}/v1/public/artifact-shares/${encodeURIComponent(token)}`
  );

  if (!contentResponse.ok) {
    throw new Error("This share link is unavailable.");
  }

  const bytes = new Uint8Array(await contentResponse.arrayBuffer());
  const contentType = resolveArtifactMimeType(
    contentResponse.headers.get("Content-Type") ?? metadata.mimeType,
    metadata.filename
  );

  if (isHtmlArtifactMimeType(contentType)) {
    return {
      content: htmlForArtifactPreview(new TextDecoder().decode(bytes)),
      metadata,
    };
  }

  if (looksLikeUtf8Text(bytes)) {
    return {
      content: new TextDecoder().decode(bytes),
      metadata,
    };
  }

  return { content: null, metadata };
}

export function usePublicArtifactShare(token: string) {
  return useQuery({
    enabled: token.length > 0,
    queryFn: () => loadPublicArtifactShare(token),
    queryKey: ["public-artifact-share", token],
  });
}
