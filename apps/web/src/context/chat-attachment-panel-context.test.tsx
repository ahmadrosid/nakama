import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatAttachmentPanelProvider } from "@/context/chat-attachment-panel-context";
import type { ChatAttachmentPanelContextValue } from "@/context/chat-attachment-panel-context-shared";
import { useChatAttachmentPanel } from "@/context/use-chat-attachment-panel";

const CHAT = "test-session";

const PANELS_KEY = "nakama:chat-panels";

const WIDTH_KEY = "nakama:attachment-panel-width";

const ARTIFACT = "profile:artifacts/a.html";

let root: Root | null = null;

let container: HTMLDivElement | null = null;

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
  container?.remove();
  container = null;

  if (previousLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

/** Mounts the provider and returns a reader for its current value. */
function mount(
  rememberId: string = CHAT
): () => ChatAttachmentPanelContextValue {
  let panel: ChatAttachmentPanelContextValue | null = null;

  function Probe() {
    panel = useChatAttachmentPanel();

    return null;
  }

  act(() => root?.unmount());
  container?.remove();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <ChatAttachmentPanelProvider rememberId={rememberId}>
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

function openArtifact(
  panel: () => ChatAttachmentPanelContextValue,
  id: string
) {
  act(() =>
    panel().show({ content: null, id, restoreKey: ARTIFACT, title: "a.html" })
  );
}

interface SavedPanel {
  chatId: string;
  id: string;
  restoreKey: string;
}

function savedPanels(): SavedPanel[] {
  // SAFETY: the provider under test writes this list of saved panels.
  return JSON.parse(localStorage.getItem(PANELS_KEY) ?? "[]") as SavedPanel[];
}

function savedPanel(chatId: string): SavedPanel | undefined {
  return savedPanels().find((panel) => panel.chatId === chatId);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("after a reload the exact card opens, not an earlier card of the same artifact", async () => {
  openArtifact(mount(), "turn-5");
  expect(savedPanel(CHAT)).toEqual({
    chatId: CHAT,
    id: "turn-5",
    restoreKey: ARTIFACT,
  });

  const panel = mount();
  const opened: string[] = [];
  act(() => {
    panel().requestRestore(ARTIFACT, "turn-2", () => opened.push("turn-2"));
    panel().requestRestore(ARTIFACT, "turn-5", () => opened.push("turn-5"));
  });
  await act(() => wait(10));

  expect(opened).toEqual(["turn-5"]);
});

test("another card of the same artifact opens when the exact card is not there", async () => {
  openArtifact(mount(), "temp-id");

  const panel = mount();
  const opened: string[] = [];
  act(() => {
    panel().requestRestore(ARTIFACT, "server-id", () =>
      opened.push("server-id")
    );
  });
  await act(() => wait(10));

  expect(opened).toEqual(["server-id"]);
});

test("a saved panel whose card never shows up is dropped, and does not open later", async () => {
  openArtifact(mount(), "turn-1");

  const panel = mount();
  await act(() => wait(1600));

  const opened: string[] = [];
  act(() => {
    panel().requestRestore(ARTIFACT, "turn-1", () => opened.push("turn-1"));
  });

  expect(opened).toEqual([]);
  expect(savedPanel(CHAT)).toBeUndefined();
});

test("closing the panel forgets it", () => {
  const panel = mount();
  openArtifact(panel, "turn-1");
  act(() => panel().hide());

  expect(savedPanel(CHAT)).toBeUndefined();
});

test("only the newest 50 chats are kept", () => {
  for (let index = 0; index < 52; index++) {
    openArtifact(mount(`chat-${index}`), "turn-1");
  }

  const chats = savedPanels().map((panel) => panel.chatId);

  expect(chats).toHaveLength(50);
  expect(chats).not.toContain("chat-0");
  expect(chats).toContain("chat-51");
});

test("the width is saved when a drag ends, not while the panel fits the window", () => {
  const panel = mount();
  openArtifact(panel, "turn-1");

  const handle = container?.querySelector('[role="separator"]');

  if (!handle) {
    throw new Error("resize handle not rendered");
  }

  act(() => {
    handle.dispatchEvent(
      new window.PointerEvent("pointerdown", { bubbles: true, clientX: 500 })
    );
    handle.dispatchEvent(
      new window.PointerEvent("pointermove", { bubbles: true, clientX: 450 })
    );
  });
  expect(localStorage.getItem(WIDTH_KEY)).toBeNull();

  act(() => {
    handle.dispatchEvent(
      new window.PointerEvent("pointerup", { bubbles: true, clientX: 450 })
    );
  });
  expect(Number(localStorage.getItem(WIDTH_KEY))).toBeGreaterThan(0);
});
