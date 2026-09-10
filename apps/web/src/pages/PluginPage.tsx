import type { OrgPluginDetail } from "@nakama/core/contract";
import { type ComponentType, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { RouteBoundary } from "@/components/RouteBoundary";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import {
  apiErrorStatus,
  pluginPageStateMessage,
  pluginUiModuleUrl,
  resolvePluginPageView,
  useOrgPlugin,
} from "@/hooks/use-plugins";
import { client } from "@/lib/client";
import {
  canAccessSystemPage,
  PAGE_PATHS,
  pluginsSystemPath,
} from "@/lib/navigation";
import { activatePlugin, type PluginClientModule } from "@/lib/plugin-runtime";

export function PluginPage() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const { user, activeOrg } = useAuth();
  const { resolvedTheme } = useTheme();
  const query = useOrgPlugin(pluginId);
  const canManage = canAccessSystemPage(
    user?.isPlatformAdmin === true,
    activeOrg?.role
  );
  const view = resolvePluginPageView({
    errorStatus: apiErrorStatus(query.error),
    orgRole: activeOrg?.role,
    plugin: query.data,
    queryStatus: query.status,
  });
  if (view !== "page" || !activeOrg || !query.data) {
    return <PluginPageState canManage={canManage} kind={view} />;
  }
  const key = `${activeOrg.id}:${pluginId}:${query.data.selectedVersion}:${query.data.revision}:${resolvedTheme}`;
  return (
    <RouteBoundary resetKey={key}>
      <PluginPageSlot
        key={key}
        orgId={activeOrg.id}
        plugin={query.data}
        theme={resolvedTheme}
      />
    </RouteBoundary>
  );
}

function PluginPageSlot({
  orgId,
  plugin,
  theme,
}: {
  orgId: string;
  plugin: OrgPluginDetail;
  theme: "dark" | "light";
}) {
  const [Page, setPage] = useState<ComponentType | null>(null);
  const [failed, setFailed] = useState(false);
  const { pluginId, revision, selectedVersion } = plugin;
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort(new Error("Plugin startup timed out."));
      setFailed(true);
    }, 12_000);
    let dispose: (() => void) | undefined;
    const load = async () => {
      const url = pluginUiModuleUrl(orgId, pluginId, revision, selectedVersion);
      const module = (await import(
        /* @vite-ignore */ url
      )) as PluginClientModule;
      const runtime = await activatePlugin(module, {
        host: {
          async call(action, input) {
            const response = await client.invokePluginAction(
              pluginId,
              action,
              { input },
              orgId,
              controller.signal
            );
            return response.result;
          },
        },
        orgId,
        pluginId,
        signal: controller.signal,
        theme,
      });
      dispose = runtime.dispose;
      if (controller.signal.aborted) {
        dispose();
        return;
      }
      setPage(() => runtime.Page);
    };
    load()
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      dispose?.();
    };
  }, [orgId, pluginId, revision, selectedVersion, theme]);
  if (failed) {
    return (
      <p className="p-6" role="alert">
        {pluginPageStateMessage("failed")}
      </p>
    );
  }
  if (!Page) {
    return (
      <p className="p-6" role="status">
        Loading plugin
      </p>
    );
  }
  return (
    <div
      className="min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6"
      data-plugin-id={pluginId}
    >
      <Page />
    </div>
  );
}

export function PluginPageState({
  kind,
  canManage,
}: {
  kind: ReturnType<typeof resolvePluginPageView>;
  canManage: boolean;
}) {
  return (
    <div className="flex min-h-64 flex-col items-start justify-center gap-3 p-6">
      <p className="type-page-title">{pluginPageStateMessage(kind)}</p>
      <Link
        className="text-sm underline underline-offset-2"
        to={canManage ? pluginsSystemPath() : PAGE_PATHS.chat}
      >
        {canManage ? "Plugins" : "Chat"}
      </Link>
    </div>
  );
}
