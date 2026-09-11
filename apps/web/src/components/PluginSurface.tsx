import type { OrgPluginDetail } from "@nakama/core/contract";
import {
  Component,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { pluginPageStateMessage, pluginUiModuleUrl } from "@/hooks/use-plugins";
import { client } from "@/lib/client";
import {
  activatePlugin,
  type PluginClientModule,
  type PluginToolProps,
} from "@/lib/plugin-runtime";

export function PluginSurface({
  orgId,
  plugin,
  theme,
  tool,
  fallback,
}: {
  orgId: string;
  plugin: OrgPluginDetail;
  theme: "dark" | "light";
  tool?: PluginToolProps;
  fallback: ReactNode;
}) {
  const [runtime, setRuntime] = useState<Awaited<
    ReturnType<typeof activatePlugin>
  > | null>(null);
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
      setRuntime({
        ...runtime,
        dispose() {
          controller.abort();
          runtime.dispose();
        },
      });
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
  if (failed && !tool) {
    return (
      <p className="p-6" role="alert">
        {pluginPageStateMessage("failed")}
      </p>
    );
  }
  if (failed || !runtime) {
    return fallback;
  }
  const Renderer = tool ? runtime.tools.get(tool.action) : null;
  if (tool && !Renderer) {
    return fallback;
  }
  const Page = runtime.Page;
  return (
    <PluginRenderBoundary
      fallback={
        tool ? (
          fallback
        ) : (
          <p className="p-6" role="alert">
            {pluginPageStateMessage("failed")}
          </p>
        )
      }
      onError={runtime.dispose}
    >
      <div
        className={
          tool ? "min-w-0" : "min-h-0 min-w-0 flex-1 overflow-auto p-4 sm:p-6"
        }
        data-plugin-id={pluginId}
      >
        <Suspense fallback={fallback}>
          {tool && Renderer ? (
            <Renderer {...tool} />
          ) : (
            <Page
              renderHeaderActions={(children) => {
                const target = document.querySelector(
                  "[data-page-header-actions]"
                );
                return target
                  ? createPortal(
                      <div
                        className="flex items-center gap-2"
                        data-plugin-id={pluginId}
                        // Page container queries must not collapse header actions.
                        style={{ containerType: "normal" }}
                      >
                        {children}
                      </div>,
                      target
                    )
                  : children;
              }}
            />
          )}
        </Suspense>
      </div>
    </PluginRenderBoundary>
  );
}

class PluginRenderBoundary extends Component<
  { children: ReactNode; fallback: ReactNode; onError(): void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
