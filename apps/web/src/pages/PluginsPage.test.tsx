import { afterEach, expect, spyOn, test } from "bun:test";
import type { LocalPluginPreviewResponse } from "@nakama/core/contract";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { client } from "@/lib/client";
import { LocalPluginInstaller } from "./plugins/local-plugin-installer";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function openDraft() {
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "Install from folder"
  );

  await act(async () => button?.click());
  await settle();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Agent"]')?.click()
  );
  await settle();
  await act(async () =>
    document.querySelector<HTMLElement>('[role="option"]')?.click()
  );

  const input = document.querySelector<HTMLInputElement>(
    '[aria-label="Draft ID"]'
  )!;

  await act(async () => {
    Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value"
    )!.set!.call(input, "notes");
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await settle();
}

function preview(): LocalPluginPreviewResponse {
  return {
    contributions: {
      actionKeys: ["list"],
      hasDatabase: false,
      hasUi: false,
      skillKeys: [],
    },
    digest: "a".repeat(64),
    draft: { draftId: "notes", orgId: "org-a", profileId: "super" },
    expectedRevision: null,
    files: [{ path: "actions/list.js", size: 40 }],
    integrity: "local",
    manifest: {
      actions: [
        {
          access: "member",
          description: "List",
          effect: "read",
          entry: "actions/list.js",
          exposeAsTool: true,
          inputSchema: { type: "object" },
          key: "list",
        },
      ],
      apiVersion: 1,
      author: "Test",
      description: "Notes",
      id: "notes",
      license: "MIT",
      minNakamaVersion: "0.1.0",
      name: "Notes",
      skills: [],
      version: "1.0.0+dev.abcdef",
    },
  };
}

async function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  // SAFETY: This component reads only ID, name, and Super Nakama status from profile fixtures.
  const profiles = spyOn(client, "listProfiles").mockResolvedValue({
    profiles: [{ id: "super", isSuper: true, name: "Super Nakama" }],
  } as Awaited<ReturnType<typeof client.listProfiles>>);

  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    profiles.mockRestore();
    queryClient.clear();
  });

  async function render(orgId: string) {
    await act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <LocalPluginInstaller key={orgId} orgId={orgId} />
        </QueryClientProvider>
      )
    );
  }

  await render("org-a");

  return { queryClient, render };
}

test("local review pins approval, escapes code, and invalidates the installed organization", async () => {
  const previewCall = spyOn(client, "previewLocalPlugin").mockResolvedValue(
    preview()
  );

  const fileCall = spyOn(client, "readLocalPluginFile").mockResolvedValue({
    content: btoa("</pre><script>window.executed=true</script>"),
    encoding: "base64",
    nextOffset: null,
    path: "actions/list.js",
  });

  // SAFETY: The component uses successful completion, not installation fields, from this fixture.
  const installCall = spyOn(client, "installLocalPlugin").mockResolvedValue({
    install: { lifecycleState: "disabled" },
  } as never);

  cleanups.push(() => {
    previewCall.mockRestore();
    fileCall.mockRestore();
    installCall.mockRestore();
  });
  const { queryClient } = await mount();
  const invalidation = spyOn(queryClient, "invalidateQueries");
  await openDraft();
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((item) => item.textContent === "Preview draft")
      ?.click()
  );
  await settle();
  expect(previewCall).toHaveBeenCalledWith({
    draftId: "notes",
    orgId: "org-a",
    profileId: "super",
  });

  const confirm = () =>
    [...document.querySelectorAll("button")].find(
      (item) => item.textContent === "Confirm installation"
    );

  expect(confirm()?.disabled).toBe(false);
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((item) => item.textContent?.includes("actions/list.js"))
      ?.click()
  );
  await settle();
  expect(document.querySelector("script")).toBeNull();
  expect(document.body.textContent).toContain("window.executed=true");
  expect(confirm()?.disabled).toBe(false);
  await act(async () => confirm()?.click());
  await settle();
  expect(installCall).toHaveBeenCalledWith({
    ...preview().draft,
    expectedDigest: preview().digest,
    expectedRevision: null,
  });
  expect(invalidation).toHaveBeenCalled();
});

test("changing organization removes a pending draft review and cannot confirm its late response", async () => {
  let resolvePreview!: (value: LocalPluginPreviewResponse) => void;

  const previewCall = spyOn(client, "previewLocalPlugin").mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePreview = resolve;
      })
  );

  const installCall = spyOn(client, "installLocalPlugin");
  cleanups.push(() => {
    previewCall.mockRestore();
    installCall.mockRestore();
  });
  const { render } = await mount();
  await openDraft();
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((item) => item.textContent === "Preview draft")
      ?.click()
  );
  await render("org-b");
  await act(async () => resolvePreview(preview()));
  await settle();
  expect(document.body.textContent).not.toContain("Confirm installation");
  expect(installCall).not.toHaveBeenCalled();
});

