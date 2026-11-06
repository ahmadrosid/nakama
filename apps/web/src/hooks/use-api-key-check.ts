import { useCallback, useState } from "react";
import { client } from "@/lib/client";
import { formatProviderLabel, type SelectedProvider } from "@/lib/models";

type KeyCheck = { key: string; status: "checking" | "ok" };

/** Asks the provider about a typed key when the user leaves the field. */
export function useApiKeyCheck(onRejected: (message: string) => void) {
  const [keyCheck, setKeyCheck] = useState<KeyCheck | null>(null);

  const runKeyCheck = useCallback(
    async (apiKey: string, type: SelectedProvider, baseUrl: string) => {
      const key = apiKey.trim();
      setKeyCheck({ key, status: "checking" });

      try {
        const { status } = await client.checkProviderKey({
          apiKey: key,
          baseUrl: baseUrl.trim() || undefined,
          type,
        });

        if (status === "rejected") {
          setKeyCheck(null);
          onRejected(
            `${formatProviderLabel(type)} rejected this API key. Check the key and try again.`
          );

          return;
        }

        // Only a clear yes shows; an outage or no check stays quiet, as on save.
        setKeyCheck(status === "ok" ? { key, status } : null);
      } catch {
        setKeyCheck(null);
      }
    },
    [onRejected]
  );

  return { keyCheck, runKeyCheck };
}
