import { describe, expect, test } from "bun:test";
import * as ui from "@nakama/ui";
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
  test("plugins render shared UI with the host React instance", async () => {
    const runtime = await activatePlugin(
      {
        apply(ctx) {
          const { Button, Input } = ctx.ui;
          ctx.slots.register("page", () =>
            ctx.React.createElement(
              "form",
              null,
              ctx.React.createElement(Input, { defaultValue: "Workflow" }),
              ctx.React.createElement(Button, { disabled: true }, "Save")
            )
          );
        },
        inject: ["slots", "ui"],
      },
      options()
    );
    const html = renderToString(createElement(runtime.Page));
    expect(html).toContain('data-slot="button"');
    expect(html).toContain('value="Workflow"');
    expect(html).toContain("disabled");
    runtime.dispose();
  });

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
      ui,
    });
    const html = renderToString(createElement(Page));
    expect(html).not.toContain("<h1");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("<iframe");
    expect(stylesheet).toContain('[data-plugin-id="workflows"]');
  });

  test.each(["", "summary", "empty", "draft", "data"])(
    "a loaded workflow renders shared controls with selection %s",
    async (selection) => {
      const module = await import(
        new URL(
          "../../../../packages/plugins/workflows/ui/app.js",
          import.meta.url
        ).href
      );
      const workflow = {
        description: "Fetch and summarize the news",
        enabled: true,
        id: "brief",
        name: "morning-brief",
        profileId: "agent-a",
        steps: [
          { id: "fetch_hn", input: {}, kind: "tool", tool: "web_fetch" },
          { id: "summarize_brief", kind: "summarize", prompt: "Summarize" },
        ],
        version: 1,
      };
      // Seed the two page states for server rendering; all component hooks still
      // run through the real host React dispatcher. Effects do not run in SSR.
      const initialStates = [
        {
          profiles: [{ id: "agent-a", name: "Default Bot" }],
          workflows:
            selection === "empty" || selection === "draft" ? [] : [workflow],
        },
        selection === "empty" ? null : selection === "draft" ? "" : workflow.id,
      ];
      let stateIndex = 0;
      let Page!: React.ComponentType;
      module.apply({
        ...options(),
        React: {
          ...React,
          useState: ((initial: unknown) => {
            const index = stateIndex++;
            const value =
              index < initialStates.length
                ? initialStates[index]
                : index === 14
                  ? selection === "summary" || selection === "data"
                    ? selection
                    : ""
                  : initial;
            return React.useState(value);
          }) as typeof React.useState,
        },
        slots: {
          register: (_slot: string, component: React.ComponentType) => {
            Page = component;
          },
        },
        styles: () => {},
        ui,
      });
      const html = renderToString(createElement(Page));
      if (selection === "empty") {
        expect(html).toContain("Create your first workflow");
        expect(html).toContain("Create workflow");
        expect(html).not.toContain("<form");
        expect(html).not.toContain("Test run");
        return;
      }
      if (selection === "draft") {
        expect(html).toContain("<form");
        expect(html).toContain('aria-label="Workflow name"');
        expect(html).toContain('type="submit"');
        expect(html).not.toContain("Create your first workflow");
        return;
      }
      expect(html).toContain('aria-label="Workflows"');
      expect(html).toContain('aria-current="true"');
      expect(html).toContain("Fetch Hn");
      expect(html).toContain("Summarize Brief");
      expect(html).toContain('role="switch"');
      expect(html).toContain('data-slot="select-trigger"');
      expect(html).toContain('data-slot="input"');
      expect(html).toMatch(/<button[^>]*>.*?Test run<\/button>/s);
      expect(html).not.toContain('type="submit"');
      if (selection === "data") {
        expect(html).toContain('aria-label="Workflow data"');
        expect(html).toContain('aria-label="Expand data"');
        expect(html).toContain('aria-label="Close data"');
        expect(html).toContain('aria-busy="true"');
        expect(html).not.toContain('role="dialog"');
        expect(html).not.toContain('aria-label="Step views"');
        return;
      }
      if (selection) {
        expect(html).toContain('aria-label="Workflow step"');
        expect(html).toContain('aria-label="Expand step"');
        expect(html).toContain('aria-label="Close step"');
        expect(html).toContain('aria-label="Step views"');
        expect(html).toContain('data-slot="textarea"');
      }
    }
  );

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
    await expect(
      activatePlugin(
        {
          apply(ctx) {
            void ctx.ui;
          },
          inject: ["slots"],
        },
        options()
      )
    ).rejects.toThrow();
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
