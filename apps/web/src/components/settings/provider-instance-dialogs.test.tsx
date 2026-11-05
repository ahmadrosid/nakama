import { afterEach, expect, test } from "bun:test";
import type { ProviderInstanceSummary } from "@nakama/core/contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ProviderReplaceKeyDialog } from "./provider-instance-dialogs";

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
});

const instance: ProviderInstanceSummary = {
  createdAt: "2026-01-01T00:00:00Z",
  hasApiKey: true,
  id: "deepseek",
  label: "DeepSeek",
  modelCount: 1,
  secretSource: "settings",
  type: "deepseek",
};

test("clearing a saved key asks to confirm first", async () => {
  const actions: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root!.render(
      <ProviderReplaceKeyDialog
        apiKey=""
        busy={false}
        dialogError={null}
        instance={instance}
        onApiKeyChange={() => undefined}
        onManage={(action) => actions.push(action)}
        onOpenChange={() => undefined}
        onSave={() => undefined}
        onToggleShowApiKey={() => undefined}
        open
        providerType="deepseek"
        showApiKey={false}
      />
    )
  );

  const button = (label: RegExp) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => label.test(candidate.textContent ?? "")
    );

  await act(async () => button(/^Clear saved key$/)!.click());
  expect(actions).toEqual([]);

  await act(async () => button(/^Clear key$/)!.click());
  expect(actions).toEqual(["clear"]);
});
