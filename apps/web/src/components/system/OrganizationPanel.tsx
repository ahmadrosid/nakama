import { Button } from "@nakama/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@nakama/ui/card";
import { toast } from "@nakama/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OrgArchiveCard } from "@/components/settings/OrgArchiveCard";
import { OrgMembersCard } from "@/components/settings/OrgMembersCard";
import { OrgMemoryCard } from "@/components/settings/OrgMemoryCard";
import { SkillsCuratorOrgCard } from "@/components/settings/SkillsCuratorOrgCard";
import { SkillsPostTurnReviewOrgCard } from "@/components/settings/SkillsPostTurnReviewOrgCard";
import { SkillsWriteApprovalOrgCard } from "@/components/settings/SkillsWriteApprovalOrgCard";
import { useAuth } from "@/context/use-auth";
import { useProfilesQuery } from "@/hooks/use-app-queries";
import { client, formatError } from "@/lib/client";

export function OrganizationPanel() {
  return (
    <div className="min-w-0 space-y-8">
      <OrgMembersCard />
      <SkillsWriteApprovalOrgCard />
      <SkillsPostTurnReviewOrgCard />
      <SkillsCuratorOrgCard />
      <OrgMemoryCard />
      <KnowledgeIndexOrgCard />
      <OrgArchiveCard />
    </div>
  );
}

function KnowledgeIndexOrgCard() {
  const { activeOrg, user } = useAuth();
  const { data: profiles = [] } = useProfilesQuery();
  const profile = profiles.find((item) => !item.isSuper) ?? profiles[0];
  const queryClient = useQueryClient();
  const index = useQuery({
    enabled: Boolean(
      profile && (activeOrg?.role === "admin" || user?.isPlatformAdmin)
    ),
    queryFn: () => client.getKnowledgeIndex(profile!.id),
    queryKey: ["knowledge-index", profile?.id],
    refetchInterval: 5000,
  });
  const change = useMutation({
    mutationFn: (action: "enable" | "disable" | "backfill" | "retry") =>
      client.changeKnowledgeIndex(profile!.id, action),
    onError: (error) => toast(formatError(error)),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["knowledge-index", profile?.id],
      }),
  });
  if (!(activeOrg?.role === "admin" || user?.isPlatformAdmin)) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Knowledge index</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          {profile
            ? index.data
              ? `${index.data.status.replace("_", " ")} · ${index.data.indexedCount}/${index.data.readyCount} ready for ${profile.name}`
              : "Loading index status"
            : "Create a profile to enable indexing"}
        </p>
        <p className="text-muted-foreground text-xs">
          {index.data?.provider ?? "No supported model"} · 4,000 input bytes and
          300 output tokens per document · six documents per approved batch
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!profile || change.isPending || !index.data}
            onClick={() =>
              change.mutate(index.data!.enabled ? "disable" : "enable")
            }
            size="sm"
            variant="outline"
          >
            {index.data?.enabled ? "Turn off" : "Enable index"}
          </Button>
          {index.data?.enabled ? (
            <>
              <Button
                disabled={change.isPending}
                onClick={() => change.mutate("backfill")}
                size="sm"
                variant="outline"
              >
                Index existing documents
              </Button>
              <Button
                disabled={
                  change.isPending ||
                  index.data.status === "updating" ||
                  index.data.failed + index.data.pending === 0
                }
                onClick={() => change.mutate("retry")}
                size="sm"
                variant="outline"
              >
                Approve next batch
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
