import { Tabs } from "@base-ui/react/tabs";
import type { ProfileSummary } from "@nakama/core";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { toast } from "@nakama/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Building06Icon,
  CloudDownloadIcon,
  CloudUploadIcon,
  Copy01Icon,
  Delete02Icon,
} from "hugeicons-react";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { DiscordSettingsCard } from "@/components/DiscordSettingsCard";
import { ExportProfileDialog } from "@/components/profiles/ExportProfileDialog";
import { ProfileSkillsSettingsSection } from "@/components/profiles/ProfileSkillsSettingsSection";
import { SlackSettingsCard } from "@/components/SlackSettingsCard";
import { SoulTab } from "@/components/soul-tools/SoulTab";
import { TeamsSettingsCard } from "@/components/TeamsSettingsCard";
import { TelegramSettingsCard } from "@/components/TelegramSettingsCard";
import { WhatsAppSettingsCard } from "@/components/WhatsAppSettingsCard";
import { useAuth } from "@/context/use-auth";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import {
  ChannelProfileContext,
  useChannelProfileId,
  useProfilesQuery,
} from "@/hooks/use-app-queries";
import { useSystemStatusQuery } from "@/hooks/use-system-status";
import { client, formatError } from "@/lib/client";
import { profilePath } from "@/lib/navigation";
import { isProfileOwner } from "@/lib/profiles";
import { queryKeys } from "@/lib/query-keys";
import { buildProfileChannels } from "@/pages/profiles/profile-channels";
import { ProfileConfigAssignmentsSection } from "@/pages/profiles/profile-config-assignments-section";
import {
  ProfileConfigIdentitySection,
  ProfileSystemPromptCard,
} from "@/pages/profiles/profile-config-identity-section";
import { ProfileHistoryTab } from "@/pages/profiles/profile-history-tab";
import { ProfileMcpSection } from "@/pages/profiles/profile-mcp-section";
import { ProfileSkillsSection } from "@/pages/profiles/profile-skills-section";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";

const sectionTabClass =
  "whitespace-nowrap rounded-full px-2 py-1.5 text-center font-medium text-muted-foreground text-sm outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm sm:px-3";

function ProfilePromptPanel({
  state,
  canPack,
  canCreateProfile,
  profileId,
}: {
  state: ProfilesPageState;
  canPack: boolean;
  canCreateProfile: boolean;
  profileId: string;
}) {
  const { user } = useAuth();
  const isOwner = isProfileOwner(state.detail, user?.id);

  return (
    <>
      <ProfileSystemPromptCard state={state} />
      {canPack || isOwner ? (
        <section className="space-y-4" id="profile-prompt">
          {canCreateProfile || isOwner ? (
            <SoulTab profileId={profileId} />
          ) : null}
          <details className="group/history">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-muted-foreground/55 text-sm hover:text-muted-foreground [&::-webkit-details-marker]:hidden">
              <span>Change histories</span>
              <ArrowDown01Icon
                aria-hidden="true"
                className="size-3.5 -rotate-90 transition-transform group-open/history:rotate-0"
              />
            </summary>
            <div className="pt-3">
              <ProfileHistoryTab profileId={profileId} />
            </div>
          </details>
        </section>
      ) : null}
    </>
  );
}

function initialProfileSection(
  detailTab: string,
  hash: string,
  search: string
) {
  const section = new URLSearchParams(search).get("section");

  if (section === "tools" || section === "mcp") {
    return section;
  }

  if (detailTab === "proposals") {
    return "tools";
  }

  return hash === "#profile-connections" ? "channels" : "prompt";
}

function ProfileSectionTab({
  hint,
  label,
  value,
}: {
  hint: string;
  label: string;
  value: string;
}) {
  return (
    <Tabs.Tab className={sectionTabClass} value={value}>
      {label}
      {hint ? (
        <span className="ml-1.5 hidden text-muted-foreground/70 text-xs tabular-nums sm:inline">
          {hint}
        </span>
      ) : null}
    </Tabs.Tab>
  );
}

function buildProfileSections({
  channels,
  detail,
  showBehavior,
  showChannels,
}: {
  channels: { connected: boolean }[] | null;
  detail: NonNullable<ProfilesPageState["detail"]>;
  showBehavior: boolean;
  showChannels: boolean;
}) {
  const channelHint = channels
    ? `${channels.filter((channel) => channel.connected).length}/${channels.length}`
    : "";

  return [
    { hint: "", label: "Prompt", value: "prompt" },
    ...(showChannels
      ? [{ hint: channelHint, label: "Channels", value: "channels" }]
      : []),
    ...(showBehavior
      ? [{ hint: "", label: "Behavior", value: "behavior" }]
      : []),
    {
      hint: String(detail.tools.filter((tool) => !tool.pluginId).length),
      label: "Tools",
      value: "tools",
    },
    {
      hint: String(detail.mcpServers.length),
      label: "MCP",
      value: "mcp",
    },
    {
      hint: String(detail.skills.filter((skill) => !skill.pluginId).length),
      label: "Skills",
      value: "skills",
    },
  ];
}

