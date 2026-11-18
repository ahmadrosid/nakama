import { afterEach, expect, spyOn, test } from "bun:test";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  type ChatAttachmentPanelConfig,
  ChatAttachmentPanelContext,
} from "@/context/chat-attachment-panel-context-shared";
import type { ChatListItem } from "@/lib/chat-history";
import { client } from "@/lib/client";
import {
  BrowserControlActions,
  BrowserLiveViewPanelBridge,
  BrowserSignInCard,
} from "./browser-live-view-panel-bridge";

afterEach(() => {
  document.body.replaceChildren();
});

function button(name: string) {
  const found = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === name
  );

  if (!found) {
    throw new Error(`No button named ${name}`);
  }

  return found;
}

async function renderActions(options: {
  loginPage?: boolean;
  onStop?: () => void;
  sessionIdRef?: { current: string };
}) {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);

  await act(async () =>
    root.render(
      <BrowserControlActions
        loginPageRef={{ current: options.loginPage ? "call-0" : null }}
        onStop={options.onStop ?? (() => undefined)}
        sessionIdRef={options.sessionIdRef ?? { current: "chat-a" }}
      />
    )
  );

  return root;
}

test("records login before handoff, against the chat the user took control in", async () => {
  const record = spyOn(client, "recordSessionBrowserControl").mockResolvedValue(
    undefined
  );

  const sessionIdRef = { current: "chat-a" };

  try {
    const root = await renderActions({ loginPage: true, sessionIdRef });

    await act(async () => button("Take control").click());
    sessionIdRef.current = "chat-b";
    await act(async () => button("Hand back to agent").click());

    expect(record.mock.calls).toEqual([
      ["chat-a", "takeover"],
      ["chat-a", "login"],
      ["chat-a", "handoff"],
    ]);
    expect(button("Take control")).toBeTruthy();
    await act(async () => root.unmount());
  } finally {
    record.mockRestore();
  }
});

test("keeps the label when the takeover is not recorded", async () => {
  const record = spyOn(client, "recordSessionBrowserControl").mockRejectedValue(
    new Error("offline")
  );

  try {
    const root = await renderActions({});

    await act(async () => button("Take control").click());

    expect(button("Take control").disabled).toBe(false);
    await act(async () => root.unmount());
    expect(record.mock.calls).toEqual([["chat-a", "takeover"]]);
  } finally {
    record.mockRestore();
  }
});

test("hands back when the panel closes or the browser stops", async () => {
  const record = spyOn(client, "recordSessionBrowserControl").mockResolvedValue(
    undefined
  );

  let stops = 0;

  try {
    const closed = await renderActions({});

    await act(async () => button("Take control").click());
    await act(async () => closed.unmount());

    expect(record.mock.calls).toEqual([
      ["chat-a", "takeover"],
      ["chat-a", "handoff"],
    ]);

    record.mockClear();

    const stopped = await renderActions({
      onStop: () => {
        stops += 1;
      },
    });

    await act(async () => button("Take control").click());
    await act(async () => button("Stop browser").click());
    await act(async () => stopped.unmount());

    expect(record.mock.calls).toEqual([
      ["chat-a", "takeover"],
      ["chat-a", "handoff"],
    ]);
    expect(stops).toBe(1);
  } finally {
    record.mockRestore();
  }
});

const loginPage: ChatListItem[] = [
  {
    content: "",
    id: "tool-1",
    role: "tool",
    tool: "browser_navigate",
    toolCallId: "call-1",
    toolResult: { loginForm: true, url: "https://example.com/login" },
    toolStatus: "done",
  },
];

/** The chat column with the card, next to the panel the bridge opens. */
function ChatWithBrowser() {
  const [panel, setPanel] = useState<ChatAttachmentPanelConfig | null>(null);

  return (
    <ChatAttachmentPanelContext.Provider
      value={{
        activeId: panel?.id ?? null,
        hide: () => setPanel(null),
        isFullscreen: false,
        isOpen: panel !== null,
        requestRestore: () => () => undefined,
        show: setPanel,
        update: () => undefined,
      }}
    >
      <BrowserLiveViewPanelBridge messages={loginPage} sessionId="chat-a" />
      <BrowserSignInCard messages={loginPage} sessionId="chat-a" />
      {panel ? <header>{panel.headerActions}</header> : null}
    </ChatAttachmentPanelContext.Provider>
  );
}

async function renderChat(liveViewUrl: string | null) {
  const browser = spyOn(client, "getSessionBrowser").mockResolvedValue({
    liveViewUrl,
  });

  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);

  await act(async () => root.render(<ChatWithBrowser />));

  return { browser, root };
}

test("the chat card takes control and hands back with the panel header in step", async () => {
  const record = spyOn(client, "recordSessionBrowserControl").mockResolvedValue(
    undefined
  );

  const { browser, root } = await renderChat("https://live.example/view");

  try {
    expect(document.body.textContent).toContain(
      "example.com needs your sign-in"
    );

    const takeControl = [...document.querySelectorAll("button")].filter(
      (element) => element.textContent === "Take control"
    );

    expect(takeControl).toHaveLength(2);
    await act(async () => takeControl[0]?.click());

    expect(
      [...document.querySelectorAll("button")].filter(
        (element) => element.textContent === "Hand back to agent"
      )
    ).toHaveLength(2);

    await act(async () => button("Hand back to agent").click());

    expect(record.mock.calls).toEqual([
      ["chat-a", "takeover"],
      ["chat-a", "login"],
      ["chat-a", "handoff"],
    ]);
    expect(document.body.textContent).toContain("Handed back to the agent");
    await act(async () => root.unmount());
  } finally {
    record.mockRestore();
    browser.mockRestore();
  }
});

test("the chat card stays hidden when no browser runs", async () => {
  const { browser, root } = await renderChat(null);

  try {
    expect(document.querySelectorAll("button")).toHaveLength(0);
    await act(async () => root.unmount());
  } finally {
    browser.mockRestore();
  }
});
