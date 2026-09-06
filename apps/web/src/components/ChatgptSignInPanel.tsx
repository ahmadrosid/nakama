import type {
  ChatgptOAuthCredentials,
  CustomModelEntry,
} from "@nakama/core/contract";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Spinner } from "@/components/ui/spinner";
import { client, formatError } from "@/lib/client";

type ChatgptSignInFlow = "idle" | "waiting" | "error";

const CHATGPT_DEVICE_LOGIN_URL = "https://auth.openai.com/codex/device";

interface ChatgptSignInPanelProps {
  density?: "default" | "compact";
  disabled?: boolean;
  oauth: ChatgptOAuthCredentials | null;
  onModelsChange?: (models: CustomModelEntry[]) => void;
  onOAuthChange: (oauth: ChatgptOAuthCredentials | null) => void;
}

export function ChatgptSignInPanel({
  density = "default",
  disabled = false,
  oauth,
  onOAuthChange,
  onModelsChange,
}: ChatgptSignInPanelProps) {
  const [flow, setFlow] = useState<ChatgptSignInFlow>("idle");
  const [error, setError] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const signInAbortRef = useRef<AbortController | null>(null);
  const connected = Boolean(oauth) && flow !== "waiting";

  useEffect(
    () => () => {
      signInAbortRef.current?.abort();
    },
    []
  );

  const startSignIn = async () => {
    signInAbortRef.current?.abort();
    const controller = new AbortController();
    signInAbortRef.current = controller;

    setError(null);
    setFlow("waiting");
    onOAuthChange(null);
    onModelsChange?.([]);
    setUserCode(null);
    setVerificationUri(null);
    window.open(CHATGPT_DEVICE_LOGIN_URL, "_blank", "noopener,noreferrer");

    try {
      const start = await client.startChatgptOAuthDevice();
      if (controller.signal.aborted) {
        return;
      }

      setUserCode(start.userCode);
      setVerificationUri(start.verificationUri);

      const result = await client.completeChatgptOAuthDevice({
        sessionId: start.sessionId,
      });
      if (controller.signal.aborted) {
        return;
      }

      onOAuthChange(result.chatgptOAuth);
      onModelsChange?.(result.models ?? []);
      setFlow("idle");
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }

      setFlow("error");
      setError(formatError(err));
    }
  };

  const cancelSignIn = () => {
    signInAbortRef.current?.abort();
    setFlow("idle");
    setUserCode(null);
    setVerificationUri(null);
  };

  return (
    <FormField
      density={density}
      footer={
        error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            One ChatGPT Plus/Pro account for this Nakama instance. Uses your
            plan quota, not OpenAI API credits.
          </p>
        )
      }
      label="ChatGPT account"
    >
      {connected ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm">Connected</p>
          <Button
            disabled={disabled}
            onClick={() => {
              onOAuthChange(null);
              void startSignIn();
            }}
            type="button"
            variant="outline"
          >
            Reconnect
          </Button>
        </div>
      ) : flow === "waiting" ? (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm">
            Open{" "}
            <a
              className="underline"
              href={verificationUri ?? CHATGPT_DEVICE_LOGIN_URL}
              rel="noreferrer"
              target="_blank"
            >
              auth.openai.com/codex/device
            </a>{" "}
            and enter this code:
          </p>
          <p className="font-mono text-lg tracking-widest">{userCode}</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled type="button" variant="outline">
              <Spinner className="mr-2" />
              Waiting for sign-in…
            </Button>
            <Button
              disabled={disabled}
              onClick={cancelSignIn}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          disabled={disabled}
          onClick={() => void startSignIn()}
          type="button"
        >
          Sign in with ChatGPT
        </Button>
      )}
    </FormField>
  );
}
