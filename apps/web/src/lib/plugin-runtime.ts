import * as React from "react";

export interface PluginClientContext {
  effect(setup: () => () => void): void;
  host: { call(action: string, input?: unknown): Promise<unknown> };
  orgId: string;
  pluginId: string;
  React: typeof React;
  signal: AbortSignal;
  slots: { register(slot: "page", component: React.ComponentType): void };
  styles(css: string): void;
  theme: "dark" | "light";
}

export interface PluginClientModule {
  apply(context: PluginClientContext): void | Promise<void>;
  inject: Array<"slots" | "host" | "styles">;
}

/** Each activation owns its registrations and effects, including failed startup. */
export async function activatePlugin(
  module: PluginClientModule,
  options: Pick<
    PluginClientContext,
    "orgId" | "pluginId" | "theme" | "signal" | "host"
  >
): Promise<{ Page: React.ComponentType; dispose(): void }> {
  options.signal.throwIfAborted();
  if (!Array.isArray(module.inject) || typeof module.apply !== "function") {
    throw new Error("Plugin must export inject and apply.");
  }
  for (const dependency of module.inject) {
    if (!["slots", "host", "styles"].includes(dependency)) {
      throw new Error(`Unavailable plugin service: ${dependency}`);
    }
  }
  const cleanups: Array<() => void> = [];
  let disposed = false;
  let Page: React.ComponentType | undefined;
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
      register(slot: "page", component: React.ComponentType) {
        assertActive();
        if (slot !== "page" || Page || typeof component !== "function") {
          throw new Error("Plugin must register exactly one page component.");
        }
        Page = component;
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
  };
  const context = {
    effect,
    orgId: options.orgId,
    pluginId: options.pluginId,
    React,
    signal: options.signal,
    theme: options.theme,
  } as PluginClientContext;
  for (const name of ["slots", "host", "styles"] as const) {
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
    return { dispose, Page };
  } catch (error) {
    dispose();
    throw error;
  }
}
