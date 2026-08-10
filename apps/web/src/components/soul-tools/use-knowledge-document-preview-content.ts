import type { KnowledgeBaseDocument } from "@nakama/core/contract";
import { useEffect, useState } from "react";
import { client, formatError } from "@/lib/client";

export function useKnowledgeDocumentPreviewContent({
  open,
  profileId,
  document,
}: {
  open: boolean;
  profileId: string;
  document: KnowledgeBaseDocument | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (!(open && profileId && document)) {
      return;
    }

    if (content !== null) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void client
      .readKnowledgeBaseDocumentContent(profileId, document.id, {
        inline: true,
        render: "text",
      })
      .then((result) => {
        if (cancelled) {
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
  }, [open, profileId, document, content]);

  return { content, error, loading, setContent };
}