function profileTabAccess(
  detail: NonNullable<ProfilesPageState["detail"]>,
  user: { id: string; isPlatformAdmin?: boolean } | null | undefined,
  orgRole: string | undefined
) {
  const canCreateProfile = user?.isPlatformAdmin === true;
  const isOrgAdmin = orgRole === "admin";
  const canPack = isOrgAdmin || canCreateProfile;
  const isOwner = isProfileOwner(detail, user?.id);

  return {
    canCreateProfile,
    canManage: canCreateProfile || isOwner,
    canPack,
    showBehavior: isOrgAdmin || isOwner,
    showChannels: (canPack || isOwner) && !detail.isSuper,
  };
}

export function ProfileConfigTab({ state }: { state: ProfilesPageState }) {
  const { user, activeOrg } = useAuth();
  const { hash, search } = useLocation();
  const [moveOpen, setMoveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const { channels, error: channelsError, isPending } = useProfileChannels();
  const { navigateToSkillDetail } = useAppNavigation();

  const [section, setSection] = useState(() =>
    initialProfileSection(state.detailTab, hash, search)
  );

  if (!state.detail) {
    return null;
  }

  const { busy, detail, selectedId } = state;

  const { canCreateProfile, canManage, canPack, showBehavior, showChannels } =
    profileTabAccess(detail, user, activeOrg?.role);

  const channelsReady = !(isPending || channelsError);

  const sections = buildProfileSections({
    channels: showChannels && channelsReady ? channels : null,
    detail,
    showBehavior,
    showChannels,
  });

  return (
    <div
      className="mx-auto flex w-fit max-w-3xl flex-col gap-8"
      id="profile-detail-panel-profile"
    >
      <ProfileConfigIdentitySection state={state} />
      <Tabs.Root
        className="min-w-0 space-y-6"
        key={detail.id}
        onValueChange={(value) => setSection(String(value))}
        value={
          sections.some((item) => item.value === section) ? section : "prompt"
        }
      >
        <Tabs.List
          aria-label="Agent sections"
          className="mx-auto grid w-full max-w-full auto-cols-fr grid-flow-col gap-1 overflow-x-auto rounded-full bg-muted p-1 sm:w-fit"
        >
          {sections.map((item) => (
            <ProfileSectionTab key={item.value} {...item} />
          ))}
        </Tabs.List>
        <Tabs.Panel className="w-0 min-w-full space-y-6" value="prompt">
          <ProfilePromptPanel
            canCreateProfile={canCreateProfile}
            canPack={canPack}
            profileId={detail.id}
            state={state}
          />
          {(showChannels || canManage) && selectedId ? (
            <ProfileFooterActions
              onExport={() => setExportOpen(true)}
              onMove={() => setMoveOpen(true)}
              showAdmin={canManage}
              showMove={canCreateProfile}
              showPack={showChannels}
              state={state}
            />
          ) : null}
        </Tabs.Panel>
        {showChannels ? (
          <Tabs.Panel className="w-0 min-w-full" value="channels">
            <ChannelProfileContext.Provider
              key={`${activeOrg?.id}:${detail.id}`}
              value={detail.id}
            >
              <ProfileConnections />
            </ChannelProfileContext.Provider>
          </Tabs.Panel>
        ) : null}
        {showBehavior ? (
          <Tabs.Panel className="w-0 min-w-full" value="behavior">
            <ProfileSkillsSettingsSection disabled={busy} profile={detail} />
          </Tabs.Panel>
        ) : null}
        <Tabs.Panel className="w-0 min-w-full" value="tools">
          <ProfileConfigAssignmentsSection key={detail.id} state={state} />
        </Tabs.Panel>
        <Tabs.Panel className="w-0 min-w-full" value="mcp">
          <ProfileMcpSection
            allMcpServers={state.allMcpServers}
            busy={busy || !state.canManageProfile}
            detail={detail}
            onAssign={state.handleAssignMcpServer}
            onCreateOpen={() => state.setMcpCreateOpen(true)}
            onRemove={state.setRemoveConfirm}
          />
        </Tabs.Panel>
        <Tabs.Panel className="w-0 min-w-full" value="skills">
          <ProfileSkillsSection
            allSkills={state.allSkills.filter((skill) => !skill.pluginId)}
            busy={busy || !state.canManageProfile}
            detail={{
              ...detail,
              skills: detail.skills.filter((skill) => !skill.pluginId),
            }}
            onAddOpen={() => state.setSkillInstallOpen(true)}
            onCreateOpen={() => state.setSkillCreateOpen(true)}
            onRemove={state.setRemoveConfirm}
            onViewDetail={(skillId) => {
              navigateToSkillDetail(skillId, {
                profileId: selectedId ?? undefined,
              });
            }}
          />
        </Tabs.Panel>
      </Tabs.Root>
      <MoveProfileDialog
        onOpenChange={setMoveOpen}
        open={moveOpen}
        state={state}
      />
      <ExportProfileDialog
        onOpenChange={setExportOpen}
        open={exportOpen}
        profileId={detail.id}
        profileName={detail.name}
      />
    </div>
  );
}

function useProfileChannels() {
  const { data: status, isPending, error } = useSystemStatusQuery();
  const { channels } = buildProfileChannels(status, Boolean(error), isPending);

  return { channels, error, isPending };
}

export function ProfileConnections() {
  const profileId = useChannelProfileId();
  const { channels, error, isPending } = useProfileChannels();

  return (
    <section className="space-y-2" id="profile-connections">
      <h2 className="font-medium text-sm">Channels</h2>
      {isPending ? (
        <p className="text-muted-foreground text-sm" role="status">
          Loading connections…
        </p>
      ) : null}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          Connection status is unavailable. Open an app to check its setup.
        </p>
      ) : null}
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {channels.map(({ id, name, action, connected, statusLabel }) => (
          <Link
            aria-label={`${action} ${name}`}
            className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left outline-none transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            key={id}
            to={`/profiles/${encodeURIComponent(profileId ?? "")}/channels/${id}`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <img
                alt=""
                className="size-5 shrink-0"
                height={20}
                src={`/icons/${id}.svg`}
                width={20}
              />
              <span className="min-w-0">
                <span className="block font-medium text-sm">{name}</span>
                <span
                  className={
                    connected
                      ? "block text-emerald-700 text-xs dark:text-emerald-300"
                      : "block text-muted-foreground text-xs"
                  }
                >
                  {statusLabel}
                </span>
              </span>
            </span>
            <ArrowRight01Icon
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
          </Link>
        ))}
      </div>
    </section>
  );
}

