import { useQuery } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";
import type { EmailSettingsResponse, UpdateEmailSettingsRequest } from "@nakama/core/contract";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { EmailSettingsFooter } from "@/components/email-settings-footer";
import { EmailSettingsFormFields } from "@/components/email-settings-form-fields";
import {
  emailSettingsQueryOptions,
  useSaveEmailSettings,
  useSendEmailTest,
} from "@/hooks/use-email-settings";
import { useAuth } from "@/context/use-auth";
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
  imapHost: "",
  imapPort: "993",
  imapSecure: true,
  smtpHost: "",
  smtpPort: "587",
  smtpSecure: false,
  username: "",
  password: "",
  from: "",
  fromName: "",
  showPassword: false,
  testRecipient: "",
  hint: null,
  formError: null,
};

type EmailSettingsAction =
  | { type: "clear-on-close" }
  | { type: "sync-from-settings"; settings: EmailSettingsResponse }
  | { type: "patch"; values: Partial<EmailSettingsState> }
  | { type: "toggle-show-password" };

function emailSettingsReducer(
  state: EmailSettingsState,
  action: EmailSettingsAction,
): EmailSettingsState {
  switch (action.type) {
    case "clear-on-close":
      return {
        ...state,
        hint: null,
        formError: null,
        showPassword: false,
      };
    case "sync-from-settings": {
      const { settings } = action;
      return {
        ...state,
        imapHost: settings.imapHost ?? "",
        imapPort: String(settings.imapPort ?? 993),
        imapSecure: settings.imapSecure ?? true,
        smtpHost: settings.smtpHost ?? "",
        smtpPort: String(settings.smtpPort ?? 587),
        smtpSecure: settings.smtpSecure ?? false,
        username: settings.username ?? "",
        from: settings.from ?? settings.username ?? "",
        fromName: settings.fromName ?? "",
        password: "",
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
  const { data: settings, isLoading, error: loadError } = useQuery({
    ...emailSettingsQueryOptions,
    enabled: open,
  });
  const saveMutation = useSaveEmailSettings();
  const testMutation = useSendEmailTest();
  const [state, dispatch] = useReducer(emailSettingsReducer, initialEmailSettingsState);

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

    dispatch({ type: "sync-from-settings", settings });
  }, [open, settings]);

  useEffect(() => {
    if (user?.email && !state.testRecipient) {
      dispatch({ type: "patch", values: { testRecipient: user.email } });
    }
  }, [user?.email, state.testRecipient]);

  const handleSave = () => {
    dispatch({ type: "patch", values: { formError: null, hint: null } });

    const request: UpdateEmailSettingsRequest = {
      imapHost: state.imapHost.trim(),
      imapPort: Number(state.imapPort),
      imapSecure: state.imapSecure,
      smtpHost: state.smtpHost.trim(),
      smtpPort: Number(state.smtpPort),
      smtpSecure: state.smtpSecure,
      username: state.username.trim(),
      from: state.from.trim(),
      fromName: state.fromName.trim(),
      ...(state.password.trim() ? { password: state.password.trim() } : {}),
    };

    saveMutation.mutate(request, {
      onSuccess: (saved) => {
        dispatch({
          type: "patch",
          values: {
            password: "",
            hint: saved.configured
              ? "Settings saved."
              : "Saved, but mailbox is not fully configured yet.",
          },
        });
      },
      onError: (err) => {
        dispatch({ type: "patch", values: { formError: formatError(err) } });
      },
    });
  };

  const handleTestSend = () => {
    dispatch({ type: "patch", values: { formError: null, hint: null } });

    testMutation.mutate(
      { to: state.testRecipient.trim() || undefined },
      {
        onSuccess: (result) => {
          dispatch({ type: "patch", values: { hint: `Test email sent to ${result.to}.` } });
        },
        onError: (err) => {
          dispatch({ type: "patch", values: { formError: formatError(err) } });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 pr-6">
            <div className="min-w-0 flex-1">
              <DialogTitle>Email mailbox</DialogTitle>
              <DialogDescription className="text-xs">
                Shared mailbox for the built-in email agent tool.
              </DialogDescription>
            </div>
            {settings?.configured ? (
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">
                Configured
              </span>
            ) : null}
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
            <Spinner />
            Loading email settings…
          </div>
        ) : loadError ? (
          <div className="px-4 py-4 text-sm text-destructive" role="alert">
            {formatError(loadError)}
          </div>
        ) : (
          <>
            <EmailSettingsFormFields
              fromName={state.fromName}
              from={state.from}
              username={state.username}
              password={state.password}
              showPassword={state.showPassword}
              passwordPlaceholder={passwordPlaceholder}
              imapHost={state.imapHost}
              imapPort={state.imapPort}
              imapSecure={state.imapSecure}
              smtpHost={state.smtpHost}
              smtpPort={state.smtpPort}
              smtpSecure={state.smtpSecure}
              onFromNameChange={(value) =>
                dispatch({ type: "patch", values: { fromName: value } })
              }
              onFromChange={(value) => dispatch({ type: "patch", values: { from: value } })}
              onUsernameChange={(value) =>
                dispatch({ type: "patch", values: { username: value } })
              }
              onPasswordChange={(value) =>
                dispatch({ type: "patch", values: { password: value } })
              }
              onShowPasswordToggle={() => dispatch({ type: "toggle-show-password" })}
              onImapHostChange={(value) =>
                dispatch({ type: "patch", values: { imapHost: value } })
              }
              onImapPortChange={(value) =>
                dispatch({ type: "patch", values: { imapPort: value } })
              }
              onImapSecureChange={(value) =>
                dispatch({ type: "patch", values: { imapSecure: value } })
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
            />

            <EmailSettingsFooter
              hint={state.hint}
              formError={state.formError}
              testRecipient={state.testRecipient}
              userEmail={user?.email}
              testPending={testMutation.isPending}
              savePending={saveMutation.isPending}
              configured={settings?.configured ?? false}
              onTestRecipientChange={(value) =>
                dispatch({ type: "patch", values: { testRecipient: value } })
              }
              onTestSend={handleTestSend}
              onSave={handleSave}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