test("a cancelled preview cannot clear a newer preview's loading state", async () => {
  const responses: Array<(value: LocalPluginPreviewResponse) => void> = [];

  const previewCall = spyOn(client, "previewLocalPlugin").mockImplementation(
    () => new Promise((resolve) => responses.push(resolve))
  );

  cleanups.push(() => previewCall.mockRestore());
  await mount();
  await openDraft();

  const button = (label: string) =>
    [...document.querySelectorAll("button")].find(
      (item) => item.textContent === label
    );

  await act(async () => button("Preview draft")?.click());
  await act(async () => button("Close")?.click());
  await settle();
  await act(async () => button("Install from folder")?.click());
  await settle();
  await act(async () => button("Preview draft")?.click());
  expect(previewCall).toHaveBeenCalledTimes(2);
  await act(async () => responses[0]!(preview()));
  await settle();
  expect(button("Preview draft")?.disabled).toBe(true);
  expect(button("Confirm installation")).toBeUndefined();
  await act(async () => responses[1]!(preview()));
  await settle();
  expect(button("Preview draft")?.disabled).toBe(false);
  expect(button("Confirm installation")?.disabled).toBe(false);
});

for (const stage of ["preview", "file", "install"]) {
  test(`failed local ${stage} clears loading and requires a fresh review`, async () => {
    const previewCall = spyOn(client, "previewLocalPlugin").mockResolvedValue(
      preview()
    );

    const fileCall = spyOn(client, "readLocalPluginFile").mockResolvedValue({
      content: btoa("export {}"),
      encoding: "base64",
      nextOffset: null,
      path: "actions/list.js",
    });

    const installCall = spyOn(client, "installLocalPlugin").mockRejectedValue(
      new Error("stale approval")
    );

    if (stage === "preview") {
      previewCall.mockRejectedValueOnce(new Error("missing draft"));
    } else if (stage === "file") {
      fileCall.mockRejectedValueOnce(new Error("changed draft"));
    }

    cleanups.push(() => {
      previewCall.mockRestore();
      fileCall.mockRestore();
      installCall.mockRestore();
    });
    await mount();
    await openDraft();

    const button = (label: string) =>
      [...document.querySelectorAll("button")].find(
        (item) => item.textContent === label
      );

    await act(async () => button("Preview draft")?.click());
    await settle();

    if (stage !== "preview") {
      await act(async () =>
        [...document.querySelectorAll("button")]
          .find((item) => item.textContent?.includes("actions/list.js"))
          ?.click()
      );
      await settle();
    }

    if (stage === "install") {
      await act(async () => button("Confirm installation")?.click());
      await settle();
    }

    expect(button("Preview draft")?.disabled).toBe(false);
    expect(button("Confirm installation")).toBeUndefined();
    await act(async () => button("Preview draft")?.click());
    await settle();
    expect(button("Confirm installation")?.disabled).toBe(false);
  });
}

test("a chat draft opens straight into review for that draft", async () => {
  const previewCall = spyOn(client, "previewLocalPlugin").mockResolvedValue(
    preview()
  );

  const profiles = spyOn(client, "listProfiles");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();

  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
    previewCall.mockRestore();
    profiles.mockRestore();
    queryClient.clear();
  });

  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <LocalPluginInstaller
          draft={{ draftId: "notes", profileId: "super" }}
          orgId="org-a"
        />
      </QueryClientProvider>
    )
  );
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((item) => item.textContent === "Review and install")
      ?.click()
  );
  await settle();

  expect(previewCall).toHaveBeenCalledWith({
    draftId: "notes",
    orgId: "org-a",
    profileId: "super",
  });
  expect(profiles).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Draft ID"]')).toBeNull();
  expect(document.body.textContent).toContain("actions/list.js");
});

test("draft review lists code that runs before source and config", async () => {
  const previewCall = spyOn(client, "previewLocalPlugin").mockResolvedValue({
    ...preview(),
    files: [
      { path: "nakama.plugin.json", size: 700 },
      { path: "src/list.js", size: 90 },
      { path: "actions/list.js", size: 40 },
    ],
  });

  const fileCall = spyOn(client, "readLocalPluginFile").mockResolvedValue({
    content: btoa("export {}"),
    encoding: "base64",
    nextOffset: null,
    path: "actions/list.js",
  });

  cleanups.push(() => {
    previewCall.mockRestore();
    fileCall.mockRestore();
  });
  await mount();
  await openDraft();
  await act(async () =>
    [...document.querySelectorAll("button")]
      .find((item) => item.textContent === "Preview draft")
      ?.click()
  );
  await settle();

  const order = [
    ...document.querySelectorAll("li > button[aria-expanded]"),
  ].map((item) => item.textContent ?? "");

  expect(order.map((text) => text.split(/\s/)[0])).toEqual([
    "actions/list.js40",
    "src/list.js90",
    "nakama.plugin.json700",
  ]);
  expect(document.body.textContent).toContain("0 of 3 read");

  await act(async () =>
    document
      .querySelector<HTMLButtonElement>("li > button[aria-expanded]")
      ?.click()
  );
  await settle();

  expect(
    document.querySelector('[aria-label="actions/list.js"]')
  ).not.toBeNull();
  expect(document.body.textContent).toContain("1 of 3 read");
});
