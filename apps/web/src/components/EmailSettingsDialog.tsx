import type {
  EmailSettingsResponse,
  UpdateEmailSettingsRequest,
} from "@nakama/core/contract";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";
import { EmailSettingsFooter } from "@/components/email-settings-footer";
import { EmailSettingsFormFields } from "@/components/email-settings-form-fields";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import {
  emailSettingsQueryOptions,
  useSaveEmailSettings,
  useSendEmailTest,
} from "@/hooks/use-email-settings";
import { formatError } from "@/lib/client";

type EmailSettingsState = {
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  username: string;
  password: string;
  from: string;
  fromName: string;
  showPassword: boolean;
  testRecipient: string;
  hint: string | null;
  formError: string | null;
};

const initialEmailSettingsState: EmailSettingsState = {
  formError: null,
  from: "",
  fromName: "",
  hint: null,
  imapHost: "",
  imapPort: "993",
  imapSecure: true,
  password: "",
  showPassword: false,
  smtpHost: "",
  smtpPort: "587",
  smtpSecure: false,
  testRecipient: "",
  username: "",
};

type EmailSettingsAction =
  | { type: "clear-on-close" }
  | {
      type: "sync-from-settings";
      settings: EmailSettingsResponse;
      userEmail?: string | null;
    }
  | { type: "patch"; values: Partial<EmailSettingsState> }
  | { type: "toggle-show-password" };

function emailSettingsReducer(
  state: EmailSettingsState,
  action: EmailSettingsAction
): EmailSettingsState {
  switch (action.type) {
    case "clear-on-close":
      return {
        ...state,
        formError: null,
        hint: null,
        showPassword: false,
      };
    case "sync-from-settings": {
      const { settings, userEmail } = action;
      const fallbackEmail = userEmail?.trim() || "";
      const username = settings.username ?? fallbackEmail;
      return {
        ...state,
        from: settings.from ?? username,
        fromName: settings.fromName ?? "",
        imapHost: settings.imapHost ?? "",
        imapPort: String(settings.imapPort ?? 993),
        imapSecure: settings.imapSecure ?? true,
        password: "",
        smtpHost: settings.smtpHost ?? "",
        smtpPort: String(settings.smtpPort ?? 587),
        smtpSecure: settings.smtpSecure ?? false,
        username,
      };
    }
    case "patch":
      return { ...state, ...action.values };
    case "toggle-show-password":
      return { ...state, showPassword: !state.showPassword };
    default:
      return state;
  }
}

export function EmailSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const {
    data: settings,
    isLoading,
    error: loadError,
  } = useQuery({
    ...emailSettingsQueryOptions,
    enabled: open,
  });
  const saveMutation = useSaveEmailSettings();
  const testMutation = useSendEmailTest();
  const [state, dispatch] = useReducer(
    emailSettingsReducer,
    initialEmailSettingsState
  );

  const passwordPlaceholder = settings?.passwordMasked
    ? `Saved (${settings.passwordMasked})`
    : "App password";

  useEffect(() => {
    if (!open) {
      dispatch({ type: "clear-on-close" });
      return;
    }

    if (!settings) {
      return;
    }

    dispatch({
      settings,
      type: "sync-from-settings",
      userEmail: user?.email,
    });
  }, [open, settings, user?.email]);

  const handleSave = () => {
    dispatch({ type: "patch", values: { formError: null, hint: null } });

    const request: UpdateEmailSettingsRequest = {
      from: state.from.trim(),
      fromName: state.fromName.trim(),
      imapHost: state.imapHost.trim(),
      imapPort: Number(state.imapPort),
      imapSecure: state.imapSecure,
      smtpHost: state.smtpHost.trim(),
      smtpPort: Number(state.smtpPort),
      smtpSecure: state.smtpSecure,
      username: state.username.trim(),
      ...(state.password.trim() ? { password: state.password.trim() } : {}),
    };

    saveMutation.mutate(request, {
      onError: (err) => {
        dispatch({ type: "patch", values: { formError: formatError(err) } });
      },
      onSuccess: (saved) => {
        dispatch({
          type: "patch",
          values: {
            hint: saved.configured
              ? "Settings saved."
              : "Saved, but mailbox is not fully configured yet.",
            password: "",
          },
        });
      },
    });
  };

  const handleTestSend = () => {
    dispatch({ type: "patch", values: { formError: null, hint: null } });

    testMutation.mutate(
      { to: state.testRecipient.trim() || undefined },
      {
        onError: (err) => {
          dispatch({ type: "patch", values: { formError: formatError(err) } });
        },
        onSuccess: (result) => {
          dispatch({
            type: "patch",
            values: { hint: `Test email sent to ${result.to}.` },
          });
        },
      }
    );
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-border border-b px-4 py-3">
          <div className="flex items-center gap-2 pr-6">
            <div className="min-w-0 flex-1">
              <DialogTitle>Email mailbox</DialogTitle>
              <DialogDescription className="text-xs">
                Shared mailbox for the built-in email agent tool.
              </DialogDescription>
            </div>
            {settings?.configured ? (
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-300 text-xs">
                Configured
              </span>
            ) : null}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-4 text-muted-foreground text-sm">
            <Spinner />
            Loading email settings…
          </div>
        ) : loadError ? (
          <div className="px-4 py-4 text-destructive text-sm" role="alert">
            {formatError(loadError)}
          </div>
        ) : (
          <>
            <EmailSettingsFormFields
              from={state.from}
              fromName={state.fromName}
              imapHost={state.imapHost}
              imapPort={state.imapPort}
              imapSecure={state.imapSecure}
              onFromChange={(value) =>
                dispatch({ type: "patch", values: { from: value } })
              }
              onFromNameChange={(value) =>
                dispatch({ type: "patch", values: { fromName: value } })
              }
              onImapHostChange={(value) =>
                dispatch({ type: "patch", values: { imapHost: value } })
              }
              onImapPortChange={(value) =>
                dispatch({ type: "patch", values: { imapPort: value } })
              }
              onImapSecureChange={(value) =>
                dispatch({ type: "patch", values: { imapSecure: value } })
              }
              onPasswordChange={(value) =>
                dispatch({ type: "patch", values: { password: value } })
              }
              onShowPasswordToggle={() =>
                dispatch({ type: "toggle-show-password" })
              }
              onSmtpHostChange={(value) =>
                dispatch({ type: "patch", values: { smtpHost: value } })
              }
              onSmtpPortChange={(value) =>
                dispatch({ type: "patch", values: { smtpPort: value } })
              }
              onSmtpSecureChange={(value) =>
                dispatch({ type: "patch", values: { smtpSecure: value } })
              }
              onUsernameChange={(value) =>
                dispatch({ type: "patch", values: { username: value } })
              }
              password={state.password}
              passwordPlaceholder={passwordPlaceholder}
              showPassword={state.showPassword}
              smtpHost={state.smtpHost}
              smtpPort={state.smtpPort}
              smtpSecure={state.smtpSecure}
              username={state.username}
            />

            <EmailSettingsFooter
              configured={settings?.configured ?? false}
              formError={state.formError}
              hint={state.hint}
              onSave={handleSave}
              onTestRecipientChange={(value) =>
                dispatch({ type: "patch", values: { testRecipient: value } })
              }
              onTestSend={handleTestSend}
              savePending={saveMutation.isPending}
              testPending={testMutation.isPending}
              testRecipient={state.testRecipient}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
