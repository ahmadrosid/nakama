import type {
  TeamsSettingsResponse,
  UpdateTeamsSettingsRequest,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Input } from "@nakama/ui/input";
import { useEffect, useState } from "react";
import {
  SETTINGS_CARD_LOADING_SKELETON,
  SettingsRow,
} from "@/components/integration-settings.shared";
import { WorkerActionBar } from "@/components/WorkerActionBar";
import { useAuth } from "@/context/use-auth";
import {
  useRegenerateTeamsHandshake,
  useSaveTeamsSettings,
  useTeamsSettings,
} from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import { formatError } from "@/lib/client";

interface TeamsForm {
  allowedUserIds: string;
  clientId: string;
  clientSecret: string;
  tenantId: string;
}

function formFrom(settings: TeamsSettingsResponse | undefined): TeamsForm {
  return {
    allowedUserIds: settings?.allowedUserIds.join(", ") ?? "",
    clientId: settings?.clientId ?? "",
    // The saved secret is never sent to the browser; blank keeps it.
    clientSecret: "",
    tenantId: settings?.tenantId ?? "",
  };
}

function toRequest(form: TeamsForm): UpdateTeamsSettingsRequest {
  const request: UpdateTeamsSettingsRequest = {
    allowedUserIds: form.allowedUserIds.trim(),
    clientId: form.clientId.trim(),
    tenantId: form.tenantId.trim(),
  };

  if (form.clientSecret.trim()) {
    request.clientSecret = form.clientSecret.trim();
  }

  return request;
}

function MessagingEndpoint({ endpoint }: { endpoint: string | null }) {
  if (!endpoint) {
    return (
      <p
        className="text-pretty text-amber-700 text-xs dark:text-amber-400"
        role="alert"
      >
        Teams can only reach this server over HTTPS. Set NAKAMA_WEB_PUBLIC_URL
        to the server's public https address, then reload this page.
      </p>
    );
  }

  return (
    <code className="block break-all rounded-md bg-muted px-2 py-1.5 text-xs">
      {endpoint}
    </code>
  );
}

