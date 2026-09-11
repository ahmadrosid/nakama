import { Link, useParams } from "react-router-dom";
import { PluginSurface } from "@/components/PluginSurface";
import { RouteBoundary } from "@/components/RouteBoundary";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import {
  apiErrorStatus,
  pluginPageStateMessage,
  resolvePluginPageView,
  useOrgPlugin,
} from "@/hooks/use-plugins";
import {
  canAccessSystemPage,
  PAGE_PATHS,
  pluginsSystemPath,
} from "@/lib/navigation";

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
      <PluginSurface
        fallback={
          <p className="p-6" role="status">
            Loading plugin
          </p>
        }
        key={key}
        orgId={activeOrg.id}
        plugin={query.data}
        theme={resolvedTheme}
      />
    </RouteBoundary>
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
