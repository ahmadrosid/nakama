import { useEffect, useState } from "react";
import { useAuth } from "@/context/use-auth";
import {
  type ChatArtifactRef,
  FILE_PREVIEW_MAX_BYTES,
  isHtmlArtifactMimeType,
  isImageArtifactMimeType,
  isTextArtifactMimeType,
  isVideoArtifactMimeType,
  looksLikeUtf8Text,
  resolveArtifactMimeType,
} from "@/lib/chat-artifacts";
import { client, formatError } from "@/lib/client";

export function useAuthenticatedImagePreview(
  profileId: string | null | undefined,
  artifactPath: string | null | undefined
) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = useBlobObjectUrl(blob);

  useEffect(() => {
    if (!(profileId?.trim() && artifactPath?.trim())) {
      setBlob(null);
      setError(null);

      return;
    }

    let cancelled = false;
    setBlob(null);
    setError(null);

    void client
      .readProfileArtifactContent(profileId, artifactPath, {
        inline: true,
        maxBytes: FILE_PREVIEW_MAX_BYTES,
      })
      .then((result) => {
        if (cancelled) {
          return;
        }

        const filename = artifactPath.split("/").pop() ?? artifactPath;

        const contentType = resolveArtifactMimeType(
          result.contentType,
          filename
        );

        if (!isImageArtifactMimeType(contentType)) {
          setBlob(null);
          setError(
            "Preview is not available for this file type. Download instead."
          );

          return;
        }

        setBlob(new Blob([result.data], { type: contentType }));
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setBlob(null);
          setError(formatError(fetchError));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [artifactPath, profileId]);

  return { error, url };
}

function useBlobObjectUrl(blob: Blob | null) {
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(
    null
  );

  useEffect(() => {
    if (!blob) {
      setPreview(null);

      return;
    }

    const nextUrl = URL.createObjectURL(blob);
    setPreview({ blob, url: nextUrl });

    return () => URL.revokeObjectURL(nextUrl);
  }, [blob]);

  return preview?.blob === blob ? preview.url : null;
}

export function useArtifactPreviewContent({
  open,
  canPreview,
  isHtml,
  isImage,
  isVideo,
  isPdf,
  isWordDocument,
  profileId,
  artifact,
}: {
  open: boolean;
  canPreview: boolean;
  isHtml: boolean;
  isImage: boolean;
  isVideo: boolean;
  isPdf: boolean;
  isWordDocument: boolean;
  profileId: string;
  artifact: ChatArtifactRef;
}) {
  const { activeOrg } = useAuth();
  const orgId = activeOrg?.id;
  const key = `${orgId}:${profileId}:${artifact.path}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [mediaBlob, setMediaBlob] = useState<Blob | null>(null);
  const mediaPreviewUrl = useBlobObjectUrl(mediaBlob);
  // Load image bytes eagerly so chat chips can show a real thumbnail before the panel opens.
  const shouldLoad = open;

  useEffect(() => {
    setLoadedKey(key);
    setContent(null);
    setMediaBlob(null);
    setError(null);

    if (!(shouldLoad && canPreview)) {
      setLoading(false);

      return;
    }

    if (artifact.sizeBytes > FILE_PREVIEW_MAX_BYTES) {
      setError(
        "This file exceeds the 8 MB preview limit. Download it instead."
      );
      setLoading(false);

      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void client
      .forOrg(orgId ?? null)
      .readProfileArtifactContent(profileId, artifact.path, {
        inline: true,
        maxBytes: FILE_PREVIEW_MAX_BYTES,
        render: isWordDocument ? "markdown" : undefined,
        signal: controller.signal,
      })
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }

        const contentType = resolveArtifactMimeType(
          result.contentType,
          artifact.filename
        );

        const servedAsHtml = isHtmlArtifactMimeType(contentType);
        const servedAsImage = isImageArtifactMimeType(contentType);
        const servedAsVideo = isVideoArtifactMimeType(contentType);

        if (isPdf) {
          if (contentType !== "application/pdf") {
            setError(
              "Preview is not available for this file type. Download instead."
            );

            return;
          }

          setMediaBlob(new Blob([result.data], { type: contentType }));

          return;
        }

        if (isImage) {
          if (!servedAsImage) {
            setError(
              "Preview is not available for this file type. Download instead."
            );

            return;
          }

          setMediaBlob(new Blob([result.data], { type: contentType }));

          return;
        }

        if (isVideo) {
          if (!servedAsVideo) {
            setError(
              "Preview is not available for this file type. Download instead."
            );

            return;
          }

          setMediaBlob(new Blob([result.data], { type: contentType }));

          return;
        }

        if (isHtml ? !servedAsHtml : servedAsHtml) {
          setError(
            "Preview is not available for this file type. Download instead."
          );

          return;
        }

        if (
          !(
            isHtml ||
            isTextArtifactMimeType(contentType) ||
            looksLikeUtf8Text(new Uint8Array(result.data))
          )
        ) {
          setError(
            "Preview is not available for this file type. Download instead."
          );

          return;
        }

        setContent(new TextDecoder().decode(result.data));
      })
      .catch((fetchError) => {
        if (!controller.signal.aborted) {
          setError(formatError(fetchError));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    shouldLoad,
    canPreview,
    isHtml,
    isImage,
    isVideo,
    isPdf,
    isWordDocument,
    profileId,
    artifact.path,
    artifact.filename,
    artifact.sizeBytes,
    orgId,
    key,
  ]);

  return {
    content: loadedKey === key ? content : null,
    error: loadedKey === key ? error : null,
    imagePreviewUrl: isImage && loadedKey === key ? mediaPreviewUrl : null,
    loading,
    pdfPreviewUrl: isPdf && loadedKey === key ? mediaPreviewUrl : null,
    setContent,
    videoPreviewUrl: isVideo && loadedKey === key ? mediaPreviewUrl : null,
  };
}
