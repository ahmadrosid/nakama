import type { OrgPluginDetail } from "@nakama/core/contract";
import * as ui from "@nakama/ui";
import * as React from "react";

export interface PluginToolProps {
  action: string;
  input?: Record<string, unknown>;
  result?: unknown;
  status: "running" | "done";
}

export interface PluginPageProps {
  renderHeaderActions?: (children: React.ReactNode) => React.ReactNode;
}

export function findPluginTool(
  plugins: OrgPluginDetail[],
  name: string | undefined
) {
  for (const plugin of plugins) {
    const action = plugin.actions.find(
      ({ key }) =>
        `plugin_${plugin.pluginId.replaceAll("-", "_")}__${key.replaceAll("-", "_")}` ===
        name
    );
    if (action) {
      return { action: action.key, plugin };
    }
  }
  return null;
}

export interface PluginClientContext {
  effect(setup: () => () => void): void;
  host: { call(action: string, input?: unknown): Promise<unknown> };
  orgId: string;
  pluginId: string;
  React: typeof React;
  signal: AbortSignal;
  slots: {
    register(
      slot: "page",
      component: React.ComponentType<PluginPageProps>
    ): void;
    register(
      slot: `tool:${string}`,
      component: React.ComponentType<PluginToolProps>
    ): void;
  };
  styles(css: string): void;
  theme: "dark" | "light";
  ui: typeof ui;
}

export interface PluginClientModule {
  apply(context: PluginClientContext): void | Promise<void>;
  inject: Array<"slots" | "host" | "styles" | "ui">;
}

/** Each activation owns its registrations and effects, including failed startup. */
export async function activatePlugin(
  module: PluginClientModule,
  options: Pick<
    PluginClientContext,
    "orgId" | "pluginId" | "theme" | "signal" | "host"
  >
): Promise<{
  Page: React.ComponentType<PluginPageProps>;
  tools: ReadonlyMap<string, React.ComponentType<PluginToolProps>>;
  dispose(): void;
}> {
  options.signal.throwIfAborted();
  if (!Array.isArray(module.inject) || typeof module.apply !== "function") {
    throw new Error("Plugin must export inject and apply.");
  }
  for (const dependency of module.inject) {
    if (!["slots", "host", "styles", "ui"].includes(dependency)) {
      throw new Error(`Unavailable plugin service: ${dependency}`);
    }
  }
  const cleanups: Array<() => void> = [];
  let disposed = false;
  let Page: React.ComponentType<PluginPageProps> | undefined;
  const tools = new Map<string, React.ComponentType<PluginToolProps>>();
  const assertActive = () => {
    options.signal.throwIfAborted();
    if (disposed) {
      throw new Error("Plugin was unloaded.");
    }
  };
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    tools.clear();
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.error("Plugin cleanup failed", error);
      }
    }
    cleanups.length = 0;
  };
  const effect = (setup: () => () => void) => {
    assertActive();
    const cleanup = setup();
    if (typeof cleanup !== "function") {
      throw new Error("Plugin effect must return a cleanup function.");
    }
    if (disposed) {
      cleanup();
    } else {
      cleanups.push(cleanup);
    }
  };
  const services = {
    host: {
      async call(action: string, input?: unknown) {
        assertActive();
        const result = await options.host.call(action, input);
        assertActive();
        return result;
      },
    },
    slots: {
      register(
        slot: "page" | `tool:${string}`,
        component:
          | React.ComponentType<PluginPageProps>
          | React.ComponentType<PluginToolProps>
      ) {
        assertActive();
        if (slot.startsWith("tool:")) {
          const action = slot.slice(5);
          if (
            !/^[a-z][a-z0-9_-]*$/.test(action) ||
            tools.has(action) ||
            typeof component !== "function"
          ) {
            throw new Error("Invalid or duplicate plugin tool renderer.");
          }
          tools.set(action, component as React.ComponentType<PluginToolProps>);
          return;
        }
        if (slot !== "page" || Page || typeof component !== "function") {
          throw new Error("Plugin must register exactly one page component.");
        }
        Page = component as React.ComponentType<PluginPageProps>;
        cleanups.push(() => {
          Page = undefined;
        });
      },
    },
    styles(css: string) {
      effect(() => {
        const style = document.createElement("style");
        style.dataset.pluginId = options.pluginId;
        style.textContent = css;
        document.head.append(style);
        return () => style.remove();
      });
    },
    ui,
  };
  const context = {
    effect,
    orgId: options.orgId,
    pluginId: options.pluginId,
    React,
    signal: options.signal,
    theme: options.theme,
  } as PluginClientContext;
  for (const name of ["slots", "host", "styles", "ui"] as const) {
    Object.defineProperty(context, name, {
      get() {
        assertActive();
        if (!module.inject.includes(name)) {
          throw new Error(`Plugin must declare ${name} in inject.`);
        }
        return services[name];
      },
    });
  }
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      dispose();
      reject(options.signal.reason);
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
  });
  cleanups.push(() => options.signal.removeEventListener("abort", onAbort));
  try {
    await Promise.race([
      Promise.resolve().then(() => module.apply(context)),
      aborted,
    ]);
    assertActive();
    if (!Page) {
      throw new Error("Plugin did not register a page.");
    }
    return { dispose, Page, tools };
  } catch (error) {
    dispose();
    throw error;
  }
}
