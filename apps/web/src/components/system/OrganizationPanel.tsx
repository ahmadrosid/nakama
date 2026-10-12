import type {
  CreateTeamRequest,
  OrganizationOverviewResponse,
  OrgMemberSummary,
  OrgSharedResourceKind,
  OrgSharedResourceSummary,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Card, CardHeader, CardTitle } from "@nakama/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AiBrain01Icon,
  ArrowRight01Icon,
  BookOpen01Icon,
  ComputerTerminal01Icon,
  Search01Icon,
  TaskEdit01Icon,
  Tick02Icon,
  UserGroupIcon,
} from "hugeicons-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { OrgArchiveCard } from "@/components/settings/OrgArchiveCard";
import { OrgMembersCard } from "@/components/settings/OrgMembersCard";
import { OrgMemoryCard } from "@/components/settings/OrgMemoryCard";
import { SkillsCuratorOrgCard } from "@/components/settings/SkillsCuratorOrgCard";
import { SkillsPostTurnReviewOrgCard } from "@/components/settings/SkillsPostTurnReviewOrgCard";
import { SkillsWriteApprovalOrgCard } from "@/components/settings/SkillsWriteApprovalOrgCard";
import { ToolDetailSections } from "@/components/tools/ToolDetailSections";
import { useActiveChatProfile } from "@/context/use-active-chat-profile";
import { useAuth } from "@/context/use-auth";
import { useAppNavigation } from "@/hooks/use-app-navigation";
import {
  useCreateTeam,
  useOrganizationOverview,
  useOrgMembers,
  useOrgPublicationMutation,
} from "@/hooks/use-org-members";
import { client, formatError } from "@/lib/client";
import { decodeModelSelection, encodeModelSelection } from "@/lib/models";
import {
  canAccessSystemPage,
  canUseToolPlayground,
  profilePath,
  skillDetailPath,
} from "@/lib/navigation";
import { queryKeys } from "@/lib/query-keys";

const RESOURCE_ROWS = [
  { icon: BookOpen01Icon, kind: "knowledge", label: "Knowledge" },
  { icon: TaskEdit01Icon, kind: "skill", label: "Skills" },
  { icon: UserGroupIcon, kind: "agent", label: "Agents" },
  { icon: ComputerTerminal01Icon, kind: "tool", label: "Tools" },
  { icon: AiBrain01Icon, kind: "model", label: "Models" },
] satisfies Array<{
  kind: OrgSharedResourceKind;
  label: string;
  icon: typeof BookOpen01Icon;
}>;

const READINESS_LABELS = {
  ready: "Ready",
  requires_setup: "Requires setup",
  unavailable: "Unavailable",
};

