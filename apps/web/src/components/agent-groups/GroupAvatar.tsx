import type { ProfileSummary } from "@nakama/core";
import type { AgentGroup } from "@nakama/core/agent-groups";
import { cn } from "@nakama/ui/utils";
import { UserGroupIcon } from "hugeicons-react";
import { useState } from "react";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { groupAvatarUrl } from "@/hooks/use-agent-groups";

/** The custom image when there is one, else two members' avatars stacked. */
export function GroupAvatar({
  className,
  group,
  profiles,
}: {
  className?: string;
  group: AgentGroup;
  profiles: ProfileSummary[];
}) {
  const url = groupAvatarUrl(group);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const faces = group.memberIds
    .flatMap((id) => profiles.find((profile) => profile.id === id) ?? [])
    .slice(0, 2);

  if (url && url !== failedUrl) {
    return (
      <img
        alt=""
        className={cn("size-7 shrink-0 rounded-md object-cover", className)}
        onError={() => setFailedUrl(url)}
        src={url}
      />
    );
  }

  return (
    <span className={cn("relative block size-7 shrink-0", className)}>
      {faces[0] && faces[1] ? (
        <>
          <ProfileAvatar
            className="absolute top-0 left-0 size-[64%] rounded-[5px] outline-none"
            profile={faces[0]}
            size="xxs"
          />
          <ProfileAvatar
            className="absolute right-0 bottom-0 size-[64%] rounded-[5px] outline-none"
            profile={faces[1]}
            size="xxs"
          />
        </>
      ) : (
        <UserGroupIcon className="absolute inset-0 m-auto size-[57%]" />
      )}
    </span>
  );
}
