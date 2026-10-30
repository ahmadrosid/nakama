import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatAttachmentPanelProvider } from "@/context/chat-attachment-panel-context";
import type { ChatAttachmentPanelContextValue } from "@/context/chat-attachment-panel-context-shared";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";

const KEY = "nakama:chat-panel:test-session";

let root: Root | null = null;

const previousLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage"
);

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: window.localStorage,
    writable: true,
  });
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;

  if (previousLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

/** Mounts the provider and returns a reader for its current value. */
function mount(): () => ChatAttachmentPanelContextValue {
  let panel: ChatAttachmentPanelContextValue | null = null;

  function Probe() {
    panel = useChatAttachmentPanel();

    return null;
  }

  act(() => root?.unmount());
  root = createRoot(document.createElement("div"));
  act(() =>
    root?.render(
      <ChatAttachmentPanelProvider rememberKey={KEY}>
        <Probe />
      </ChatAttachmentPanelProvider>
    )
  );

  return () => {
    if (!panel) {
      throw new Error("panel not mounted");
    }

    return panel;
  };
}

test("the open panel is saved and offered once after a reload", () => {
  const first = mount();
  act(() =>
    first().show({
      content: null,
      id: "card-1",
      restoreKey: "profile:artifacts/a.html",
      title: "a.html",
    })
  );
  expect(localStorage.getItem(KEY)).toBe("profile:artifacts/a.html");

  const second = mount();
  expect(second().claimRestore("profile:artifacts/other.html")).toBe(false);
  expect(second().claimRestore("profile:artifacts/a.html")).toBe(true);
  expect(second().claimRestore("profile:artifacts/a.html")).toBe(false);
});

test("closing the panel forgets it", () => {
  const panel = mount();
  act(() =>
    panel().show({
      content: null,
      id: "card-1",
      restoreKey: "profile:artifacts/a.html",
      title: "a.html",
    })
  );
  act(() => panel().hide());

  expect(localStorage.getItem(KEY)).toBeNull();
  expect(mount()().claimRestore("profile:artifacts/a.html")).toBe(false);
});
