import type { DiagramPlugin } from "streamdown";

type MermaidPluginLoader = () => Promise<{ mermaid: DiagramPlugin }>;

export function createLazyMermaidPlugin(
  loadPlugin: MermaidPluginLoader
): DiagramPlugin {
  return {
    getMermaid: (config) => ({
      initialize: () => undefined,
      render: async (id, chart) => {
        if (!chart.trim()) {
          return { svg: "" };
        }

        const { mermaid } = await loadPlugin();
        return mermaid.getMermaid(config).render(id, chart);
      },
    }),
    language: "mermaid",
    name: "mermaid",
    type: "diagram",
  };
}
