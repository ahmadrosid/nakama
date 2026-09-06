import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Spinner } from "@/components/ui/spinner";
import { useAuth } from "@/context/use-auth";
import { useTheme } from "@/context/use-theme";
import {
  apiErrorStatus,
  cancelOrgPluginQueries,
  isNakamaPluginReadyMessage,
  PLUGIN_READY_TIMEOUT_MS,
  pluginPageStateMessage,
  pluginUiDocumentUrl,
  resolvePluginPageView,
  useOrgPlugin,
} from "@/hooks/use-plugins";
import {
  canAccessSystemPage,
  canOpenPluginPage,
  PAGE_PATHS,
  pluginsSystemPath,
} from "@/lib/navigation";

export function PluginPage() {
  const { pluginId } = useParams<{ pluginId: string }>();
  const { user, activeOrg } = useAuth();
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const orgId = activeOrg?.id ?? "";
  const orgRole = activeOrg?.role;
  const canManage = canAccessSystemPage(
    user?.isPlatformAdmin === true,
    orgRole
  );
  const query = useOrgPlugin(pluginId);
  const [iframeReady, setIframeReady] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(
    () => () => {
      if (orgId) {
        void cancelOrgPluginQueries(queryClient, orgId);
      }
    },
    [orgId, queryClient]
  );

  useEffect(() => {
    setIframeReady(false);
    setLoadTimedOut(false);
  }, [orgId, pluginId, resolvedTheme]);

  const view = resolvePluginPageView({
    errorStatus: apiErrorStatus(query.error),
    iframeReady,
    loadTimedOut,
    orgRole,
    plugin: query.data,
    queryStatus: query.status,
  });

  const pageLabel = query.data?.ui?.pageLabel ?? pluginId ?? "Plugin";
  const frameSrc =
    orgId && pluginId
      ? pluginUiDocumentUrl(orgId, pluginId, resolvedTheme)
      : "";

  useEffect(() => {
    if (view !== "frame" || iframeReady || !pluginId) {
      return;
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      if (isNakamaPluginReadyMessage(event.data, pluginId)) {
        setIframeReady(true);
      }
    };

    window.addEventListener("message", onMessage);
    const timer = window.setTimeout(() => {
      setLoadTimedOut(true);
    }, PLUGIN_READY_TIMEOUT_MS);

    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
    };
  }, [iframeReady, pluginId, view]);

  if (!pluginId) {
    return (
      <PluginPageState
        canManage={canManage}
        kind="unavailable"
        viewer={orgRole === "viewer"}
      />
    );
  }

  if (view !== "frame") {
    return (
      <PluginPageState
        canManage={canManage}
        kind={view}
        viewer={!canOpenPluginPage(orgRole)}
      />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {iframeReady ? null : (
        <div className="flex items-center gap-2 px-6 py-3 text-muted-foreground text-sm">
          <Spinner className="size-4" />
          Loading plugin
        </div>
      )}
      {frameSrc ? (
        <iframe
          className="min-h-0 min-w-0 flex-1 border-0 bg-background"
          key={`${orgId}:${pluginId}:${resolvedTheme}`}
          ref={iframeRef}
          src={frameSrc}
          title={pageLabel}
        />
      ) : null}
    </div>
  );
}

export function PluginPageState({
  kind,
  canManage,
  viewer,
}: {
  kind: ReturnType<typeof resolvePluginPageView>;
  canManage: boolean;
  viewer: boolean;
}) {
  const href = canManage ? pluginsSystemPath() : PAGE_PATHS.chat;
  const linkLabel = canManage ? "Plugins" : viewer ? "Chat" : "Chat";

  return (
    <div className="flex min-h-64 flex-col items-start justify-center gap-3 p-6">
      <p className="type-page-title">{pluginPageStateMessage(kind)}</p>
      <Link className="text-sm underline underline-offset-2" to={href}>
        {linkLabel}
      </Link>
    </div>
  );
}
