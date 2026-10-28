import { afterEach, expect, spyOn, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import { usePromptInputController } from "@/components/ai-elements/prompt-input-context";
import { ChatDictationButton } from "@/components/chat/chat-dictation-button";
import { client } from "@/lib/client";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup();
  }
});

async function waitFor(check: () => boolean) {
  for (let tries = 0; tries < 50 && !check(); tries++) {
    await act(() => Bun.sleep(10));
  }
}

function queryButton(label: string) {
  return document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`
  );
}

function draftValue() {
  return (
    document.querySelector('[data-testid="draft-value"]')?.textContent ?? null
  );
}

function draftTextarea() {
  return document.querySelector<HTMLTextAreaElement>(
    '[data-testid="draft-textarea"]'
  );
}

/** Renders the provider draft value so tests can observe setInput calls. */
function DraftProbe() {
  const controller = usePromptInputController();

  return <div data-testid="draft-value">{controller.textInput.value}</div>;
}

/** Lets tests type through the provider, like real typing does. */
let setDraftInput: ((value: string) => void) | null = null;

function DraftWriter() {
  const controller = usePromptInputController();

  useEffect(() => {
    setDraftInput = (value: string) => controller.textInput.setInput(value);
  }, [controller]);

  return null;
}

class MockMediaRecorder {
  static isTypeSupported = () => true;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  start() {
    this.ondataavailable?.({ data: new Blob(["audio-bytes"]) });
  }
  stop() {
    this.onstop?.();
  }
}

class FakeFileReader {
  result: string | null = null;
  error: DOMException | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL(_blob: Blob) {
    this.result = "data:audio/webm;base64,AAAA";
    queueMicrotask(() => this.onload?.());
  }
}

function installMediaMocks() {
  const originalRecorder = globalThis.MediaRecorder;
  const originalFileReader = globalThis.FileReader;

  const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
    navigator,
    "mediaDevices"
  );

  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: MockMediaRecorder,
    writable: true,
  });
  Object.defineProperty(globalThis, "FileReader", {
    configurable: true,
    value: FakeFileReader,
    writable: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) },
  });

  cleanups.push(async () => {
    globalThis.MediaRecorder = originalRecorder;
    globalThis.FileReader = originalFileReader;

    if (mediaDevicesDescriptor) {
      Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
    } else {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: undefined,
      });
    }
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;

  const promise = new Promise<T>((r) => {
    resolve = r;
  });

  return { promise, resolve };
}

async function renderDictation(initialTextarea: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const queryClient = new QueryClient();

  const renderTree = async (showButton: boolean) => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <PromptInputProvider>
            <DraftProbe />
            <DraftWriter />
            <form>
              <textarea
                data-testid="draft-textarea"
                defaultValue={initialTextarea}
              />
              {showButton ? <ChatDictationButton /> : null}
            </form>
          </PromptInputProvider>
        </QueryClientProvider>
      );
    });
  };

  await renderTree(true);

  cleanups.push(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  return { renderTree };
}

async function click(label: string) {
  const button = queryButton(label);
  expect(button).not.toBeNull();
  await act(async () => {
    button?.click();
  });
}

function mockModel(model: string | null) {
  const settingsSpy = spyOn(
    client,
    "getTranscriptionSettings"
  ).mockResolvedValue({ model });

  cleanups.push(async () => {
    settingsSpy.mockRestore();
  });

  return settingsSpy;
}

test("hides the mic button when no transcription model is configured", async () => {
  const settingsSpy = mockModel(null);
  await renderDictation("");
  await waitFor(() => settingsSpy.mock.calls.length > 0);
  await act(() => Bun.sleep(10));
  expect(queryButton("Dictate with microphone")).toBeNull();
});

test("shows the mic button when a transcription model is configured", async () => {
  mockModel("9router-stt::selfhosted-stt/whisper-1");
  await renderDictation("");
  await waitFor(() => queryButton("Dictate with microphone") !== null);
  expect(queryButton("Dictate with microphone")).not.toBeNull();
});

test("appends a late transcription to the current draft without replacing typed text", async () => {
  installMediaMocks();
  mockModel("9router-stt::selfhosted-stt/whisper-1");
  const tx = deferred<{ text: string }>();

  const transcribeSpy = spyOn(client, "transcribeAudio").mockImplementation(
    () => tx.promise
  );

  cleanups.push(async () => {
    transcribeSpy.mockRestore();
  });

  await renderDictation("konten awal");
  await waitFor(() => queryButton("Dictate with microphone") !== null);
  await click("Dictate with microphone");
  await waitFor(() => queryButton("Send voice") !== null);

  await click("Send voice");
  await waitFor(
    () => document.body.textContent?.includes("Transcribing…") ?? false
  );

  // The user keeps typing while transcription is pending. Type through
  // the provider, like the real controlled textarea does.
  await act(async () => {
    setDraftInput?.("konten awal dan menunggu");
  });

  await act(async () => {
    tx.resolve({ text: "12345678" });
  });
  await waitFor(() => draftValue() === "konten awal dan menunggu 12345678");
  expect(draftValue()).toBe("konten awal dan menunggu 12345678");
});

test("discarding a recording never transcribes and leaves the draft untouched", async () => {
  installMediaMocks();
  mockModel("9router-stt::selfhosted-stt/whisper-1");

  const transcribeSpy = spyOn(client, "transcribeAudio").mockResolvedValue({
    text: "NOPE",
  });

  cleanups.push(async () => {
    transcribeSpy.mockRestore();
  });

  await renderDictation("draft awal");
  await waitFor(() => queryButton("Dictate with microphone") !== null);
  await click("Dictate with microphone");
  await waitFor(() => queryButton("Discard recording") !== null);
  await click("Discard recording");
  await waitFor(() => queryButton("Dictate with microphone") !== null);

  expect(transcribeSpy.mock.calls.length).toBe(0);
  expect(draftTextarea()?.value).toBe("draft awal");
  expect(draftValue()).toBe("");
});

test("a late result after leaving the chat never touches any draft", async () => {
  installMediaMocks();
  mockModel("9router-stt::selfhosted-stt/whisper-1");
  const tx = deferred<{ text: string }>();

  const transcribeSpy = spyOn(client, "transcribeAudio").mockImplementation(
    () => tx.promise
  );

  cleanups.push(async () => {
    transcribeSpy.mockRestore();
  });

  const { renderTree } = await renderDictation("konten awal");
  await waitFor(() => queryButton("Dictate with microphone") !== null);
  await click("Dictate with microphone");
  await waitFor(() => queryButton("Send voice") !== null);
  await click("Send voice");
  await waitFor(
    () => document.body.textContent?.includes("Transcribing…") ?? false
  );

  // Leaving the chat unmounts the button; its session token is invalidated.
  await renderTree(false);

  await act(async () => {
    tx.resolve({ text: "TELAT" });
  });
  await act(() => Bun.sleep(10));
  expect(draftValue()).toBe("");
  expect(draftTextarea()?.value).toBe("konten awal");
});

test("empty recorder mime type falls back to audio/webm", async () => {
  installMediaMocks();
  mockModel("9router-stt::selfhosted-stt/whisper-1");

  class EmptyMimeRecorder extends MockMediaRecorder {
    override mimeType = "";
  }

  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: EmptyMimeRecorder,
    writable: true,
  });

  const transcribeSpy = spyOn(client, "transcribeAudio").mockResolvedValue({
    text: "hi",
  });

  cleanups.push(async () => {
    transcribeSpy.mockRestore();
  });

  await renderDictation("");
  await waitFor(() => queryButton("Dictate with microphone") !== null);
  await click("Dictate with microphone");
  await waitFor(() => queryButton("Send voice") !== null);
  await click("Send voice");
  await waitFor(() => transcribeSpy.mock.calls.length > 0);

  const [request] = transcribeSpy.mock.calls[0];
  expect(request.mediaType).toBe("audio/webm");
  expect(request.filename).toBe("dictation.webm");
});

test("double click while the permission prompt is pending acquires one stream", async () => {
  installMediaMocks();
  mockModel("9router-stt::selfhosted-stt/whisper-1");

  const transcribeSpy = spyOn(client, "transcribeAudio").mockResolvedValue({
    text: "NOPE",
  });

  cleanups.push(async () => {
    transcribeSpy.mockRestore();
  });

  let gumCalls = 0;
  const gum = deferred<{ getTracks: () => Array<{ stop: () => void }> }>();

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: () => {
        gumCalls += 1;

        return gum.promise;
      },
    },
  });

  await renderDictation("");
  await waitFor(() => queryButton("Dictate with microphone") !== null);
  await click("Dictate with microphone");
  await click("Dictate with microphone");

  expect(gumCalls).toBe(1);

  await act(async () => {
    gum.resolve({ getTracks: () => [] });
  });
  await waitFor(() => queryButton("Send voice") !== null);
  await click("Discard recording");
  await waitFor(() => queryButton("Dictate with microphone") !== null);

  expect(transcribeSpy.mock.calls.length).toBe(0);
});

test("unmount while the permission prompt is pending stops the stream and never transcribes", async () => {
  installMediaMocks();
  mockModel("9router-stt::selfhosted-stt/whisper-1");

  const transcribeSpy = spyOn(client, "transcribeAudio").mockResolvedValue({
    text: "NOPE",
  });

  cleanups.push(async () => {
    transcribeSpy.mockRestore();
  });

  let stopped = 0;
  const gum = deferred<{ getTracks: () => Array<{ stop: () => void }> }>();

  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => gum.promise },
  });

  const { renderTree } = await renderDictation("");
  await waitFor(() => queryButton("Dictate with microphone") !== null);
  await click("Dictate with microphone");

  // Leaving the chat unmounts the button while the prompt is pending.
  await renderTree(false);

  await act(async () => {
    gum.resolve({
      getTracks: () => [
        {
          stop: () => {
            stopped += 1;
          },
        },
      ],
    });
  });
  await waitFor(() => stopped === 1);

  expect(stopped).toBe(1);
  expect(transcribeSpy.mock.calls.length).toBe(0);
  expect(queryButton("Send voice")).toBeNull();
});
