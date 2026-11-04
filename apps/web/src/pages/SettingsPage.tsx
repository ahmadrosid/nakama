import { DEMO_LOGIN_HOST } from "@nakama/core/demo-login";
import { Button } from "@nakama/ui/button";
import { Card, CardContent } from "@nakama/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Spinner } from "@nakama/ui/spinner";
import { Switch } from "@nakama/ui/switch";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ComposioSettingsCard } from "@/components/ComposioSettingsCard";
import { LocalAuthTokenCard } from "@/components/LocalAuthTokenCard";
import { BrowserRuntimeSettingsCard } from "@/components/settings/BrowserRuntimeSettingsCard";
import { BrowserSessionsCard } from "@/components/settings/BrowserSessionsCard";
import { DataPortabilityPanel } from "@/components/settings/DataPortabilityPanel";
import { ImageGenerationSettingsCard } from "@/components/settings/ImageGenerationSettingsCard";
import { MfaSettingsCard } from "@/components/settings/MfaSettingsCard";
import { PlatformMfaSettingsCard } from "@/components/settings/PlatformMfaSettingsCard";
import { ProviderSettingsCard } from "@/components/settings/ProviderSettingsCard";
import { TranscriptionSettingsCard } from "@/components/settings/TranscriptionSettingsCard";
import { VersionSettingsRow } from "@/components/settings/VersionSettingsRow";
import { VisionSettingsCard } from "@/components/settings/VisionSettingsCard";
import { WebPublicUrlSettingsRow } from "@/components/settings/WebPublicUrlSettingsRow";
import { WebSearchSettingsCard } from "@/components/settings/WebSearchSettingsCard";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TimezoneSelect } from "@/components/TimezoneSelect";
import { UserContextSettings } from "@/components/UserContextCard";
import { useAppContext } from "@/context/use-app-context";
import { useAuth } from "@/context/use-auth";
import { useChatUsageVisible } from "@/hooks/use-chat-usage-visible";
import { useSaveUserTimezone, useUserTimezone } from "@/hooks/use-timezones";
import { formatError } from "@/lib/client";
import { getBrowserTimezone } from "@/lib/timezones";

function isDemoLoginHost(
  hostname: string = typeof window === "undefined"
    ? ""
    : window.location.hostname
): boolean {
  return hostname.trim().toLowerCase() === DEMO_LOGIN_HOST;
}

export function SettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, activeOrg } = useAuth();
  const { health } = useAppContext();
  const isDemo = isDemoLoginHost();
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  const isOrgAdmin = activeOrg?.role === "admin";

  const [mfaRequiredNotice, setMfaRequiredNotice] = useState(
    () => new URLSearchParams(location.search).get("mfa") === "required"
  );

  const chatUsage = useChatUsageVisible();
  const version = health?.version?.trim();

  return (
    <>
      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setMfaRequiredNotice(false);
            navigate("/settings/preferences", { replace: true });
          }
        }}
        open={mfaRequiredNotice}
      >
        {mfaRequiredNotice ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Multi-factor authentication required</DialogTitle>
              <DialogDescription>
                Your platform requires multi-factor authentication. Set up an
                authenticator app below to continue using Nakama.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                onClick={() => {
                  setMfaRequiredNotice(false);
                  navigate("/settings/preferences", { replace: true });
                }}
                type="button"
              >
                Set up authentication
              </Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
      <div className="mx-auto max-w-3xl space-y-10">
        <SettingsSection title="General">
          <Card className="w-full shadow-none">
            <CardContent className="divide-y divide-border p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="font-medium text-foreground text-sm">
                  Appearance
                </p>
                <ThemeToggle />
              </div>

              <UserContextSettings />

              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                id="chat-usage-setting"
              >
                <p className="font-medium text-foreground text-sm">
                  Token usage in chat
                </p>
                <Switch
                  aria-label="Token usage in chat"
                  checked={chatUsage.visible}
                  onCheckedChange={chatUsage.toggle}
                />
              </div>

              {isPlatformAdmin ? <TimezoneSettingsRow /> : null}
            </CardContent>
          </Card>
        </SettingsSection>

        <SettingsSection title="Security">
          <section id="sessions">
            <BrowserSessionsCard />
          </section>

          <MfaSettingsCard />

          {isOrgAdmin ? (
            <section id="local-token">
              <LocalAuthTokenCard />
            </section>
          ) : null}
        </SettingsSection>

        {version || isPlatformAdmin ? (
          <InstanceSettings
            isDemo={isDemo}
            isPlatformAdmin={isPlatformAdmin}
            updateCheckEnabled={health?.updateCheckEnabled === true}
            version={version}
          />
        ) : null}
      </div>
    </>
  );
}

