import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SIDEBAR_COLLAPSED_KEY } from "@/lib/sidebar";
import { useSidebarCollapsed } from "./use-sidebar-collapsed";

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
  document.body.innerHTML = "";

  if (previousLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", previousLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

function renderProbe(shortcut: boolean) {
  const state = { collapsed: false };

  function Probe() {
    state.collapsed = useSidebarCollapsed({ shortcut }).collapsed;

    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<Probe />));

  return { root, state };
}

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", {
    cancelable: true,
    key: "b",
    ...init,
  });

  act(() => {
    window.dispatchEvent(event);
  });

  return event;
}

test("Ctrl+B and Cmd+B toggle the sidebar and save the state", () => {
  const { root, state } = renderProbe(true);

  const event = press({ ctrlKey: true });
  expect(event.defaultPrevented).toBe(true);
  expect(state.collapsed).toBe(true);
  expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("true");

  press({ metaKey: true });
  expect(state.collapsed).toBe(false);
  expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe("false");

  act(() => root.unmount());
});

test("other keys and the drawer copy do not toggle the sidebar", () => {
  const { root, state } = renderProbe(true);

  press({});
  press({ ctrlKey: true, shiftKey: true });
  press({ ctrlKey: true, key: "k" });
  expect(state.collapsed).toBe(false);
  act(() => root.unmount());

  const drawer = renderProbe(false);
  press({ ctrlKey: true });
  expect(drawer.state.collapsed).toBe(false);
  act(() => drawer.root.unmount());
});