export function ProfileChannelSettingsPage() {
  const { profileId, channel } = useParams();
  const { activeOrg } = useAuth();
  const { data: profiles = [], isPending, error } = useProfilesQuery();
  const profile = profiles.find((item) => item.id === profileId);

  const settings = {
    discord: { Component: DiscordSettingsCard, name: "Discord" },
    slack: { Component: SlackSettingsCard, name: "Slack" },
    teams: { Component: TeamsSettingsCard, name: "Microsoft Teams" },
    telegram: { Component: TelegramSettingsCard, name: "Telegram" },
    whatsapp: { Component: WhatsAppSettingsCard, name: "WhatsApp" },
  };

  const selected =
    channel === "telegram" ||
    channel === "whatsapp" ||
    channel === "discord" ||
    channel === "slack" ||
    channel === "teams"
      ? settings[channel]
      : undefined;

  if (isPending) {
    return <p role="status">Loading settings…</p>;
  }

  if (error) {
    return <p role="alert">{formatError(error)}</p>;
  }

  if (!(profile && selected)) {
    return <p role="alert">Channel settings not found.</p>;
  }

  const Settings = selected.Component;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        className="block w-fit text-muted-foreground text-sm hover:text-foreground"
        to={`${profilePath(profile.id)}#profile-connections`}
      >
        ← Back to agent
      </Link>
      <header className="space-y-2">
        <h1 className="font-medium text-xl">{selected.name} settings</h1>
        <p className="text-muted-foreground text-sm">
          Manage your {selected.name} connection and who can message this agent.
        </p>
      </header>
      <ChannelProfileContext.Provider
        key={`${activeOrg?.id}:${profile.id}:${channel}`}
        value={profile.id}
      >
        <Settings embedded />
      </ChannelProfileContext.Provider>
    </div>
  );
}

function profileDeleteDisabled(state: ProfilesPageState) {
  return (
    state.busy ||
    (state.detail?.isDefault === true && state.profiles.length < 3)
  );
}

