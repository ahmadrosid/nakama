import { describe, expect, test } from "bun:test";
import * as React from "react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  activatePlugin,
  type PluginClientContext,
  type PluginClientModule,
} from "./plugin-runtime";

function options(controller = new AbortController()) {
  return {
    host: { call: async () => "saved" },
    orgId: "org-a",
    pluginId: "notes",
    signal: controller.signal,
    theme: "dark" as const,
  };
}

describe("native plugin activation", () => {
  test("the shipped Workflows module renders with the host React instance", async () => {
    const module = await import(
      new URL(
        "../../../../packages/plugins/workflows/ui/app.js",
        import.meta.url
      ).href
    );
    let Page!: React.ComponentType;
    let stylesheet = "";
    module.apply({
      ...options(),
      React,
      slots: {
        register: (_slot: string, component: React.ComponentType) => {
          Page = component;
        },
      },
      styles: (css: string) => {
        stylesheet = css;
      },
    });
    const html = renderToString(createElement(Page));
    expect(html).toContain("<h1>Workflows</h1>");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<iframe");
    expect(stylesheet).toContain('[data-plugin-id="workflows"]');
  });

  test("an effect interrupted during setup still releases its resource", async () => {
    const controller = new AbortController();
    let active = 0;
    await expect(
      activatePlugin(
        {
          apply(ctx) {
            ctx.effect(() => {
              active++;
              controller.abort();
              return () => {
                active--;
              };
            });
          },
          inject: [],
        },
        options(controller)
      )
    ).rejects.toThrow();
    expect(active).toBe(0);
  });

  test("registers a React component with declared services and cleans effects on unload", async () => {
    const calls: unknown[] = [];
    let context!: PluginClientContext;
    const runtime = await activatePlugin(
      {
        apply(ctx) {
          context = ctx;
          ctx.effect(() => {
            calls.push("start");
            return () => {
              calls.push("stop");
            };
          });
          ctx.slots.register("page", () =>
            ctx.React.createElement("p", null, `${ctx.orgId}:${ctx.theme}`)
          );
        },
        inject: ["slots", "host"],
      },
      options()
    );
    expect(renderToString(createElement(runtime.Page))).toContain("org-a:dark");
    expect(await context.host.call("save", {})).toBe("saved");
    runtime.dispose();
    runtime.dispose();
    expect(calls).toEqual(["start", "stop"]);
    expect(() => context.slots.register("page", () => null)).toThrow();
  });

  test("failed activation rolls back registered effects", async () => {
    let active = 0;
    await expect(
      activatePlugin(
        {
          apply(ctx) {
            ctx.effect(() => {
              active++;
              return () => {
                active--;
              };
            });
            ctx.slots.register("page", () => null);
            throw new Error("failed");
          },
          inject: ["slots"],
        },
        options()
      )
    ).rejects.toThrow();
    expect(active).toBe(0);
  });

  test("unknown and undeclared services are rejected", async () => {
    const unavailable = {
      apply() {},
      inject: ["database"],
    } as unknown as PluginClientModule;
    await expect(activatePlugin(unavailable, options())).rejects.toThrow();
    await expect(
      activatePlugin(
        {
          apply(ctx) {
            void ctx.host;
          },
          inject: ["slots"],
        },
        options()
      )
    ).rejects.toThrow();
  });

  test("a plugin must register exactly one page", async () => {
    await expect(
      activatePlugin({ apply() {}, inject: [] }, options())
    ).rejects.toThrow();
    await expect(
      activatePlugin(
        {
          apply(ctx) {
            ctx.slots.register("page", () => null);
            ctx.slots.register("page", () => null);
          },
          inject: ["slots"],
        },
        options()
      )
    ).rejects.toThrow();
  });

  test("aborting pending activation removes effects and rejects late registration", async () => {
    const controller = new AbortController();
    let active = 0;
    let context!: PluginClientContext;
    const pending = activatePlugin(
      {
        apply(ctx) {
          context = ctx;
          ctx.effect(() => {
            active++;
            return () => {
              active--;
            };
          });
          return new Promise(() => {});
        },
        inject: ["slots"],
      },
      options(controller)
    );
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toThrow();
    expect(active).toBe(0);
    expect(() => context.slots.register("page", () => null)).toThrow();
  });

  test("an org switch cancels the old activation and rejects its late host response", async () => {
    const controller = new AbortController();
    let resolve!: (value: string) => void;
    let context!: PluginClientContext;
    const runtime = await activatePlugin(
      {
        apply(ctx) {
          context = ctx;
          ctx.slots.register("page", () => null);
        },
        inject: ["host", "slots"],
      },
      {
        ...options(controller),
        host: {
          call: () =>
            new Promise<string>((done) => {
              resolve = done;
            }),
        },
      }
    );
    const response = context.host.call("list");
    controller.abort();
    resolve("old org data");
    await expect(response).rejects.toThrow();
    runtime.dispose();
  });
});
