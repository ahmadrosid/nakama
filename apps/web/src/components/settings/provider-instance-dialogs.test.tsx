import { afterEach, expect, test } from "bun:test";
import type { ProviderInstanceSummary } from "@nakama/core/contract";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ProviderManageModelsDialog,
  ProviderRemoveDialog,
  ProviderReplaceKeyDialog,
} from "./provider-instance-dialogs";

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

test("remove lists the settings that lose their model", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root!.render(
      <ProviderRemoveDialog
        busy={false}
        isSole={false}
        label="DeepSeek"
        onConfirm={() => undefined}
        onOpenChange={() => undefined}
        open
        usedBy={["Image parsing model"]}
      />
    )
  );

  const items = [...document.querySelectorAll("li")].map(
    (item) => item.textContent
  );

  expect(items).toEqual(["Image parsing model"]);
});

test("submitting the key form saves the key", async () => {
  let saves = 0;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root!.render(
      <ProviderReplaceKeyDialog
        apiKey="sk-test"
        busy={false}
        dialogError={null}
        instance={instance}
        onApiKeyChange={() => undefined}
        onOpenChange={() => undefined}
        onSave={() => {
          saves += 1;
        }}
        onToggleShowApiKey={() => undefined}
        open
        providerType="deepseek"
        showApiKey={false}
      />
    )
  );

  const form = document.querySelector("#replace-api-key")?.closest("form");

  await act(async () => form?.requestSubmit());
  expect(saves).toBe(1);
});

test("closing Manage with edits asks before it drops them", async () => {
  const changes: boolean[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () =>
    root!.render(
      <ProviderManageModelsDialog
        busy={false}
        dialogError={null}
        dirty
        onOpenChange={(open) => changes.push(open)}
        onSave={() => undefined}
        open
        title="Manage DeepSeek"
      >
        <p>models</p>
      </ProviderManageModelsDialog>
    )
  );

  const button = (label: RegExp) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => label.test(candidate.textContent ?? "")
    );

  await act(async () => button(/^Cancel$/)!.click());
  expect(changes).toEqual([]);

  await act(async () => button(/^Keep editing$/)!.click());
  expect(changes).toEqual([]);

  await act(async () => button(/^Cancel$/)!.click());
  await act(async () => button(/^Discard$/)!.click());
  expect(changes).toEqual([false]);
});
