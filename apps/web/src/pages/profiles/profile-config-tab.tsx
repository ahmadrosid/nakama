import { CloudDownloadIcon, Copy01Icon, Delete02Icon } from "hugeicons-react";
import { ExportProfileButton } from "@/components/profiles/ExportProfileButton";
import { ProfileSkillsSettingsSection } from "@/components/profiles/ProfileSkillsSettingsSection";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/use-auth";
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
          <ExportProfileButton disabled={busy} profileId={detail.id} />
          {canCreateProfile && selectedId ? (
            <>
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
                disabled={busy}
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
