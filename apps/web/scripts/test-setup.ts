import { afterAll } from "bun:test";
import { Window } from "happy-dom";

// Base UI chooses its layout hook at import time, before individual tests run.
const dom = new Window({ url: "http://localhost" });
const globals = {
  cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
  DocumentFragment: dom.DocumentFragment,
  document: dom.document,
  Element: dom.Element,
  getComputedStyle: dom.getComputedStyle.bind(dom),
  HTMLElement: dom.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
  KeyboardEvent: dom.KeyboardEvent,
  MutationObserver: dom.MutationObserver,
  Node: dom.Node,
  navigator: dom.navigator,
  ResizeObserver: dom.ResizeObserver,
  requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
  window: dom,
};
const originals = new Map(
  Object.keys(globals).map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ])
);
for (const [key, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value,
    writable: true,
  });
}

afterAll(() => {
  dom.happyDOM.abort();
  for (const [key, descriptor] of originals) {
    if (descriptor) {
      Object.defineProperty(globalThis, key, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, key);
    }
  }
});
