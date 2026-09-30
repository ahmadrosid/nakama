import { expect, test } from "bun:test";
import type { AutomationRunRecord } from "@nakama/core/contract";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ThemeContext } from "@/context/theme-context-shared";
import { RunHistoryList } from "./automations-components";
import { runPreviewText } from "./automations-page.shared";

test("running rows only expand when there is output or an error", async () => {
  const run: AutomationRunRecord = {
    automationId: "automation",
    completedAt: null,
    error: null,
    id: "run",
    output: null,
    startedAt: new Date().toISOString(),
    status: "running",
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  const render = async (record: AutomationRunRecord) => {
    await act(async () =>
      root.render(
        <ThemeContext
          value={{
            resolvedTheme: "light",
            setTheme: () => {},
            theme: "light",
            toggleTheme: () => {},
          }}
        >
          <RunHistoryList
            busy={false}
            onDeleteRun={() => {}}
            onRerun={() => {}}
            running
            runs={[record]}
          />
        </ThemeContext>
      )
    );
  };
  try {
    await render(run);
    expect(runPreviewText(run)).toBeNull();
    expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
    expect(container.querySelector("[aria-expanded]")).toBeNull();
    for (const content of [
      { output: "Result" },
      { error: "Failure" },
      { deliveryError: "Delivery failure" },
    ]) {
      await render({ ...run, ...content });
      expect(container.querySelector('[aria-expanded="true"]')).not.toBeNull();
      expect(container.textContent).toContain(Object.values(content)[0]);
      expect(container.querySelectorAll(".animate-spin")).toHaveLength(1);
    }
  } finally {
    await act(async () => root.unmount());
  }
});
