import { expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ChatPage } from "./ChatPage";
import * as content from "./chat/chat-page-content";
import * as page from "./chat/use-chat-page";

test("slash focuses the composer without interrupting typing or shortcuts", async () => {
  const state = spyOn(page, "useChatPage").mockReturnValue(
    {} as page.ChatPageState
  );
  const view = spyOn(content, "ChatPageContent").mockImplementation(() => (
    <textarea defaultValue="draft" name="message" />
  ));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const press = (target: Element, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "/",
      ...options,
    });
    target.dispatchEvent(event);
    return event;
  };
  try {
    await act(async () => root.render(<ChatPage />));
    const composer = container.querySelector("textarea")!;
    expect(press(document.body).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(composer);
    expect(composer.value).toBe("draft");
    expect(press(composer).defaultPrevented).toBe(false);
    composer.blur();
    for (const options of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { isComposing: true },
      { key: "x" },
    ]) {
      expect(press(document.body, options).defaultPrevented).toBe(false);
      expect(document.activeElement).not.toBe(composer);
    }
    for (const html of [
      "<input />",
      "<textarea></textarea>",
      "<select></select>",
      '<div contenteditable="true"><span></span></div>',
      '<div role="dialog"><button></button></div>',
    ]) {
      const other = document.createElement("div");
      other.innerHTML = html;
      container.append(other);
      expect(
        press(other.querySelector("span, button") ?? other.firstElementChild!)
          .defaultPrevented
      ).toBe(false);
      expect(document.activeElement).not.toBe(composer);
      other.remove();
    }
    composer.disabled = true;
    expect(press(document.body).defaultPrevented).toBe(false);
    composer.disabled = false;
    await act(async () => root.unmount());
    expect(press(document.body).defaultPrevented).toBe(false);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    state.mockRestore();
    view.mockRestore();
  }
});
