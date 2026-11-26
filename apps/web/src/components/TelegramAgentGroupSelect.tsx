import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nakama/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAgentGroupsQuery } from "@/hooks/use-agent-groups";
import { client, formatError } from "@/lib/client";

const AGENT = "agent";

/** Who the bot answers as: its own agent, or one of the caller's Agent Groups. */
export function TelegramAgentGroupSelect({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["telegram-agent-group", profileId];
  const groups = useAgentGroupsQuery();

  const target = useQuery({
    queryFn: () => client.getTelegramAgentGroup(profileId),
    queryKey,
  });

  const save = useMutation({
    mutationFn: (groupId: string | null) =>
      client.setTelegramAgentGroup(profileId, groupId),
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  });

  const value = target.data?.groupId ?? AGENT;
  const selected = groups.data?.find((group) => group.id === value);

  return (
    <div className="space-y-1.5 py-3">
      <p className="font-medium text-sm">Answer as</p>
      <Select
        disabled={target.isLoading || save.isPending}
        onValueChange={(next) => save.mutate(next === AGENT ? null : next)}
        value={value}
      >
        <SelectTrigger aria-label="Answer as" className="w-64">
          <SelectValue>
            {value === AGENT ? "This agent" : (selected?.name ?? "Agent Group")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AGENT}>This agent</SelectItem>
          {groups.data?.map((group) => (
            <SelectItem key={group.id} value={group.id}>
              {group.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">
        An Agent Group answers as you: every member can reply, and each reply
        starts with the agent's @handle.
      </p>
      {save.error ? (
        <p className="text-destructive text-xs">{formatError(save.error)}</p>
      ) : null}
    </div>
  );
}
