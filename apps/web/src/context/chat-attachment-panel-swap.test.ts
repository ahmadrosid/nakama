import { describe, expect, test } from "bun:test";
import {
  type AttachmentPanelCloseInFlight,
  beginAttachmentPanelClose,
} from "./chat-attachment-panel-context-shared";

describe("beginAttachmentPanelClose", () => {
  test("returns null when missing panel or onClose", () => {
    const inFlight = { current: null as AttachmentPanelCloseInFlight };
    expect(beginAttachmentPanelClose(null, inFlight)).toBeNull();
    expect(beginAttachmentPanelClose({ id: "a" }, inFlight)).toBeNull();
  });

  test("awaits onClose once across rapid reuse", async () => {
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
    expect(inFlight.current).toBeNull();
  });
});
