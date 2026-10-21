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

export interface DeviceSignIn<T> {
  completeDevice: (
    sessionId: string,
    signal: AbortSignal
  ) => Promise<{ oauth: T; models?: CustomModelEntry[] }>;
  label: string;
  loginUrl?: string;
  startDevice: () => Promise<ChatgptOAuthDeviceStartResponse>;
}

export const CHATGPT_SIGN_IN: DeviceSignIn<ChatgptOAuthCredentials> = {
  completeDevice: async (sessionId) => {
    const result = await client.completeChatgptOAuthDevice({ sessionId });

    return { models: result.models, oauth: result.chatgptOAuth };
  },
  label: "ChatGPT",
  loginUrl: "https://auth.openai.com/codex/device",
  startDevice: () => client.startChatgptOAuthDevice(),
};

export const XAI_SIGN_IN: DeviceSignIn<XaiOAuthCredentials> = {
  completeDevice: async (sessionId, signal) => {
    const result = await client.completeXaiOAuthDevice({ sessionId }, signal);

    return { models: result.models, oauth: result.xaiOAuth };
  },
  label: "Grok",
  startDevice: () => client.startXaiOAuthDevice(),
};

export function useDeviceSignIn<T>(
  { completeDevice, loginUrl, startDevice }: DeviceSignIn<T>,
  {
    onModelsChange,
    onOAuthChange,
  }: {
    onModelsChange?: (models: CustomModelEntry[]) => void;
    onOAuthChange: (oauth: T | null) => void;
  }
) {
  const [flow, setFlow] = useState<SubscriptionSignInFlow>("idle");
  const [error, setError] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const signInAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      signInAbortRef.current?.abort();
    },
    []
  );

  const start = async () => {
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
      const started = await startDevice();

      if (controller.signal.aborted) {
        return;
      }

      setUserCode(started.userCode);
      setVerificationUri(started.verificationUri);

      if (!loginUrl) {
        window.open(started.verificationUri, "_blank", "noopener,noreferrer");
      }

      const result = await completeDevice(started.sessionId, controller.signal);

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

  const cancel = () => {
    signInAbortRef.current?.abort();
    setFlow("idle");
    setError(null);
    setUserCode(null);
    setVerificationUri(null);
  };

  return { cancel, error, flow, loginUrl, start, userCode, verificationUri };
}

export function DeviceSignInCode({
  loginUrl,
  userCode,
  verificationUri,
}: {
  loginUrl?: string;
  userCode: string | null;
  verificationUri: string | null;
}) {
  return (
    <>
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
    </>
  );
}

interface SignInPanelProps<T> {
  density?: "default" | "compact";
  disabled?: boolean;
  oauth: T | null;
  onModelsChange?: (models: CustomModelEntry[]) => void;
  onOAuthChange: (oauth: T | null) => void;
}

function SubscriptionSignInPanel<T>({
  signIn,
  density = "default",
  disabled = false,
  oauth,
  onOAuthChange,
  onModelsChange,
}: SignInPanelProps<T> & { signIn: DeviceSignIn<T> }) {
  const { label } = signIn;
  const device = useDeviceSignIn(signIn, { onModelsChange, onOAuthChange });
  const connected = Boolean(oauth) && device.flow !== "waiting";

  return (
    <FormField
      density={density}
      footer={
        device.error ? (
          <p className="text-destructive text-sm" role="alert">
            {device.error}
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
            onClick={() => void device.start()}
            type="button"
            variant="outline"
          >
            Reconnect
          </Button>
        </div>
      ) : device.flow === "waiting" ? (
        <div className="space-y-3 rounded-md border p-3">
          <DeviceSignInCode
            loginUrl={device.loginUrl}
            userCode={device.userCode}
            verificationUri={device.verificationUri}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled type="button" variant="outline">
              <Spinner className="mr-2" />
              Waiting for sign-in…
            </Button>
            <Button
              disabled={disabled}
              onClick={device.cancel}
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
          onClick={() => void device.start()}
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
  return <SubscriptionSignInPanel {...props} signIn={CHATGPT_SIGN_IN} />;
}

export function XaiSignInPanel(props: SignInPanelProps<XaiOAuthCredentials>) {
  return <SubscriptionSignInPanel {...props} signIn={XAI_SIGN_IN} />;
}
