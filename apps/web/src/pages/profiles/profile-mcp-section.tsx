import { PlusIcon, Trash2Icon } from "lucide-react";
import { McpServerAssignPicker } from "@/components/McpServerAssignPicker";
import { Button } from "@/components/ui/button";
import type { McpServerSummary, ProfileDetail } from "@nakama/core/contract";
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
            <p className="type-body mt-1 text-xs">{detail.mcpServers.length} assigned</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCreateOpen}>
            <PlusIcon className="size-4" aria-hidden />
            Add MCP server
          </Button>
          <McpServerAssignPicker
            servers={availableMcpServers}
            disabled={busy}
            buttonLabel="Assign existing"
            onAssign={onAssign}
          />
        </div>
      </div>

      {allMcpServers.length === 0 ? (
        <p className="type-body text-xs text-muted-foreground">
          Connect HTTP or command-based MCP servers.
        </p>
      ) : detail.mcpServers.length === 0 ? null : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {detail.mcpServers.map((server) => (
            <li
              key={server.id}
              className="flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium leading-tight text-foreground">
                  {server.name}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {server.transport} · {server.toolCount} tool
                  {server.toolCount === 1 ? "" : "s"}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                disabled={busy}
                aria-label={`Delete ${server.name}`}
                onClick={() => onRemove({ kind: "mcp", id: server.id, name: server.name })}
              >
                <Trash2Icon className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