function TeamsPairingRow({
  settings,
  savePending,
}: {
  settings: TeamsSettingsResponse | undefined;
  savePending: boolean;
}) {
  const generate = useRegenerateTeamsHandshake();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [expiredCode, setExpiredCode] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);
  const code = settings?.handshakeCode ?? null;
  const expiresAt = settings?.handshakeExpiresAt ?? null;

  const activeCode =
    code !== expiredCode && Date.parse(expiresAt ?? "") > Date.now()
      ? code
      : null;

  useEffect(() => {
    if (!(code && expiresAt)) {
      return;
    }

    const timer = setTimeout(
      () => setExpiredCode(code),
      Math.max(0, Date.parse(expiresAt) - Date.now())
    );

    return () => clearTimeout(timer);
  }, [code, expiresAt]);

  async function copyCode() {
    if (!activeCode) {
      return;
    }

    try {
      await navigator.clipboard.writeText(activeCode);
      setCopiedCode(activeCode);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <SettingsRow
      description="Send the code to the bot in a direct message. It expires in 10 minutes."
      label="Pairing"
      layout="stacked"
    >
      <div className="flex flex-wrap items-center gap-2">
        {activeCode ? (
          <>
            <code
              aria-label="Pairing code"
              className="break-all rounded-md bg-muted px-2 py-1.5 text-xs"
            >
              {activeCode}
            </code>
            <Button
              onClick={copyCode}
              size="sm"
              type="button"
              variant="outline"
            >
              {copiedCode === activeCode ? "Copied" : "Copy"}
            </Button>
          </>
        ) : null}
        <Button
          disabled={!settings?.configured || generate.isPending || savePending}
          onClick={() => {
            setCopyError(false);
            generate.mutate();
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {generate.isPending
            ? "Generating…"
            : activeCode
              ? "New code"
              : "Generate code"}
        </Button>
        <span className="text-muted-foreground text-xs" role="status">
          {settings?.pairedUserIds.length ?? 0} linked
        </span>
      </div>
      {generate.error ? (
        <p className="text-destructive text-sm" role="alert">
          {formatError(generate.error)}
        </p>
      ) : null}
      {copyError ? (
        <p className="text-destructive text-sm" role="alert">
          Could not copy the code. Select it and copy it manually.
        </p>
      ) : null}
    </SettingsRow>
  );
}

export function TeamsSettingsCard() {
  const { data: settings, error: loadError, isPending } = useTeamsSettings();
  const { activeOrg, user } = useAuth();
  const save = useSaveTeamsSettings();
  const { data: status } = useSystemStatusQuery();

  const [form, setForm] = useState<TeamsForm>(() => formFrom(undefined));

  const {
    allowedUserIds: savedAllowedUserIds,
    clientId: savedClientId,
    tenantId: savedTenantId,
  } = formFrom(settings);

  useEffect(() => {
    setForm({
      allowedUserIds: savedAllowedUserIds,
      clientId: savedClientId,
      clientSecret: "",
      tenantId: savedTenantId,
    });
  }, [savedAllowedUserIds, savedClientId, savedTenantId]);

  if (isPending) {
    return SETTINGS_CARD_LOADING_SKELETON;
  }

  if (loadError) {
    return (
      <p className="text-destructive text-sm" role="alert">
        {formatError(loadError)}
      </p>
    );
  }

  const worker = status?.teamsWorker;
  const running = Boolean(worker?.running);

  const field = (key: keyof TeamsForm) => ({
    onChange: (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [key]: event.target.value })),
    value: form[key],
  });

  return (
    <div className="divide-y divide-border rounded-xl border border-border bg-card">
      <SettingsRow
        description="The Directory (tenant) ID of the Microsoft Entra tenant the bot belongs to."
        label="Tenant ID"
        layout="stacked"
      >
        <Input aria-label="Tenant ID" {...field("tenantId")} />
      </SettingsRow>

      <SettingsRow
        description="The bot's Application (client) ID."
        label="Client ID"
        layout="stacked"
      >
        <Input aria-label="Client ID" {...field("clientId")} />
      </SettingsRow>

      <SettingsRow
        description={
          settings?.clientSecretConfigured
            ? "A secret is saved. Leave this blank to keep it."
            : "A client secret for the bot's app registration."
        }
        label="Client secret"
        layout="stacked"
      >
        <Input
          aria-label="Client secret"
          autoComplete="off"
          type="password"
          {...field("clientSecret")}
        />
      </SettingsRow>

      <SettingsRow
        description="Entra object IDs, separated by commas. Users can chat when listed here or linked with a pairing code."
        label="Allowed users"
        layout="stacked"
      >
        <Input aria-label="Allowed users" {...field("allowedUserIds")} />
      </SettingsRow>

      {user?.isPlatformAdmin || activeOrg?.role === "admin" ? (
        <TeamsPairingRow savePending={save.isPending} settings={settings} />
      ) : null}

      <SettingsRow
        description="Register this as the bot's messaging endpoint in Azure."
        label="Messaging endpoint"
        layout="stacked"
      >
        <MessagingEndpoint endpoint={settings?.messagingEndpoint ?? null} />
      </SettingsRow>

      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate(toRequest(form), {
              onSuccess: () =>
                setForm((current) => ({ ...current, clientSecret: "" })),
            })
          }
          size="sm"
          type="button"
        >
          Save
        </Button>
        {save.error ? (
          <p className="text-destructive text-sm" role="alert">
            {formatError(save.error)}
          </p>
        ) : null}
      </div>

      <SettingsRow
        description={
          running
            ? "Listening on this server. Teams reaches it only through the messaging endpoint above."
            : "Stopped"
        }
        label="Bridge worker"
      >
        <WorkerActionBar
          pm2Managed={Boolean(worker?.process?.managed)}
          running={running}
          workerName="teams"
        />
      </SettingsRow>
    </div>
  );
}
