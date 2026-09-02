import { describe, expect, test } from "bun:test";
import {
  type AttachmentPanelCloseInFlight,
  beginAttachmentPanelClose,
  beginPriorAttachmentPanelClose,
} from "./chat-attachment-panel-context-shared";

describe("beginPriorAttachmentPanelClose", () => {
  test("returns null when same id or missing prior panel", () => {
    const inFlight = { current: null as AttachmentPanelCloseInFlight };
    expect(
      beginPriorAttachmentPanelClose(
        { id: "a", onClose: () => {} },
        "a",
        inFlight
      )
    ).toBeNull();
    expect(beginPriorAttachmentPanelClose(null, "b", inFlight)).toBeNull();
    expect(
      beginPriorAttachmentPanelClose({ id: "a" }, "b", inFlight)
    ).toBeNull();
  });

  test("awaits onClose once across rapid swaps to different ids", async () => {
    const inFlight = { current: null as AttachmentPanelCloseInFlight };
    let closeCount = 0;
    let releaseClose!: () => void;
    const onClose = () =>
      new Promise<void>((resolve) => {
        closeCount += 1;
        releaseClose = resolve;
      });

    const first = beginPriorAttachmentPanelClose(
      { id: "a", onClose },
      "b",
      inFlight
    );
    const second = beginPriorAttachmentPanelClose(
      { id: "a", onClose },
      "c",
      inFlight
    );

    expect(first).toBe(second);
    expect(closeCount).toBe(1);

    releaseClose();
    await first;
    expect(inFlight.current).toBeNull();
  });
});

describe("beginAttachmentPanelClose", () => {
  test("reuses in-flight close for the same panel", async () => {
    const inFlight = { current: null as AttachmentPanelCloseInFlight };
    let closeCount = 0;
    let releaseClose!: () => void;
    const onClose = () =>
      new Promise<void>((resolve) => {
        closeCount += 1;
        releaseClose = resolve;
      });

    const first = beginAttachmentPanelClose({ id: "a", onClose }, inFlight);
    const second = beginAttachmentPanelClose({ id: "a", onClose }, inFlight);

    expect(first).toBe(second);
    expect(closeCount).toBe(1);

    releaseClose();
    await first;
  });
});
