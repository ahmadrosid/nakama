import type { OrgPluginDetail } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Spinner } from "@nakama/ui/spinner";
import { cn } from "@nakama/ui/utils";
import { Tick02Icon } from "hugeicons-react";
import { type ReactNode, useState } from "react";
import { readRecord, readString } from "@/components/chat/web-search.shared";
import { useAuth } from "@/context/use-auth";
import {
  useEnableOrgPlugin,
  useOrgPlugins,
  usePluginAgentAccess,
} from "@/hooks/use-plugins";
import type { ChatListItem } from "@/lib/chat-history";
import { formatError } from "@/lib/client";
import { canAccessSystemPage } from "@/lib/navigation";
import { findPluginTool } from "@/lib/plugin-runtime";
import {
  LocalPluginInstaller,
  PluginAgentAccessDialog,
} from "@/pages/PluginsPage";

interface PluginDraft {
  actions: string[];
  draftId: string;
  fileCount: number;
  name: string;
  orgId: string;
  pluginId: string;
  profileId: string;
  version: string;
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Tool results are untrusted JSON decoded at this boundary.
function parsePluginDraft(value: unknown): PluginDraft | null {
  const record = readRecord(value);

  if (record?.type !== "plugin_draft_ready") {
    return null;
  }

  const fields = {
    draftId: readString(record.draftId),
    name: readString(record.name),
    orgId: readString(record.orgId),
    pluginId: readString(record.pluginId),
    profileId: readString(record.profileId),
    version: readString(record.version),
  };

  const { draftId, name, orgId, pluginId, profileId, version } = fields;

  if (!(draftId && name && orgId && pluginId && profileId && version)) {
    return null;
  }

  return {
    actions: Array.isArray(record.actions)
      ? record.actions.flatMap((item) => readString(item) ?? [])
      : [],
    draftId,
    fileCount: Number(record.fileCount) || 0,
    name,
    orgId,
    pluginId,
    profileId,
    version,
  };
}

export function PluginDrafts({
  complete,
  messages,
  usedTools,
}: {
  complete: boolean;
  messages: ChatListItem[];
  usedTools: string[];
}) {
  const { activeOrg } = useAuth();

  if (!complete) {
    return null;
  }

  const drafts = messages.flatMap((message) => {
    if (message.tool !== "submit_plugin_draft") {
      return [];
    }

    const draft = parsePluginDraft(message.toolResult);

    return draft && draft.orgId === activeOrg?.id ? [draft] : [];
  });

  return drafts.map((draft) => (
    <PluginDraftCard
      draft={draft}
      key={`${draft.draftId}:${draft.version}`}
      usedTools={usedTools}
    />
  ));
}

function PluginDraftCard({
  draft,
  usedTools,
}: {
  draft: PluginDraft;
  usedTools: string[];
}) {
  const { activeOrg, user } = useAuth();
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  const canEnable = canAccessSystemPage(isPlatformAdmin, activeOrg?.role);
  const plugins = useOrgPlugins().data ?? [];
  const access = usePluginAgentAccess();
  const enable = useEnableOrgPlugin();
  const [connecting, setConnecting] = useState<OrgPluginDetail | null>(null);
  const plugin = plugins.find((item) => item.pluginId === draft.pluginId);

  const installed =
    plugin?.installed && plugin.selectedVersion === draft.version;

  const enabled = installed && plugin?.lifecycleState === "enabled";
  const connectedCount = access.data?.counts[draft.pluginId] ?? 0;
  const connected = enabled && connectedCount > 0;

  const tried =
    connected &&
    usedTools.some(
      (tool) =>
        findPluginTool(plugins, tool)?.plugin.pluginId === draft.pluginId
    );

  const action = draft.actions[0] ?? "its tool";

  const steps: Array<{
    detail: string;
    done: boolean;
    title: string;
    controls?: ReactNode;
  }> = [
    {
      detail: draft.fileCount === 1 ? "1 file" : `${draft.fileCount} files`,
      done: true,
      title: "Drafted",
    },
    {
      controls:
        isPlatformAdmin && activeOrg ? (
          <LocalPluginInstaller
            draft={{ draftId: draft.draftId, profileId: draft.profileId }}
            orgId={activeOrg.id}
          />
        ) : null,
      detail: installed
        ? `Version ${draft.version} installed`
        : isPlatformAdmin
          ? "Review the files, then install."
          : "Waiting for a platform admin",
      done: Boolean(installed),
      title: "Review and install",
    },
    {
      controls:
        canEnable && plugin ? (
          <Button
            disabled={enable.isPending}
            onClick={() =>
              enable.mutate({
                expectedRevision: plugin.revision,
                pluginId: plugin.pluginId,
              })
            }
            size="sm"
          >
            {enable.isPending ? <Spinner className="size-4" /> : null}
            Enable plugin
          </Button>
        ) : null,
      detail: enable.error
        ? formatError(enable.error)
        : enabled
          ? "Enabled"
          : (plugin?.lastLifecycleError ?? "Turn it on for this organization"),
      done: Boolean(enabled),
      title: "Enable",
    },
    {
      controls:
        isPlatformAdmin && plugin ? (
          <Button onClick={() => setConnecting(plugin)} size="sm">
            Choose profiles
          </Button>
        ) : null,
      detail: connected
        ? `${connectedCount} ${connectedCount === 1 ? "profile" : "profiles"}`
        : `Assign ${action}`,
      done: Boolean(connected),
      title: "Connect to profiles",
    },
    {
      detail: tried ? "Ran in this chat" : `Ask an agent to run ${action}`,
      done: Boolean(tried),
      title: "Try it",
    },
  ];

  const current = steps.findIndex((step) => !step.done);

  return (
    <section className="w-full rounded-xl bg-card shadow-sm ring-1 ring-border/80 dark:shadow-none">
      <header className="flex items-center justify-between gap-3 border-border border-b px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium text-foreground text-sm">
            {draft.name}
          </h3>
          <p className="truncate font-mono text-muted-foreground text-xs">
            plugin-drafts/{draft.draftId} · {draft.version}
          </p>
        </div>
        <p className="shrink-0 text-muted-foreground text-xs tabular-nums">
          {current < 0 ? "Live" : `Step ${current + 1} of ${steps.length}`}
        </p>
      </header>
      <ol className="flex flex-col px-4 py-3">
        {steps.map((step, index) => {
          const active = index === current;
          const last = index === steps.length - 1;

          return (
            <li className="flex gap-3" key={step.title}>
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full font-medium text-xs",
                    step.done && "bg-green-700 text-white",
                    active &&
                      "border-2 border-primary bg-primary/10 text-primary",
                    !(step.done || active) &&
                      "border-2 border-border text-muted-foreground"
                  )}
                >
                  {step.done ? (
                    <Tick02Icon aria-hidden className="size-3.5" />
                  ) : (
                    index + 1
                  )}
                </span>
                {last ? null : (
                  <span
                    className={cn(
                      "min-h-3 w-0.5 flex-1",
                      step.done ? "bg-green-700" : "bg-border"
                    )}
                  />
                )}
              </div>
              <div className={cn("min-w-0 flex-1", !last && "pb-4")}>
                <p
                  className={cn(
                    "font-medium text-sm",
                    !(step.done || active) && "text-muted-foreground"
                  )}
                >
                  {step.title}
                </p>
                <p className="text-pretty text-muted-foreground text-sm">
                  {step.detail}
                </p>
                {active && step.controls ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {step.controls}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {connecting ? (
        <PluginAgentAccessDialog
          onClose={() => setConnecting(null)}
          plugin={connecting}
        />
      ) : null}
    </section>
  );
}
