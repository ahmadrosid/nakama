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
import {
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

export function TeamsSettingsCard() {
  const { data: settings, error: loadError, isPending } = useTeamsSettings();
  const save = useSaveTeamsSettings();
  const { data: status } = useSystemStatusQuery();
  const [form, setForm] = useState<TeamsForm>(() => formFrom(undefined));

  useEffect(() => {
    setForm(formFrom(settings));
  }, [settings]);

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
        description="Entra object IDs of the people who may chat with this agent, separated by commas. Nobody can until one is listed."
        label="Allowed users"
        layout="stacked"
      >
        <Input aria-label="Allowed users" {...field("allowedUserIds")} />
      </SettingsRow>

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