function ProfileFooterActions({
  onExport,
  onMove,
  showAdmin,
  showMove,
  showPack,
  state,
}: {
  onExport: () => void;
  onMove: () => void;
  showAdmin: boolean;
  showMove: boolean;
  showPack: boolean;
  state: ProfilesPageState;
}) {
  const { busy, selectedId } = state;

  const actions = [
    ...(showPack
      ? [
          {
            disabled: busy,
            Icon: CloudDownloadIcon,
            label: "Import agent",
            onClick: () => state.setImportOpen(true),
          },
          {
            disabled: busy,
            Icon: CloudUploadIcon,
            label: "Export agent",
            onClick: onExport,
          },
        ]
      : []),
    ...(showAdmin && !state.detail?.sharedAgent
      ? [
          ...(showMove
            ? [
                {
                  disabled: busy,
                  Icon: Building06Icon,
                  label: "Move agent",
                  onClick: onMove,
                },
              ]
            : []),
          {
            disabled: busy,
            Icon: Copy01Icon,
            label: "Duplicate",
            onClick: () => selectedId && state.openCloneDialog(selectedId),
          },
        ]
      : []),
    ...(showAdmin
      ? [
          {
            destructive: true,
            disabled: profileDeleteDisabled(state),
            Icon: Delete02Icon,
            label: "Delete agent",
            onClick: () => selectedId && state.openDeleteDialog(selectedId),
          },
        ]
      : []),
  ];

  // Two columns; an odd button out and the destructive one take a full row.
  const regular = actions.filter((action) => !action.destructive);
  const fullRow = new Set(regular.length % 2 === 1 ? [regular.at(-1)] : []);

  return (
    <footer className="grid w-0 min-w-full grid-cols-2 gap-2">
      {actions.map((action) => {
        const { Icon, destructive, disabled, label, onClick } = action;

        return (
          <button
            className={`flex h-10 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border px-3 text-sm outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ${destructive || fullRow.has(action) ? "col-span-2" : ""} ${destructive ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}
            disabled={disabled}
            key={label}
            onClick={onClick}
            type="button"
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </button>
        );
      })}
    </footer>
  );
}

function MoveProfileDialog({
  onOpenChange,
  open,
  state,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  state: ProfilesPageState;
}) {
  const { activeOrg } = useAuth();
  const [organizationId, setOrganizationId] = useState("");
  const queryClient = useQueryClient();
  const canMove = open && state.canManageProfile;

  const organizations = useQuery({
    enabled: canMove,
    queryFn: () => client.listPlatformOrganizations(),
    queryKey: ["platformOrganizations"],
  });

  const move = useMutation({
    mutationFn: async () => {
      if (!state.detail || state.detail.sharedAgent) {
        throw new Error("Shared agent configuration is read-only.");
      }

      const profileId = state.detail.id;

      if (!(await state.flushSave())) {
        throw new Error("Save profile changes before changing organization.");
      }

      return client.moveProfile(profileId, { organizationId });
    },
    onError: (error) => toast(formatError(error)),
    onSuccess: async ({ profile }) => {
      const profileId = profile.id;
      queryClient.setQueryData<ProfileSummary[]>(
        queryKeys.profiles.all,
        (data) => data?.filter((profile) => profile.id !== profileId)
      );
      queryClient.removeQueries({
        queryKey: queryKeys.profiles.detail(profileId),
      });
      state.setSelectedId(null);
      onOpenChange(false);
      toast("Organization changed.");
      await queryClient.invalidateQueries();
    },
  });

  const destinations =
    organizations.data?.organizations.filter(
      (org) => org.id !== activeOrg?.id && !org.archivedAt
    ) ?? [];

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!move.isPending) {
          onOpenChange(next);
        }
      }}
      open={canMove}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Select organization for: {state.detail?.name}
          </DialogTitle>
        </DialogHeader>
        <Select
          disabled={move.isPending || organizations.isPending}
          onValueChange={(value) => setOrganizationId(value ?? "")}
          value={organizationId}
        >
          <SelectTrigger
            aria-label="Destination organization"
            className="w-full"
          >
            <SelectValue placeholder="Choose organization">
              {destinations.find((org) => org.id === organizationId)?.name}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {destinations.map((org) => (
              <SelectItem key={org.id} value={org.id}>
                {org.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {organizations.isError ? (
          <p className="text-destructive text-sm" role="alert">
            {formatError(organizations.error)}
          </p>
        ) : null}
        {!(organizations.isPending || organizations.isError) &&
        destinations.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No other organizations available.
          </p>
        ) : null}
        <DialogFooter>
          <Button
            disabled={move.isPending}
            onClick={() => onOpenChange(false)}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={
              move.isPending ||
              !destinations.some((org) => org.id === organizationId)
            }
            onClick={() => move.mutate()}
          >
            {move.isPending ? "Changing…" : "Change organization"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
