import { afterEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { client } from "@/lib/client";
import { BrowserControlActions } from "./browser-live-view-panel-bridge";

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
        loginPageRef={{ current: options.loginPage ?? false }}
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
