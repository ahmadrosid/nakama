import type { McpServerSummary, ProfileDetail } from "@nakama/core/contract";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { McpServerAssignPicker } from "@/components/McpServerAssignPicker";
import { Button } from "@/components/ui/button";
import type { RemoveAssignmentTarget } from "@/pages/profiles/profiles-page.shared";

export function ProfileMcpSection({
  detail,
  busy,
  allMcpServers,
  availableMcpServers,
  onCreateOpen,
  onAssign,
  onRemove,
}: {
  detail: ProfileDetail;
  busy: boolean;
  allMcpServers: McpServerSummary[];
  availableMcpServers: McpServerSummary[];
  onCreateOpen: () => void;
  onAssign: (serverId: string) => void;
  onRemove: (target: RemoveAssignmentTarget) => void;
}) {
  return (
    <div className="pt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="type-section-title">MCP servers</h3>
          {detail.mcpServers.length > 0 ? (
            <p className="type-body mt-1 text-xs">
              {detail.mcpServers.length} assigned
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy}
            onClick={onCreateOpen}
            size="sm"
            type="button"
            variant="outline"
          >
            <PlusIcon aria-hidden className="size-4" />
            Add MCP server
          </Button>
          <McpServerAssignPicker
            buttonLabel="Assign existing"
            disabled={busy}
            onAssign={onAssign}
            servers={availableMcpServers}
          />
        </div>
      </div>

      {allMcpServers.length === 0 ? (
        <p className="type-body text-muted-foreground text-xs">
          Connect HTTP or command-based MCP servers.
        </p>
      ) : detail.mcpServers.length === 0 ? null : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {detail.mcpServers.map((server) => (
            <li
              className="flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md"
              key={server.id}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground text-sm leading-tight">
                  {server.name}
                </p>
                <p className="mt-0.5 text-muted-foreground text-xs leading-snug">
                  {server.transport} · {server.toolCount} tool
                  {server.toolCount === 1 ? "" : "s"}
                </p>
              </div>
              <Button
                aria-label={`Delete ${server.name}`}
                className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                disabled={busy}
                onClick={() =>
                  onRemove({ id: server.id, kind: "mcp", name: server.name })
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2Icon aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
