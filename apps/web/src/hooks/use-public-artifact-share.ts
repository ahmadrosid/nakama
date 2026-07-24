import { useQuery } from "@tanstack/react-query";
import {
  isHtmlArtifactMimeType,
  looksLikeUtf8Text,
  resolveArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client } from "@/lib/client";
import { htmlForArtifactPreview } from "@/lib/artifact-html-preview";

export interface PublicShareMetadata {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  inlineAllowed: boolean;
}

export interface PublicArtifactShareData {
  metadata: PublicShareMetadata;
  content: string | null;
}

async function loadPublicArtifactShare(token: string): Promise<PublicArtifactShareData> {
  const metaResponse = await fetch(
    `${client.baseUrl}/v1/public/artifact-shares/${encodeURIComponent(token)}?meta=1`,
  );

  if (!metaResponse.ok) {
    throw new Error("This share link is unavailable.");
  }

  const metadata = (await metaResponse.json()) as PublicShareMetadata;
  const resolvedMime = resolveArtifactMimeType(metadata.mimeType, metadata.filename);
  const previewAsHtml = isHtmlArtifactMimeType(resolvedMime);

  if (!metadata.inlineAllowed && !previewAsHtml) {
    return { metadata, content: null };
  }

  const contentResponse = await fetch(
    `${client.baseUrl}/v1/public/artifact-shares/${encodeURIComponent(token)}`,
  );

  if (!contentResponse.ok) {
    throw new Error("This share link is unavailable.");
  }

  const bytes = new Uint8Array(await contentResponse.arrayBuffer());
  const contentType = resolveArtifactMimeType(
    contentResponse.headers.get("Content-Type") ?? metadata.mimeType,
    metadata.filename,
  );

  if (isHtmlArtifactMimeType(contentType)) {
    return {
      metadata,
      content: htmlForArtifactPreview(new TextDecoder().decode(bytes)),
    };
  }

  if (looksLikeUtf8Text(bytes)) {
    return {
      metadata,
      content: new TextDecoder().decode(bytes),
    };
  }

  return { metadata, content: null };
}

export function usePublicArtifactShare(token: string) {
  return useQuery({
    queryKey: ["public-artifact-share", token],
    queryFn: () => loadPublicArtifactShare(token),
    enabled: token.length > 0,
  });
}