function SharedModelDialog({
  orgId,
  resource,
}: {
  orgId: string;
  resource: OrgSharedResourceSummary;
}) {
  const [open, setOpen] = useState(false);
  const { user, activeOrg } = useAuth();
  const { navigateToPage } = useAppNavigation();

  const detail = useQuery({
    enabled: open,
    gcTime: 0,
    queryFn: async () => {
      const { resources } = await client.listOrgSharedResources(orgId);

      const publication = resources.find(
        (entry) => entry.id === resource.id && entry.resourceKind === "model"
      );

      if (!publication || publication.readiness !== "ready") {
        throw new Error("This shared model is unavailable.");
      }

      const selection = decodeModelSelection(publication.resourceId);

      if (!selection) {
        throw new Error("This shared model is unavailable.");
      }

      const { models, providers } = await client.getModels();

      const model = models.find(
        (entry) =>
          entry.id === selection.modelId &&
          entry.providerId === selection.providerId
      );

      const provider = providers.find(
        (entry) => entry.id === selection.providerId
      );

      if (!(model && provider)) {
        throw new Error("This shared model is unavailable.");
      }

      return { model, provider, publication };
    },
    queryKey: [...queryKeys.models, "published", orgId, resource.id],
    staleTime: 0,
  });

  const canManageProfiles = canAccessSystemPage(
    user?.isPlatformAdmin === true,
    activeOrg?.role
  );

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button
            aria-label={`View shared model ${resource.label} from ${resource.sourceOrganization.name}`}
            className="h-auto max-w-full whitespace-normal break-words text-left"
            size="sm"
            variant="secondary"
          />
        }
      >
        {resource.label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{resource.label}</DialogTitle>
        </DialogHeader>
        {detail.isFetching && <p role="status">Loading model…</p>}
        {detail.isError && (
          <div className="space-y-2" role="alert">
            <p>{formatError(detail.error)}</p>
            <Button
              disabled={detail.isFetching}
              onClick={() => void detail.refetch()}
              variant="outline"
            >
              Retry model
            </Button>
          </div>
        )}
        {detail.data && !detail.isFetching && !detail.isError && (
          <>
            <p className="break-words text-muted-foreground text-sm">
              Shared from {detail.data.publication.sourceOrganization.name}
            </p>
            <dl className="grid min-w-0 gap-3 break-words text-sm sm:grid-cols-[6rem_minmax(0,1fr)]">
              <dt>Model</dt>
              <dd>{detail.data.model.name}</dd>
              <dt>Provider</dt>
              <dd>{detail.data.provider.label}</dd>
              <dt>Provider ID</dt>
              <dd className="font-mono">{detail.data.provider.id}</dd>
              <dt>Model ID</dt>
              <dd className="font-mono">{detail.data.model.id}</dd>
              {detail.data.model.contextWindow !== undefined && (
                <>
                  <dt>Context limit</dt>
                  <dd className="tabular-nums">
                    {detail.data.model.contextWindow.toLocaleString()} tokens
                  </dd>
                </>
              )}
            </dl>
            {canManageProfiles && (
              <DialogFooter>
                <Button
                  onClick={() => {
                    setOpen(false);
                    navigateToPage("profiles");
                  }}
                >
                  Agent settings
                </Button>
                {user?.isPlatformAdmin && (
                  <Button
                    onClick={() => {
                      setOpen(false);
                      navigateToPage("providers");
                    }}
                    variant="outline"
                  >
                    Manage providers
                  </Button>
                )}
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SharedToolDialog({
  orgId,
  resource,
}: {
  orgId: string;
  resource: OrgSharedResourceSummary;
}) {
  const [open, setOpen] = useState(false);
  const { navigateToToolPlayground } = useAppNavigation();

  const detail = useQuery({
    enabled: open,
    gcTime: 0,
    queryFn: () => client.getTool(resource.resourceId, orgId),
    queryKey: queryKeys.tools.published(orgId, resource.id),
    staleTime: 0,
  });

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button
            aria-label={`View shared tool ${resource.label} from ${resource.sourceOrganization.name}`}
            className="h-auto max-w-full whitespace-normal break-words text-left"
            size="sm"
            variant="secondary"
          />
        }
      >
        {resource.label}
        {resource.readiness !== "ready" && (
          <span className="ml-2 text-muted-foreground">
            {READINESS_LABELS[resource.readiness]}
          </span>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{resource.label}</DialogTitle>
        </DialogHeader>
        {detail.isFetching && <p role="status">Loading tool…</p>}
        {detail.isError && (
          <div className="space-y-2" role="alert">
            <p>{formatError(detail.error)}</p>
            <Button
              disabled={detail.isFetching}
              onClick={() => void detail.refetch()}
              variant="outline"
            >
              Retry tool
            </Button>
          </div>
        )}
        {detail.data && !detail.isFetching && !detail.isError && (
          <>
            <div className="min-w-0 space-y-3 break-words">
              <p className="text-muted-foreground text-sm">
                Shared from {resource.sourceOrganization.name}
              </p>
              <ToolDetailSections tool={detail.data.tool} />
            </div>
            <DialogFooter>
              <Button
                onClick={() => {
                  setOpen(false);
                  navigateToToolPlayground(resource.resourceId);
                }}
              >
                {resource.readiness === "requires_setup"
                  ? "Set up tool"
                  : "Open playground"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SharedAgentButton({
  orgId,
  resource,
}: {
  orgId: string;
  resource: OrgSharedResourceSummary;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const queryClient = useQueryClient();
  const { syncForOrg } = useActiveChatProfile();
  const { navigateToNewChat } = useAppNavigation();

  async function select() {
    if (running.current) {
      return;
    }

    running.current = true;
    setPending(true);
    setError(null);

    try {
      // oxlint-disable-next-line react-doctor/async-defer-await -- Recheck the team after this request completes.
      const { profile } = await client.createSharedAgentInstance(
        orgId,
        resource.id
      );

      if (!trigger.current?.isConnected) {
        return;
      }

      await queryClient.cancelQueries({ queryKey: queryKeys.profiles.all });

      if (!trigger.current?.isConnected) {
        return;
      }

      // oxlint-disable-next-line react-doctor/async-defer-await -- Recheck the team before using the returned profiles.
      const { profiles } = await client.listProfiles(orgId);

      if (!trigger.current?.isConnected) {
        return;
      }

      if (!profiles.some((item) => item.id === profile.id)) {
        throw new Error("The selected agent is unavailable. Retry selection.");
      }

      queryClient.setQueryData([...queryKeys.profiles.all, orgId], profiles);
      queryClient.setQueryData(queryKeys.profiles.all, profiles);
      syncForOrg({ orgId, preferredProfileId: profile.id, profiles });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.organizationOverview(resource.orgId, orgId),
      });
      navigateToNewChat(profile.id);
    } catch (cause) {
      if (trigger.current?.isConnected) {
        setError(formatError(cause));
      }
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <div className="min-w-0 max-w-full space-y-2">
      <Button
        aria-label={`Open shared agent ${resource.label} from ${resource.sourceOrganization.name}`}
        className="h-auto max-w-full whitespace-normal break-words text-left"
        disabled={pending}
        onClick={() => void select()}
        ref={trigger}
        size="sm"
        variant="secondary"
      >
        {pending ? "Opening agent…" : resource.label}
      </Button>
      {error && (
        <p className="break-words text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SharedKnowledgeDialog({
  orgId,
  resource,
}: {
  orgId: string;
  resource: OrgSharedResourceSummary;
}) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const running = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);

  const detail = useQuery({
    enabled: open,
    gcTime: 0,
    queryFn: async () => {
      const document = await client.readPublishedKnowledgeBaseDocument(
        orgId,
        resource.id,
        { render: "text" }
      );

      return new TextDecoder().decode(document.data);
    },
    queryKey: queryKeys.knowledgeBase.published(orgId, resource.id),
    staleTime: 0,
  });

  async function download() {
    if (running.current) {
      return;
    }

    running.current = true;
    setDownloading(true);
    setDownloadError(null);
    let downloadUrl: string | null = null;

    try {
      const content = await client.readPublishedKnowledgeBaseDocument(
        orgId,
        resource.id
      );

      if (trigger.current?.isConnected) {
        const anchor = document.createElement("a");

        downloadUrl = URL.createObjectURL(
          new Blob([content.data], { type: content.contentType })
        );

        try {
          anchor.href = downloadUrl;
          anchor.download = resource.label;
          document.body.append(anchor);
          anchor.click();
        } finally {
          anchor.remove();
        }
      }
    } catch (error) {
      if (trigger.current?.isConnected) {
        setDownloadError(formatError(error));
      }
    } finally {
      running.current = false;
      setDownloading(false);

      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!running.current) {
          setDownloadError(null);
          setOpen(nextOpen);
        }
      }}
      open={open}
    >
      <DialogTrigger
        render={
          <Button
            aria-label={`View shared knowledge ${resource.label} from ${resource.sourceOrganization.name}`}
            className="h-auto max-w-full whitespace-normal break-words text-left"
            ref={trigger}
            size="sm"
            variant="secondary"
          />
        }
      >
        {resource.label}
      </DialogTrigger>
      <DialogContent showCloseButton={!downloading}>
        <DialogHeader>
          <DialogTitle>{resource.label}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          Shared from {resource.sourceOrganization.name}
        </p>
        {detail.isFetching && <p role="status">Loading document…</p>}
        {detail.isError && (
          <div className="space-y-2" role="alert">
            <p>{formatError(detail.error)}</p>
            <Button
              disabled={detail.isFetching}
              onClick={() => void detail.refetch()}
              variant="outline"
            >
              Retry preview
            </Button>
          </div>
        )}
        {detail.data !== undefined && !detail.isFetching && !detail.isError && (
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm">
            {detail.data}
          </pre>
        )}
        {downloadError && <p role="alert">{downloadError}</p>}
        <DialogFooter>
          <Button disabled={downloading} onClick={() => void download()}>
            {downloading
              ? "Downloading…"
              : downloadError
                ? "Retry download"
                : "Download document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SharedSkillDialog({
  orgId,
  resource,
}: {
  orgId: string;
  resource: OrgSharedResourceSummary;
}) {
  const [open, setOpen] = useState(false);

  const detail = useQuery({
    enabled: open,
    gcTime: 0,
    queryFn: () => client.getPublishedSkill(orgId, resource.id),
    queryKey: queryKeys.skills.published(orgId, resource.id),
    staleTime: 0,
  });

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button
            aria-label={`View shared skill ${resource.label} from ${resource.sourceOrganization.name}`}
            className="h-auto max-w-full whitespace-normal break-words text-left"
            size="sm"
            variant="secondary"
          />
        }
      >
        {resource.label}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{resource.label}</DialogTitle>
        </DialogHeader>
        {detail.isFetching && <p role="status">Loading skill…</p>}
        {detail.isError && (
          <div className="space-y-2" role="alert">
            <p>{formatError(detail.error)}</p>
            <Button
              disabled={detail.isFetching}
              onClick={() => void detail.refetch()}
              variant="outline"
            >
              Retry skill
            </Button>
          </div>
        )}
        {detail.data && !detail.isFetching && !detail.isError && (
          <div className="min-w-0 space-y-3">
            <p className="text-muted-foreground text-sm">
              Shared from {detail.data.skill.sourceOrganization.name}
            </p>
            {detail.data.skill.description && (
              <p className="break-words">{detail.data.skill.description}</p>
            )}
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 text-sm">
              {detail.data.skill.body}
            </pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResourcePublicationDialog({
  orgId,
  resources,
  kind,
  label,
}: {
  orgId: string;
  resources: OrgSharedResourceSummary[];
  kind: OrgSharedResourceKind;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [resourceId, setResourceId] = useState<string | null>(null);

  const catalog = useQuery({
    enabled: open,
    queryFn: async () => {
      if (kind === "knowledge") {
        const { documents } = await client.listOrganizationKnowledgeBase(orgId);

        return documents
          .filter((document) => document.status === "ready")
          .map((document) => ({ id: document.id, label: document.filename }));
      }

      if (kind === "skill") {
        const { skills } = await client.listSkills(orgId);

        return skills
          .filter((skill) => skill.enabled && skill.orgId === orgId)
          .map((skill) => ({ id: skill.id, label: skill.name }));
      }

      if (kind === "tool") {
        const { tools } = await client.listTools(orgId);

        return tools.map((tool) => ({ id: tool.id, label: tool.name }));
      }

      if (kind === "model") {
        const { models, providers } = await client.getModels();

        return models.flatMap((model) => {
          const provider = providers.find(
            (entry) => entry.id === model.providerId
          );

          return provider
            ? [
                {
                  id: encodeModelSelection(provider.id, model.id),
                  label: model.name,
                },
              ]
            : [];
        });
      }

      const { profiles } = await client.listProfiles(orgId);

      return profiles
        .filter(
          (profile) =>
            !(profile.isSuper || profile.isDefault || profile.sharedAgent)
        )
        .map((profile) => ({ id: profile.id, label: profile.name }));
    },
    queryKey: queryKeys.organizationPublicationCatalog(orgId, kind),
  });

  const mutation = useOrgPublicationMutation(orgId);

  const resourceLabel = kind === "knowledge" ? "document" : kind;

  const publications = resources.filter(
    (resource) => resource.resourceKind === kind
  );

  const labelCounts = new Map<string, number>();

  for (const resource of catalog.data ?? []) {
    labelCounts.set(resource.label, (labelCounts.get(resource.label) ?? 0) + 1);
  }

  const available = (catalog.data ?? [])
    .filter(
      (resource) =>
        !publications.some(
          (publication) => publication.resourceId === resource.id
        )
    )
    .map((resource) => ({
      ...resource,
      label:
        (labelCounts.get(resource.label) ?? 0) > 1
          ? `${resource.label} (${resource.id})`
          : resource.label,
    }));

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!mutation.isPending) {
          mutation.reset();
          setOpen(nextOpen);
        }
      }}
      open={open}
    >
      <DialogTrigger
        render={
          <Button
            aria-label={`Manage shared ${label.toLowerCase()}`}
            size="sm"
            variant="outline"
          />
        }
      >
        Manage
      </DialogTrigger>
      <DialogContent showCloseButton={!mutation.isPending}>
        <DialogHeader>
          <DialogTitle>Shared {label.toLowerCase()}</DialogTitle>
        </DialogHeader>
        {catalog.isError && (
          <div className="space-y-2" role="alert">
            <p>{formatError(catalog.error)}</p>
            <Button
              disabled={catalog.isFetching}
              onClick={() => void catalog.refetch()}
              variant="outline"
            >
              Retry {resourceLabel}s
            </Button>
          </div>
        )}
        {catalog.isPending && <p role="status">Loading {resourceLabel}s…</p>}
        {catalog.data && (
          <div className="flex flex-col gap-3">
            <Select
              disabled={mutation.isPending || catalog.isError}
              items={available.map((resource) => ({
                label: resource.label,
                value: resource.id,
              }))}
              onValueChange={setResourceId}
              value={resourceId}
            >
              <SelectTrigger
                aria-label={`${resourceLabel} to publish`}
                className="w-full"
              >
                <SelectValue placeholder={`Select ${resourceLabel}`} />
              </SelectTrigger>
              <SelectContent>
                {available.map((resource) => (
                  <SelectItem key={resource.id} value={resource.id}>
                    {resource.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {available.length === 0 && (
              <p className="text-muted-foreground text-sm">
                No unpublished {resourceLabel}s
              </p>
            )}
            <Button
              disabled={
                mutation.isPending ||
                catalog.isError ||
                !available.some((resource) => resource.id === resourceId)
              }
              onClick={() => {
                if (resourceId) {
                  mutation.mutate(
                    {
                      action: "publish",
                      resource: { resourceId, resourceKind: kind },
                    },
                    { onSuccess: () => setResourceId(null) }
                  );
                }
              }}
            >
              Publish {resourceLabel}
            </Button>
          </div>
        )}
        <ul className="space-y-3">
          {publications.map((publication) => (
            <li
              className="flex items-center justify-between gap-3"
              key={publication.id}
            >
              <span className="min-w-0 break-words">{publication.label}</span>
              <Button
                aria-label={`Unpublish ${publication.label}`}
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    action: "unpublish",
                    publicationId: publication.id,
                  })
                }
                size="sm"
                variant="outline"
              >
                Unpublish
              </Button>
            </li>
          ))}
        </ul>
        {mutation.isError && (
          <p className="text-destructive" role="alert">
            {formatError(mutation.error)}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function slugifyTeamName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const ROLE_NAMES: Record<OrgMemberSummary["role"], string> = {
  admin: "Org admin",
  member: "Member",
  viewer: "Viewer",
};

function memberInitials(member: OrgMemberSummary) {
  const source = member.name?.trim() || member.email;

  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function TeamAdminPicker({
  orgId,
  value,
  disabled,
  onChange,
}: {
  orgId: string;
  value: string;
  disabled: boolean;
  onChange: (userId: string) => void;
}) {
  const members = useOrgMembers(orgId);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const visible = (members.data?.members ?? []).filter(
    (member) =>
      !needle ||
      member.email.toLowerCase().includes(needle) ||
      (member.name ?? "").toLowerCase().includes(needle)
  );

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center gap-2 border-border border-b bg-muted/50 px-3">
        <Search01Icon aria-hidden className="size-4 text-muted-foreground" />
        <input
          aria-label="Search members"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search members"
          value={query}
        />
      </div>
      <div className="max-h-56 divide-y divide-border overflow-y-auto">
        {members.isLoading && (
          <p className="px-4 py-3 text-muted-foreground text-sm">
            Loading members…
          </p>
        )}
        {visible.map((member) => {
          const selected = member.userId === value;

          return (
            <label
              className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 ${
                selected ? "bg-primary/10" : "bg-background"
              }`}
              key={member.userId}
            >
              <input
                checked={selected}
                className="sr-only"
                disabled={disabled}
                name="team-admin"
                onChange={() => onChange(member.userId)}
                type="radio"
                value={member.userId}
              />
              <span
                aria-hidden
                className={`flex size-8 shrink-0 items-center justify-center rounded-full font-medium text-xs ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {memberInitials(member)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-sm">
                  {member.name?.trim() || member.email}
                </span>
                <span className="block truncate text-muted-foreground text-xs">
                  {member.email} · {ROLE_NAMES[member.role]}
                </span>
              </span>
              {selected && (
                <Tick02Icon aria-hidden className="size-4 text-primary" />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function AddTeamDialog({
  orgId,
  creatorId,
}: {
  orgId: string;
  creatorId: string;
}) {
  const { refreshSession } = useAuth();
  const createTeam = useCreateTeam(orgId);
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [slugOverride, setSlugOverride] = useState<string | null>(null);
  const [editingSlug, setEditingSlug] = useState(false);
  const [adminUserId, setAdminUserId] = useState(creatorId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);
  const running = useRef(false);
  const request = useRef<CreateTeamRequest | null>(null);
  const slug = slugOverride ?? slugifyTeamName(name);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (running.current) {
      return;
    }

    const input = {
      adminUserId: adminUserId.trim(),
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
    };

    if (
      !(
        input.name &&
        input.adminUserId &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)
      )
    ) {
      setError("Enter a team name, valid slug, and first admin.");

      return;
    }

    if (
      !request.current ||
      request.current.name !== input.name ||
      request.current.slug !== input.slug ||
      request.current.adminUserId !== input.adminUserId
    ) {
      request.current = { ...input, requestId: crypto.randomUUID() };
    }

    running.current = true;
    setPending(true);
    setError(null);

    try {
      if (!created) {
        await createTeam.mutateAsync(request.current);
        setCreated(true);
      }

      await refreshSession();
      setOpen(false);
      setName("");
      setSlugOverride(null);
      setEditingSlug(false);
      setAdminUserId(creatorId);
      request.current = null;
      setCreated(false);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!running.current) {
          setOpen(nextOpen);
        }
      }}
      open={open}
    >
      <DialogTrigger
        render={<Button aria-label="Add team" size="sm" variant="outline" />}
      >
        Add team
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Add team</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          id={formId}
          onSubmit={(event) => void submit(event)}
        >
          <div className="space-y-1.5">
            <label
              className="block font-medium text-sm"
              htmlFor={`${formId}-name`}
            >
              Team name
            </label>
            <Input
              className="h-10 rounded-xl"
              disabled={pending || created}
              id={`${formId}-name`}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
            <div className="flex items-center gap-2 pt-1 text-sm">
              <span className="text-muted-foreground">Slug</span>
              {editingSlug ? (
                <Input
                  aria-label="Slug"
                  className="h-8 max-w-56 rounded-lg"
                  disabled={pending || created}
                  id={`${formId}-slug`}
                  onChange={(event) => setSlugOverride(event.target.value)}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  required
                  value={slug}
                />
              ) : (
                <>
                  <span className="font-medium">{slug || "—"}</span>
                  <button
                    className="font-medium text-primary hover:underline disabled:opacity-50"
                    disabled={pending || created}
                    onClick={() => {
                      setSlugOverride(slug);
                      setEditingSlug(true);
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="font-medium text-sm">First admin</p>
            <TeamAdminPicker
              disabled={pending || created}
              onChange={setAdminUserId}
              orgId={orgId}
              value={adminUserId}
            />
          </div>
          {error && (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => setOpen(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button disabled={pending} form={formId} type="submit">
            {pending ? "Creating…" : "Create team"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrganizationTeamRow({
  team,
  activeOrgId,
}: {
  team: OrganizationOverviewResponse["teams"][number];
  activeOrgId: string;
}) {
  const { switchOrg } = useAuth();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  async function handleSwitch() {
    if (running.current || !team.canSwitch || team.id === activeOrgId) {
      return;
    }

    running.current = true;
    setPending(true);
    setError(null);

    try {
      await switchOrg(team.id);
      setOpen(false);
    } catch (cause) {
      setError(formatError(cause));
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <li>
      <Dialog
        onOpenChange={(nextOpen) => {
          if (!running.current) {
            setError(null);
            setOpen(nextOpen);
          }
        }}
        open={open}
      >
        <DialogTrigger
          render={
            <button
              aria-label={`View ${team.name}`}
              className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-3 text-left outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
              type="button"
            />
          }
        >
          <span className="min-w-0 space-y-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="break-words font-medium">{team.name}</span>
              {team.id === activeOrgId && (
                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-orange-700 text-xs dark:bg-orange-950 dark:text-orange-300">
                  Current
                </span>
              )}
            </span>
            <span className="block text-muted-foreground text-xs tabular-nums">
              {[
                `${team.memberCount} members`,
                ...Object.entries(team.localResourceCounts).map(
                  ([kind, count]) => `${count} ${kind}`
                ),
              ].join(" · ")}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="rounded-md bg-muted px-2 py-0.5 text-muted-foreground text-xs">
              Shared foundation
            </span>
            <ArrowRight01Icon
              aria-hidden
              className="size-4 text-muted-foreground"
            />
          </span>
        </DialogTrigger>
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle className="break-words">{team.name}</DialogTitle>
          </DialogHeader>
          <dl className="space-y-2">
            <div>
              <dt className="text-muted-foreground">Team ID</dt>
              <dd className="break-all font-mono text-xs">{team.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="break-words">{team.slug}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Members</dt>
              <dd className="tabular-nums">{team.memberCount}</dd>
            </div>
            {Object.entries(team.localResourceCounts).map(([kind, count]) => (
              <div className="flex gap-2" key={kind}>
                <dt className="text-muted-foreground">{kind}</dt>
                <dd className="tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
          {error && (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          )}
          {team.canSwitch && team.id !== activeOrgId && (
            <DialogFooter>
              <Button disabled={pending} onClick={() => void handleSwitch()}>
                {pending ? "Switching…" : "Switch to team"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </li>
  );
}

export function OrganizationOverview() {
  const { activeOrg, user } = useAuth();

  const overview = useOrganizationOverview(
    activeOrg?.id ?? null,
    activeOrg?.parentOrgId ?? null
  );

  if (!activeOrg) {
    return null;
  }

  if (overview.isError && !overview.data) {
    return (
      <div className="space-y-3" role="alert">
        <p>{formatError(overview.error)}</p>
        <Button
          disabled={overview.isFetching}
          onClick={() => void overview.refetch()}
          variant="outline"
        >
          Retry
        </Button>
      </div>
    );
  }

  if (!overview.data || overview.data.activeOrgId !== activeOrg.id) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        Loading organization…
      </p>
    );
  }

  const { organization, sharedResources, teams } = overview.data;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="break-words font-semibold text-xl">
          {organization.name}
        </h2>
        <p className="text-muted-foreground text-sm">
          Shared with every team from day one. Teams build their own work on
          top.
        </p>
      </div>
      {overview.isError && (
        <div className="space-y-2" role="alert">
          <p>{formatError(overview.error)}</p>
          <Button
            disabled={overview.isFetching}
            onClick={() => void overview.refetch()}
            variant="outline"
          >
            Retry overview
          </Button>
        </div>
      )}
      <Card className="overflow-hidden shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-5 py-3">
          <CardTitle className="text-sm">Shared with every team</CardTitle>
          <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-orange-700 text-xs dark:bg-orange-950 dark:text-orange-300">
            Available to all teams
          </span>
        </CardHeader>
        <dl className="divide-y">
          {RESOURCE_ROWS.map(({ kind, label, icon: Icon }) => (
            <div
              className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:gap-4"
              key={kind}
            >
              <dt className="flex shrink-0 items-center gap-3 font-medium text-sm sm:w-32">
                <Icon aria-hidden className="size-4 text-muted-foreground" />
                {label}
              </dt>
              <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {sharedResources
                  .filter((resource) => resource.resourceKind === kind)
                  .map((resource) =>
                    resource.resourceKind === "skill" &&
                    resource.readiness === "ready" &&
                    (activeOrg.parentOrgId ||
                      (resource.orgId === activeOrg.id &&
                        user &&
                        !user.isPlatformAdmin &&
                        activeOrg.role === "admin")) ? (
                      <SharedSkillDialog
                        key={`${activeOrg.id}:${resource.id}`}
                        orgId={activeOrg.id}
                        resource={resource}
                      />
                    ) : resource.resourceKind === "knowledge" &&
                      resource.readiness === "ready" &&
                      (activeOrg.parentOrgId ||
                        (resource.orgId === activeOrg.id &&
                          user &&
                          canAccessSystemPage(
                            user.isPlatformAdmin === true,
                            activeOrg.role
                          ))) ? (
                      <SharedKnowledgeDialog
                        key={`${activeOrg.id}:${resource.id}`}
                        orgId={activeOrg.id}
                        resource={resource}
                      />
                    ) : resource.resourceKind === "agent" &&
                      resource.readiness === "ready" &&
                      activeOrg.parentOrgId &&
                      user &&
                      (user.isPlatformAdmin ||
                        activeOrg.role === "admin" ||
                        activeOrg.role === "member") ? (
                      <SharedAgentButton
                        key={`${activeOrg.id}:${user.id}:${resource.id}`}
                        orgId={activeOrg.id}
                        resource={resource}
                      />
                    ) : resource.resourceKind === "tool" &&
                      resource.readiness !== "unavailable" &&
                      canUseToolPlayground(
                        user?.isPlatformAdmin === true,
                        activeOrg.role
                      ) ? (
                      <SharedToolDialog
                        key={`${activeOrg.id}:${user?.id}:${resource.id}`}
                        orgId={activeOrg.id}
                        resource={resource}
                      />
                    ) : resource.resourceKind === "model" &&
                      resource.readiness === "ready" &&
                      user &&
                      (activeOrg.role !== undefined || user.isPlatformAdmin) ? (
                      <SharedModelDialog
                        key={`${activeOrg.id}:${user.id}:${resource.id}`}
                        orgId={activeOrg.id}
                        resource={resource}
                      />
                    ) : !activeOrg.parentOrgId &&
                      resource.orgId === activeOrg.id &&
                      resource.readiness === "ready" &&
                      user &&
                      ((resource.resourceKind === "agent" &&
                        canAccessSystemPage(
                          user.isPlatformAdmin === true,
                          activeOrg.role
                        )) ||
                        (resource.resourceKind === "skill" &&
                          user.isPlatformAdmin)) ? (
                      <Button
                        aria-label={`View published ${resource.resourceKind} ${resource.label} from ${resource.sourceOrganization.name}`}
                        className="h-auto max-w-full whitespace-normal break-words text-left"
                        key={`${activeOrg.id}:${resource.id}`}
                        nativeButton={false}
                        render={
                          <Link
                            to={
                              resource.resourceKind === "agent"
                                ? profilePath(resource.resourceId)
                                : skillDetailPath(resource.resourceId)
                            }
                          />
                        }
                        size="sm"
                        variant="secondary"
                      >
                        {resource.label}
                      </Button>
                    ) : (
                      <span
                        className="max-w-full break-words rounded-full bg-muted px-2.5 py-0.5 text-muted-foreground text-xs"
                        key={resource.id}
                        title={`Shared from ${resource.sourceOrganization.name}`}
                      >
                        {resource.label}
                        {resource.readiness !== "ready" && (
                          <span className="ml-2 text-muted-foreground">
                            {READINESS_LABELS[resource.readiness]}
                          </span>
                        )}
                      </span>
                    )
                  )}
                {!sharedResources.some(
                  (resource) => resource.resourceKind === kind
                ) && (
                  <span className="text-muted-foreground text-sm">
                    None published
                  </span>
                )}
              </dd>
              {overview.data.canManageOrganization &&
                organization.id === activeOrg.id && (
                  <ResourcePublicationDialog
                    key={activeOrg.id}
                    kind={kind}
                    label={label}
                    orgId={activeOrg.id}
                    resources={sharedResources}
                  />
                )}
            </div>
          ))}
        </dl>
      </Card>
      <Card className="overflow-hidden shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b px-5 py-3">
          <div className="space-y-0.5">
            <CardTitle className="text-sm">Teams</CardTitle>
            <p className="text-muted-foreground text-xs">
              Every team starts from the shared foundation
            </p>
          </div>
          {overview.data.canManageOrganization &&
            organization.id === activeOrg.id &&
            user && (
              <AddTeamDialog
                creatorId={user.id}
                key={`${activeOrg.id}:${user.id}`}
                orgId={activeOrg.id}
              />
            )}
        </CardHeader>
        <ul className="divide-y">
          {teams.map((team) => (
            <OrganizationTeamRow
              activeOrgId={activeOrg.id}
              key={`${activeOrg.id}:${team.id}`}
              team={team}
            />
          ))}
        </ul>
        {teams.length === 0 && (
          <p className="px-5 py-4 text-muted-foreground text-sm">No teams</p>
        )}
      </Card>
    </div>
  );
}

export function OrganizationPanel() {
  const { activeOrg, user } = useAuth();

  return (
    <div className="min-w-0 space-y-8">
      <OrganizationOverview />
      {canAccessSystemPage(user?.isPlatformAdmin === true, activeOrg?.role) && (
        <>
          <h2 className="font-semibold text-xl">
            {activeOrg?.parentOrgId
              ? "Current team settings"
              : "Organization settings"}
          </h2>
          <OrgMembersCard />
          <SkillsWriteApprovalOrgCard />
          <SkillsPostTurnReviewOrgCard />
          <SkillsCuratorOrgCard />
          <OrgMemoryCard />
          <OrgArchiveCard />
        </>
      )}
    </div>
  );
}
