import { useEffect, useState } from "react";
import {
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isTextArtifactMimeType,
  looksLikeUtf8Text,
  resolveArtifactMimeType,
  type ChatArtifactRef,
} from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";

function useBlobObjectUrl(blob: Blob | null) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(blob);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [blob]);

  return url;
}

export function useArtifactPreviewContent({
  open,
  canPreview,
  isHtml,
  isImage,
  isWordDocument,
  profileId,
  artifact,
}: {
  open: boolean;
  canPreview: boolean;
  isHtml: boolean;
  isImage: boolean;
  isWordDocument: boolean;
  profileId: string;
  artifact: ChatArtifactRef;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const imagePreviewUrl = useBlobObjectUrl(imageBlob);

  useEffect(() => {
    if (!open || !canPreview) {
      return;
    }

    if (isImage) {
      if (imageBlob !== null) {
        return;
      }
    } else if (content !== null) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void client
      .readProfileArtifactContent(profileId, artifact.path, {
        inline: true,
        render: isWordDocument ? "markdown" : undefined,
      })
      .then((result) => {
        if (cancelled) {
          return;
        }

        const contentType = resolveArtifactMimeType(result.contentType, artifact.filename);
        const servedAsHtml = isHtmlArtifactMimeType(contentType);
        const servedAsImage = isImageArtifactMimeType(contentType);

        if (isImage) {
          if (!servedAsImage) {
            setError("Preview is not available for this file type. Download instead.");
            return;
          }

          setImageBlob(new Blob([result.data], { type: contentType }));
          return;
        }

        if (isHtml ? !servedAsHtml : servedAsHtml) {
          setError("Preview is not available for this file type. Download instead.");
          return;
        }

        if (
          !isHtml &&
          !isTextArtifactMimeType(contentType) &&
          !looksLikeUtf8Text(new Uint8Array(result.data))
        ) {
          setError("Preview is not available for this file type. Download instead.");
          return;
        }

        setContent(new TextDecoder().decode(result.data));
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(formatError(fetchError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    canPreview,
    content,
    imageBlob,
    isHtml,
    isImage,
    isWordDocument,
    profileId,
    artifact.path,
    artifact.filename,
  ]);

  return {
    loading,
    error,
    content,
    imagePreviewUrl,
    setContent,
  };
}
