import type {
  CreateMcpServerRequest,
  ProfileSummary,
  ToolSetupPlan,
} from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { McpServerDialog } from "@/components/soul-tools/mcp-tab/McpServerDialog";
import { ToolAssignDialog } from "@/components/ToolAssignDialog";
import { useAuth } from "@/context/use-auth";
import {
  useMcpServersQuery,
  useProfileQuery,
  useProfilesQuery,
  useSkillsQuery,
  useToolsQuery,
} from "@/hooks/use-app-queries";
import {
  pluginAgentAccessState,
  useOrgPlugins,
  useSavePluginAgentAccess,
} from "@/hooks/use-plugins";
import {
  useAssignMcpServerMutation,
  useAssignToolMutation,
  useCreateMcpServerMutation,
} from "@/hooks/use-resource-mutations";
import { client, formatError } from "@/lib/client";

export function ToolCredentialCard({
  result,
  sessionId,
  disabled,
  onContinue,
}: {
  result: unknown;
  sessionId?: string;
  disabled?: boolean;
  onContinue?: (setupId: string) => Promise<void>;
}) {
  const { user, activeOrg } = useAuth();
  if (!result || typeof result !== "object") {
    return null;
  }
  const value = result as Record<string, unknown>;
  if (
    value.type === "tool_setup_required" &&
    typeof value.setupId === "string" &&
    typeof value.orgId === "string" &&
    value.orgId === activeOrg?.id
  ) {
    return (
      <ToolSetupCard
        canManage={user?.isPlatformAdmin === true || activeOrg.role === "admin"}
        disabled={disabled}
        key={`${value.orgId}:${value.setupId}`}
        onContinue={onContinue}
        orgId={value.orgId}
        sessionId={sessionId}
        setupId={value.setupId}
      />
    );
  }
  if (
    value.type !== "tool_credentials_required" ||
    typeof value.toolId !== "string" ||
    typeof value.toolName !== "string" ||
    typeof value.orgId !== "string" ||
    value.orgId !== activeOrg?.id
  ) {
    return null;
  }
  return (
    <ToolCredentialForm
      canManage={user?.isPlatformAdmin === true || activeOrg.role === "admin"}
      key={`${value.orgId}:${value.toolId}`}
      orgId={value.orgId}
      toolId={value.toolId}
      toolName={value.toolName}
    />
  );
}

function ToolSetupCard({
  setupId,
  orgId,
  sessionId,
  canManage,
  disabled,
  onContinue,
}: {
  setupId: string;
  orgId: string;
  sessionId?: string;
  canManage: boolean;
  disabled?: boolean;
  onContinue?: (setupId: string) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["tool-setup", orgId, setupId];
  const setup = useQuery({
    enabled: canManage,
    queryFn: () => client.forOrg(orgId).getToolSetup(setupId),
    queryKey,
    refetchInterval: (query) =>
      query.state.data?.status === "approved" ? 2000 : false,
  });
  const profiles = useProfilesQuery();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = saving || disabled;
  const plan = setup.data;
  if (!canManage) {
    return (
      <p className="text-muted-foreground text-sm">
        Ask an admin to create and connect this tool.
      </p>
    );
  }
  if (!plan) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {setup.isError ? "Could not load tool setup." : "Loading tool setup…"}
      </p>
    );
  }
  if (plan.sessionId !== sessionId) {
    return (
      <p className="text-muted-foreground text-sm">
        Open the original chat to complete this tool setup.
      </p>
    );
  }
  if (plan.status === "ready") {
    return (
      <div className="w-full max-w-sm rounded-xl border bg-card p-4">
        <p className="font-medium text-sm">{plan.name}</p>
        <p className="text-sm" role="status">
          Ready
        </p>
      </div>
    );
  }
  if (!profiles.data) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {profiles.isError ? "Could not load agents." : "Loading agents…"}
      </p>
    );
  }
  const approved = plan.status === "approved";
  const buttonLabel = approved ? "Continue build" : "Create & connect";
  return (
    <form
      className="flex w-full max-w-md flex-col gap-4 rounded-xl border bg-card p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (locked || !onContinue) {
          return;
        }
        const form = event.currentTarget;
        const values = new FormData(form);
        setSaving(true);
        setError(null);
        try {
          if (!approved) {
            const saved = await client.forOrg(orgId).approveToolSetup(setupId, {
              profileId: String(values.get("profileId") ?? "") || undefined,
              ...(plan.requiresApiKey
                ? { apiKey: String(values.get("apiKey") ?? "") }
                : {}),
            });
            queryClient.setQueryData(queryKey, saved);
          }
          form.reset();
          await onContinue(setupId);
          await queryClient.invalidateQueries({ queryKey });
          await queryClient.invalidateQueries({ queryKey: ["profiles"] });
        } catch (error) {
          setError(formatError(error));
        } finally {
          form.reset();
          setSaving(false);
        }
      }}
    >
      <p className="font-medium">{plan.name}</p>
      <p className="whitespace-pre-wrap text-sm">{plan.plan}</p>
      <ToolSetupFields disabled={locked} plan={plan} profiles={profiles.data} />
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : null}
      <Button disabled={locked || !onContinue} type="submit">
        {saving ? "Building…" : buttonLabel}
      </Button>
    </form>
  );
}

