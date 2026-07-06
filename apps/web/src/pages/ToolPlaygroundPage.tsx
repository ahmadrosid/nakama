import type { ToolDetail } from "@nakama/core/contract";
import { ChevronLeftIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ToolDetailSections } from "@/components/tools/ToolDetailSections";
import {
  ToolPlaygroundOutput,
  ToolPlaygroundRunForm,
  useToolPlaygroundRun,
} from "@/components/tools/ToolPlaygroundPanel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/auth-context";
import { useProfilesQuery, useToolQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import {
  canAccessSystemPage,
  canUseToolPlayground,
  toolsTabPath,
} from "@/lib/navigation";
import { findSuperBotProfile } from "@/lib/profiles";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

export function ToolPlaygroundPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const { user, activeOrg, isLoading: authLoading } = useAuth();
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  const canAccess = canAccessSystemPage(isPlatformAdmin, activeOrg?.role);
  const canUsePlayground = canUseToolPlayground(isPlatformAdmin, activeOrg?.role);

  const {
    data: tool,
    isLoading: toolLoading,
    error: toolError,
  } = useToolQuery(toolId ?? null);
  const { data: profiles = [] } = useProfilesQuery();
  const superBotProfileId = findSuperBotProfile(profiles)?.id ?? null;

  if (authLoading) {
    return <PageState message="Loading…" />;
  }

  if (!canAccess || !canUsePlayground) {
    return <Navigate to="/chat" replace />;
  }

  if (!toolId) {
    return <Navigate to={toolsTabPath()} replace />;
  }

  if (toolLoading && !tool) {
    return <PageState message="Loading tool…" />;
  }

  if (toolError && !tool) {
    return (
      <div className="space-y-4 p-6">
        <BackLink />
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {formatError(toolError)}
        </p>
      </div>
    );
  }

  if (!tool) {
    return <Navigate to={toolsTabPath()} replace />;
  }

  return (
    <ToolPlaygroundPageContent
      tool={tool}
      superBotProfileId={superBotProfileId}
    />
  );
}

function ToolPlaygroundPageContent({
  tool,
  superBotProfileId,
}: {
  tool: ToolDetail;
  superBotProfileId: string | null;
}) {
  const isJavascriptTool = tool.handlerType === "javascript";
  const run = useToolPlaygroundRun(tool, superBotProfileId);
  const [mainTab, setMainTab] = useState<"output" | "detail">("output");

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-4 p-6">
      <BackLink />

      <section className={cn(sectionClass, "flex min-h-0 flex-1 overflow-hidden")}>
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {isJavascriptTool ? (
            <aside
              className="order-2 shrink-0 overflow-y-auto border-t border-border lg:order-1 lg:w-80 lg:border-t-0 lg:border-r xl:w-96"
            >
              <ToolPlaygroundRunForm tool={tool} run={run} />
            </aside>
          ) : null}

          <main className="order-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:order-2">
            {isJavascriptTool ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div
                  role="tablist"
                  aria-label="Tool playground"
                  className="flex shrink-0 border-b border-border px-4 sm:px-5"
                >
                  <PlaygroundTab
                    id="tool-playground-tab-output"
                    active={mainTab === "output"}
                    controls="tool-playground-panel-output"
                    onSelect={() => setMainTab("output")}
                  >
                    Run output
                    {run.running ? <Spinner className="size-3.5" /> : null}
                  </PlaygroundTab>
                  <PlaygroundTab
                    id="tool-playground-tab-detail"
                    active={mainTab === "detail"}
                    controls="tool-playground-panel-detail"
                    onSelect={() => setMainTab("detail")}
                  >
                    Tool detail
                  </PlaygroundTab>
                </div>

                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                  {mainTab === "output" ? (
                    <div
                      id="tool-playground-panel-output"
                      role="tabpanel"
                      aria-labelledby="tool-playground-tab-output"
                    >
                      <ToolPlaygroundOutput run={run} superBotProfileId={superBotProfileId} />
                    </div>
                  ) : (
                    <div
                      id="tool-playground-panel-detail"
                      role="tabpanel"
                      aria-labelledby="tool-playground-tab-detail"
                    >
                      <ToolDetailSections tool={tool} showHeader />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-5 overflow-y-auto p-4 sm:p-5">
                <p
                  className="rounded-md border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
                  role="status"
                >
                  Playground is available for custom JavaScript tools only. Built-in and MCP tools
                  cannot be run here.{" "}
                  <Link to={toolsTabPath()} className="font-medium underline underline-offset-2">
                    Back to tools
                  </Link>
                </p>
                <ToolDetailSections tool={tool} showHeader />
              </div>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}

function PlaygroundTab({
  id,
  active,
  controls,
  onSelect,
  children,
}: {
  id: string;
  active: boolean;
  controls: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      data-active={active || undefined}
      className={cn(
        "relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors sm:px-4",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

function BackLink() {
  return (
    <Button type="button" variant="ghost" size="sm" className="-ml-2 w-fit" render={<Link to={toolsTabPath()} />}>
      <ChevronLeftIcon className="size-4" aria-hidden />
      Tools
    </Button>
  );
}

function PageState({ message }: { message: string }) {
  return (
    <div className="p-6">
      <div
        className={cn(
          sectionClass,
          "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground",
        )}
      >
        <Spinner className="size-5" />
        {message}
      </div>
    </div>
  );
}
