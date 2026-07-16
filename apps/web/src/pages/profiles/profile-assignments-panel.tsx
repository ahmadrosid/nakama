import { PlusIcon, Trash2Icon } from "lucide-react";
import { ComposioToolkitAssignPicker } from "@/components/ComposioToolkitAssignPicker";
import { McpServerAssignPicker } from "@/components/McpServerAssignPicker";
import { SkillAssignPicker } from "@/components/SkillAssignPicker";
import { ToolAssignDialog } from "@/components/ToolAssignDialog";
import { Button } from "@/components/ui/button";
import type { ProfilesPageState } from "@/pages/profiles/use-profiles-page";

export function ProfileAssignmentsPanel({ state }: { state: ProfilesPageState }) {
  const {
    detail,
    busy,
    availableTools,
    handleAssignTool,
    setRemoveConfirm,
    allMcpServers,
    availableMcpServers,
    setMcpCreateOpen,
    handleAssignMcpServer,
    composioToolkitsData,
    assignedComposioToolkits,
    availableComposioToolkits,
    handleAssignComposioToolkit,
    allSkills,
    assignedSkillIds,
    setSkillCreateOpen,
    handleAssignSkill,
    handleDeleteSkill,
    setDetailSkillId,
  } = state;

  if (!detail) {
    return null;
  }

  return (
    <>
                    <div className="pt-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="type-section-title">Tools</h3>
                          <p className="type-body mt-1 text-xs">
                            {detail.tools.length === 0
                              ? "No tools assigned to this profile."
                              : `${detail.tools.length} assigned`}
                          </p>
                        </div>
                        <ToolAssignDialog
                          tools={availableTools}
                          disabled={busy}
                          onAssign={handleAssignTool}
                        />
                      </div>

                      {detail.tools.length === 0 ? (
                        <p className="type-body text-xs">No tools assigned.</p>
                      ) : (
                        <ul className="divide-y divide-border rounded-md border border-border">
                          {detail.tools.map((tool) => (
                            <li
                              key={tool.id}
                              className="flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium leading-tight text-foreground">
                                  {tool.name}
                                </p>
                                <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground">
                                  {tool.description}
                                </p>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                                disabled={busy}
                                aria-label={`Delete ${tool.name}`}
                                onClick={() =>
                                  setRemoveConfirm({ kind: "tool", id: tool.id, name: tool.name })
                                }
                              >
                                <Trash2Icon className="size-4" aria-hidden />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

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
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setMcpCreateOpen(true)}
                          >
                            <PlusIcon className="size-4" aria-hidden />
                            Add MCP server
                          </Button>
                          <McpServerAssignPicker
                            servers={availableMcpServers}
                            disabled={busy}
                            buttonLabel="Assign existing"
                            onAssign={handleAssignMcpServer}
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
                                onClick={() =>
                                  setRemoveConfirm({ kind: "mcp", id: server.id, name: server.name })
                                }
                              >
                                <Trash2Icon className="size-4" aria-hidden />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {composioToolkitsData?.configured ? (
                      <div className="pt-5">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h3 className="type-section-title">Composio toolkits</h3>
                            {assignedComposioToolkits.length > 0 ? (
                              <p className="type-body mt-1 text-xs">
                                {assignedComposioToolkits.length} assigned
                              </p>
                            ) : null}
                          </div>
                          <ComposioToolkitAssignPicker
                            toolkits={availableComposioToolkits}
                            disabled={busy}
                            buttonLabel="Assign toolkit"
                            onAssign={handleAssignComposioToolkit}
                          />
                        </div>

                        {composioToolkitsData.orgToolkits.length === 0 ? (
                          <p className="type-body text-xs text-muted-foreground">
                            Ask an org admin to enable apps on Integrations first.
                          </p>
                        ) : assignedComposioToolkits.length === 0 ? null : (
                          <ul className="divide-y divide-border rounded-md border border-border">
                            {assignedComposioToolkits.map(({ toolkit, userConnection }) => (
                              <li
                                key={toolkit.id}
                                className="flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium leading-tight text-foreground">
                                    {toolkit.displayName}
                                  </p>
                                  <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                                    Org: {toolkit.status}
                                    {userConnection?.status === "connected"
                                      ? " · You: connected"
                                      : " · You: not connected — connect on Integrations"}
                                    {toolkit.cachedTools.length > 0
                                      ? ` · ${toolkit.cachedTools.length} tool${toolkit.cachedTools.length === 1 ? "" : "s"}`
                                      : ""}
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-sm"
                                  className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                                  disabled={busy}
                                  aria-label={`Remove ${toolkit.displayName}`}
                                  onClick={() =>
                                    setRemoveConfirm({
                                      kind: "composio",
                                      id: toolkit.id,
                                      name: toolkit.displayName,
                                    })
                                  }
                                >
                                  <Trash2Icon className="size-4" aria-hidden />
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : null}

                    <div className="pt-5">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="type-section-title">Skills</h3>
                          {detail.skills.length > 0 ? (
                            <p className="type-body mt-1 text-xs">
                              {detail.skills.length} assigned
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setSkillCreateOpen(true)}
                          >
                            Add skill
                          </Button>
                          <SkillAssignPicker
                            skills={allSkills}
                            assignedSkillIds={assignedSkillIds}
                            disabled={busy}
                            buttonLabel="Manage skills"
                            onAssign={handleAssignSkill}
                            onDelete={handleDeleteSkill}
                          />
                        </div>
                      </div>

                      {allSkills.length === 0 ? (
                        <p className="type-body text-xs text-muted-foreground">
                          Create one above, or add{" "}
                          <code className="rounded bg-muted px-1 py-0.5">SKILL.md</code> folders to{" "}
                          <code className="rounded bg-muted px-1 py-0.5">agent/skills</code>.
                        </p>
                      ) : detail.skills.length === 0 ? null : (
                        <ul className="divide-y divide-border rounded-md border border-border">
                          {detail.skills.map((skill) => (
                            <li
                              key={skill.id}
                              className="group flex items-center justify-between gap-2 px-3 py-2 first:rounded-t-md last:rounded-b-md hover:bg-muted/40"
                            >
                              <button
                                type="button"
                                disabled={busy}
                                className="flex min-w-0 flex-1 items-start text-left disabled:opacity-50"
                                aria-label={`View details for ${skill.name}`}
                                onClick={() => setDetailSkillId(skill.id)}
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium leading-tight text-foreground">
                                    {skill.name}
                                  </p>
                                  <p className="mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground">
                                    {[
                                      skill.description,
                                      skill.hasTool ? "includes tool" : null,
                                      skill.disableModelInvocation ? "explicit invoke only" : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")}
                                  </p>
                                </div>
                              </button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                                disabled={busy}
                                aria-label={`Delete ${skill.name}`}
                                onClick={() =>
                                  setRemoveConfirm({ kind: "skill", id: skill.id, name: skill.name })
                                }
                              >
                                <Trash2Icon className="size-4" aria-hidden />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

    </>
  );
}
