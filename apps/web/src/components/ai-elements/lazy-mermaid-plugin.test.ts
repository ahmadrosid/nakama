import { describe, expect, test } from "bun:test";
import type { DiagramPlugin } from "streamdown";
import { createLazyMermaidPlugin } from "./lazy-mermaid-plugin";

const createDelegate = (
  render: (id: string, chart: string) => Promise<{ svg: string }>,
  onConfig?: DiagramPlugin["getMermaid"]
): DiagramPlugin => ({
  getMermaid: onConfig ?? (() => ({ initialize: () => undefined, render })),
  language: "mermaid",
  name: "mermaid",
  type: "diagram",
});

describe("createLazyMermaidPlugin", () => {
  test("does not load Mermaid for an empty streamed chart", async () => {
    let loadCount = 0;
    const plugin = createLazyMermaidPlugin(async () => {
      loadCount += 1;
      return {
        mermaid: createDelegate(async () => ({ svg: "unused" })),
      };
    });

    const result = await plugin.getMermaid().render("diagram", " \n\t");

    expect(result).toEqual({ svg: "" });
    expect(loadCount).toBe(0);
  });

  test("preserves config and render arguments when delegating", async () => {
    const received: {
      chart?: string;
      config?: Parameters<DiagramPlugin["getMermaid"]>[0];
      id?: string;
    } = {};
    const delegate = createDelegate(
      async (id, chart) => {
        received.id = id;
        received.chart = chart;
        return { svg: "<svg />" };
      },
      (config) => {
        received.config = config;
        return {
          initialize: () => undefined,
          render: async (id, chart) => {
            received.id = id;
            received.chart = chart;
            return { svg: "<svg />" };
          },
        };
      }
    );
    const plugin = createLazyMermaidPlugin(async () => ({ mermaid: delegate }));
    const config = { theme: "dark" } as const;
    const chart = " \n graph TD\n ";

    const result = await plugin.getMermaid(config).render("diagram-1", chart);

    expect(received).toEqual({
      chart,
      config,
      id: "diagram-1",
    });
    expect(result).toEqual({ svg: "<svg />" });
  });

  test("propagates loader rejection to Streamdown", async () => {
    const loadError = new Error("loader rejected");
    const plugin = createLazyMermaidPlugin(async () => {
      throw loadError;
    });

    await expect(
      plugin.getMermaid().render("diagram", "graph TD")
    ).rejects.toBe(loadError);
  });
});