function ToolSetupFields({
  disabled,
  plan,
  profiles,
}: {
  disabled?: boolean;
  plan: ToolSetupPlan;
  profiles: ProfileSummary[];
}) {
  const fieldId = useId();
  if (plan.status === "approved") {
    return null;
  }
  return (
    <>
      <div className="space-y-2">
        <label className="text-sm" htmlFor={`${fieldId}-profile`}>
          Agent
        </label>
        <select
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          defaultValue={plan.profileId ?? ""}
          disabled={disabled}
          id={`${fieldId}-profile`}
          name="profileId"
        >
          <option value="">Assign later</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </div>
      {plan.requiresApiKey ? (
        <div className="space-y-2">
          <label className="text-sm" htmlFor={`${fieldId}-key`}>
            API key
          </label>
          <Input
            autoComplete="off"
            disabled={disabled}
            id={`${fieldId}-key`}
            maxLength={8192}
            name="apiKey"
            required
            type="password"
          />
        </div>
      ) : null}
    </>
  );
}

function ToolCredentialForm({
  toolId,
  toolName,
  orgId,
  canManage,
}: {
  toolId: string;
  toolName: string;
  orgId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const queryClient = useQueryClient();
  const queryKey = ["tool-credentials", orgId, toolId];
  const status = useQuery({
    enabled: canManage,
    queryFn: () => client.forOrg(orgId).getToolCredentialStatus(toolId),
    queryKey,
  });

  return (
    <div className="flex w-full max-w-sm items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <div className="min-w-0">
        <p className="truncate font-medium text-sm">{toolName}</p>
        <p className="text-muted-foreground text-xs" role="status">
          {canManage
            ? status.data?.configured
              ? "API key saved"
              : "Connect API key"
            : "Ask an admin to connect the API key"}
        </p>
      </div>
      {canManage ? (
        <Dialog
          onOpenChange={(next) => {
            if (!saving) {
              setOpen(next);
              setError(null);
            }
          }}
          open={open}
        >
          <DialogTrigger render={<Button size="sm" variant="outline" />}>
            {status.data?.configured ? "Replace key" : "Configure"}
          </DialogTrigger>
          {open ? (
            <DialogContent aria-describedby={undefined} className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Connect {toolName}</DialogTitle>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (saving) {
                    return;
                  }
                  const form = event.currentTarget;
                  const apiKey = String(new FormData(form).get("apiKey") ?? "");
                  form.reset();
                  setSaving(true);
                  setError(null);
                  try {
                    const saved = await client
                      .forOrg(orgId)
                      .saveToolCredential(toolId, apiKey);
                    queryClient.setQueryData(queryKey, saved);
                    setOpen(false);
                  } catch {
                    setError(
                      "Could not save the API key. Enter it again to retry."
                    );
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <div className="space-y-2">
                  <label className="font-medium text-sm" htmlFor={inputId}>
                    API key
                  </label>
                  <Input
                    autoComplete="off"
                    disabled={saving}
                    id={inputId}
                    maxLength={8192}
                    name="apiKey"
                    required
                    type="password"
                  />
                </div>
                {error ? (
                  <p className="text-destructive text-sm" role="alert">
                    {error}
                  </p>
                ) : null}
                <Button disabled={saving} type="submit">
                  {saving ? "Saving…" : "Save"}
                </Button>
              </form>
            </DialogContent>
          ) : null}
        </Dialog>
      ) : null}
    </div>
  );
}

export function ChatAddCapabilitiesDialogs({
  pluginOpen,
  onPluginOpenChange,
  mcpOpen,
  onMcpOpenChange,
  onToolOpenChange,
  profileId,
  toolOpen,
}: {
  pluginOpen: boolean;
  onPluginOpenChange(open: boolean): void;
  mcpOpen: boolean;
  onMcpOpenChange: (open: boolean) => void;
  onToolOpenChange: (open: boolean) => void;
  profileId: string;
  toolOpen: boolean;
}) {
  const { data: tools = [] } = useToolsQuery();
  const { data: servers = [] } = useMcpServersQuery();
  const { data: profile } = useProfileQuery(profileId);
  const assignToolMutation = useAssignToolMutation();
  const assignMcpMutation = useAssignMcpServerMutation();
  const createMcpMutation = useCreateMcpServerMutation();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const assignedToolIds = new Set(profile?.tools.map((tool) => tool.id) ?? []);
  const assignedMcpIds = new Set(
    profile?.mcpServers.map((server) => server.id) ?? []
  );
  const availableTools = tools.filter((tool) => !assignedToolIds.has(tool.id));
  const availableMcpServers = servers.filter(
    (server) => !assignedMcpIds.has(server.id)
  );
  const busy =
    assignToolMutation.isPending ||
    assignMcpMutation.isPending ||
    createMcpMutation.isPending;

  async function handleAssignTool(toolId: string) {
    setError(null);
    setNotice(null);

    try {
      await assignToolMutation.mutateAsync({ profileId, toolId });
      onToolOpenChange(false);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleAssignMcp(serverId: string) {
    setError(null);
    setNotice(null);

    try {
      await assignMcpMutation.mutateAsync({ profileId, serverId });
      onMcpOpenChange(false);
    } catch (err) {
      setError(formatError(err));
    }
  }

  async function handleCreateMcp(request: CreateMcpServerRequest) {
    setError(null);
    setNotice(null);

    try {
      const response = await createMcpMutation.mutateAsync({
        ...request,
        connect: true,
      });
      await assignMcpMutation.mutateAsync({
        profileId,
        serverId: response.server.id,
      });
      onMcpOpenChange(false);
    } catch (err) {
      const message = formatError(err);
      setError(message);
      throw new Error(message);
    }
  }

  async function handleTestMcp(server: (typeof availableMcpServers)[number]) {
    setError(null);

    try {
      const result = await client.testMcpServer({
        config: server.transport === "http" ? { url: "" } : { command: "" },
        name: server.name,
        serverId: server.id,
        transport: server.transport,
      });
      if (result.ok) {
        setNotice(
          `Connection successful. Found ${result.toolCount} tool${result.toolCount === 1 ? "" : "s"}.`
        );
      } else {
        setError(result.error ?? "Connection test failed.");
      }
    } catch (err) {
      setError(formatError(err));
    }
  }

  return (
    <>
      {pluginOpen ? (
        <ChatPluginDialog
          onOpenChange={onPluginOpenChange}
          profileId={profileId}
        />
      ) : null}
      <ToolAssignDialog
        disabled={busy}
        error={toolOpen ? error : null}
        hideTrigger
        onAssign={handleAssignTool}
        onOpenChange={(open) => {
          if (!open) {
            setError(null);
          }
          onToolOpenChange(open);
        }}
        open={toolOpen}
        tools={availableTools}
      />
      <McpServerDialog
        availableServers={availableMcpServers}
        busy={busy}
        error={mcpOpen ? (error ?? notice) : null}
        onAssign={handleAssignMcp}
        onOpenChange={(open) => {
          if (!open) {
            setError(null);
          }
          onMcpOpenChange(open);
        }}
        onSubmit={handleCreateMcp}
        onTestConnection={(server) => void handleTestMcp(server)}
        open={mcpOpen}
      />
    </>
  );
}

function ChatPluginDialog({
  profileId,
  onOpenChange,
}: {
  profileId: string;
  onOpenChange(open: boolean): void;
}) {
  const { user } = useAuth();
  const plugins = useOrgPlugins();
  const profile = useProfileQuery(profileId);
  const tools = useToolsQuery();
  const skills = useSkillsQuery();
  const save = useSavePluginAgentAccess();
  if (!user?.isPlatformAdmin) {
    return null;
  }
  const loading =
    plugins.isLoading ||
    profile.isLoading ||
    tools.isLoading ||
    skills.isLoading;
  const error =
    save.error || plugins.error || profile.error || tools.error || skills.error;
  const enabled = (plugins.data ?? []).filter(
    (plugin) => plugin.installed && plugin.lifecycleState === "enabled"
  );
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!save.isPending) {
          onOpenChange(open);
        }
      }}
      open
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add plugin</DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {formatError(error)}
          </p>
        ) : null}
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading plugins…</p>
        ) : (
          <ul className="max-h-80 divide-y divide-border overflow-auto">
            {enabled.map((plugin) => {
              const assigned =
                profile.data &&
                pluginAgentAccessState(profile.data, plugin.pluginId, {
                  skills: skills.data ?? [],
                  tools: tools.data ?? [],
                });
              return (
                <li
                  className="flex items-center justify-between gap-3 py-3"
                  key={plugin.pluginId}
                >
                  <span className="font-medium text-sm">{plugin.name}</span>
                  <Button
                    disabled={
                      !assigned ||
                      assigned.full ||
                      assigned.total === 0 ||
                      save.isPending
                    }
                    onClick={() =>
                      save.mutate({
                        changes: { [profileId]: true },
                        pluginId: plugin.pluginId,
                      })
                    }
                    size="sm"
                  >
                    {assigned?.full ? "Enabled" : "Enable"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {!loading && enabled.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No enabled plugins available.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
