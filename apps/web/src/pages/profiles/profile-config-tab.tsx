import type { ProfileSummary } from "@nakama/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building06Icon,
  CloudDownloadIcon,
  Copy01Icon,
  Delete02Icon,
  MoreHorizontalIcon,
} from "hugeicons-react";
import { useState } from "react";
import { ExportProfileButton } from "@/components/profiles/ExportProfileButton";
import { ProfileSkillsSettingsSection } from "@/components/profiles/ProfileSkillsSettingsSection";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/use-auth";
import { client, formatError } from "@/lib/client";
import { queryKeys } from "@/lib/query-keys";
import { toast } from "@/lib/toast";
import { ProfileConfigAssignmentsSection } from "@/pages/profiles/profile-config-assignments-section";
import { ProfileConfigIdentitySection } from "@/pages/profiles/profile-config-identity-section";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";

export function ProfileConfigTab({ state }: { state: ProfilesPageState }) {
  const { user, activeOrg } = useAuth();

  if (!state.detail) {
    return null;
  }

  const canCreateProfile = user?.isPlatformAdmin === true;
  const canPack = activeOrg?.role === "admin" || canCreateProfile;
  const { busy, detail, selectedId } = state;

  return (
    <div
      aria-labelledby="profile-detail-tab-profile"
      id="profile-detail-panel-profile"
      role="tabpanel"
    >
      {canPack && !detail.isSuper ? (
        <div className="mb-3 flex flex-wrap justify-end gap-2">
          <Button
            aria-label="Import profile"
            disabled={busy}
            onClick={() => state.setImportOpen(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <CloudDownloadIcon aria-hidden className="size-3.5" />
            <span>Import</span>
          </Button>
          <ExportProfileButton
            disabled={busy}
            profileId={detail.id}
            profileName={detail.name}
          />
          {canCreateProfile && selectedId ? (
            <ProfileAdminMenu key={selectedId} state={state} />
          ) : null}
        </div>
      ) : null}
      <ProfileConfigIdentitySection state={state} />
      <ProfileSkillsSettingsSection disabled={busy} profile={detail} />
      <ProfileConfigAssignmentsSection state={state} />
    </div>
  );
}

function ProfileAdminMenu({ state }: { state: ProfilesPageState }) {
  const [moveOpen, setMoveOpen] = useState(false);
  const { busy, detail, selectedId } = state;
  const deleteDisabled =
    busy || (detail?.isDefault === true && state.profiles.length < 3);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label="More profile actions"
              disabled={busy}
              size="icon-sm"
              type="button"
              variant="outline"
            />
          }
        >
          <MoreHorizontalIcon aria-hidden className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={busy}
            onClick={() => setMoveOpen(true)}
          >
            <Building06Icon aria-hidden />
            Change organization
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={busy}
            onClick={() => {
              if (selectedId) {
                state.openCloneDialog(selectedId);
              }
            }}
          >
            <Copy01Icon aria-hidden />
            Clone
          </DropdownMenuItem>
          <DropdownMenuItem
            className="cursor-pointer"
            disabled={deleteDisabled}
            onClick={() => {
              if (selectedId) {
                state.openDeleteDialog(selectedId);
              }
            }}
            variant="destructive"
          >
            <Delete02Icon aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <MoveProfileDialog
        onOpenChange={setMoveOpen}
        open={moveOpen}
        state={state}
      />
    </>
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
  const organizations = useQuery({
    enabled: open,
    queryFn: () => client.listPlatformOrganizations(),
    queryKey: ["platformOrganizations"],
  });
  const move = useMutation({
    mutationFn: async () => {
      const profileId = state.detail!.id;
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
      open={open}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change organization</DialogTitle>
          <DialogDescription>
            Automations pause. Connections and shared links reset.
          </DialogDescription>
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
            <SelectValue placeholder="Choose organization" />
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