function TimezoneSettingsRow() {
  const [timezone, setTimezone] = useState(() => getBrowserTimezone());
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { data: savedTimezone } = useUserTimezone();
  const saveTimezoneMutation = useSaveUserTimezone();

  useEffect(() => {
    if (savedTimezone) {
      setTimezone(savedTimezone);
    }
  }, [savedTimezone]);

  const handleChange = useCallback(
    (nextTimezone: string) => {
      setError(null);
      setHint(null);
      setTimezone(nextTimezone);

      saveTimezoneMutation.mutate(nextTimezone, {
        onError: (err) => setError(formatError(err)),
        onSuccess: (saved) => {
          setTimezone(saved);
          setHint("Saved");
        },
      });
    },
    [saveTimezoneMutation]
  );

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-foreground text-sm">Timezone</p>
        {error ? (
          <p className="text-destructive text-xs" role="alert">
            {error}
          </p>
        ) : null}
        {hint ? (
          <p
            className="text-emerald-700 text-xs dark:text-emerald-300"
            role="status"
          >
            {hint}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {saveTimezoneMutation.isPending ? (
          <Spinner className="size-4 text-muted-foreground" />
        ) : null}
        <TimezoneSelect
          className="w-44 min-w-0 sm:w-52"
          disabled={saveTimezoneMutation.isPending}
          emptyLabel="Select timezone"
          id="timezone"
          onValueChange={(nextTimezone) => {
            if (nextTimezone && nextTimezone !== timezone) {
              handleChange(nextTimezone);
            }
          }}
          value={timezone}
        />
      </div>
    </div>
  );
}

function InstanceSettings({
  isDemo,
  isPlatformAdmin,
  updateCheckEnabled,
  version,
}: {
  isDemo: boolean;
  isPlatformAdmin: boolean;
  updateCheckEnabled: boolean;
  version: string | undefined;
}) {
  return (
    <SettingsSection title="Instance">
      <Card className="w-full shadow-none">
        <CardContent className="divide-y divide-border p-0">
          {version ? (
            <VersionSettingsRow
              updateCheckEnabled={updateCheckEnabled}
              version={version}
            />
          ) : null}

          {/* Install-wide: the callback/share base for every organization. */}
          {isPlatformAdmin ? <WebPublicUrlSettingsRow /> : null}
        </CardContent>
      </Card>

      {!isDemo && isPlatformAdmin ? <PlatformMfaSettingsCard /> : null}

      {isPlatformAdmin ? (
        <section id="composio">
          <ComposioSettingsCard />
        </section>
      ) : null}

      {isPlatformAdmin ? (
        <Card className="w-full overflow-hidden shadow-none">
          <CardContent className="p-0">
            <DataPortabilityPanel />
          </CardContent>
        </Card>
      ) : null}
    </SettingsSection>
  );
}

function SettingsSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <h2 className="px-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function LlmProvidersPage() {
  const [formError, setFormError] = useState<string | null>(null);
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView();
    }
  }, [hash]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <ProviderSettingsCard formError={formError} onFormError={setFormError} />
      <Card className="w-full shadow-none">
        <CardContent className="divide-y divide-border p-0">
          <div id="image-parsing">
            <VisionSettingsCard />
          </div>
          <div id="transcription">
            <TranscriptionSettingsCard />
          </div>
          <div id="image-generation">
            <ImageGenerationSettingsCard />
          </div>
          <div id="web-search">
            <WebSearchSettingsCard />
          </div>
          <div id="browser-runtime">
            <BrowserRuntimeSettingsCard />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
