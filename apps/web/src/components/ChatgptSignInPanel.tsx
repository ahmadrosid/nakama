import type {
  ChatgptOAuthCredentials,
  ChatgptOAuthDeviceStartResponse,
  CustomModelEntry,
  XaiOAuthCredentials,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { FormField } from "@nakama/ui/form-field";
import { Spinner } from "@nakama/ui/spinner";
import { useEffect, useRef, useState } from "react";
import { client, formatError } from "@/lib/client";

type SubscriptionSignInFlow = "idle" | "waiting" | "error";

const CHATGPT_DEVICE_LOGIN_URL = "https://auth.openai.com/codex/device";

interface SignInPanelProps<T> {
  density?: "default" | "compact";
  disabled?: boolean;
  oauth: T | null;
  onModelsChange?: (models: CustomModelEntry[]) => void;
  onOAuthChange: (oauth: T | null) => void;
}

function SubscriptionSignInPanel<T>({
  label,
  loginUrl,
  startDevice,
  completeDevice,
  density = "default",
  disabled = false,
  oauth,
  onOAuthChange,
  onModelsChange,
}: SignInPanelProps<T> & {
  label: string;
  loginUrl?: string;
  startDevice: () => Promise<ChatgptOAuthDeviceStartResponse>;
  completeDevice: (
    sessionId: string,
    signal: AbortSignal
  ) => Promise<{ oauth: T; models?: CustomModelEntry[] }>;
}) {
  const [flow, setFlow] = useState<SubscriptionSignInFlow>("idle");
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
    if (loginUrl) {
      window.open(loginUrl, "_blank", "noopener,noreferrer");
    }

    try {
      const start = await startDevice();
      if (controller.signal.aborted) {
        return;
      }

      setUserCode(start.userCode);
      setVerificationUri(start.verificationUri);
      if (!loginUrl) {
        window.open(start.verificationUri, "_blank", "noopener,noreferrer");
      }

      const result = await completeDevice(start.sessionId, controller.signal);
      if (controller.signal.aborted) {
        return;
      }

      onOAuthChange(result.oauth);
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
        ) : label === "ChatGPT" ? (
          <p className="text-muted-foreground text-xs">
            One ChatGPT Plus/Pro account for this Nakama instance. Uses your
            plan quota, not OpenAI API credits.
          </p>
        ) : null
      }
      label={`${label} account`}
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
              href={verificationUri ?? loginUrl}
              rel="noreferrer"
              target="_blank"
            >
              {verificationUri ?? "sign-in page"}
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
          Sign in with {label}
        </Button>
      )}
    </FormField>
  );
}

export function ChatgptSignInPanel(
  props: SignInPanelProps<ChatgptOAuthCredentials>
) {
  return (
    <SubscriptionSignInPanel
      {...props}
      completeDevice={async (sessionId) => {
        const result = await client.completeChatgptOAuthDevice({ sessionId });
        return { models: result.models, oauth: result.chatgptOAuth };
      }}
      label="ChatGPT"
      loginUrl={CHATGPT_DEVICE_LOGIN_URL}
      startDevice={() => client.startChatgptOAuthDevice()}
    />
  );
}

export function XaiSignInPanel(props: SignInPanelProps<XaiOAuthCredentials>) {
  return (
    <SubscriptionSignInPanel
      {...props}
      completeDevice={async (sessionId, signal) => {
        const result = await client.completeXaiOAuthDevice(
          { sessionId },
          signal
        );
        return { models: result.models, oauth: result.xaiOAuth };
      }}
      label="Grok"
      startDevice={() => client.startXaiOAuthDevice()}
    />
  );
}
