import type { OrgPluginDetail } from "@nakama/core/contract";
import { Button } from "@nakama/ui/button";
import { Checkbox } from "@nakama/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nakama/ui/dialog";
import { Input } from "@nakama/ui/input";
import { Spinner } from "@nakama/ui/spinner";
import { Search01Icon } from "hugeicons-react";
import { type Dispatch, type SetStateAction, useState } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import {
  pluginAgentAccessState,
  usePluginAgentAccess,
  useSavePluginAgentAccess,
} from "@/hooks/use-plugins";
import { formatError } from "@/lib/client";

export function PluginAgentAccessDialog({
  plugin,
  onClose,
}: {
  plugin: OrgPluginDetail;
  onClose(): void;
}) {
  const access = usePluginAgentAccess();
  const save = useSavePluginAgentAccess();
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const data = access.data;

  const hasResources =
    data &&
    [...data.tools, ...data.skills].some(
      (item) => item.pluginId === plugin.pluginId
    );

  const busy = save.isPending;

  const pendingChanges = Object.fromEntries(
    Object.entries(changes).filter(([id, selected]) => {
      const profile = data?.profiles.find((item) => item.id === id);

      if (!(profile && data)) {
        return false;
      }

      const state = pluginAgentAccessState(profile, plugin.pluginId, data);

      return selected ? !state.full : state.assigned > 0;
    })
  );

  async function onSave() {
    try {
      await save.mutateAsync({
        changes: pendingChanges,
        pluginId: plugin.pluginId,
      });
      onClose();
    } catch {
      // Keep the selection available for retry after refreshing assignments.
    }
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!(open || busy)) {
          onClose();
        }
      }}
      open
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose agents that can use this plugin</DialogTitle>
          <DialogDescription>
            {plugin.name} — selected agents receive all of this plugin’s tools
            and skills.
          </DialogDescription>
        </DialogHeader>
        {access.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-5" />
          </div>
        ) : null}
        {access.error ? (
          <div className="space-y-2">
            <p className="text-destructive text-sm" role="alert">
              {formatError(access.error)}
            </p>
            <Button
              disabled={access.isFetching}
              onClick={() => void access.refetch()}
              size="sm"
              variant="outline"
            >
              Retry
            </Button>
          </div>
        ) : null}
        {data &&
          !access.error &&
          (hasResources ? (
            <PluginAgentAccessList
              busy={busy}
              changes={changes}
              data={data}
              pluginId={plugin.pluginId}
              setChanges={setChanges}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              This plugin has nothing for agents to use.
            </p>
          ))}
        {save.error ? (
          <p className="text-destructive text-sm" role="alert">
            {formatError(save.error)} Some changes may have been saved. Review
            the selection and retry.
          </p>
        ) : null}
        <DialogFooter>
          <Button disabled={busy} onClick={onClose} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              access.isFetching ||
              Boolean(access.error) ||
              !hasResources ||
              Object.keys(pendingChanges).length === 0
            }
            onClick={() => void onSave()}
          >
            {busy ? <Spinner className="size-4" /> : null}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PluginAgentAccessList({
  busy,
  changes,
  data,
  pluginId,
  setChanges,
}: {
  busy: boolean;
  changes: Record<string, boolean>;
  data: NonNullable<ReturnType<typeof usePluginAgentAccess>["data"]>;
  pluginId: string;
  setChanges: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  const [query, setQuery] = useState("");

  const profiles = data.profiles;

  const isSelected = (profile: (typeof profiles)[number]) =>
    changes[profile.id] ?? pluginAgentAccessState(profile, pluginId, data).full;

  const needle = query.trim().toLowerCase();

  const shown = profiles.filter((profile) =>
    profile.name.toLowerCase().includes(needle)
  );

  const selectedCount = profiles.filter(isSelected).length;

  const allShownSelected = shown.length > 0 && shown.every(isSelected);
  const someShownSelected = shown.some(isSelected);

  function selectShown(selected: boolean) {
    setChanges((current) => ({
      ...current,
      ...Object.fromEntries(shown.map((profile) => [profile.id, selected])),
    }));
  }

  return (
    <div className="space-y-3">
      {profiles.length > 0 ? (
        <>
          <div className="relative">
            <Search01Icon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              aria-label="Search agents"
              className="pl-9"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents"
              value={query}
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-border border-y px-2 py-1.5">
            <label className="flex cursor-pointer items-center gap-3 font-medium text-sm">
              <Checkbox
                checked={allShownSelected}
                disabled={busy || shown.length === 0}
                indeterminate={someShownSelected && !allShownSelected}
                onCheckedChange={selectShown}
              />
              Select all
            </label>
            <span className="text-muted-foreground text-xs">
              {selectedCount} of {profiles.length} selected
            </span>
          </div>
        </>
      ) : null}
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {profiles.length === 0 ? (
          <p className="py-4 text-muted-foreground text-sm">
            No agents in this organization.
          </p>
        ) : null}
        {profiles.length > 0 && shown.length === 0 ? (
          <p className="py-4 text-center text-muted-foreground text-sm">
            No agents match.
          </p>
        ) : null}
        {shown.map((profile) => {
          const state = pluginAgentAccessState(profile, pluginId, data);

          const partial =
            changes[profile.id] === undefined &&
            state.assigned > 0 &&
            !state.full;

          return (
            <label
              className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/50"
              key={profile.id}
            >
              <Checkbox
                checked={changes[profile.id] ?? state.full}
                disabled={busy}
                indeterminate={partial}
                onCheckedChange={(checked) =>
                  setChanges((current) => ({
                    ...current,
                    [profile.id]: checked,
                  }))
                }
              />
              <ProfileAvatar profile={profile} size="sm" />
              <span className="min-w-0 flex-1 break-words text-sm">
                {profile.name}
              </span>
              {partial ? (
                <span className="text-muted-foreground text-xs">
                  Partial access
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
