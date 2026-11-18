import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { ProfileSummary } from "@nakama/core";
import { groupRoster } from "@nakama/core/agent-groups";
import type { DocumentAttachment } from "@nakama/core/contract";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { GroupComposer } from "./group-composer";

const container = document.createElement("div");

document.body.append(container);

const root = createRoot(container);

// The test DOM has no FileReader; this one reads the file's real bytes.
class BytesFileReader {
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  result: string | null = null;
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString("base64")}`;
      this.onload?.();
    }, this.onerror);
  }
}

const originalFileReader = globalThis.FileReader;

Object.defineProperty(globalThis, "FileReader", {
  configurable: true,
  value: BytesFileReader,
  writable: true,
});

afterEach(async () => {
  await act(async () => root.render(null));
});

afterAll(() => {
  globalThis.FileReader = originalFileReader;
});

async function waitFor(check: () => boolean) {
  for (let tries = 0; tries < 50 && !check(); tries++) {
    await act(() => Bun.sleep(10));
  }
}

// SAFETY: the composer reads only a member's id and name.
const roster = groupRoster({ handles: {}, memberIds: ["a"] }, [
  { id: "a", name: "Alpha" },
] as ProfileSummary[]);

test("a ZIP can be attached and is sent as a document", async () => {
  const onSend = mock((_content: string, _documents?: DocumentAttachment[]) =>
    Promise.resolve()
  );

  await act(async () => {
    root.render(
      <GroupComposer
        allowDocuments
        busy={false}
        onSend={onSend}
        onStop={() => undefined}
        roster={roster}
        stopping={false}
      />
    );
  });

  const input = container.querySelector<HTMLInputElement>('input[type="file"]');

  if (!input) {
    throw new Error("Expected the hidden file input to render.");
  }

  const zip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "data.zip", {
    type: "application/zip",
  });

  Object.defineProperty(input, "files", { value: [zip] });
  await act(async () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await waitFor(() => Boolean(container.textContent?.includes("data.zip")));

  const send = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Send message"]'
  );

  await act(async () => send?.click());
  await waitFor(() => onSend.mock.calls.length > 0);

  expect(onSend.mock.calls[0]?.[1]).toEqual([
    { data: "UEsDBA==", filename: "data.zip", mediaType: "application/zip" },
  ]);
});
