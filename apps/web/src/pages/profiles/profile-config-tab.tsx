import type { ProfileSummary } from "@nakama/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownloadIcon, Copy01Icon, Delete02Icon } from "hugeicons-react";
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
            <>
              <MoveProfileButton key={selectedId} state={state} />
              <Button
                aria-label="Clone profile"
                disabled={busy}
                onClick={() => state.openCloneDialog(selectedId)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Copy01Icon aria-hidden className="size-3.5" />
                <span>Clone</span>
              </Button>
              <Button
                aria-label="Delete profile"
                className="text-destructive hover:text-destructive"
                disabled={
                  busy ||
                  (detail.isDefault === true && state.profiles.length < 3)
                }
                onClick={() => state.openDeleteDialog(selectedId)}
                size="sm"
                type="button"
                variant="outline"
              >
                <Delete02Icon aria-hidden className="size-3.5" />
                <span>Delete</span>
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      <ProfileConfigIdentitySection state={state} />
      <ProfileSkillsSettingsSection disabled={busy} profile={detail} />
      <ProfileConfigAssignmentsSection state={state} />
    </div>
  );
}

function MoveProfileButton({ state }: { state: ProfilesPageState }) {
  const { activeOrg } = useAuth();
  const [open, setOpen] = useState(false);
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
        throw new Error("Save profile changes before moving.");
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
      setOpen(false);
      toast("Profile moved.");
      await queryClient.invalidateQueries();
    },
  });
  const destinations =
    organizations.data?.organizations.filter(
      (org) => org.id !== activeOrg?.id && !org.archivedAt
    ) ?? [];
  return (
    <>
      <Button
        disabled={state.busy || move.isPending}
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        Move
      </Button>
      <Dialog
        onOpenChange={(next) => {
          if (!move.isPending) {
            setOpen(next);
          }
        }}
        open={open}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move {state.detail?.name}</DialogTitle>
            <DialogDescription>
              Move this profile, workspace, and chats to another organization.
              Automations and workflows move paused. Organization connections
              need reconnecting, and shared links are revoked.
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
              onClick={() => setOpen(false)}
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
              {move.isPending ? "Moving…" : "Move profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
