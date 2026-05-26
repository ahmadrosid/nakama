import { useEffect, useState } from "react";
import type { UpdateTelegramSettingsRequest } from "@tinyclaw/core/contract";
import { CopyIcon, EyeIcon, EyeOffIcon, RefreshCwIcon } from "lucide-react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import {
  useRegenerateTelegramHandshake,
  useSaveTelegramSettings,
  useTelegramSettings,
} from "@/hooks/use-telegram-settings";
import { formatError } from "@/lib/client";

export function TelegramSettingsCard() {
  const { data: settings, isLoading, error: loadError } = useTelegramSettings();
  const { data: profiles = [] } = useProfilesQuery();
  const saveMutation = useSaveTelegramSettings();
  const regenerateMutation = useRegenerateTelegramHandshake();

  const [botToken, setBotToken] = useState("");
  const [showBotToken, setShowBotToken] = useState(false);
  const [allowedUserIds, setAllowedUserIds] = useState("");
  const [profileId, setProfileId] = useState("profile_default");
  const [hint, setHint] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setAllowedUserIds(settings.allowedUserIds.join(", "));
    setProfileId(settings.profileId);
    setBotToken("");
  }, [settings]);

  const configured = settings?.configured === true;
  const canSave = configured || botToken.trim().length > 0;

  async function copyHandshakeCode() {
    if (!settings?.handshakeCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(settings.handshakeCode);
      setHint("Pairing code copied.");
    } catch {
      setHint("Copy the code manually.");
    }
  }

  function handleSave() {
    setFormError(null);
    setHint(null);

    const request: UpdateTelegramSettingsRequest = {
      profileId: profileId.trim() || "profile_default",
    };

    if (botToken.trim()) {
      request.botToken = botToken.trim();
    }

    if (allowedUserIds.trim()) {
      request.allowedUserIds = allowedUserIds.trim();
    }

    saveMutation.mutate(request, {
      onSuccess: (saved) => {
        setBotToken("");
        if (saved.handshakeCode) {
          setHint("Saved. Send this pairing code to your bot once.");
        } else if (saved.pairedUserIds.length > 0) {
          setHint(`Saved · ${saved.pairedUserIds.length} linked chat(s)`);
        } else {
          setHint("Saved.");
        }
      },
      onError: (err) => {
        setFormError(formatError(err));
      },
    });
  }

  function handleRegenerateHandshake() {
    setFormError(null);
    setHint(null);

    regenerateMutation.mutate(undefined, {
      onSuccess: () => {
        setHint("New pairing code generated. Send it to your bot once.");
      },
      onError: (err) => {
        setFormError(formatError(err));
      },
    });
  }

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>Bridge settings for the Telegram bot.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-24 animate-pulse rounded-lg bg-muted" aria-hidden="true" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Telegram</CardTitle>
        <CardDescription>
          Link your Telegram account with a one-time pairing code. Saved to{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            ~/.tinyclaw/telegram/config.ini
          </code>
          . Restart{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">bun run dev:telegram</code>{" "}
          after saving.
        </CardDescription>
      </CardHeader>
      <CardContent className="max-w-md space-y-4">
        {loadError ? (
          <p className="text-sm text-destructive" role="alert">
            {formatError(loadError)}
          </p>
        ) : null}

        <div className="space-y-2">
          <label htmlFor="telegram-bot-token" className="text-sm font-medium text-foreground">
            Bot token
          </label>
          <InputGroup>
            <InputGroupInput
              id="telegram-bot-token"
              type={showBotToken ? "text" : "password"}
              autoComplete="off"
              placeholder={
                configured && settings?.botTokenMasked
                  ? `Configured (${settings.botTokenMasked})`
                  : "From @BotFather"
              }
              value={botToken}
              disabled={saveMutation.isPending}
              onChange={(event) => {
                setBotToken(event.target.value);
                setHint(null);
                if (formError) {
                  setFormError(null);
                }
              }}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                type="button"
                size="icon-xs"
                aria-label={showBotToken ? "Hide token" : "Show token"}
                onClick={() => setShowBotToken((current) => !current)}
              >
                {showBotToken ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </div>

        {configured && settings?.handshakeCode ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-sm font-medium text-foreground">Pairing code</p>
            <p className="text-xs text-muted-foreground">
              Message your bot on Telegram and paste this code once to link your account.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded bg-background px-2 py-1.5 text-sm tracking-widest">
                {settings.handshakeCode}
              </code>
              <Button type="button" size="icon-sm" variant="outline" onClick={() => void copyHandshakeCode()}>
                <CopyIcon className="size-4" />
                <span className="sr-only">Copy pairing code</span>
              </Button>
            </div>
          </div>
        ) : null}

        {configured ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={regenerateMutation.isPending || saveMutation.isPending}
              onClick={handleRegenerateHandshake}
            >
              {regenerateMutation.isPending ? (
                <>
                  <Spinner className="mr-2" />
                  Generating…
                </>
              ) : (
                <>
                  <RefreshCwIcon className="mr-2 size-4" />
                  New pairing code
                </>
              )}
            </Button>
          </div>
        ) : null}

        {settings && settings.pairedUserIds.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Linked Telegram user IDs: {settings.pairedUserIds.join(", ")}
          </p>
        ) : null}

        <div className="space-y-2">
          <label htmlFor="telegram-profile" className="text-sm font-medium text-foreground">
            Bot profile
          </label>
          <Select
            value={profileId}
            disabled={saveMutation.isPending || profiles.length === 0}
            onValueChange={(value) => {
              if (value) {
                setProfileId(String(value));
                setHint(null);
              }
            }}
          >
            <SelectTrigger id="telegram-profile" className="w-full">
              <SelectValue placeholder="Select profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  <span className="flex items-center gap-2">
                    <ProfileAvatar profile={profile} size="sm" />
                    <span>{profile.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Advanced: pre-approve user IDs (optional)
          </summary>
          <div className="mt-2 space-y-2">
            <InputGroup>
              <InputGroupInput
                id="telegram-allowed-users"
                type="text"
                autoComplete="off"
                placeholder="123456789"
                value={allowedUserIds}
                disabled={saveMutation.isPending}
                onChange={(event) => {
                  setAllowedUserIds(event.target.value);
                  setHint(null);
                }}
              />
            </InputGroup>
            <p className="text-xs text-muted-foreground">
              Skip pairing for these numeric IDs (comma-separated). Most users can leave this empty.
            </p>
          </div>
        </details>

        {formError ? (
          <p className="text-sm text-destructive" role="alert">
            {formError}
          </p>
        ) : null}

        {hint ? (
          <p className="text-xs text-emerald-200" role="status">
            {hint}
          </p>
        ) : null}

        <Button
          type="button"
          size="sm"
          disabled={saveMutation.isPending || !canSave}
          onClick={handleSave}
        >
          {saveMutation.isPending ? (
            <>
              <Spinner className="mr-2" />
              Saving…
            </>
          ) : (
            "Save Telegram settings"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
