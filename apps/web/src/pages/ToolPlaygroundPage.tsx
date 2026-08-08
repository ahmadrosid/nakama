import type { ToolDetail } from "@nakama/core/contract";
import { ChevronLeftIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { ToolDetailSections } from "@/components/tools/ToolDetailSections";
import {
  ToolPlaygroundOutput,
  ToolPlaygroundRunForm,
} from "@/components/tools/ToolPlaygroundPanel";
import { useToolPlaygroundRun } from "@/components/tools/use-tool-playground-run";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { useProfilesQuery, useToolQuery } from "@/hooks/use-app-queries";
import { formatError } from "@/lib/client";
import {
  canAccessSystemPage,
  canUseToolPlayground,
  toolPlaygroundBackTarget,
} from "@/lib/navigation";
import { findSuperBotProfile } from "@/lib/profiles";
import { cn } from "@/lib/utils";

const sectionClass = "rounded-md border border-border bg-card";

export function ToolPlaygroundPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const [searchParams] = useSearchParams();
  const { user, activeOrg, isLoading: authLoading } = useAuth();
  const isPlatformAdmin = user?.isPlatformAdmin === true;
  const canAccess = canAccessSystemPage(isPlatformAdmin, activeOrg?.role);
  const canUsePlayground = canUseToolPlayground(
    isPlatformAdmin,
    activeOrg?.role
  );
  const backHref = toolPlaygroundBackTarget(searchParams).href;

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

  if (!(canAccess && canUsePlayground)) {
    return <Navigate replace to="/chat" />;
  }

  if (!toolId) {
    return <Navigate replace to={backHref} />;
  }

  if (toolLoading && !tool) {
    return <PageState message="Loading tool…" />;
  }

  if (toolError && !tool) {
    return (
      <div className="space-y-4 p-6">
        <BackLink />
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {formatError(toolError)}
        </p>
      </div>
    );
  }

  if (!tool) {
    return <Navigate replace to={backHref} />;
  }

  return (
    <ToolPlaygroundPageContent
      superBotProfileId={superBotProfileId}
      tool={tool}
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
  const [searchParams] = useSearchParams();
  const back = toolPlaygroundBackTarget(searchParams);
  const isJavascriptTool = tool.handlerType === "javascript";
  const run = useToolPlaygroundRun(tool, superBotProfileId);
  const [mainTab, setMainTab] = useState<"output" | "detail">("output");

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-4 p-6">
      <BackLink />

      <section
        className={cn(sectionClass, "flex min-h-0 flex-1 overflow-hidden")}
      >
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {isJavascriptTool ? (
            <aside className="order-2 shrink-0 overflow-y-auto border-border border-t lg:order-1 lg:w-80 lg:border-t-0 lg:border-r xl:w-96">
              <ToolPlaygroundRunForm run={run} tool={tool} />
            </aside>
          ) : null}

          <main className="order-1 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:order-2">
            {isJavascriptTool ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div
                  aria-label="Tool playground"
                  className="flex shrink-0 border-border border-b px-4 sm:px-5"
                  role="tablist"
                >
                  <PlaygroundTab
                    active={mainTab === "output"}
                    controls="tool-playground-panel-output"
                    id="tool-playground-tab-output"
                    onSelect={() => setMainTab("output")}
                  >
                    Run output
                    {run.running ? <Spinner className="size-3.5" /> : null}
                  </PlaygroundTab>
                  <PlaygroundTab
                    active={mainTab === "detail"}
                    controls="tool-playground-panel-detail"
                    id="tool-playground-tab-detail"
                    onSelect={() => setMainTab("detail")}
                  >
                    Tool detail
                  </PlaygroundTab>
                </div>

                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
                  {mainTab === "output" ? (
                    <div
                      aria-labelledby="tool-playground-tab-output"
                      id="tool-playground-panel-output"
                      role="tabpanel"
                    >
                      <ToolPlaygroundOutput
                        run={run}
                        superBotProfileId={superBotProfileId}
                      />
                    </div>
                  ) : (
                    <div
                      aria-labelledby="tool-playground-tab-detail"
                      id="tool-playground-panel-detail"
                      role="tabpanel"
                    >
                      <ToolDetailSections showHeader tool={tool} />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-5 overflow-y-auto p-4 sm:p-5">
                <p
                  className="rounded-md border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-amber-800 text-sm dark:text-amber-200"
                  role="status"
                >
                  Playground is available for custom JavaScript tools only.
                  Built-in and MCP tools cannot be run here.{" "}
                  <Link
                    className="font-medium underline underline-offset-2"
                    to={back.href}
                  >
                    Back to {back.label.toLowerCase()}
                  </Link>
                </p>
                <ToolDetailSections showHeader tool={tool} />
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
      aria-controls={controls}
      aria-selected={active}
      className={cn(
        "relative -mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 font-medium text-sm transition-colors sm:px-4",
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      )}
      data-active={active || undefined}
      id={id}
      onClick={onSelect}
      role="tab"
      type="button"
    >
      {children}
    </button>
  );
}

function BackLink() {
  const [searchParams] = useSearchParams();
  const { href, label } = toolPlaygroundBackTarget(searchParams);

  return (
    <Button
      className="-ml-2 w-fit"
      render={<Link to={href} />}
      size="sm"
      type="button"
      variant="ghost"
    >
      <ChevronLeftIcon aria-hidden className="size-4" />
      {label}
    </Button>
  );
}

function PageState({ message }: { message: string }) {
  return (
    <div className="p-6">
      <div
        className={cn(
          sectionClass,
          "flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-muted-foreground text-sm"
        )}
      >
        <Spinner className="size-5" />
        {message}
      </div>
    </div>
  );
}
